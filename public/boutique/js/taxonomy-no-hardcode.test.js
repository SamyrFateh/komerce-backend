/**
 * DSC-A3 — Tests de garde taxonomie
 *
 * Invariants vérifiés en CI :
 *   (1) Aucune liste de catégories codée en dur hors de shop-schema.js
 *   (2) _FALLBACK_CATEGORIES ⊆ seed 061 (clés catégories + sous-catégories)
 *   (3) Anti-régression du défaut : shop-schema utilise fetch par défaut,
 *       le fallback est opt-in (=== true), pas opt-out (!== false)
 *
 * Exception documentée : shop-schema.js est le seul fichier autorisé
 * à porter le fallback contraint (sous-ensemble strict du seed 061).
 */

const fs   = require('fs');
const path = require('path');

// ─── Chemins ─────────────────────────────────────────────────────────────────
const ROOT         = path.resolve(__dirname, '../../');
const SHOP_SCHEMA  = path.join(ROOT, 'public/boutique/js/shop-schema.js');
const JS_DIR       = path.join(ROOT, 'public/boutique/js');
const MIGRATION_061 = path.join(ROOT, 'migrations/061_boutique_categories.sql');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extraire les clés INSERT INTO boutique_categories d'une migration SQL */
function extractSeedCategoryKeys(sqlContent) {
  const keys = [];
  // Match les valeurs de la colonne key (1er champ de chaque VALUES row)
  const re = /VALUES\s*\n?([\s\S]*?)(?:ON CONFLICT|;)/g;
  let m;
  while ((m = re.exec(sqlContent)) !== null) {
    const block = m[1];
    // Chaque ligne de valeur : ('key', ...)
    const rowRe = /\(\s*'([^']+)'/g;
    let r;
    while ((r = rowRe.exec(block)) !== null) {
      keys.push(r[1]);
    }
  }
  return keys;
}

/** Extraire les clés INSERT INTO boutique_subcategories d'une migration SQL */
function extractSeedSubcategoryKeys(sqlContent) {
  // Format : ('category_key', 'subkey', ...)
  const keys = [];
  const re = /boutique_subcategories[\s\S]*?VALUES\s*([\s\S]*?)(?:ON CONFLICT|;)/g;
  let m;
  while ((m = re.exec(sqlContent)) !== null) {
    const block = m[1];
    const rowRe = /\(\s*'[^']+',\s*'([^']+)'/g;
    let r;
    while ((r = rowRe.exec(block)) !== null) {
      keys.push(r[1]);
    }
  }
  return keys;
}

/** Collecter récursivement les fichiers .js d'un dossier */
function collectJsFiles(dir, exclude = []) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      results.push(...collectJsFiles(full, exclude));
    } else if (entry.isFile() && entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      if (!exclude.some(ex => full.includes(ex))) {
        results.push(full);
      }
    }
  }
  return results;
}

// ─── (1) Aucune catégorie codée en dur hors shop-schema ──────────────────────
describe('DSC-A3.1 — pas de catégorie en dur hors shop-schema', () => {
  // Patterns caractéristiques d'une liste de catégories codée en dur
  // (clés connues du seed dans un tableau JS)
  const HARDCODE_PATTERNS = [
    /['"]Mode\s*&\s*Beauté['"]\s*,\s*['"]Tech['"]/,
    /['"]Sur-mesure['"]\s*,\s*['"]Sport['"]/,
    /key:\s*['"]Mode\s*&\s*Beauté['"]/,
    /key:\s*['"]Sur-mesure['"]/,
    /key:\s*['"]Enfant['"]/,
  ];

  const EXCLUDED = [
    path.basename(SHOP_SCHEMA),   // exception documentée
  ];

  test('aucun fichier JS hors shop-schema ne contient une liste de catégories codée en dur', () => {
    const files = collectJsFiles(JS_DIR, [SHOP_SCHEMA]);
    const violations = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of HARDCODE_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${path.relative(ROOT, file)}: match ${pattern}`);
          break;
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        'Catégories codées en dur détectées hors shop-schema.js :\n' +
        violations.join('\n') +
        '\nToute liste de catégories doit passer par GET /api/categories (§6.2).'
      );
    }
  });
});

// ─── (2) _FALLBACK_CATEGORIES ⊆ seed 061 ─────────────────────────────────────
describe('DSC-A3.2 — fallback ⊆ seed 061', () => {
  const shopSchemaContent = fs.readFileSync(SHOP_SCHEMA, 'utf8');
  const sqlContent = fs.readFileSync(MIGRATION_061, 'utf8');

  const seedCatKeys = extractSeedCategoryKeys(sqlContent);
  const seedSubKeys = extractSeedSubcategoryKeys(sqlContent);

  test('les clés de catégories du fallback sont dans le seed 061', () => {
    // Extraire les key: '...' de _FALLBACK_CATEGORIES dans le source
    const fallbackCatKeys = [];
    const re = /key:\s*'([^']+)'/g;
    // On cherche dans le bloc _FALLBACK_CATEGORIES uniquement
    const fallbackBlock = shopSchemaContent.match(/const _FALLBACK_CATEGORIES\s*=\s*\[([\s\S]*?)\];\s*\n\nlet/)?.[1] || '';
    let m;
    while ((m = re.exec(fallbackBlock)) !== null) {
      fallbackCatKeys.push(m[1]);
    }

    const orphans = fallbackCatKeys.filter(k => !seedCatKeys.includes(k) && !seedSubKeys.includes(k));
    expect(orphans).toEqual([]);
  });

  test('aucune clé de catégorie orpheline (absente du seed) dans le fallback', () => {
    // Vérification explicite des clés retirées (Bricolage, Créations personnelles, Auto)
    const RETIRED_KEYS = ['Bricolage', 'Créations personnelles', 'Auto'];
    const fallbackBlock = shopSchemaContent.match(/const _FALLBACK_CATEGORIES\s*=\s*\[([\s\S]*?)\];\s*\n\nlet/)?.[1] || '';
    for (const k of RETIRED_KEYS) {
      expect(fallbackBlock).not.toMatch(new RegExp(`key:\\s*'${k}'`));
    }
  });
});

// ─── (3) Anti-régression : défaut = fetch, fallback = opt-in === true ─────────
describe('DSC-A3.3 — défaut fetch, fallback opt-in strict', () => {
  const content = fs.readFileSync(SHOP_SCHEMA, 'utf8');

  test('_FORCE_FALLBACK utilise === true (opt-in strict, pas !== false)', () => {
    // La ligne correcte : window.KOMERCE_FORCE_FALLBACK_CATEGORIES === true
    expect(content).toMatch(/KOMERCE_FORCE_FALLBACK_CATEGORIES\s*===\s*true/);
  });

  test('_FORCE_FALLBACK N\'utilise PAS !== false (opt-out inversé)', () => {
    expect(content).not.toMatch(/KOMERCE_FORCE_FALLBACK_CATEGORIES\s*!==\s*false/);
  });

  test('_doFetch appelle fetch(\'/api/categories\')', () => {
    expect(content).toMatch(/fetch\s*\(\s*['"]\/api\/categories['"]\s*\)/);
  });

  test('le chemin par défaut démarre _loadPromise = _doFetch()', () => {
    expect(content).toMatch(/_loadPromise\s*=\s*_doFetch\s*\(\s*\)/);
  });
});
