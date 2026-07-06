'use strict';

/**
 * tests/unit/helpers/boutiqueTestKit.js
 *
 * Socle de test partagé pour les modules boutique (js/b-*.js).
 * Miroir de dashboards/tests/unit/helpers/dashboardTestKit.js, adapté aux
 * différences réelles de la boutique :
 *   - modules ES réels (export/import via babel), pas d'IIFE + window.*
 *     comme les vues dashboard → pas de loadView/require dynamique ici.
 *   - état partagé au niveau module (js/b-store.js: `state`, `dom`) plutôt
 *     que par vue → besoin d'un reset explicite entre tests (les modules ne
 *     sont chargés qu'une fois par fichier de test, cf. komerce-api.test.js).
 *   - API réseau exposée en global `window.K` (posé par komerce-api.js),
 *     pas un client importable → mockWindowK() le simule directement.
 *
 * Ce que le kit NE fait PAS : les `jest.mock('../../js/xxx.js', ...)` de
 * dépendances (b-cart-core, b-cart, b-modal…) restent dans chaque fichier
 * de test — jest hoist ces appels, un helper runtime ne peut pas les
 * remplacer. Le kit documente juste la forme attendue à copier-coller dans
 * le jest.mock() du fichier de test.
 */

/**
 * Réinitialise l'état partagé de b-store.js (`state`) à des valeurs neutres,
 * en mutant l'objet en place (les modules importent la même référence, un
 * `state = {...}` ne serait pas vu par eux).
 * @param {object} state - l'objet `state` importé depuis js/b-store.js
 * @param {object} [overrides] - clés à écraser après le reset
 */
function resetState(state, overrides = {}) {
  Object.assign(state, {
    products: [],
    filtered: [],
    cart: [],
    favs: [],
    activeCat: 'all',
    activeSubcat: null,
    sectionSubcats: {},
    flatSubcat: null,
    modalOpen: false,
    modalProduct: null,
    modalSubcatFilter: null,
    modalQty: 1,
    modalHistory: [],
    viewedHistory: [],
    carouselIndex: 0,
    carouselCount: 1,
    searchTimeout: null,
    relais: [],
    orderData: { payment_mode: 'cash_relais' },
    walletBalance: 0,
    page: 0,
    checkoutAttemptKey: null,
    pendingStripeOrderRef: null,
    shareToken: null,
    shareId: null,
    cartName: '',
    shareExpiry: null,
    editSharedCart: null,
  }, overrides);
  return state;
}

/**
 * Vide et réassigne les refs DOM d'un objet `dom` (b-store.js) importé par
 * un module. Usage : resetDom(dom, { modalQtyVal: 'span', addCartBtn: 'button' })
 * @param {object} dom - l'objet `dom` importé depuis js/b-store.js
 * @param {Object.<string,string>} refs - clé → tagName à créer
 */
function resetDom(dom, refs = {}) {
  Object.keys(refs).forEach((key) => {
    dom[key] = document.createElement(refs[key]);
  });
  return dom;
}

/**
 * Monte un fixture DOM minimal dans document.body et le retourne.
 * Remplace tout fixture précédent posé par un appel antérieur (id fixe).
 * @param {string} [html] - HTML interne du container
 * @returns {HTMLElement}
 */
function mountFixture(html = '') {
  let root = document.getElementById('boutique-test-root');
  if (root) root.remove();
  root = document.createElement('div');
  root.id = 'boutique-test-root';
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/**
 * Simule window.K (posé en prod par komerce-api.js). À appeler dans
 * beforeEach ; fusionne des defaults inertes avec les overrides du test.
 * @param {object} [methods] - méthodes/namespaces à surcharger
 */
function mockWindowK(methods = {}) {
  window.K = {
    request: jest.fn().mockResolvedValue({}),
    isConnected: jest.fn(() => false),
    auth: { getUser: jest.fn(), restore: jest.fn().mockResolvedValue(null) },
    ...methods,
  };
  return window.K;
}

/**
 * Vide la microtask queue (chaînes async apiPost → toast → re-render) et
 * avance les fake timers s'ils sont actifs (setTimeout différés utilisés
 * pour les re-renders, ex. renderFavView() après toggleFav()).
 *
 * @param {number} [n=3] - nombre de ticks microtask à écouler. Le défaut
 *   (3) correspond à la convention convergée indépendamment par
 *   b-wallet.test.js, b-tracking.test.js et b-identity.test.js — suffisant
 *   pour une chaîne apiGet/apiPost → .json() → re-render. Certains flows
 *   plus profonds (ex. verifyCode() de b-identity.js : fetch → res.json()
 *   → branche catch) ont besoin de plus (`flush(8)`).
 */
async function flush(n = 3) {
  for (let i = 0; i < n; i++) await Promise.resolve();
  // jest.getTimerCount() logue un warning ET throw si les fake timers ne
  // sont pas actifs sur ce test — on détecte l'état réel via setTimeout
  // (remplacé par un mock jest quand useFakeTimers() est actif) plutôt que
  // d'appeler getTimerCount() à l'aveugle.
  const fakeTimersActive = typeof jest !== 'undefined'
    && typeof jest.isMockFunction === 'function'
    && jest.isMockFunction(setTimeout);
  if (fakeTimersActive && jest.getTimerCount() > 0) {
    jest.runOnlyPendingTimers();
    for (let i = 0; i < n; i++) await Promise.resolve();
  }
}

/** Réinitialise le stub localStorage posé par tests/unit/setup.js. */
function resetLocalStorage() {
  if (global.localStorage && global.localStorage.clear) global.localStorage.clear();
}

/**
 * Dispatch un submit natif sur un <form>, en contournant la validation
 * HTML5 de jsdom (comme dashboardTestKit.submitForm).
 * @param {HTMLFormElement} form
 */
function submitForm(form) {
  const evt = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(evt);
}

module.exports = {
  resetState,
  resetDom,
  mountFixture,
  mockWindowK,
  flush,
  resetLocalStorage,
  submitForm,
};
