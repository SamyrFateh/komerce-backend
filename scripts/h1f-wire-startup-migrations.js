#!/usr/bin/env node
'use strict';

/**
 * H1F wiring codemod.
 *
 * This script extracts the startup migrations/seeds block from server.js into
 * bootstrap/startup-migrations.js and replaces the inline setImmediate body with
 * a call to runStartupMigrations(...).
 *
 * It intentionally copies the current block from server.js instead of relying on
 * a manually duplicated mega-block. This keeps the extraction exact and reviewable.
 *
 * Usage:
 *   node scripts/h1f-wire-startup-migrations.js --check
 *   node scripts/h1f-wire-startup-migrations.js --write
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const BOOTSTRAP = path.join(ROOT, 'bootstrap', 'startup-migrations.js');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function fail(message) {
  console.error(`❌ H1F codemod refused: ${message}`);
  process.exit(1);
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function indentBlock(block, spaces) {
  const pad = ' '.repeat(spaces);
  return block
    .split('\n')
    .map(line => (line.trim() ? pad + line : line))
    .join('\n');
}

function stripOuterTryAndCatch(setImmediateBlock) {
  const bodyStart = "  setImmediate(async () => {\n    try {\n";
  const bodyEnd = "\n    } catch (err) {\n      console.error('❌ Migration error (non-fatal, serveur opérationnel):', err.message);\n    }\n  });";

  if (!setImmediateBlock.startsWith(bodyStart)) fail('setImmediate block does not start with expected try wrapper');
  if (!setImmediateBlock.endsWith(bodyEnd)) fail('setImmediate block does not end with expected catch wrapper');

  let body = setImmediateBlock.slice(bodyStart.length, setImmediateBlock.length - bodyEnd.length);

  // Remove exactly the six spaces used by the current inline body.
  body = body
    .split('\n')
    .map(line => (line.startsWith('      ') ? line.slice(6) : line))
    .join('\n');

  return body;
}

function buildBootstrap(migrationBody) {
  return `'use strict';

/**
 * H1F — Startup migrations bootstrap.
 *
 * Extracted from server.js without changing execution order or SQL content.
 * All historical startup migrations remain non-fatal at the individual block
 * level, and the caller keeps the global non-fatal catch.
 */

async function runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds }) {
${indentBlock(migrationBody, 2)}
}

module.exports = {
  runStartupMigrations,
};
`;
}

const original = fs.readFileSync(SERVER, 'utf8');

if (original.includes("require('./bootstrap/startup-migrations')")) {
  fail('server.js already appears wired for H1F');
}

if (fs.existsSync(BOOTSTRAP)) {
  fail('bootstrap/startup-migrations.js already exists');
}

const requiredMarkers = [
  'await fixAdminHash();',
  'await fixMissingSchema();',
  'await runAllSeeds();',
  "console.log('✅ Migrations et seeds terminées');",
  "process.on('SIGTERM'",
  'module.exports = app;',
  "const server = app.listen(PORT, () => {",
];

for (const marker of requiredMarkers) {
  if (!original.includes(marker)) fail(`required marker missing in server.js: ${marker}`);
}

const setImmediateStartMarker = "  setImmediate(async () => {\n    try {\n      await fixAdminHash();";
const setImmediateEndMarker = "\n    } catch (err) {\n      console.error('❌ Migration error (non-fatal, serveur opérationnel):', err.message);\n    }\n  });";

const start = original.indexOf(setImmediateStartMarker);
if (start < 0) fail('startup migrations setImmediate start marker not found');
if (original.indexOf(setImmediateStartMarker, start + 1) >= 0) fail('startup migrations setImmediate start marker appears more than once');

const end = original.indexOf(setImmediateEndMarker, start);
if (end < 0) fail('startup migrations setImmediate end marker not found');

const setImmediateBlock = original.slice(start, end + setImmediateEndMarker.length);
const migrationBody = stripOuterTryAndCatch(setImmediateBlock);

const bootstrap = buildBootstrap(migrationBody);

const importAnchor = "const { startOperationalCrons } = require('./bootstrap/crons');\nstartOperationalCrons();";
if (!original.includes(importAnchor)) fail('import anchor after crons not found');

const importReplacement = `${importAnchor}\nconst { runStartupMigrations } = require('./bootstrap/startup-migrations');`;

const replacementBlock = `  setImmediate(() => {
    runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds })
      .catch(err => console.error('❌ Migration error (non-fatal, serveur opérationnel):', err.message));
  });`;

let next = original.replace(importAnchor, importReplacement);
next = next.replace(setImmediateBlock, replacementBlock);

const postChecks = [
  "require('./bootstrap/startup-migrations')",
  'runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds })',
  "app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use(express.json({ limit: '1mb' }));",
  'mountApiRoutesBeforeStripeOwnedBlocks(app);',
  'mountHtmlRoutes(app, __dirname);',
  'startOperationalCrons();',
  'const server = app.listen(PORT, () => {',
  "process.on('SIGTERM'",
  'module.exports = app;',
];

for (const marker of postChecks) {
  if (!next.includes(marker)) fail(`post-transform marker missing: ${marker}`);
}

const shouldBeMovedOutOfServer = [
  'await fixAdminHash();',
  'await fixMissingSchema();',
  'await runAllSeeds();',
  "console.log('✅ Migrations et seeds terminées');",
  "const migration037 = require('./scripts/migration-037-fix-products');",
];

for (const marker of shouldBeMovedOutOfServer) {
  if (next.includes(marker)) fail(`migration marker still present in server.js after transform: ${marker}`);
  if (!bootstrap.includes(marker)) fail(`migration marker missing from generated bootstrap: ${marker}`);
}

if (countOccurrences(next, 'setImmediate(') !== 1) {
  fail('unexpected number of setImmediate occurrences after transform');
}

console.log('✅ H1F startup migrations codemod checks passed');
console.log(`Mode: ${MODE}`);
console.log(`server.js length: ${original.length} → ${next.length}`);
console.log(`bootstrap/startup-migrations.js length: ${bootstrap.length}`);

if (MODE === 'write') {
  fs.writeFileSync(BOOTSTRAP, bootstrap, 'utf8');
  fs.writeFileSync(SERVER, next, 'utf8');
  console.log('✅ Files updated. Review with: git diff -- server.js bootstrap/startup-migrations.js');
} else {
  console.log('No files written. Re-run with --write to apply.');
}
