'use strict';
const fs = require('fs');

function replaceOnce(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(from)) throw new Error('marker missing in ' + file + ': ' + from.slice(0, 80));
  fs.writeFileSync(file, src.replace(from, to));
}

const facade = `/**
 * @komerce-arch
 * @role          orders-cart-public-api
 * @domain        boutique
 * @layer         adapter
 * @criticality   high
 * @inputs        product_id, cart_state
 * @outputs       cart_mutation, cart_summary, cart_open
 * @depends       b-cart.js, cart-product-summary.js
 * @used-by       b-modal-suggestions.js
 * @doctrine      feature_first_public_boundary
 */
'use strict';

/**
 * Frontière publique orders-client pour les consommateurs cross-feature.
 * Les consommateurs ne doivent jamais importer b-cart.js ou
 * cart-product-summary.js directement : cette façade garde la liberté de
 * refactorer l'implémentation interne du panier sans propager le couplage.
 */
import { quickAdd, quickRemove, openCartWithHighlight } from './b-cart.js';
import { getProductCartSummary } from './cart-product-summary.js';

export {
  quickAdd,
  quickRemove,
  openCartWithHighlight,
  getProductCartSummary,
};
`;
fs.writeFileSync('public/boutique/js/cart-public-api.js', facade);

replaceOnce(
  'public/boutique/js/b-modal-suggestions.js',
  "import { quickAdd, quickRemove, openCartWithHighlight } from './b-cart.js';\nimport { getProductCartSummary } from './cart-product-summary.js';",
  "import { quickAdd, quickRemove, openCartWithHighlight, getProductCartSummary } from './cart-public-api.js';"
);

replaceOnce(
  'public/boutique/tests/unit/b-modal-suggestions.test.js',
  "jest.mock('../../js/b-cart.js', () => ({\n  quickAdd: jest.fn(),\n  quickRemove: jest.fn(),\n  openCartWithHighlight: jest.fn(),\n}));",
  "jest.mock('../../js/cart-public-api.js', () => ({\n  quickAdd: jest.fn(),\n  quickRemove: jest.fn(),\n  openCartWithHighlight: jest.fn(),\n  getProductCartSummary: jest.fn((cart, productId) => {\n    const lines = (cart || []).filter((item) => String(item.product?.id ?? item.product_id ?? item.id) === String(productId));\n    return {\n      totalQty: lines.reduce((sum, item) => sum + (Number(item.qty) || 0), 0),\n      lineCount: lines.length,\n    };\n  }),\n}));"
);
replaceOnce(
  'public/boutique/tests/unit/b-modal-suggestions.test.js',
  "const { quickAdd, quickRemove, openCartWithHighlight } = require('../../js/b-cart.js');",
  "const { quickAdd, quickRemove, openCartWithHighlight } = require('../../js/cart-public-api.js');"
);

const boundaryTest = `'use strict';\n\n/** @test-kind unit @test-runner jest @test-requires none */\nconst fs = require('fs');\nconst path = require('path');\n\nconst JS = path.join(__dirname, '../../js');\n\ndescribe('orders-client cart public API boundary', () => {\n  test('la façade expose uniquement les primitives panier nécessaires aux consommateurs', () => {\n    const src = fs.readFileSync(path.join(JS, 'cart-public-api.js'), 'utf8');\n    expect(src).toContain("from './b-cart.js'");\n    expect(src).toContain("from './cart-product-summary.js'");\n    for (const name of ['quickAdd', 'quickRemove', 'openCartWithHighlight', 'getProductCartSummary']) {\n      expect(src).toContain(name);\n    }\n  });\n\n  test('recommendations consomme la façade et jamais les internes orders', () => {\n    const src = fs.readFileSync(path.join(JS, 'b-modal-suggestions.js'), 'utf8');\n    expect(src).toContain("from './cart-public-api.js'");\n    expect(src).not.toContain("from './b-cart.js'");\n    expect(src).not.toContain("from './cart-product-summary.js'");\n  });\n});\n`;
fs.writeFileSync('public/boutique/tests/unit/cart-public-api-boundary.test.js', boundaryTest);

replaceOnce(
  'public/boutique/features/orders-client.feature.js',
  "      '../js/cart-product-summary.js',\n      '../js/b-mini-cart.js',",
  "      '../js/cart-product-summary.js',\n      '../js/cart-public-api.js',\n      '../js/b-mini-cart.js',"
);
replaceOnce(
  'public/boutique/features/orders-client.feature.js',
  "      '../tests/unit/b-cart.test.js',\n      '../tests/unit/b-mini-cart.test.js',",
  "      '../tests/unit/b-cart.test.js',\n      '../tests/unit/cart-public-api-boundary.test.js',\n      '../tests/unit/b-mini-cart.test.js',"
);
replaceOnce(
  'public/boutique/features/orders-client.feature.js',
  "      'b-cart.js / addToCart / setQty / openCart / closeCart / renderCart',\n      'b-tracking.js / buildTimeline / renderOrdersHistory / renderOrderDetail',",
  "      'b-cart.js / addToCart / setQty / openCart / closeCart / renderCart',\n      'cart-public-api.js / quickAdd / quickRemove / openCartWithHighlight / getProductCartSummary — frontière publique stable pour consommateurs cross-feature',\n      'b-tracking.js / buildTimeline / renderOrdersHistory / renderOrderDetail',"
);

replaceOnce(
  'public/boutique/features/recommendations.feature.js',
  "      'boutique — b-modal-suggestions.js, b-pdp-curation-suggestions.js importent b-bus.js, b-cart.js, b-scroll-owner.js, b-store.js, b-utils.js',",
  "      'platform-ops — b-modal-suggestions.js et b-pdp-curation-suggestions.js consomment bus, store, scroll-owner et utilitaires UI',\n      'orders — b-modal-suggestions.js consomme uniquement cart-public-api.js pour ajout/retrait, résumé et ouverture du panier',"
);

replaceOnce(
  'features/recommendations.feature.js',
  "      'auth',\n      'logistics',",
  "      'auth',\n      'logistics',\n      'orders (frontière frontend orders-client/cart-public-api.js consommée par b-modal-suggestions.js ; aucune importation directe des internes panier)',"
);

const exceptionsFile = 'governance/feature-dependency-exceptions.json';
const exceptions = JSON.parse(fs.readFileSync(exceptionsFile, 'utf8'));
exceptions.exceptions = exceptions.exceptions.filter((e) => !(e.from === 'recommendations' && e.to === 'orders'));
fs.writeFileSync(exceptionsFile, JSON.stringify(exceptions, null, 2) + '\n');

const baselineFile = 'governance/business-graph-drift-baseline.json';
const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
if (baseline.baseline['OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT'] !== 3) {
  throw new Error('unexpected dependency baseline before recommendations boundary');
}
baseline.baseline['OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT'] = 2;
baseline._comment_recommendations_orders_boundary_20260817 = 'recommendations ne dépend plus des internes b-cart.js/cart-product-summary.js : cart-public-api.js, possédé par orders-client, est la frontière publique stable. Ancienne exception O6 supprimée ; baseline resserrée 3→2, jamais relevée.';
fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + '\n');

console.log('recommendations -> orders public boundary staged');
