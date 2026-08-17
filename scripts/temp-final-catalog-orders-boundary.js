'use strict';
const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content); }
function replaceOnce(file, from, to) {
  const src = read(file);
  if (!src.includes(from)) throw new Error(`marker missing in ${file}: ${from.slice(0, 120)}`);
  write(file, src.replace(from, to));
}
function replaceRegex(file, re, to) {
  const src = read(file);
  if (!re.test(src)) throw new Error(`regex missing in ${file}: ${re}`);
  write(file, src.replace(re, to));
}

const favorites = `/**
 * @komerce-arch
 * @role          catalog-favorites-state
 * @domain        catalog
 * @layer         ui-state
 * @criticality   medium
 * @inputs        product_id, favorites_state
 * @outputs       favorite_state, persisted_favorites, favorite_button_state
 * @depends       b-store.js, b-utils.js
 * @used-by       b-catalog.js, b-subcat.js, render/render-product-card.js, b-modal-core.js, boutique.js
 * @doctrine      boutique_canal_decouverte
 */
'use strict';

import { state } from './b-store.js';
import { showToast } from './b-utils.js';

export function isFav(id) {
  const sid = String(id);
  return state.favs.some((favoriteId) => String(favoriteId) === sid);
}

export function saveFavs() {
  localStorage.setItem('k_favs', JSON.stringify(state.favs));
}

export function toggleFav(id, btnEl) {
  const idx = state.favs.indexOf(id);
  if (idx >= 0) {
    state.favs.splice(idx, 1);
    btnEl.classList.remove('liked');
    btnEl.innerHTML = '🤍';
    btnEl.setAttribute('aria-pressed', 'false');
    btnEl.setAttribute('aria-label', 'Ajouter aux favoris');
    showToast('Retiré des favoris');
  } else {
    state.favs.push(id);
    btnEl.classList.add('liked');
    btnEl.innerHTML = '❤️';
    btnEl.setAttribute('aria-pressed', 'true');
    btnEl.setAttribute('aria-label', 'Retirer des favoris');
    btnEl.classList.add('k-pop');
    setTimeout(() => btnEl.classList.remove('k-pop'), 300);
    showToast('❤️ Ajouté aux favoris');
  }
  saveFavs();
}
`;
write('public/boutique/js/catalog-favorites.js', favorites);

const favoritesTest = `'use strict';\n\n/** @test-kind unit @test-runner jest @test-requires none */\nconst { state } = require('../../js/b-store.js');\nconst { showToast } = require('../../js/b-utils.js');\nconst { isFav, saveFavs, toggleFav } = require('../../js/catalog-favorites.js');\nconst { resetState, resetLocalStorage } = require('./helpers/boutiqueTestKit');\n\njest.mock('../../js/b-utils.js', () => ({\n  showToast: jest.fn(),\n}));\n\nbeforeEach(() => {\n  resetState(state);\n  resetLocalStorage();\n  jest.clearAllMocks();\n});\n\ndescribe('catalog favorites', () => {\n  test('isFav compare les ids sans dépendre du type', () => {\n    state.favs = [12, '34'];\n    expect(isFav(12)).toBe(true);\n    expect(isFav('12')).toBe(true);\n    expect(isFav(34)).toBe(true);\n    expect(isFav(99)).toBe(false);\n  });\n\n  test('saveFavs persiste la vérité catalog', () => {\n    state.favs = [1, 2, 3];\n    saveFavs();\n    expect(JSON.parse(localStorage.getItem('k_favs'))).toEqual([1, 2, 3]);\n  });\n\n  test('toggleFav ajoute puis retire avec accessibilité et persistance', () => {\n    jest.useFakeTimers();\n    const btn = document.createElement('button');\n    state.favs = [];\n    toggleFav(7, btn);\n    expect(state.favs).toEqual([7]);\n    expect(btn.classList.contains('liked')).toBe(true);\n    expect(btn.innerHTML).toBe('❤️');\n    expect(btn.getAttribute('aria-pressed')).toBe('true');\n    expect(btn.getAttribute('aria-label')).toBe('Retirer des favoris');\n    expect(JSON.parse(localStorage.getItem('k_favs'))).toEqual([7]);\n    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Ajouté aux favoris'));\n    jest.advanceTimersByTime(300);\n    expect(btn.classList.contains('k-pop')).toBe(false);\n\n    toggleFav(7, btn);\n    expect(state.favs).toEqual([]);\n    expect(btn.classList.contains('liked')).toBe(false);\n    expect(btn.innerHTML).toBe('🤍');\n    expect(btn.getAttribute('aria-pressed')).toBe('false');\n    expect(btn.getAttribute('aria-label')).toBe('Ajouter aux favoris');\n    expect(JSON.parse(localStorage.getItem('k_favs'))).toEqual([]);\n    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Retiré des favoris'));\n    jest.useRealTimers();\n  });\n});\n`;
write('public/boutique/tests/unit/catalog-favorites.test.js', favoritesTest);

