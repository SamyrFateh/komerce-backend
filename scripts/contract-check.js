'use strict';
/**
 * TEMP LOT 2F — branche CI éphémère uniquement.
 * Génère le contrat Finance dans le runner et publie les artefacts Actions.
 * Ce fichier ne doit jamais être mergé.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const generatorPath = path.join(ROOT, 'scripts', 'contract-generate.js');
let source = fs.readFileSync(generatorPath, 'utf8');

const routeMarker = "  { prefix: '/api/admin/dashboard/operations/market/{marketCode}', method: 'get', schema: null },\n";
const routeBlock = "  // LOT 2F — Canonical Finance global + market-scoped\n" +
  "  { prefix: '/api/admin/dashboard/finance', method: 'get', schema: null },\n" +
  "  { prefix: '/api/admin/dashboard/finance/market/{marketCode}', method: 'get', schema: null },\n";
if (!source.includes(routeBlock)) source = source.replace(routeMarker, routeMarker + routeBlock);

const responseMarker = 'const KNOWN_RESPONSES = {\n';
const responseBlock = "  // LOT 2F — réponses Finance consommées par Canonical.\n" +
  "  '/api/admin/dashboard/finance': {\n" +
  "    get: { fields: ['scope','period','kpis','payment_mix','refunds','incomplete_cost_orders','data_quality'], source: 'test' }\n" +
  "  },\n" +
  "  '/api/admin/dashboard/finance/market/{marketCode}': {\n" +
  "    get: { fields: ['scope','period','kpis','payment_mix','refunds','incomplete_cost_orders','data_quality'], source: 'test' }\n" +
  "  },\n";
if (!source.includes(responseBlock)) source = source.replace(responseMarker, responseMarker + responseBlock);

fs.writeFileSync(generatorPath, source);

const generatorEnv = {
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
  stdio: 'inherit', cwd: ROOT, env: generatorEnv,
});
execFileSync(process.execPath, [generatorPath], {
  stdio: 'inherit', cwd: ROOT, env: generatorEnv,
});

execFileSync('npm', ['install', '--no-save', '--package-lock=false', '@actions/artifact@2'], {
  stdio: 'inherit', cwd: ROOT, env: generatorEnv,
});

const uploadScript = `
(async () => {
  const path = require('path');
  const { DefaultArtifactClient } = require('@actions/artifact');
  const root = process.cwd();
  const files = [
    path.join(root, 'scripts', 'contract-generate.js'),
    path.join(root, 'docs', '_generated', 'route-registry.json'),
    path.join(root, 'docs', 'contract', 'openapi.json'),
  ];
  const client = new DefaultArtifactClient();
  const result = await client.uploadArtifact('finance-contract-2f', files, root, { retentionDays: 1 });
  console.log('FINANCE_CONTRACT_ARTIFACT', JSON.stringify(result));
})().catch(err => { console.error(err); process.exit(1); });
`;
execFileSync(process.execPath, ['-e', uploadScript], {
  stdio: 'inherit', cwd: ROOT, env: generatorEnv,
});

console.log('✅ Finance contract generated and uploaded.');
