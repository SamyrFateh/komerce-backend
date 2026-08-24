'use strict';
/**
 * TEMP LOT 2F — branche CI éphémère uniquement.
 * Génère le contrat Finance dans le runner et l'encode dans les logs CI.
 * Ce fichier ne doit jamais être mergé.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const generatorPath = path.join(ROOT, 'scripts', 'contract-generate.js');
let source = fs.readFileSync(generatorPath, 'utf8');

const routeMarker = "  { prefix: '/api/admin/dashboard/operations/market/{marketCode}', method: 'get', schema: null },\n";
const routeBlock = "  // LOT 2F — Canonical Finance global + market-scoped\n" +
  "  { prefix: '/api/admin/dashboard/finance', method: 'get', schema: null },\n" +
  "  { prefix: '/api/admin/dashboard/finance/market/{marketCode}', method: 'get', schema: null },\n";
if (!source.includes(routeBlock)) {
  if (!source.includes(routeMarker)) throw new Error('operations route marker not found');
  source = source.replace(routeMarker, routeMarker + routeBlock);
}

const responseMarker = 'const KNOWN_RESPONSES = {\n';
const responseBlock = "  // LOT 2F — réponses Finance consommées par Canonical.\n" +
  "  '/api/admin/dashboard/finance': {\n" +
  "    get: { fields: ['scope','period','kpis','payment_mix','refunds','incomplete_cost_orders','data_quality'], source: 'test' }\n" +
  "  },\n" +
  "  '/api/admin/dashboard/finance/market/{marketCode}': {\n" +
  "    get: { fields: ['scope','period','kpis','payment_mix','refunds','incomplete_cost_orders','data_quality'], source: 'test' }\n" +
  "  },\n";
if (!source.includes(responseBlock)) {
  if (!source.includes(responseMarker)) throw new Error('KNOWN_RESPONSES marker not found');
  source = source.replace(responseMarker, responseMarker + responseBlock);
}
fs.writeFileSync(generatorPath, source);

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://ci-dummy:ci-dummy@localhost:5432/ci-dummy',
  ADMIN_PASSWORD: 'ci-dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
  QR_SECRET: 'ci-dummy',
  JWT_SECRET: 'ci-dummy',
  SESSION_SECRET: 'ci-dummy',
  INTERNAL_API_KEY: 'ci-dummy',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  JWT_EXPIRES: '7d',
  APP_URL: 'http://localhost',
  PUBLIC_URL: 'http://localhost',
  PUBLIC_BASE_URL: 'http://localhost',
  ADMIN_RESET_KEY: 'ci-dummy',
  INVOICE_PUBLIC_LINK_SECRET: 'ci-dummy',
  AUTHKEY_API_KEY: 'ci-dummy',
  PAYPAL_CLIENT_ID: 'ci-dummy',
  PAYPAL_CLIENT_SECRET: 'ci-dummy',
  PAYPAL_WEBHOOK_ID: 'ci-dummy',
  META_WA_TOKEN: 'ci-dummy',
  META_WA_PHONE_NUMBER_ID: 'ci-dummy',
  META_WA_APP_SECRET: 'ci-dummy',
};

execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-route-registry.js')], {
  stdio: 'inherit', cwd: ROOT, env,
});
execFileSync(process.execPath, [generatorPath], {
  stdio: 'inherit', cwd: ROOT, env,
});

const outputs = [
  ['contract-generate.js', generatorPath],
  ['route-registry.json', path.join(ROOT, 'docs', '_generated', 'route-registry.json')],
  ['openapi.json', path.join(ROOT, 'docs', 'contract', 'openapi.json')],
];

for (const [name, file] of outputs) {
  const raw = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const encoded = zlib.gzipSync(raw, { level: 9 }).toString('base64');
  const chunkSize = 4000;
  const chunks = [];
  for (let i = 0; i < encoded.length; i += chunkSize) chunks.push(encoded.slice(i, i + chunkSize));
  console.log(`FC2F_META|${name}|${raw.length}|${sha256}|${chunks.length}`);
  chunks.forEach((chunk, index) => console.log(`FC2F_DATA|${name}|${index + 1}|${chunks.length}|${chunk}`));
}

console.log('✅ Finance contract generated and encoded.');