// b-cart-core redevient strictement panier : plus de favoris.
replaceOnce(
  'public/boutique/js/b-cart-core.js',
  ' * Exports : cartQty, cartTotal, saveCart, updateCartBadge, isFav, saveFavs',
  ' * Exports : cartQty, cartTotal, saveCart, updateCartBadge, showToast'
);
replaceRegex(
  'public/boutique/js/b-cart-core.js',
  /\n\/\/ ──────────────────────────────────────────────\n\/\/ FAVORIS\n\/\/ ──────────────────────────────────────────────[\s\S]*$/,
  '\n'
);

// b-cart ne possède plus le comportement favoris.
replaceOnce(
  'public/boutique/js/b-cart.js',
  '  showToast, saveCart, cartQty, cartTotal, saveFavs,',
  '  showToast, saveCart, cartQty, cartTotal,'
);
replaceRegex(
  'public/boutique/js/b-cart.js',
  /\n  \/\* ── TOGGLE FAV ─+[\s\S]*?\n  \/\* ── CATEGORIES ─+\/\n/,
  '\n  /* ── CATEGORIES ─────────────────────────────────────────── */\n'
);
replaceOnce(
  'public/boutique/js/b-cart.js',
  '  addToCart, quickAdd, quickRemove, toggleFav, setQty,',
  '  addToCart, quickAdd, quickRemove, setQty,'
);

// Frontière orders publique : uniquement les opérations panier nécessaires aux consommateurs cross-feature.
replaceOnce(
  'public/boutique/js/cart-public-api.js',
  ' * @outputs       cart_mutation, cart_summary, cart_open',
  ' * @outputs       cart_mutation, cart_summary, cart_open, cart_controls_sync'
);
replaceOnce(
  'public/boutique/js/cart-public-api.js',
  ' * @used-by       b-modal-suggestions.js',
  ' * @used-by       b-modal-suggestions.js, b-catalog.js, b-subcat.js, render/render-product-card.js, b-modal-buybox-shared.js'
);
replaceOnce(
  'public/boutique/js/cart-public-api.js',
  "import { quickAdd, quickRemove, openCartWithHighlight } from './b-cart.js';",
  "import { addToCart, quickAdd, quickRemove, openCartWithHighlight, markAllCartButtons, pruneObsoleteCart } from './b-cart.js';"
);
replaceOnce(
  'public/boutique/js/cart-public-api.js',
  'export {\n  quickAdd,',
  'export {\n  addToCart,\n  quickAdd,'
);
replaceOnce(
  'public/boutique/js/cart-public-api.js',
  '  openCartWithHighlight,\n  getProductCartSummary,',
  '  openCartWithHighlight,\n  markAllCartButtons,\n  pruneObsoleteCart,\n  getProductCartSummary,'
);

