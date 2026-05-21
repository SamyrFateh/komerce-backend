#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function fail(message) {
  console.error(`❌ H1C codemod refused: ${message}`);
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

if (next.includes("require('./bootstrap/security')")) {
  fail('server.js already appears wired for H1C');
}

next = next.replace("const cors         = require('cors');\nconst helmet       = require('helmet');\n", "");

next = replaceOnce(
  next,
  "const FRONTEND_URL = process.env.FRONTEND_URL || '';\n\n// ── CORS ──────────────────────────────────────────────────────────────────────\n\n",
  "\n\n// ── Security headers ────────────────────────────────────────────────────\n\napp.use(helmet({",
  "const { applySecurity } = require('./bootstrap/security');\n\n",
  'cors block'
);

next = replaceOnce(
  next,
  "// ── Security headers ────────────────────────────────────────────────────\n\napp.use(helmet({",
  "\n\n// ── Stripe webhook MUST receive raw body for signature verification ──────────",
  "// ── Security headers + CORS ───────────────────────────────────────────────\napplySecurity(app);",
  'helmet/cors apply block'
);

const requiredNeedles = [
  "app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use(express.json({ limit: '1mb' }));",
  'mountApiRoutesBeforeStripeOwnedBlocks(app);',
  'app.get(\'/api/health\'',
  'app.use(errorHandler);',
  'app.listen(PORT',
];

for (const needle of requiredNeedles) {
  if (!next.includes(needle)) fail(`safety check missing after transform: ${needle}`);
}

const removedNeedles = [
  "const cors         = require('cors');",
  "const helmet       = require('helmet');",
  'function isAllowedOrigin(origin)',
  'const corsOptions = {',
  'app.use(cors(corsOptions));',
];
for (const needle of removedNeedles) {
  if (next.includes(needle)) fail(`old security code still present in server.js: ${needle}`);
}

if (!next.includes('applySecurity(app);')) fail('applySecurity(app) missing');

console.log('✅ H1C security codemod checks passed');
console.log(`Mode: ${MODE}`);
console.log(`server.js length: ${original.length} → ${next.length}`);

if (MODE === 'write') {
  fs.writeFileSync(SERVER, next, 'utf8');
  console.log('✅ server.js updated. Review with: git diff -- server.js');
} else {
  console.log('No file written. Re-run with --write to apply.');
}
