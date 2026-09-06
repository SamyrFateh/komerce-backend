'use strict';
/**
 * contract-check.js — v2
 * Vérifie que tout ce que boutique + dashboards consomment
 * existe dans le contrat OpenAPI généré.
 *
 * Règle : consommé ⊄ produit → erreur explicite → exit(1) → CI rouge.
 * La dette UNKNOWN n'est pas une erreur (on sait qu'on ne sait pas).
 * La dérive (route/champ disparu du contrat) est une erreur.
 * Le registre docs/contract/DEBT.md doit refléter exactement les UNKNOWN réels.
 */
const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const CONTRACT_FILE = path.join(__dirname, '..', 'docs', 'contract', 'openapi.json');

const FRONT_DIRS = {
  boutique:   process.env.BOUTIQUE_DIR   || path.join(__dirname, '..', 'public', 'boutique', 'js'),
  dashboards: process.env.DASHBOARDS_DIR || path.join(__dirname, '..', 'public', 'dashboards'),
};

if (!fs.existsSync(CONTRACT_FILE)) {
  console.error('❌ Contrat absent. Lancer : npm run contract:generate');
  process.exit(1);
}
const contract = JSON.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));
const contractPaths = Object.keys(contract.paths || {});

// Champs critiques à surveiller (extraits de l'analyse A2)
const WATCHED_FIELDS = [
  'contributed_kmf','remaining_kmf','total_kmf_snapshot','settlement_open',
  'expires_at','pickup_code','pickup_secret','reference','token',
  'shared_cart_id',
  // 'fully_funded' — exclu : c'est une clé de mapping status → libellé dans les vues,
  //   pas un champ de réponse API. Documenté dans docs/contract/DEBT.md.
];

// Routes connues comme mortes (710 côté backend) — avertissement, pas erreur
const KNOWN_DEAD = [
  '/api/collective-workspaces',
  '/api/collective-payments',
  '/api/card-config',
];

// Le checker protège les consommateurs RUNTIME. Les fixtures/tests/rapports peuvent
// contenir des URLs synthétiques (ex. order-l7-001) qui ne sont pas des appels
// applicatifs et ne doivent jamais devenir des dérives de contrat.
const NON_RUNTIME_DIRS = new Set([
  'node_modules', '.git', 'tests', 'test', '__tests__',
  'coverage', 'playwright-report', 'test-results',
]);

function scanDir(dir) {
  const paths  = new Map(); // normalizedPath → Set<fichier>
  const fields = new Map(); // field → Set<fichier>

  if (!fs.existsSync(dir)) return { paths, fields };

  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && !NON_RUNTIME_DIRS.has(entry.name)) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const src  = fs.readFileSync(full, 'utf8');
        const file = path.relative(process.cwd(), full);

        // ── Chemins /api (strings et template literals) ──────────────────
        // Regex 1 : chaînes entre guillemets/backtick
        for (const m of src.matchAll(/[`'"](\/api\/[a-zA-Z0-9_/.-]{3,})[`'"]/g)) {
          const p = normalize(m[1]);
          if (!paths.has(p)) paths.set(p, new Set());
          paths.get(p).add(file);
        }
        // Regex 2 : concaténation `${base}/${id}` type `/api/shared-carts/` + id
        for (const m of src.matchAll(/["'`](\/api\/[a-zA-Z0-9_/-]{3,}\/?)["'`]\s*[+,]/g)) {
          const p = normalize(m[1]);
          if (!paths.has(p)) paths.set(p, new Set());
          paths.get(p).add(file);
        }

        // ── Champs de réponse critiques ───────────────────────────────────
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
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/g, '/{id}') // UUID
    .replace(/\/\$\{[^}]+\}/g, '/{id}')                 // template ${var}
    .replace(/\/[0-9]+\b/g, '/{id}')                    // id numérique
    .replace(/\/$/, '');                                  // trailing slash
}

function matchContract(consumed, contractPaths) {
  const cNorm = normalize(consumed).replace(/\{[^}]+\}/g, '{x}');
  return contractPaths.some(cp => {
    const cpNorm = cp.replace(/\{[^}]+\}/g, '{x}');
    // Match exact
    if (cpNorm === cNorm) return true;
    // Match préfixe : le frontend a extrait /api/foo/ (avant la concaténation + var)
    // et le contrat a /api/foo/{id} ou /api/foo/{id}/action
    if (cpNorm.startsWith(cNorm + '/') || cpNorm.startsWith(cNorm.replace(/\/$/, '') + '/')) return true;
    return false;
  });
}

// ── Vérification ─────────────────────────────────────────────────────────────
const errors   = [];
const warnings = [];

for (const [frontName, dir] of Object.entries(FRONT_DIRS)) {
  const { paths, fields } = scanDir(dir);

  // Chemins
  for (const [p, files] of paths) {
    if (KNOWN_DEAD.some(d => p.startsWith(d))) {
      warnings.push(`⚠️  [${frontName}] route morte encore appelée : ${p}\n   → fichiers : ${[...files].slice(0,2).join(', ')}\n   → lot L1-C : purger le code front déprécié`);
      continue;
    }
    if (!matchContract(p, contractPaths)) {
      errors.push(`❌ [${frontName}] "${p}" absent du contrat\n   → fichiers : ${[...files].slice(0,2).join(', ')}\n   → ajouter la route dans contract-generate.js ou vérifier qu'elle existe encore`);
    }
  }

  // Champs critiques
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

// Le registre de dette est une projection du contrat, pas une liste manuelle.
try {
  execFileSync(process.execPath, [path.join(__dirname, 'contract-debt-sync.js'), '--check'], { stdio: 'inherit' });
} catch {
  errors.push('❌ docs/contract/DEBT.md ne correspond pas aux réponses UNKNOWN réelles du contrat.');
}

// ── Rapport ───────────────────────────────────────────────────────────────────
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
  console.error('  puis synchroniser docs/contract/DEBT.md avec `node scripts/contract-debt-sync.js --write`.');
  process.exit(1);
}

console.log(`✅ Aucune dérive — contrat respecté.\n`);