// Catalog renderer : toasts platform-ops, favoris catalog, panier via façade orders.
replaceOnce(
  'public/boutique/js/b-catalog.js',
  '  renderProductCarousel, bindCarouselDots,\n}                         from \'./b-utils.js\';\nimport {\n  showToast, cartQty, updateCartBadge, isFav,\n}                         from \'./b-cart-core.js\';\nimport {\n  renderCartBody,\n  toggleFav, quickAdd, quickRemove, markAllCartButtons,\n  pruneObsoleteCart, openCartWithHighlight,\n}                         from \'./b-cart.js\';',
  '  renderProductCarousel, bindCarouselDots, showToast,\n}                         from \'./b-utils.js\';\nimport { toggleFav } from \'./catalog-favorites.js\';\nimport {\n  quickAdd, quickRemove, markAllCartButtons,\n  pruneObsoleteCart, openCartWithHighlight,\n}                         from \'./cart-public-api.js\';'
);

// Subcat : le toast importé était mort ; favoris catalog, panier via façade orders.
replaceOnce(
  'public/boutique/js/b-subcat.js',
  "import {\n  showToast,\n}                         from './b-cart-core.js';\n",
  ''
);
replaceOnce(
  'public/boutique/js/b-subcat.js',
  "import { toggleFav, quickAdd, quickRemove, openCartWithHighlight } from './b-cart.js';",
  "import { toggleFav } from './catalog-favorites.js';\nimport { quickAdd, quickRemove, openCartWithHighlight } from './cart-public-api.js';"
);
replaceOnce(
  'public/boutique/js/b-subcat.js',
  ' * @depends       b-store.js, shop-schema.js, b-pager.js, b-catalog.js, b-modal.js, b-cart.js, b-scroll-owner.js',
  ' * @depends       b-store.js, shop-schema.js, b-pager.js, b-catalog.js, b-modal.js, catalog-favorites.js, cart-public-api.js, b-scroll-owner.js'
);

// Product card : favoris catalog + résumé via frontière orders.
replaceOnce(
  'public/boutique/js/render/render-product-card.js',
  "import { isFav } from '../b-cart-core.js';\nimport { getProductCartSummary } from '../cart-product-summary.js';",
  "import { isFav } from '../catalog-favorites.js';\nimport { getProductCartSummary } from '../cart-public-api.js';"
);

// Toasts n'appartiennent pas à orders : retour à b-utils.
replaceOnce(
  'public/boutique/js/b-modal-desktop-product.js',
  "import { fmtPrice, optimizeImgUrl } from './b-utils.js';",
  "import { fmtPrice, optimizeImgUrl, showToast } from './b-utils.js';"
);
replaceOnce('public/boutique/js/b-modal-desktop-product.js', "import { showToast } from './b-cart-core.js';\n", '');
replaceOnce(
  'public/boutique/js/b-favs.js',
  "import { fmt, bindCarouselDots, apiPost } from './b-utils.js';\nimport { showToast } from './b-cart-core.js';",
  "import { fmt, bindCarouselDots, apiPost, showToast } from './b-utils.js';"
);

// Buybox catalogue : vraie opération panier via façade publique.
replaceOnce(
  'public/boutique/js/b-modal-buybox-shared.js',
  "import { addToCart } from './b-cart.js';",
  "import { addToCart } from './cart-public-api.js';"
);
replaceOnce(
  'public/boutique/js/b-modal-buybox-shared.js',
  ' * @depends       b-utils.js, b-modal.js, b-cart.js, b-share-cart.js, view-models/modal-cart-product-model.js',
  ' * @depends       b-utils.js, b-modal.js, cart-public-api.js, b-share-cart.js, view-models/modal-cart-product-model.js'
);

