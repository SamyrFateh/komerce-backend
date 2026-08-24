'use strict';
/**
 * TEMP LOT 2F — branche CI éphémère uniquement.
 * Génère le contrat Finance dans le runner, publie les artefacts, puis exécute
 * le contract-check normal. Ce fichier ne doit jamais être mergé.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONTRACT_FILE = path.join(ROOT, 'docs', 'contract', 'openapi.json');

function prepareFinanceContractArtifact() {
  if (process.env.GITHUB_ACTIONS !== 'true') return;

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
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-route-registry.js')], { stdio: 'inherit', cwd: ROOT });
  execFileSync(process.execPath, [generatorPath], { stdio: 'inherit', cwd: ROOT });

  execFileSync('npm', ['install', '--no-save', '--package-lock=false', '@actions/artifact@2'], {
    stdio: 'inherit',
    cwd: ROOT,
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
  execFileSync(process.execPath, ['-e', uploadScript], { stdio: 'inherit', cwd: ROOT });
}

prepareFinanceContractArtifact();

const FRONT_DIRS = {
  boutique: process.env.BOUTIQUE_DIR || path.join(ROOT, 'public', 'boutique', 'js'),
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
  'expires_at','pickup_code','pickup_secret','reference','token','shared_cart_id',
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
  const paths = new Map();
  const fields = new Map();
  if (!fs.existsSync(dir)) return { paths, fields };

  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && !NON_RUNTIME_DIRS.has(entry.name)) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
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

const errors = [];
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
  process.exit(1);
}
console.log(`✅ Aucune dérive — contrat respecté.\n`);
