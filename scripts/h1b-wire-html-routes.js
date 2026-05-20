#!/usr/bin/env node
'use strict';

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
let next = original;

if (next.includes('mountHtmlRoutes(app, __dirname);')) {
  fail('server.js already appears wired for H1B');
}

next = replaceOnce(
  next,
  "const {\n  mountApiRoutesBeforeStripeOwnedBlocks,\n  mountApiRoutesAfterStripeOwnedBlocks,\n} = require('./bootstrap/api-routes');\n",
  "\n\nconst walletService",
  "const {\n  mountApiRoutesBeforeStripeOwnedBlocks,\n  mountApiRoutesAfterStripeOwnedBlocks,\n} = require('./bootstrap/api-routes');\nconst { mountHtmlRoutes } = require('./bootstrap/html-routes');",
  'html import insertion'
);

next = replaceOnce(
  next,
  '// ── SPA fallback ────────────────────────────────────────────────────────────\n\n// ── Tracking short URL: /s/:token → serve suivi.html ──────────────────────\n',
  '\n\napp.use(errorHandler);',
  '// ── HTML routes / SPA fallback ─────────────────────────────────────────────\nmountHtmlRoutes(app, __dirname);',
  'html routes block'
);

const requiredNeedles = [
  "app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use(express.json({ limit: '1mb' }));",
  'mountApiRoutesBeforeStripeOwnedBlocks(app);',
  'mountApiRoutesAfterStripeOwnedBlocks(app);',
  'app.post(\'/api/shared-carts/stripe/webhook\'',
  'app.post(\'/api/collective-payments/stripe/webhook\'',
  'app.get(\'/api/health\'',
  'app.use(errorHandler);',
  'setInterval(async () => {',
  'app.listen(PORT',
];

for (const needle of requiredNeedles) {
  if (!next.includes(needle)) fail(`safety check missing after transform: ${needle}`);
}

const removedNeedles = [
  "app.get('/s/:token'",
  "app.get('/c/:token'",
  "app.get('/mon-compte'",
  "app.get('/event/create'",
  "app.get('/Komerce_Boutique.html'",
  "app.get('*'",
];
for (const needle of removedNeedles) {
  if (next.includes(needle)) fail(`old HTML route still present in server.js: ${needle}`);
}

console.log('✅ H1B HTML routes codemod checks passed');
console.log(`Mode: ${MODE}`);
console.log(`server.js length: ${original.length} → ${next.length}`);

if (MODE === 'write') {
  fs.writeFileSync(SERVER, next, 'utf8');
  console.log('✅ server.js updated. Review with: git diff -- server.js');
} else {
  console.log('No file written. Re-run with --write to apply.');
}
