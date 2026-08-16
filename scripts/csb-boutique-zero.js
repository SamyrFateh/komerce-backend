'use strict';
const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(path, from, to, label) {
  let src = read(path);
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`${label || path}: expected 1 exact match, got ${count}`);
  src = src.replace(from, to);
  write(path, src);
}
function replaceRegex(path, re, to, expected, label) {
  let src = read(path);
  const matches = src.match(re) || [];
  if (matches.length !== expected) throw new Error(`${label || path}: expected ${expected} regex matches, got ${matches.length}`);
  src = src.replace(re, to);
  write(path, src);
}

// 1. The three neutral inter-slice ports are Boutique platform infrastructure.
replaceOnce(
  'public/boutique/features/platform-ops.feature.js',
  "      '../js/boutique.js',\n",
  "      '../js/boutique.js',\n      '../js/ports/cart-intent-port.js',\n      '../js/ports/catalog-presentation-port.js',\n      '../js/ports/shared-list-projection-port.js',\n",
  'platform-ops owns technical ports'
);

// 2. Break the catalog <-> subcategory direct cycle.
replaceOnce(
  'public/boutique/js/b-subcat.js',
  "import { _renderCard, renderGrid } from './b-catalog.js';\n",
  "import { renderProductCard }       from './render/render-product-card.js';\n",
  'subcat no longer imports catalog'
);
replaceOnce(
  'public/boutique/js/b-subcat.js',
  "firstPage.map(_renderCard).join('')",
  "firstPage.map(renderProductCard).join('')",
  'subcat uses canonical card renderer'
);
replaceOnce(
  'public/boutique/js/b-subcat.js',
  "        renderGrid();\n        let _sc = dom.pageScroll;",
  "        bus.emit('catalog:render-request');\n        let _sc = dom.pageScroll;",
  'subcat requests catalog rerender through bus'
);
replaceOnce(
  'public/boutique/js/b-catalog.js',
  "bus.on('chip:center', function(chip) { centerActiveChip(chip); });\n",
  "bus.on('chip:center', function(chip) { centerActiveChip(chip); });\nbus.on('catalog:render-request', function() { renderGrid(); });\n",
  'catalog owns render request bus endpoint'
);

// 3. Break the catalog <-> home-controller direct cycle by using the controller's existing injected deps seam.
replaceOnce(
  'public/boutique/js/controllers/home-controller.js',
  "import { renderGrid, setActiveCat } from '../b-catalog.js';\n",
  '',
  'home controller no longer imports catalog'
);
replaceOnce(
  'public/boutique/js/controllers/home-controller.js',
  "import { scrollPageToTop, scrollPageToElement } from '../b-scroll-owner.js';\n\nfunction getCatsEl()",
  "import { scrollPageToTop, scrollPageToElement } from '../b-scroll-owner.js';\n\nlet catalogActions = {};\nfunction catalogAction(name) {\n  const fn = catalogActions[name];\n  if (typeof fn !== 'function') {\n    throw new Error('[home-controller] catalog action not configured: ' + name);\n  }\n  return fn;\n}\n\nfunction getCatsEl()",
  'home controller injected catalog actions'
);
replaceOnce(
  'public/boutique/js/controllers/home-controller.js',
  "      setActiveCat('all');\n      scrollPageToTop('smooth');",
  "      catalogAction('setActiveCat')('all');\n      scrollPageToTop('smooth');",
  'home controller back action injected'
);
replaceOnce(
  'public/boutique/js/controllers/home-controller.js',
  "      renderSubcatRail(catKey);\n      renderGrid();\n",
  "      renderSubcatRail(catKey);\n      catalogAction('renderGrid')();\n",
  'home controller subcat rerender injected'
);
replaceOnce(
  'public/boutique/js/controllers/home-controller.js',
  "  const { renderGrid, scrollPagerToCat, scrollToCategorySection } = deps;\n",
  "  const { renderGrid, setActiveCat, scrollPagerToCat, scrollToCategorySection } = deps;\n",
  'home controller selection gets setActiveCat via deps'
);
replaceOnce(
  'public/boutique/js/controllers/home-controller.js',
  "export function setupHomeController(deps) {\n  const catsEl = renderCategoryRail();",
  "export function setupHomeController(deps) {\n  catalogActions = {\n    ...catalogActions,\n    renderGrid: deps?.renderGrid,\n    setActiveCat: deps?.setActiveCat,\n  };\n  const catsEl = renderCategoryRail();",
  'home controller configures injected actions'
);
replaceOnce(
  'public/boutique/js/b-catalog.js',
  "  _setupHomeController({\n    renderGrid,\n    scrollPagerToCat:       _scrollPagerToCat,",
  "  _setupHomeController({\n    renderGrid,\n    setActiveCat,\n    scrollPagerToCat:       _scrollPagerToCat,",
  'catalog injects setActiveCat'
);

