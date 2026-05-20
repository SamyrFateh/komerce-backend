#!/usr/bin/env node
'use strict';

/**
 * H1B wiring codemod.
 *
 * Objectif : câbler `bootstrap/html-routes.js` dans `server.js` avec un diff
 * local contrôlable, sans réécrire server.js via l'API GitHub.
 *
 * Usage recommandé :
 *   node scripts/h1b-wire-html-routes.js --check
 *   node scripts/h1b-wire-html-routes.js --write
 *   git diff -- server.js
 *   npm test
 *   npm run test:p0
 *
 * Le script est strict : si les bornes attendues ne sont pas trouvées
 * exactement une fois, il s'arrête sans modifier le fichier.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function fail(message) {
  console.error(`❌ H1B codemod refused: ${message}`);
  process.exit(1);
}

function replaceOnce(input, startMarker, endMarker, replacement, label) {
  const start = input.indexOf(startMarker);
  if (start < 0) fail(`${label}: start marker not found`);
  const end = input.indexOf(endMarker, start + startMarker.length);
  if (end < 0) fail(`${label}: end marker not found`);
  if (input.indexOf(startMarker, start + 1) >= 0) fail(`${label}: start marker appears more than once`);

  return input.slice(0, start) + replacement + input.slice(end);
}

const original = fs.readFileSync(SERVER, 'utf8');

if (original.includes('mountStaticHtmlRoutes(app, { rootDir: __dirname })')) {
  fail('server.js already appears to be wired for H1B');
}

// ── 1. Add bootstrap import near API bootstrap import ───────────────────────
const apiImportBlock = `const {
  mountApiRoutesBeforeStripeOwnedBlocks,
  mountApiRoutesAfterStripeOwnedBlocks,
} = require('./bootstrap/api-routes');`;

const htmlImportBlock = `const {
  mountApiRoutesBeforeStripeOwnedBlocks,
  mountApiRoutesAfterStripeOwnedBlocks,
} = require('./bootstrap/api-routes');
const {
  mountStaticHtmlRoutes,
  mountHtmlFallbackRoutes,
} = require('./bootstrap/html-routes');`;

let next = replaceOnce(original, apiImportBlock, apiImportBlock + '\n', htmlImportBlock + '\n', 'bootstrap imports');

// ── 2. Replace static html/auth-guard block before API routes ───────────────
const staticBlockStart = '// ── Auth guard injection — auto-injects session checker into admin pages ────';
const staticBlockEnd = '// ── Routes API ────────────────────────────────────────────────────────────';
const staticReplacement = `// ── Routes HTML statiques + auth guard injection ───────────────────────────
mountStaticHtmlRoutes(app, { rootDir: __dirname });

// ── Routes API ────────────────────────────────────────────────────────────`;

next = replaceOnce(next, staticBlockStart, staticBlockEnd, staticReplacement, 'static html routes block');

// ── 3. Replace SPA/html fallback block after public config ─────────────────
const fallbackBlockStart = '// ── SPA fallback ────────────────────────────────────────────────────────────';
const fallbackBlockEnd = 'app.use(errorHandler);';
const fallbackReplacement = `// ── Routes HTML applicatives + fallback SPA ────────────────────────────────
mountHtmlFallbackRoutes(app, { rootDir: __dirname });

app.use(errorHandler);`;

next = replaceOnce(next, fallbackBlockStart, fallbackBlockEnd, fallbackReplacement, 'html fallback routes block');

// ── Safety checks ───────────────────────────────────────────────────────────
const requiredChecks = [
  "require('./bootstrap/html-routes')",
  'mountStaticHtmlRoutes(app, { rootDir: __dirname });',
  'mountHtmlFallbackRoutes(app, { rootDir: __dirname });',
  "app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use('/api/collective-payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use(express.json({ limit: '1mb' }));",
  'mountApiRoutesBeforeStripeOwnedBlocks(app);',
  'mountApiRoutesAfterStripeOwnedBlocks(app);',
  'app.use(errorHandler);',
  'const server = app.listen(PORT, () => {',
];

for (const needle of requiredChecks) {
  if (!next.includes(needle)) fail(`safety check missing after transform: ${needle}`);
}

const removedNeedles = [
  "const _fs = require('fs');",
  "const ADMIN_DASHBOARD_PATHS = [",
  "app.get('/event/create'",
  "app.get('/Komerce_Boutique.html'",
  "app.get('*', (req, res) => {",
];
for (const needle of removedNeedles) {
  if (next.includes(needle)) fail(`old HTML block still contains: ${needle}`);
}

console.log('✅ H1B codemod checks passed');
console.log(`Mode: ${MODE}`);
console.log(`server.js length: ${original.length} → ${next.length}`);

if (MODE === 'write') {
  fs.writeFileSync(SERVER, next, 'utf8');
  console.log('✅ server.js updated. Review with: git diff -- server.js');
} else {
  console.log('No file written. Re-run with --write to apply.');
}
