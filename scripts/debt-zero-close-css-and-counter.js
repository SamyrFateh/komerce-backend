'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, text) { fs.writeFileSync(file, text); }
function replaceOnce(file, from, to) {
  const text = read(file);
  if (!text.includes(from)) throw new Error(`${file}: target not found: ${from.slice(0, 160)}`);
  write(file, text.replace(from, to));
}
function replaceRegex(file, re, to) {
  const text = read(file);
  if (!re.test(text)) throw new Error(`${file}: regex target not found: ${re}`);
  write(file, text.replace(re, to));
}

// ──────────────────────────────────────────────────────────────
// CSS cascade closure: remove declarations that are unconditionally
// superseded later in the SAME media context. Final rendered values stay
// unchanged; ownership moves to the later, explicitly canonical layers.
// ──────────────────────────────────────────────────────────────

// Desktop PDP: modal-desktop-density.css is the 2026-08 final owner at >=1200.
replaceRegex(
  'public/boutique/css/modal-product-lot4-hybrid.css',
  /  \/\* ── Composition 2 régions ≥1200px[\s\S]*?\n  \}\n\n  \/\* D6 — Hero desktop/,
  `  /* ≥1200px : la géométrie finale est désormais possédée par\n     modal-desktop-density.css (pass de densité 2026-08). La règle 900px\n     ci-dessus reste le fallback canonique ; aucun override mort ici. */\n\n  /* D6 — Hero desktop`
);

// Mobile hero: mobile-catalog-convergence.css owns the visual surface.
replaceOnce(
  'public/boutique/css/hero-ultra-mobile.css',
  `/*\n * HERO ULTRA MOBILE — CANONIQUE COMPACT\n * Cible : 102–110 px de hauteur utile.\n * On conserve uniquement le fond chaud et le détourage canonique commun\n * aux trois marchés. Le K du téléphone remplace tout symbole additionnel.\n */\n@media (max-width: 899px) {\n  #k-hero-fixed-wrap > .k-hero {\n    background: var(--page-bg);\n  }\n\n  .k-hero .k-hero-inner .k-hero-media {\n    height: clamp(102px, 27.5vw, 110px);\n    margin-top: 0;\n    margin-bottom: 0;\n    border-radius: 16px;\n    background: var(--hero-bg);\n    box-shadow: 0 6px 18px var(--border-text-06);\n  }`,
  `/*\n * HERO ULTRA MOBILE — CANONIQUE COMPACT\n * Cible : 102–110 px de hauteur utile.\n * Ce fichier possède uniquement la géométrie et le cadrage du détourage.\n * La surface visuelle (fond, rayon, ombre) est possédée par\n * mobile-catalog-convergence.css afin d'éviter deux sources de cascade.\n */\n@media (max-width: 899px) {\n  .k-hero .k-hero-inner .k-hero-media {\n    height: clamp(102px, 27.5vw, 110px);\n    margin-top: 0;\n    margin-bottom: 0;\n  }`
);

// Mobile category rail: convergence layer owns the final open/flat surface.
replaceOnce(
  'public/boutique/css/category-cutout-navigation.css',
  `    background: var(--white);\n    box-shadow: inset 0 -1px 0 var(--border-text-08);\n`,
  `    background: var(--white);\n    /* Surface/ombre finale possédée par mobile-catalog-convergence.css. */\n`
);

