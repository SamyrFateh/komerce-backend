'use strict';
const fs = require('fs');

function replaceOnce(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(from)) throw new Error('marker missing in ' + file + ': ' + from.slice(0, 100));
  fs.writeFileSync(file, src.replace(from, to));
}

const surfaceApi = `/**
 * @komerce-arch
 * @role          shared-cart-surface-public-api
 * @domain        shared-cart
 * @layer         adapter
 * @criticality   critical
 * @inputs        shared_cart_context, cart_surface, participant_token
 * @outputs       surface_state, drawer_render, shared_list_activation
 * @depends       group-side-cart.js
 * @used-by       ../b-cart.js, ../b-tracking.js
 * @doctrine      feature_first_public_boundary
 */
'use strict';

/**
 * Frontière publique shared-cart pour les consommateurs cross-feature qui
 * pilotent uniquement la surface canonique panier/liste. Les détails du
 * contrôleur group-side-cart.js restent internes à shared-cart.
 */
export {
  isSharedListSurfaceActive,
  hasOpenSharedListInSlot,
  renderSharedListInCart,
  exitSharedListRenderMode,
  setCartSurface,
  reopenSharedListCart,
  activateFromParticipantUrl,
} from './group-side-cart.js';
`;
fs.writeFileSync('public/boutique/js/group/shared-cart-surface-api.js', surfaceApi);

const libraryApi = `/**
 * @komerce-arch
 * @role          shared-cart-library-public-api
 * @domain        shared-cart
 * @layer         adapter
 * @criticality   high
 * @inputs        viewer_session, organizer_identity
 * @outputs       shared_cart_library, canonical_list_label
 * @depends       group-api.js, group-list-labels.js
 * @used-by       ../b-tracking.js
 * @doctrine      feature_first_public_boundary
 */
'use strict';

/**
 * Frontière publique shared-cart dédiée à la bibliothèque « Mes listes ».
 * Elle expose uniquement la lecture de bibliothèque et le libellé canonique,
 * sans livrer les primitives réseau ou presenters internes du domaine.
 */
export { getSharedCartLibrary } from './group-api.js';
export { sharedListDisplayLabel } from './group-list-labels.js';
`;
fs.writeFileSync('public/boutique/js/group/shared-cart-library-api.js', libraryApi);

replaceOnce(
  'public/boutique/js/b-cart.js',
  '@depends       b-bus.js, b-store.js, b-cart-core.js, b-catalog.js, b-scroll-owner.js, shop-schema.js, group/group-side-cart.js, routes/shared-cart.js',
  '@depends       b-bus.js, b-store.js, b-cart-core.js, b-catalog.js, b-scroll-owner.js, shop-schema.js, group/shared-cart-surface-api.js, routes/shared-cart.js'
);
replaceOnce(
  'public/boutique/js/b-cart.js',
  "import { isSharedListSurfaceActive, hasOpenSharedListInSlot, renderSharedListInCart, exitSharedListRenderMode, setCartSurface, reopenSharedListCart } from './group/group-side-cart.js';",
  "import { isSharedListSurfaceActive, hasOpenSharedListInSlot, renderSharedListInCart, exitSharedListRenderMode, setCartSurface, reopenSharedListCart } from './group/shared-cart-surface-api.js';"
);

replaceOnce(
  'public/boutique/js/b-tracking.js',
  '@depends       b-store.js, b-phone.js, b-utils.js, b-cart-core.js, b-identity.js, group/group-api.js, routes/otp.js, routes/orders.js, routes/documents.js, routes/wallet.js, routes/shared-cart.js',
  '@depends       b-store.js, b-phone.js, b-utils.js, b-cart-core.js, b-identity.js, group/shared-cart-library-api.js, group/shared-cart-surface-api.js, routes/otp.js, routes/orders.js, routes/documents.js, routes/wallet.js, routes/shared-cart.js'
);
replaceOnce(
  'public/boutique/js/b-tracking.js',
  "import { getSharedCartLibrary } from './group/group-api.js';\nimport { sharedListDisplayLabel } from './group/group-list-labels.js';",
  "import { getSharedCartLibrary, sharedListDisplayLabel } from './group/shared-cart-library-api.js';"
);
replaceOnce(
  'public/boutique/js/b-tracking.js',
  "const { activateFromParticipantUrl } = await import('./group/group-side-cart.js');",
  "const { activateFromParticipantUrl } = await import('./group/shared-cart-surface-api.js');"
);