// Modal core : le favori est catalog ; les vraies opérations panier restent orders (dépendance shared-cart -> orders déjà déclarée).
replaceOnce(
  'public/boutique/js/b-modal-core.js',
  '  quickAdd, quickRemove, toggleFav, setQty,',
  '  quickAdd, quickRemove, setQty,'
);
replaceOnce(
  'public/boutique/js/b-modal-core.js',
  "}                         from './b-cart.js';\nimport {\n  normalizeCategoryKey, getCategorySectionEmoji,",
  "}                         from './b-cart.js';\nimport { toggleFav } from './catalog-favorites.js';\nimport {\n  normalizeCategoryKey, getCategorySectionEmoji,"
);

// Composition root : favorites depuis catalog, jamais depuis cart-core.
replaceOnce(
  'public/boutique/js/boutique.js',
  '  showToast, cartQty, cartTotal, saveCart, updateCartBadge,\n  isFav, saveFavs,\n}                              from \'./b-cart-core.js\';',
  '  showToast, cartQty, cartTotal, saveCart, updateCartBadge,\n}                              from \'./b-cart-core.js\';\nimport { isFav, saveFavs }     from \'./catalog-favorites.js\';'
);

// Tests catalog : suivent les nouvelles frontières, pas les internes orders.
replaceOnce(
  'public/boutique/tests/unit/b-catalog.test.js',
  "  bindCarouselDots: mockBindCarouselDots,\n}));",
  "  bindCarouselDots: mockBindCarouselDots,\n  showToast: mockShowToast,\n}));"
);
replaceRegex(
  'public/boutique/tests/unit/b-catalog.test.js',
  /jest\.mock\('\.\.\/\.\.\/js\/b-cart-core\.js',[\s\S]*?\}\)\);\njest\.mock\('\.\.\/\.\.\/js\/b-cart\.js',[\s\S]*?\}\)\);/,
  "jest.mock('../../js/catalog-favorites.js', () => ({ toggleFav: mockToggleFav }));\njest.mock('../../js/cart-public-api.js', () => ({\n  quickAdd: mockQuickAdd,\n  quickRemove: mockQuickRemove,\n  openCartWithHighlight: mockOpenCartWithHighlight,\n  markAllCartButtons: mockMarkAllCartButtons,\n  pruneObsoleteCart: mockPruneObsoleteCart,\n}));"
);

replaceRegex(
  'public/boutique/tests/unit/b-subcat.test.js',
  /jest\.mock\('\.\.\/\.\.\/js\/b-cart\.js',[\s\S]*?\}\)\);\n\njest\.mock\('\.\.\/\.\.\/js\/b-cart-core\.js',[\s\S]*?\}\)\);/,
  "jest.mock('../../js/catalog-favorites.js', () => ({ toggleFav: jest.fn() }));\n\njest.mock('../../js/cart-public-api.js', () => ({\n  quickAdd: jest.fn(),\n  quickRemove: jest.fn(),\n  openCartWithHighlight: jest.fn(),\n}));"
);

replaceOnce(
  'public/boutique/tests/unit/render-product-card.test.js',
  "jest.mock('../../js/b-cart-core.js', () => ({\n  isFav: jest.fn(() => false),\n}));",
  "jest.mock('../../js/catalog-favorites.js', () => ({\n  isFav: jest.fn(() => false),\n}));\n\njest.mock('../../js/cart-public-api.js', () => ({\n  getProductCartSummary: jest.fn((cart, productId) => {\n    const lines = (cart || []).filter((item) => String(item.product?.id ?? item.product_id ?? item.id) === String(productId));\n    const totalQty = lines.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);\n    return { productId: String(productId), lines, line: lines.length === 1 ? lines[0] : null, lineCount: lines.length, totalQty, hasVariantLines: false, isAmbiguous: lines.length > 1, canQuickAdjust: lines.length === 1 };\n  }),\n}));"
);