// Desktop side-cart: side-cart-desktop-polish.css is the final 2026-08 owner.
replaceOnce(
  'public/boutique/css/boutique-desktop.css',
  `  .k-sc-item:hover {\n    background: var(--sand);\n    border-color: var(--border-text-08);\n  }\n  .k-sc-item-img {\n    width: 48px; height: 48px;\n    border-radius: 7px;\n    object-fit: cover;\n    flex-shrink: 0;\n    background: var(--sand);\n    border: 1px solid var(--border-text-06);\n  }`,
  `  .k-sc-item:hover {\n    border-color: var(--border-text-08);\n  }\n  .k-sc-item-img {\n    width: 48px; height: 48px;\n    border-radius: 7px;\n    object-fit: cover;\n    flex-shrink: 0;\n    /* background/border desktop finals: side-cart-desktop-polish.css */\n  }`
);
replaceOnce(
  'public/boutique/css/boutique-desktop.css',
  `  #k-side-cart:has(.k-cart-tabs) .k-sc-title-bar:has(\n    .k-cart-snapshot-contributors\n  ) {\n    min-height: 0;\n    padding: 6px 12px;\n    background: transparent;\n    border-bottom: 1px solid var(--border);\n  }`,
  `  #k-side-cart:has(.k-cart-tabs) .k-sc-title-bar:has(\n    .k-cart-snapshot-contributors\n  ) {\n    min-height: 0;\n    padding: 6px 12px;\n    background: transparent;\n    /* border-bottom final: side-cart-desktop-polish.css */\n  }`
);

// ──────────────────────────────────────────────────────────────
// Remove the four historical SQL suppressions. The current N2 scanner only
// flags direct req/params/body interpolation; these audited builders use
// server-controlled fragments + parameterized values, so no suppression is
// needed anymore. quality:gate will prove this after the removal.
// ──────────────────────────────────────────────────────────────
replaceOnce(
  'routes/parcels.js',
  `, params); // quality-disable N2-SQL-INJECTION — AUD-07: where = parameterized condition templates`,
  `, params); // AUD-07: where = parameterized condition templates; values remain bound in params`
);
replaceOnce(
  'routes/admin-costing.js',
  `, params); // quality-disable N2-SQL-INJECTION — updates[] contains hardcoded column names, values in params`,
  `, params); // AUD-07: updates[] contains allowlisted column names; values remain bound in params`
);
replaceOnce(
  'services/dashboard-metrics/control-tower.js',
  `; // quality-disable N2-SQL-INJECTION`,
  `; // AUD-07: buildFiltersClause emits server-controlled SQL fragments; values remain parameterized`
);
replaceOnce(
  'services/dashboard-metrics/control-tower.js',
  `, prevQuery.params); // quality-disable N2-SQL-INJECTION`,
  `, prevQuery.params); // AUD-07: same trusted filter builder; values remain parameterized`
);

// ──────────────────────────────────────────────────────────────
// Make reviewed exceptions machine-readable without conflating them with
// unresolved debt. A future ALLOWED_* entry is still OPEN unless it is also
// explicitly present in the corresponding REVIEWED_* set.
// ──────────────────────────────────────────────────────────────
replaceOnce(
  'scripts/audit-backend-arch.js',
  `const ALLOWED_LARGE_FILES = new Set([\n  'services/scan-engine.js', // 935L au 2026-08-28 — KEEP_LARGE, vigilance si content verification grossit\n]);\n`,
  `const ALLOWED_LARGE_FILES = new Set([\n  'services/scan-engine.js', // 935L au 2026-08-28 — KEEP_LARGE, vigilance si content verification grossit\n]);\n\n// Sous-ensemble réaudité : exception saine, pas dette à résorber. Toute future\n// entrée ajoutée à ALLOWED_LARGE_FILES reste une dette ouverte tant qu'elle\n// n'est pas explicitement revue ici.\nconst REVIEWED_LARGE_FILES = new Set([\n  'services/scan-engine.js', // audit 2026-08-28 : state machine cohésive, owners respectés, KEEP_LARGE\n]);\n`
);
replaceOnce(
  'scripts/audit-backend-arch.js',
  `const ALLOWED_ENGINE_ROUTES = new Set([\n  'routes/sourcing-scanner.js',  // catalogs/import extrait (2026-06-28) ; reste *-scanner.js par choix nominal\n]);\n`,
  `const ALLOWED_ENGINE_ROUTES = new Set([\n  'routes/sourcing-scanner.js',  // catalogs/import extrait (2026-06-28) ; reste *-scanner.js par choix nominal\n]);\n\n// Exception nominale réauditée : la route est une façade mince, pas un engine.\nconst REVIEWED_ENGINE_ROUTE_EXCEPTIONS = new Set([\n  'routes/sourcing-scanner.js',\n]);\n`
);