// 4. No direct-cycle allowlist remains. A future direct cycle is a hard error.
replaceRegex(
  'public/boutique/scripts/check-js-imports.js',
  /\/\*\*\n \* Cycles A↔B documentés comme intentionnels\.[\s\S]*?const KNOWN_CYCLES = \[[\s\S]*?\n\];\n/,
  "// Clean Signal Boundary: no direct A↔B cycle is allowlisted.\n// A direct cycle must be removed through the bus or a neutral port.\n",
  1,
  'remove direct-cycle allowlist'
);
replaceRegex(
  'public/boutique/scripts/check-js-imports.js',
  /\n    const known = KNOWN_CYCLES\.find\([\s\S]*?\n      continue;\n    \}\n/,
  '\n',
  1,
  'remove known-cycle downgrade'
);
replaceOnce(
  'public/boutique/scripts/check-js-imports.js',
  "      `Ajoutez-le à KNOWN_CYCLES si intentionnel, sinon découplez via b-bus.js`);",
  "      `Découplez via b-bus.js ou un port technique neutre`);",
  'cycle remediation message'
);
// I-4 is explicitly informational. Do not emit warning glyphs that Feature360 interprets as debt.
replaceOnce(
  'public/boutique/scripts/check-js-imports.js',
  "      console.log(`  ${YELLOW}⚠${RESET} ${DIM}${f} — ${items.length} export(s) non consommé(s) :${RESET}`);",
  "      console.log(`  ${CYAN}ℹ${RESET} ${DIM}${f} — ${items.length} export(s) non consommé(s) :${RESET}`);",
  'I-4 file line is informational'
);
replaceOnce(
  'public/boutique/scripts/check-js-imports.js',
  "      console.log(`${YELLOW}  ${deadExports.length} export(s) non consommés [I-4] (informatif uniquement).${RESET}`);",
  "      console.log(`${CYAN}  ℹ ${deadExports.length} export(s) non consommés [I-4] (informatif uniquement).${RESET}`);",
  'I-4 success summary is informational'
);
replaceOnce(
  'public/boutique/scripts/check-js-imports.js',
  "    console.log(`${YELLOW}  ${deadExports.length} export(s) non consommés [I-4] (informatif)${RESET}`);",
  "    console.log(`${CYAN}  ℹ ${deadExports.length} export(s) non consommés [I-4] (informatif)${RESET}`);",
  'I-4 failure summary remains informational'
);

// 5. Body-class checker: distinguish actual document.body aliases from unrelated local variables.
replaceOnce(
  'public/boutique/scripts/check-body-classes.js',
  "  'k-view-group',\n]);",
  "  'k-view-group',\n  'k-view-komerce',\n]);",
  'Mon Komerce is a view class'
);
replaceOnce(
  'public/boutique/scripts/check-body-classes.js',
  "  const lines = src.split('\\n');\n  const ops   = [];\n\n  // Deux formes : document.body.classList.X et (rarement) body.classList.X\n  // On cherche les deux.\n  const bodyRe = /(?:document\\.body|(?<![a-zA-Z0-9_$])body)\\.classList\\.(add|remove|toggle|contains)\\s*\\(([^)]+)\\)/g;",
  "  const lines = src.split('\\n');\n  const ops   = [];\n\n  // Seuls document.body, dom.body et les alias explicitement assignés à l'un\n  // des deux sont le body de page. Un `const body = dom.orderBody` ne l'est pas.\n  const bodyAliases = new Set();\n  const aliasRe = /(?:const|let|var)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*(?:document\\.body|dom\\.body)\\b/g;\n  let aliasMatch;\n  while ((aliasMatch = aliasRe.exec(src)) !== null) bodyAliases.add(aliasMatch[1]);\n  const bodyRe = /((?:document\\.body|dom\\.body)|[a-zA-Z_$][a-zA-Z0-9_$]*)\\.classList\\.(add|remove|toggle|contains)\\s*\\(([^)]+)\\)/g;",
  'body checker uses explicit body aliases'
);
replaceOnce(
  'public/boutique/scripts/check-body-classes.js',
  "      const op      = m[1];\n      const argsRaw = m[2];",
  "      const target  = m[1];\n      if (!target.includes('.') && !bodyAliases.has(target)) continue;\n      const op      = m[2];\n      const argsRaw = m[3];",
  'body checker filters unrelated local body variables'
);
replaceOnce(
  'public/boutique/scripts/check-body-classes.js',
  "    if (hasRemove && !hasAdd && !hasToggle && !HTML_INIT_CLASSES.has(cls)) {",
  "    if (hasRemove && !hasAdd && !hasToggle && !HTML_INIT_CLASSES.has(cls) && !isViewClass) {",
  'dynamic view classes are balanced by switchView'
);

