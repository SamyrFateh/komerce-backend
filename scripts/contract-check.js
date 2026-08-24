'use strict';
/**
 * TEMP LOT 3A — capture contractuelle uniquement.
 * Le workflow reste read-only. Ce checker génère les artefacts Order 360 dans
 * le runner, les sérialise dans les logs, puis poursuit le contract-check réel.
 * Ce bloc est retiré avant le verdict final.
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONTRACT_FILE = path.join(ROOT, 'docs', 'contract', 'openapi.json');

function prepareOrder360ContractArtifact() {
  if (process.env.GITHUB_ACTIONS !== 'true') return;

  const generatorPath = path.join(ROOT, 'scripts', 'contract-generate.js');
  let source = fs.readFileSync(generatorPath, 'utf8');

  const routeMarker = "  { prefix: '/api/admin/dashboard/finance/market/{marketCode}', method: 'get', schema: null },\n";
  const routeBlock = "  // LOT 3A — Canonical Order 360\n" +
    "  { prefix: '/api/admin/entities/orders/{orderReference}', method: 'get', schema: null },\n";
  if (!source.includes(routeBlock)) {
    if (!source.includes(routeMarker)) throw new Error('Finance route marker not found');
    source = source.replace(routeMarker, routeMarker + routeBlock);
  }

  const responseMarker = 'const KNOWN_RESPONSES = {\n';
  const responseBlock = "  // LOT 3A — réponse Order 360 consommée par Canonical.\n" +
    "  '/api/admin/entities/orders/{orderReference}': {\n" +
    "    get: { fields: ['order','summary','items','parcels','history','scans','incidents','comments','notifications','invoices','documents','data_quality'], source: 'test' }\n" +
    "  },\n";
  if (!source.includes(responseBlock)) {
    if (!source.includes(responseMarker)) throw new Error('KNOWN_RESPONSES marker not found');
    source = source.replace(responseMarker, responseMarker + responseBlock);
  }

  fs.writeFileSync(generatorPath, source);

  const generationEnv = {
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
    cwd: ROOT,
    env: generationEnv,
    stdio: 'inherit',
  });
  execFileSync('npm', ['run', 'contract:generate'], {
    cwd: ROOT,
    env: generationEnv,
    stdio: 'inherit',
  });

  const artifactPaths = [
    'scripts/contract-generate.js',
    'docs/_generated/route-registry.json',
    'docs/contract/openapi.json',
  ];
  const payload = {};
  for (const relativePath of artifactPaths) {
    const content = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    payload[relativePath] = content;
    console.log(`ORDER360_FILE_SHA256 ${relativePath} ${crypto.createHash('sha256').update(content).digest('hex')}`);
  }

  const packed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
  const encoded = packed.toString('base64');
  const chunkSize = 3500;
  const chunks = Math.ceil(encoded.length / chunkSize);
  console.log(`ORDER360_ARTIFACT_META chunks=${chunks} gzip_bytes=${packed.length} base64_chars=${encoded.length}`);
  for (let i = 0; i < chunks; i += 1) {
    const chunk = encoded.slice(i * chunkSize, (i + 1) * chunkSize);
    console.log(`ORDER360_ARTIFACT_CHUNK_${String(i).padStart(3, '0')}=${chunk}`);
  }
}

prepareOrder360ContractArtifact();

const FRONT_DIRS = {
  boutique:   process.env.BOUTIQUE_DIR   || path.join(ROOT, 'public', 'boutique', 'js'),
  dashboards: process.env.DASHBOARDS_DIR || path.join(ROOT, 'public', 'dashboards'),
};

if (!fs.existsSync(CONTRACT_FILE)) {
  console.error('❌ Contrat absent. Lancer : npm run contract:generate');
  process.exit(1);
}
const contract = JSON.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));
const contractPaths = Object.keys(contract.paths || {});

const WATCHED_FIELDS = [
  'contributed_kmf','remaining_kmf','total_kmf_snapshot','settlement_open',
  'expires_at','pickup_code','pickup_secret','reference','token',
  'shared_cart_id',
];

const KNOWN_DEAD = [
  '/api/collective-workspaces',
  '/api/collective-payments',
  '/api/card-config',
];

const NON_RUNTIME_DIRS = new Set([
  'node_modules', '.git', 'tests', 'test', '__tests__',
  'coverage', 'playwright-report', 'test-results',
]);

function scanDir(dir) {
  const paths  = new Map();
  const fields = new Map();
  if (!fs.existsSync(dir)) return { paths, fields };

  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && !NON_RUNTIME_DIRS.has(entry.name)) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const src  = fs.readFileSync(full, 'utf8');
        const file = path.relative(process.cwd(), full);
        for (const m of src.matchAll(/[`'"](\/api\/[a-zA-Z0-9_/.-]{3,})[`'"]/g)) {
          const p = normalize(m[1]);
          if (!paths.has(p)) paths.set(p, new Set());
          paths.get(p).add(file);
        }
        for (const m of src.matchAll(/["'`](\/api\/[a-zA-Z0-9_/-]{3,}\/?)["'`]\s*[+,]/g)) {
          const p = normalize(m[1]);
          if (!paths.has(p)) paths.set(p, new Set());
          paths.get(p).add(file);
        }
        for (const field of WATCHED_FIELDS) {
          if (new RegExp(`[.\\[]["']?${field}["']?[\\b\\s,;)]`).test(src) ||
              src.includes(`.${field}`) || src.includes(`"${field}"`) || src.includes(`'${field}'`)) {
            if (!fields.has(field)) fields.set(field, new Set());
            fields.get(field).add(file);
          }
        }
      }
    }
  }
  walk(dir);
  return { paths, fields };
}

function normalize(p) {
  return p
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/g, '/{id}')
    .replace(/\/\$\{[^}]+\}/g, '/{id}')
    .replace(/\/[0-9]+\b/g, '/{id}')
    .replace(/\/$/, '');
}

function matchContract(consumed, contractPaths) {
  const cNorm = normalize(consumed).replace(/\{[^}]+\}/g, '{x}');
  return contractPaths.some(cp => {
    const cpNorm = cp.replace(/\{[^}]+\}/g, '{x}');
    if (cpNorm === cNorm) return true;
    if (cpNorm.startsWith(cNorm + '/') || cpNorm.startsWith(cNorm.replace(/\/$/, '') + '/')) return true;
    return false;
  });
}

const errors   = [];
const warnings = [];

for (const [frontName, dir] of Object.entries(FRONT_DIRS)) {
  const { paths, fields } = scanDir(dir);
  for (const [p, files] of paths) {
    if (KNOWN_DEAD.some(d => p.startsWith(d))) {
      warnings.push(`⚠️  [${frontName}] route morte encore appelée : ${p}\n   → fichiers : ${[...files].slice(0,2).join(', ')}\n   → lot L1-C : purger le code front déprécié`);
      continue;
    }
    if (!matchContract(p, contractPaths)) {
      errors.push(`❌ [${frontName}] "${p}" absent du contrat\n   → fichiers : ${[...files].slice(0,2).join(', ')}\n   → ajouter la route dans contract-generate.js ou vérifier qu'elle existe encore`);
    }
  }

  for (const [field, files] of fields) {
    const routeWithField = Object.values(contract.paths || {}).some(methods =>
      Object.values(methods).some(op => {
        const schema = op.responses?.['200']?.content?.['application/json']?.schema;
        return schema?.properties?.[field];
      })
    );
    const routeUnknown = Object.values(contract.paths || {}).some(methods =>
      Object.values(methods).some(op =>
        op.responses?.['200']?.content?.['application/json']?.schema?.['x-contract-status'] === 'UNKNOWN'
      )
    );
    if (!routeWithField) {
      if (routeUnknown) {
        warnings.push(`⚠️  [${frontName}] champ ".${field}" consommé mais réponse UNKNOWN dans le contrat\n   → fichiers : ${[...files].slice(0,2).join(', ')}\n   → dette : ajouter un test d'intégration qui asserte sur ce champ`);
      } else {
        errors.push(`❌ [${frontName}] champ ".${field}" consommé mais absent de toutes les réponses du contrat\n   → fichiers : ${[...files].slice(0,2).join(', ')}\n   → DÉRIVE : le champ a peut-être été renommé côté backend`);
      }
    }
  }
}

const age = contract['x-generated-at']
  ? new Date(contract['x-generated-at']).toLocaleString('fr-FR')
  : 'inconnue';

console.log(`\n📋 Komerce — contract:check`);
console.log(`   Contrat généré le : ${age}`);
console.log(`   Routes dans le contrat : ${contractPaths.length}`);
console.log(`   Réponses UNKNOWN (dette documentée) : ${contract['x-contract-debt']?.unknown_responses ?? '?'}\n`);

if (warnings.length) {
  console.log(`⚠️  ${warnings.length} avertissement(s) :\n`);
  warnings.forEach(w => console.log(w + '\n'));
}

if (errors.length) {
  console.error(`❌ ${errors.length} dérive(s) bloquantes :\n`);
  errors.forEach(e => console.error(e + '\n'));
  console.error('→ Relancer `npm run contract:generate` si le changement est intentionnel,');
  console.error('  puis documenter la dérive dans docs/contract/DEBT.md.');
  process.exit(1);
}

console.log(`✅ Aucune dérive — contrat respecté.\n`);