const debtFile = 'scripts/debt-audit.js';
replaceOnce(
  debtFile,
  `  // I-BACK-2 : fichiers trop grands\n  const largeFiles = extractSet(auditSrc, 'ALLOWED_LARGE_FILES');\n  addDebt({\n    rule: 'I-BACK-2',\n    label: 'Fichiers > 800 lignes (à décomposer)',\n    lot: 'Lot B / B1-B6',\n    entries: largeFiles,\n    note: 'Extraction engines + routes volumineuses',\n  });\n`,
  `  // I-BACK-2 : séparer la dette historique des exceptions réauditées.\n  const largeFiles = extractSet(auditSrc, 'ALLOWED_LARGE_FILES');\n  const reviewedLargeFiles = new Set(extractSet(auditSrc, 'REVIEWED_LARGE_FILES'));\n  const openLargeFiles = largeFiles.filter(file => !reviewedLargeFiles.has(file));\n  if (openLargeFiles.length > 0) {\n    addDebt({\n      rule: 'I-BACK-2',\n      label: 'Fichiers > 800 lignes (à décomposer)',\n      lot: 'Lot B / B1-B6',\n      entries: openLargeFiles,\n      note: 'Entrées grandfathered non encore réauditées',\n    });\n  }\n  const healthyLargeFiles = largeFiles.filter(file => reviewedLargeFiles.has(file));\n  if (healthyLargeFiles.length > 0) {\n    addDebt({\n      rule: 'I-BACK-2 (reviewed)',\n      label: 'Fichiers volumineux réaudités et cohésifs',\n      lot: 'Exception documentée — revue architecturale 2026-08-28',\n      entries: healthyLargeFiles,\n      note: 'Conservés grands par cohésion métier ; à revalider seulement si leur responsabilité évolue',\n    });\n  }\n`
);
replaceOnce(
  debtFile,
  `  // I-BACK-6 : engine routes\n  const engineRoutes = extractSet(auditSrc, 'ALLOWED_ENGINE_ROUTES');\n  addDebt({\n    rule: 'I-BACK-6',\n    label: 'Engines dans routes/ (à migrer vers services/)',\n    lot: 'Lot B1 (sourcing-engine, sourcing-scanner) + Lot B2 (economic-engine)',\n    entries: engineRoutes,\n  });\n`,
  `  // I-BACK-6 : une allowlist nominale n'est fermée que si elle a été réauditée.\n  const engineRoutes = extractSet(auditSrc, 'ALLOWED_ENGINE_ROUTES');\n  const reviewedEngineRoutes = new Set(extractSet(auditSrc, 'REVIEWED_ENGINE_ROUTE_EXCEPTIONS'));\n  const openEngineRoutes = engineRoutes.filter(file => !reviewedEngineRoutes.has(file));\n  if (openEngineRoutes.length > 0) {\n    addDebt({\n      rule: 'I-BACK-6',\n      label: 'Engines dans routes/ (à migrer vers services/)',\n      lot: 'Lot B1/B2',\n      entries: openEngineRoutes,\n    });\n  }\n  const nominalEngineRoutes = engineRoutes.filter(file => reviewedEngineRoutes.has(file));\n  if (nominalEngineRoutes.length > 0) {\n    addDebt({\n      rule: 'I-BACK-6 (reviewed)',\n      label: 'Routes au nom historique *-scanner, façade déjà mince',\n      lot: 'Exception documentée — dette nominale réauditée',\n      entries: nominalEngineRoutes,\n      note: 'Le suffixe historique ne correspond plus à une responsabilité engine',\n    });\n  }\n`
);

console.log('Debt Zero: CSS cascade and actionable-debt counter closure applied');
