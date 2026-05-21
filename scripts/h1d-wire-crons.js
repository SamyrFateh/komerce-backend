#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function fail(message) {
  console.error(`❌ H1D codemod refused: ${message}`);
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

if (next.includes('startOperationalCrons();')) {
  fail('server.js already appears wired for H1D');
}

next = replaceOnce(
  next,
  "// ── Cron cash relais ──────────────────────────────────────────────────────────\n\n",
  "\n\n// ── Démarrage + Graceful Shutdown ──────────────────────────────────────────────",
  "// ── Operational crons ───────────────────────────────────────────────────────\nconst { startOperationalCrons } = require('./bootstrap/crons');\nstartOperationalCrons();",
  'crons block'
);

const requiredNeedles = [
  "app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use(express.json({ limit: '1mb' }));",
  'mountApiRoutesBeforeStripeOwnedBlocks(app);',
  'app.get(\'/api/health\'',
  'app.use(errorHandler);',
  'app.listen(PORT',
  'walletService.ensureWalletTables()',
];

for (const needle of requiredNeedles) {
  if (!next.includes(needle)) fail(`safety check missing after transform: ${needle}`);
}

const removedNeedles = [
  'processCashRelaisReminders',
  'processBackorderReminders',
  'BACKORDER_CHECK_INTERVAL_MS',
  'backorderCronRunning',
  'cronRunning',
];
for (const needle of removedNeedles) {
  if (next.includes(needle)) fail(`old cron code still present in server.js: ${needle}`);
}

console.log('✅ H1D crons codemod checks passed');
console.log(`Mode: ${MODE}`);
console.log(`server.js length: ${original.length} → ${next.length}`);

if (MODE === 'write') {
  fs.writeFileSync(SERVER, next, 'utf8');
  console.log('✅ server.js updated. Review with: git diff -- server.js');
} else {
  console.log('No file written. Re-run with --write to apply.');
}