// Tracking harness follows the public boundaries instead of mocking shared-cart internals.
replaceOnce(
  'public/boutique/tests/unit/b-tracking.test.js',
  "jest.mock('../../js/group/group-api.js', () => ({\n  getSharedCartLibrary: jest.fn(),\n  closeCart: jest.fn(),\n}));\njest.mock('../../js/group/group-side-cart.js', () => ({\n  activateFromParticipantUrl: jest.fn(),\n}));",
  "jest.mock('../../js/group/shared-cart-library-api.js', () => ({\n  getSharedCartLibrary: jest.fn(),\n  sharedListDisplayLabel: jest.fn(({ isCreator = false, creatorFirstName = null, organizerFullName = null } = {}) => {\n    if (isCreator) return 'Ma liste';\n    const raw = String(creatorFirstName || organizerFullName || '').trim();\n    const firstName = raw ? raw.split(/\\s+/)[0] : '';\n    return firstName ? 'Liste de ' + firstName : 'Liste reçue';\n  }),\n}));\njest.mock('../../js/group/shared-cart-surface-api.js', () => ({\n  activateFromParticipantUrl: jest.fn(),\n}));"
);
replaceOnce(
  'public/boutique/tests/unit/b-tracking.test.js',
  "const { getSharedCartLibrary } = require('../../js/group/group-api.js');\nconst { activateFromParticipantUrl } = require('../../js/group/group-side-cart.js');",
  "const { getSharedCartLibrary } = require('../../js/group/shared-cart-library-api.js');\nconst { activateFromParticipantUrl } = require('../../js/group/shared-cart-surface-api.js');"
);

const surfaceTest = `'use strict';\n\n/** @test-kind unit @test-runner jest @test-requires none */\nconst fs = require('fs');\nconst path = require('path');\n\nconst JS = path.join(__dirname, '../../js');\n\ndescribe('shared-cart surface public API boundary', () => {\n  test('la façade reste une réexportation étroite du contrôleur shared-cart', () => {\n    const src = fs.readFileSync(path.join(JS, 'group/shared-cart-surface-api.js'), 'utf8');\n    expect(src).toContain("from './group-side-cart.js'");\n    for (const name of ['isSharedListSurfaceActive','hasOpenSharedListInSlot','renderSharedListInCart','exitSharedListRenderMode','setCartSurface','reopenSharedListCart','activateFromParticipantUrl']) {\n      expect(src).toContain(name);\n    }\n    expect(src).not.toContain('showKomerceConfirm');\n    expect(src).not.toContain('refreshSharedListContext');\n  });\n\n  test('orders-client consomme la façade sans importer group-side-cart directement', () => {\n    const cart = fs.readFileSync(path.join(JS, 'b-cart.js'), 'utf8');\n    const tracking = fs.readFileSync(path.join(JS, 'b-tracking.js'), 'utf8');\n    expect(cart).toContain("from './group/shared-cart-surface-api.js'");\n    expect(cart).not.toContain("from './group/group-side-cart.js'");\n    expect(tracking).toContain("import('./group/shared-cart-surface-api.js')");\n    expect(tracking).not.toContain("import('./group/group-side-cart.js')");\n  });\n});\n`;
fs.writeFileSync('public/boutique/tests/unit/shared-cart-surface-api.test.js', surfaceTest);