// b-favs test n'a aucune raison de mocker/importer orders : renderer canonique mocké suffit.
replaceRegex(
  'public/boutique/tests/unit/b-favs.test.js',
  /jest\.mock\('\.\.\/\.\.\/js\/b-cart-core\.js',[\s\S]*?\}\)\);\njest\.mock\('\.\.\/\.\.\/js\/b-cart\.js',[\s\S]*?\}\)\);/,
  "jest.mock('../../js/catalog-favorites.js', () => ({ isFav: jest.fn(() => false), toggleFav: jest.fn() }));"
);
replaceRegex(
  'public/boutique/tests/unit/b-favs.test.js',
  /const \{ showToast, isFav \} = require\('\.\.\/\.\.\/js\/b-cart-core\.js'\);\nconst \{ toggleFav, quickAdd, quickRemove \} = require\('\.\.\/\.\.\/js\/b-cart\.js'\);/,
  "const { showToast } = require('../../js/b-utils.js');\nconst { isFav, toggleFav } = require('../../js/catalog-favorites.js');"
);

replaceOnce(
  'public/boutique/tests/unit/b-modal-buybox-shared.test.js',
  "jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn() }));",
  "jest.mock('../../js/cart-public-api.js', () => ({ addToCart: jest.fn() }));"
);
replaceOnce(
  'public/boutique/tests/unit/b-modal-buybox-shared.test.js',
  "const { addToCart } = require('../../js/b-cart.js');",
  "const { addToCart } = require('../../js/cart-public-api.js');"
);

// Modal core test harnesses : conserver le mock panier, déplacer seulement toggleFav.
for (const file of [
  'public/boutique/tests/unit/b-modal-core.test.js',
  'public/boutique/tests/unit/b-modal-core-active-flows.test.js',
  'public/boutique/tests/unit/b-modal-core-actions-composition.test.js',
  'public/boutique/tests/unit/b-modal-core-desktop-click.test.js',
  'public/boutique/tests/unit/b-modal-core-pdc6-baseline.test.js',
  'public/boutique/tests/unit/b-modal-core-pdc6-coverage.test.js',
]) {
  if (!fs.existsSync(file)) continue;
  let src = read(file);
  if (src.includes('toggleFav:')) {
    src = src.replace(/\n?\s*toggleFav:\s*([^,\n]+),?/g, '');
    if (!src.includes("jest.mock('../../js/catalog-favorites.js'")) {
      const marker = "jest.mock('../../js/b-cart.js'";
      const idx = src.indexOf(marker);
      if (idx >= 0) {
        const end = src.indexOf('\n', src.indexOf('));', idx)) + 1;
        src = src.slice(0, end) + "jest.mock('../../js/catalog-favorites.js', () => ({ toggleFav: jest.fn() }));\n" + src.slice(end);
      }
    }
    write(file, src);
  }
}

// b-cart unit test : favoris sortent de la responsabilité orders.
for (const file of ['public/boutique/tests/unit/b-cart.test.js']) {
  let src = read(file);
  src = src.replace('  saveFavs: jest.fn(),\n', '');
  src = src.replace('const { showToast, updateCartBadge, saveCart, cartQty, saveFavs } =\n', 'const { showToast, updateCartBadge, saveCart, cartQty } =\n');
  src = src.replace('  addToCart, quickAdd, quickRemove, toggleFav, setQty,\n', '  addToCart, quickAdd, quickRemove, setQty,\n');
  src = src.replace(/\n  describe\('toggleFav',[\s\S]*?\n  \}\);\n\n  describe\('markAllCartButtons'/, "\n  describe('markAllCartButtons'");
  src = src.replace(' *      toggleFav, markAllCartButtons, openCart/closeCart/openCartWithHighlight,', ' *      markAllCartButtons, openCart/closeCart/openCartWithHighlight,');
  write(file, src);
}

