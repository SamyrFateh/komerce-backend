#!/usr/bin/env node
'use strict';

/**
 * H2 wiring codemod.
 *
 * Extracts the bottom server lifecycle block from server.js into
 * bootstrap/server-lifecycle.js:
 * - PORT resolution
 * - wallet/routing/parcel security startup ensures
 * - app.listen + startup migrations trigger
 * - SIGTERM graceful shutdown
 * - crash guards
 *
 * It does not touch routes, webhooks, parsers, security, crons, HTML, API,
 * startup migrations content, or module.exports = app.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const BOOTSTRAP = path.join(ROOT, 'bootstrap', 'server-lifecycle.js');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function fail(message) {
  console.error(`❌ H2 codemod refused: ${message}`);
  process.exit(1);
}

const lifecycleBootstrap = `'use strict';

/**
 * H2 — Server lifecycle bootstrap.
 *
 * Centralise server startup, graceful shutdown and crash guards.
 * Keeps the same operational behavior as the previous inline server.js block.
 */

function startServerLifecycle({
  app,
  db,
  walletService,
  routingService,
  parcelSecurity,
  runStartupMigrations,
  fixAdminHash,
  fixMissingSchema,
  runAllSeeds,
  port = process.env.PORT || 3000,
}) {
  walletService.ensureWalletTables().catch(e => console.error('Wallet init error:', e.message));
  routingService.ensureRoutingColumns(db).catch(e => console.error('Routing init error:', e.message));
  parcelSecurity.ensureSecurityTables(db).catch(e => console.error('Security init error:', e.message));

  const server = app.listen(port, () => {
    console.log(\`KOMERCE API v12.4 — port \${port} — démarrage immédiat — migrations en background\`);

    setImmediate(() => {
      runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds })
        .catch(err => console.error('❌ Migration error (non-fatal, serveur opérationnel):', err.message));
    });
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM reçu — fermeture gracieuse...');
    server.close(() => {
      console.log('Serveur fermé proprement.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  });

  // NEW-07 — Crash guards : éviter qu'une promesse non catchée tue le process
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    // Sortir proprement — l'état du process est incertain après uncaughtException
    setTimeout(() => process.exit(1), 500);
  });

  return server;
}

module.exports = {
  startServerLifecycle,
};
`;

const original = fs.readFileSync(SERVER, 'utf8');

if (original.includes("require('./bootstrap/server-lifecycle')")) {
  fail('server.js already appears wired for H2');
}

if (fs.existsSync(BOOTSTRAP)) {
  fail('bootstrap/server-lifecycle.js already exists');
}

const startMarker = '// ── Démarrage + Graceful Shutdown ──────────────────────────────────────────────';
const endMarker = '\nmodule.exports = app;';
const start = original.indexOf(startMarker);
if (start < 0) fail('lifecycle start marker not found');
if (original.indexOf(startMarker, start + 1) >= 0) fail('lifecycle start marker appears more than once');

const end = original.indexOf(endMarker, start);
if (end < 0) fail('module.exports marker not found after lifecycle block');

const lifecycleBlock = original.slice(start, end);

const mustMoveMarkers = [
  'const PORT = process.env.PORT || 3000;',
  "walletService.ensureWalletTables().catch(e => console.error('Wallet init error:', e.message));",
  "routingService.ensureRoutingColumns(db).catch(e => console.error('Routing init error:', e.message));",
  "parcelSecurity.ensureSecurityTables(db).catch(e => console.error('Security init error:', e.message));",
  'const server = app.listen(PORT, () => {',
  'runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds })',
  "process.on('SIGTERM'",
  "process.on('unhandledRejection'",
  "process.on('uncaughtException'",
];

for (const marker of mustMoveMarkers) {
  if (!lifecycleBlock.includes(marker)) fail(`expected lifecycle marker missing before transform: ${marker}`);
}

const replacement = `// ── Server lifecycle ────────────────────────────────────────────────────────
const { startServerLifecycle } = require('./bootstrap/server-lifecycle');
startServerLifecycle({
  app,
  db,
  walletService,
  routingService,
  parcelSecurity,
  runStartupMigrations,
  fixAdminHash,
  fixMissingSchema,
  runAllSeeds,
});`;

const next = original.slice(0, start) + replacement + original.slice(end);

const postChecks = [
  "require('./bootstrap/server-lifecycle')",
  'startServerLifecycle({',
  "require('./bootstrap/startup-migrations')",
  "app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use(express.json({ limit: '1mb' }));",
  'mountApiRoutesBeforeStripeOwnedBlocks(app);',
  'mountHtmlRoutes(app, __dirname);',
  'startOperationalCrons();',
  'module.exports = app;',
];

for (const marker of postChecks) {
  if (!next.includes(marker)) fail(`post-transform marker missing: ${marker}`);
}

for (const marker of mustMoveMarkers) {
  if (next.includes(marker)) fail(`lifecycle marker still present in server.js after transform: ${marker}`);
  if (!lifecycleBootstrap.includes(marker.replace('PORT', 'port'))) {
    // Some markers intentionally differ after parameterization; check direct fallback too.
    const acceptable = marker === 'const PORT = process.env.PORT || 3000;' || marker === 'const server = app.listen(PORT, () => {';
    if (!acceptable && !lifecycleBootstrap.includes(marker)) fail(`marker missing from generated bootstrap: ${marker}`);
  }
}

console.log('✅ H2 server lifecycle codemod checks passed');
console.log(`Mode: ${MODE}`);
console.log(`server.js length: ${original.length} → ${next.length}`);
console.log(`bootstrap/server-lifecycle.js length: ${lifecycleBootstrap.length}`);

if (MODE === 'write') {
  fs.writeFileSync(BOOTSTRAP, lifecycleBootstrap, 'utf8');
  fs.writeFileSync(SERVER, next, 'utf8');
  console.log('✅ Files updated. Review with: git diff -- server.js bootstrap/server-lifecycle.js');
} else {
  console.log('No files written. Re-run with --write to apply.');
}