const libraryTest = `'use strict';\n\n/** @test-kind unit @test-runner jest @test-requires none */\nconst fs = require('fs');\nconst path = require('path');\n\nconst JS = path.join(__dirname, '../../js');\n\ndescribe('shared-cart library public API boundary', () => {\n  test('la façade expose uniquement bibliothèque et libellé canonique', () => {\n    const src = fs.readFileSync(path.join(JS, 'group/shared-cart-library-api.js'), 'utf8');\n    expect(src).toContain("getSharedCartLibrary } from './group-api.js'");\n    expect(src).toContain("sharedListDisplayLabel } from './group-list-labels.js'");\n    expect(src).not.toContain('saveSharedCart');\n    expect(src).not.toContain('removeSavedSharedCart');\n  });\n\n  test('tracking consomme la façade sans importer les internes library/labels', () => {\n    const tracking = fs.readFileSync(path.join(JS, 'b-tracking.js'), 'utf8');\n    expect(tracking).toContain("from './group/shared-cart-library-api.js'");\n    expect(tracking).not.toContain("from './group/group-api.js'");\n    expect(tracking).not.toContain("from './group/group-list-labels.js'");\n  });\n});\n`;
fs.writeFileSync('public/boutique/tests/unit/shared-cart-library-api.test.js', libraryTest);

// Shared-cart owns both public boundaries and their direct boundary tests.
replaceOnce(
  'public/boutique/features/shared-cart.feature.js',
  "      '../js/group/group-side-cart.js',\n      '../js/group/group-state.js',",
  "      '../js/group/group-side-cart.js',\n      '../js/group/shared-cart-surface-api.js',\n      '../js/group/shared-cart-library-api.js',\n      '../js/group/group-state.js',"
);
replaceOnce(
  'public/boutique/features/shared-cart.feature.js',
  "      '../tests/unit/group-side-cart.test.js',\n      '../tests/unit/shared-list-responsive-layout.test.js',",
  "      '../tests/unit/group-side-cart.test.js',\n      '../tests/unit/shared-cart-surface-api.test.js',\n      '../tests/unit/shared-cart-library-api.test.js',\n      '../tests/unit/shared-list-responsive-layout.test.js',"
);
replaceOnce(
  'public/boutique/features/shared-cart.feature.js',
  "      'group-api.js / group-state.js',",
  "      'group-api.js / group-state.js',\n      'shared-cart-surface-api.js / surface panier-liste publique pour orders-client',\n      'shared-cart-library-api.js / lecture bibliothèque + libellé public pour orders-client',"
);

replaceOnce(
  'public/boutique/features/orders-client.feature.js',
  "      'notifications-client — navigation depuis le bandeau et urgence retrait',",
  "      'notifications-client — navigation depuis le bandeau et urgence retrait',\n      'shared-cart — b-cart.js et b-tracking.js consomment uniquement shared-cart-surface-api.js / shared-cart-library-api.js',"
);

replaceOnce(
  'features/orders.feature.js',
  "      'refunds',\n    ],",
  "      'refunds',\n      'shared-cart (projection frontend orders-client uniquement : consommation via shared-cart-surface-api.js / shared-cart-library-api.js ; aucun import direct des internes group/*)',\n    ],"
);

const exceptionsFile = 'governance/feature-dependency-exceptions.json';
const exceptions = JSON.parse(fs.readFileSync(exceptionsFile, 'utf8'));
exceptions.exceptions = exceptions.exceptions.filter((e) => !(e.from === 'orders' && e.to === 'shared-cart'));
fs.writeFileSync(exceptionsFile, JSON.stringify(exceptions, null, 2) + '\n');

const baselineFile = 'governance/business-graph-drift-baseline.json';
const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
if (baseline.baseline['OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT'] !== 2) {
  throw new Error('unexpected dependency baseline before orders/shared-cart boundary');
}
baseline.baseline['OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT'] = 1;
baseline._comment_orders_shared_cart_boundary_20260817 = 'orders-client ne consomme plus directement group-side-cart.js/group-api.js/group-list-labels.js : deux frontières shared-cart étroites (surface + library) portent le contrat public. Exception O6 supprimée ; baseline resserrée 2→1, jamais relevée.';
fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + '\n');

console.log('orders -> shared-cart public boundaries staged');