// b-cart-core test : favorites migrés vers catalog-favorites.test.js.
let coreTest = read('public/boutique/tests/unit/b-cart-core.test.js');
coreTest = coreTest.replace('  updateCartBadge,\n  isFav,\n  saveFavs,\n', '  updateCartBadge,\n');
coreTest = coreTest.replace(/\n\ndescribe\('isFav',[\s\S]*$/, '\n');
coreTest = coreTest.replace('`updateCartBadge`, `isFav`, `saveFavs` (5 des 7 exports)', '`updateCartBadge` et `showToast` étaient historiquement sous-testés');
coreTest = coreTest.replace('`cartQty`/`cartTotal`/`isFav` en inline sans', '`cartQty`/`cartTotal` en inline sans');
write('public/boutique/tests/unit/b-cart-core.test.js', coreTest);

// Catalog manifests : nouveau propriétaire favoris + contrat orders explicite par façade.
replaceOnce(
  'public/boutique/features/catalog.feature.js',
  "      '../js/b-catalog.js',",
  "      '../js/b-catalog.js',\n      '../js/catalog-favorites.js',"
);
replaceOnce(
  'public/boutique/features/catalog.feature.js',
  "      '../tests/unit/b-favs.test.js',",
  "      '../tests/unit/b-favs.test.js',\n      '../tests/unit/catalog-favorites.test.js',"
);
replaceOnce(
  'public/boutique/features/catalog.feature.js',
  "      'orders — actions panier depuis les surfaces produit',",
  "      'orders — actions panier depuis les surfaces produit, exclusivement via cart-public-api.js',"
);
replaceOnce(
  'public/boutique/features/catalog.feature.js',
  "      'render-product-card.js / renderProductCard',",
  "      'render-product-card.js / renderProductCard',\n      'catalog-favorites.js / isFav / saveFavs / toggleFav — vérité favoris du catalogue',"
);

replaceOnce(
  'features/catalog.feature.js',
  "      'js/b-catalog.js',",
  "      'js/b-catalog.js',\n      'js/catalog-favorites.js',"
);
replaceOnce(
  'features/catalog.feature.js',
  "      'shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)',",
  "      'shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)',\n      'orders (projection frontend : actions panier consommées uniquement via public/boutique/js/cart-public-api.js ; aucun import direct des internes b-cart/b-cart-core/cart-product-summary depuis les surfaces catalog)',"
);

// Orders client expose la surface élargie mais toujours étroite.
replaceOnce(
  'public/boutique/features/orders-client.feature.js',
  'cart-public-api.js / quickAdd / quickRemove / openCartWithHighlight / getProductCartSummary — frontière publique stable pour consommateurs cross-feature',
  'cart-public-api.js / addToCart / quickAdd / quickRemove / openCartWithHighlight / markAllCartButtons / pruneObsoleteCart / getProductCartSummary — frontière publique stable pour consommateurs cross-feature'
);

// Exception O6 supprimée ; baseline ACTIONABLE descend à zéro.
const exceptionsFile = 'governance/feature-dependency-exceptions.json';
const exceptions = JSON.parse(read(exceptionsFile));
exceptions.exceptions = exceptions.exceptions.filter((e) => !(e.from === 'catalog' && e.to === 'orders'));
write(exceptionsFile, JSON.stringify(exceptions, null, 2) + '\n');

const baselineFile = 'governance/business-graph-drift-baseline.json';
const baseline = JSON.parse(read(baselineFile));
if (baseline.baseline['OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT'] !== 1) {
  throw new Error('unexpected dependency baseline before final seam');
}
baseline.baseline['OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT'] = 0;
baseline._comment_catalog_orders_boundary_20260817 = 'Dernière couture cross-feature fermée : catalog rapatrie la vérité favoris, consomme les toasts via platform-ops et toutes les opérations panier via cart-public-api.js. Exception O6 catalog→orders supprimée ; baseline resserrée 1→0, jamais relevée.';
write(baselineFile, JSON.stringify(baseline, null, 2) + '\n');

console.log('FINAL_CATALOG_ORDERS_BOUNDARY_STAGED');