// 6. Remove the only genuinely stale body-class CSS contract (no DOM or JS reference exists).
replaceRegex(
  'public/boutique/css/cart.css',
  /\n\/\* « Numéro changé \? · Ce n'est pas vous \? » — une seule ligne \*\/[\s\S]*?body\.ck-is-me \.k-ck-id-btns-row \{ display: flex; \}\s*$/,
  '\n',
  1,
  'remove dead ck-is-me CSS'
);

// 7. Remove bespoke 380/430 viewport breakpoints in favor of container/fluid layout.
replaceOnce(
  'public/boutique/css/checkout-vertical-rail.css',
  "  grid-template-columns: repeat(2, minmax(0,1fr));",
  "  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));",
  'recipient grid is container-adaptive'
);
replaceRegex(
  'public/boutique/css/checkout-vertical-rail.css',
  /\n@media \(max-width: 380px\) \{\n  \.ck-recipient-grid \{ grid-template-columns: 1fr; \}\n\}\n/,
  '\n',
  1,
  'remove recipient 380 breakpoint'
);
replaceOnce(
  'public/boutique/css/checkout-vertical-rail.css',
  "  padding: 16px 18px 18px;",
  "  padding: 16px clamp(12px, 4vw, 18px) 18px;",
  'checkout padding is fluid'
);
replaceRegex(
  'public/boutique/css/checkout-vertical-rail.css',
  /\n@media \(max-width: 380px\) \{\n  \.k-order-overlay\.open \.k-order-body--checkout \{ padding-right: 12px; padding-left: 12px; \}\n  \.ck-step-header \{ padding-right: 11px; padding-left: 11px; \}\n  \.ck-step-header-change \{ padding: 0 9px; \}\n  \.ck-pay-chip \{ min-height: 56px; padding: 7px 9px; \}\n\}\n/,
  '\n',
  1,
  'remove secondary 380 breakpoint'
);
replaceOnce(
  'public/boutique/css/shared-list-library-remove.css',
  ".k-library-item-row {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  align-items: stretch;\n  gap: 8px;\n  min-width: 0;\n}\n\n.k-library-item-row .k-library-item {\n  min-width: 0;\n}",
  ".k-library-item-row {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: stretch;\n  gap: 8px;\n  min-width: 0;\n}\n\n.k-library-item-row .k-library-item {\n  flex: 1 1 280px;\n  min-width: 0;\n}",
  'shared-list row wraps by container width'
);
replaceOnce(
  'public/boutique/css/shared-list-library-remove.css',
  "  align-self: center;\n  min-height: 40px;",
  "  align-self: center;\n  flex: 0 0 auto;\n  margin-left: auto;\n  min-height: 40px;",
  'shared-list remove action flex placement'
);
replaceRegex(
  'public/boutique/css/shared-list-library-remove.css',
  /\n@media \(max-width: 430px\) \{[\s\S]*?\n\}\s*$/,
  '\n',
  1,
  'remove 430 breakpoint'
);

// 8. Strict Boutique registry must also reject orphan warnings.
replaceOnce(
  'public/boutique/scripts/feature-registry-check.js',
  "    if (STRICT && errors.length > 0) process.exit(1);",
  "    if (STRICT && (errors.length > 0 || warnings.length > 0)) process.exit(1);",
  'registry JSON strict blocks orphans'
);
replaceOnce(
  'public/boutique/scripts/feature-registry-check.js',
  "  if (STRICT && errors.length > 0) {\n    console.log('  ──  Mode --strict : exit(1)\\n');\n    process.exit(1);\n  }",
  "  if (STRICT && (errors.length > 0 || warnings.length > 0)) {\n    console.log('  ──  Mode --strict : exit(1)\\n');\n    process.exit(1);\n  }",
  'registry report strict blocks orphans'
);

// 9. Gate projection must not turn positive success sentences into debt findings.
replaceOnce(
  'scripts/gen-gate-findings.js',
  "    const file = extractRepoFile(message);\n    if (file) currentFile = file;\n    if (!/(❌|✖|⚠|\\bWARN(?:ING)?\\b|\\bERROR\\b|\\bFAIL(?:ED)?\\b|violation|interdit|inconnu|manquant|orphelin|conflict|duplicate|d[ée]passe)/i.test(message)) continue;",
  "    const file = extractRepoFile(message);\n    if (file) currentFile = file;\n    if (/^(?:✔|✅)\\s/.test(message) || /^Aucun(?:e)?\\b/i.test(message)) continue;\n    if (!/(❌|✖|⚠|\\bWARN(?:ING)?\\b|\\bERROR\\b|\\bFAIL(?:ED)?\\b|violation|interdit|inconnu|manquant|orphelin|conflict|duplicate|d[ée]passe)/i.test(message)) continue;",
  'gate projection ignores explicit success diagnostics'
);

console.log('CSB Boutique zero-noise patch applied.');
