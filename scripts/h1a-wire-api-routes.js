#!/usr/bin/env node
'use strict';

/**
 * H1A wiring codemod.
 *
 * Objectif : câbler `bootstrap/api-routes.js` dans `server.js` avec un diff
 * local contrôlable, sans réécrire server.js via l'API GitHub.
 *
 * Usage recommandé :
 *   node scripts/h1a-wire-api-routes.js --check
 *   node scripts/h1a-wire-api-routes.js --write
 *   git diff -- server.js
 *   npm test
 *   npm run test:p0
 *
 * Le script est volontairement strict : si les bornes attendues ne sont pas
 * trouvées exactement une fois, il s'arrête sans modifier le fichier.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function fail(message) {
  console.error(`❌ H1A codemod refused: ${message}`);
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

if (original.includes('mountApiRoutesBeforeStripeOwnedBlocks(app)')) {
  fail('server.js already appears to be wired');
}

const importBlockStart = '// ── Routes API ────────────────────────────────────────────────────────────\n\n';
const importBlockEnd = "\n\napp.use('/api/transit-dashboard', transitDashRouter);";

const importReplacement = `// ── Routes API ────────────────────────────────────────────────────────────\n\nconst {\n  mountApiRoutesBeforeStripeOwnedBlocks,\n  mountApiRoutesAfterStripeOwnedBlocks,\n} = require('./bootstrap/api-routes');\n\nconst walletService    = require('./services/wallet-service');\nconst routingService   = require('./services/routing');\nconst parcelSecurity   = require('./services/parcel-security');`;

let next = replaceOnce(original, importBlockStart, importBlockEnd, importReplacement, 'routes imports block');

const beforeBlockStart = "app.use('/api/transit-dashboard', transitDashRouter);";
const beforeBlockEnd = "\n\n// ═══ Panier Partagé MVP (Niveau 1) ═══";
const beforeReplacement = "mountApiRoutesBeforeStripeOwnedBlocks(app);";
next = replaceOnce(next, beforeBlockStart, beforeBlockEnd, beforeReplacement, 'routes before Stripe-owned blocks');

const afterBlockStart = "app.use('/api/admin/risk-provisions',    adminRiskProvisionsRouter);";
const afterBlockEnd = "\n\n\n// ── Healthcheck ─────────────────────────────────────────────────────────────";
const afterReplacement = "mountApiRoutesAfterStripeOwnedBlocks(app);";
next = replaceOnce(next, afterBlockStart, afterBlockEnd, afterReplacement, 'routes after Stripe-owned blocks');

const requiredChecks = [
  "app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use('/api/collective-payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use(express.json({ limit: '1mb' }));",
  "app.post('/api/shared-carts/stripe/webhook', sharedCart.stripeWebhookHandler);",
  "app.post('/api/collective-payments/stripe/webhook', collectiveWS.stripeWebhookHandler);",
  "collectivePaymentOrchestrator.startExpirationCron(intervalMs);",
  "app.get('/api/health', async (req, res) => {",
  "app.get('*', (req, res) => {",
];

for (const needle of requiredChecks) {
  if (!next.includes(needle)) fail(`safety check missing after transform: ${needle}`);
}

if (!next.includes("mountApiRoutesBeforeStripeOwnedBlocks(app);")) {
  fail('before mount call missing after transform');
}
if (!next.includes("mountApiRoutesAfterStripeOwnedBlocks(app);")) {
  fail('after mount call missing after transform');
}

const removedNeedles = [
  "const authRouter       = require('./routes/auth');",
  "const adminRiskProvisionsRouter         = require('./routes/admin-risk-provisions');",
  "app.use('/api/v2', opsApiRouter);",
  "app.use('/api/payments',   paymentsRouter);",
];
for (const needle of removedNeedles) {
  if (next.includes(needle)) fail(`old routes block still contains: ${needle}`);
}

console.log('✅ H1A codemod checks passed');
console.log(`Mode: ${MODE}`);
console.log(`server.js length: ${original.length} → ${next.length}`);

if (MODE === 'write') {
  fs.writeFileSync(SERVER, next, 'utf8');
  console.log('✅ server.js updated. Review with: git diff -- server.js');
} else {
  console.log('No file written. Re-run with --write to apply.');
}
