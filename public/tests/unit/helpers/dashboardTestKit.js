'use strict';

/**
 * tests/unit/helpers/dashboardTestKit.js
 *
 * Socle de test partagé pour les vues dashboard (admin/js/views/*.js).
 * Codifie les pièges redécouverts à chaque vue (Problems, HubRelais, Sales,
 * Products, Accounting…) :
 *
 *   - Les vues s'attachent à `global.<Nom>` (IIFE), sous 2 formes réelles :
 *       objet { render }          (ex: SalesView, AccountingView)
 *       fonction bare async(root) (ex: SettingsView)
 *     loadView() normalise toujours en { render } pour que les tests
 *     n'aient jamais à distinguer les deux.
 *   - KmcApi / KmcFilters / KpiCard sont des globals posés par des IIFE
 *     (api-client.js, filters-store.js, components/KpiCard.js) — en test on
 *     les remplace entièrement par des mocks (makeKmcApi/makeKmcFilters/
 *     makeKpiCard) plutôt que de charger les vrais fichiers, pour ne pas
 *     dépendre du réseau/DOM réels.
 *   - utils.js (esc/escAttr/fmtDate…) EST chargé réellement par loadView :
 *     ce sont des helpers purs sans effet de bord, et plusieurs vues
 *     (AccountingView notamment) les utilisent bare (`esc(...)`) sans les
 *     importer explicitement.
 *   - jest.resetModules() à chaque loadView() : évite la pollution d'état
 *     entre tests (state module-level des vues comme AccountingView).
 *
 * Convention de chemin : relPath est relatif à tests/unit/ — écrit comme un
 * require() à la main depuis un fichier tests/unit/*.test.js (donc en
 * partant de 2 niveaux, ex: '../../admin/js/views/AccountingView.js'), même
 * si ce helper vit lui-même un niveau plus bas (tests/unit/helpers/).
 */

const path = require('path');

const TESTS_UNIT_DIR = path.resolve(__dirname, '..');
const DEFAULT_BASE_DEPS = ['../../admin/js/utils.js'];

function requireFresh(relPathFromTestsUnit) {
  const abs = path.resolve(TESTS_UNIT_DIR, relPathFromTestsUnit);
  delete require.cache[require.resolve(abs)];
  require(abs);
}

/**
 * Charge une vue fraîche et retourne son objet normalisé { render }.
 * @param {string} relPath - chemin de la vue relatif à tests/unit/
 *   (ex: '../admin/js/views/AccountingView.js')
 * @param {string} globalName - nom sous lequel la vue s'attache à `global`
 *   (ex: 'AccountingView')
 * @param {object} [opts]
 * @param {string[]} [opts.extraDeps] - deps réelles additionnelles à charger
 *   fraîches avant la vue (chemins relatifs à tests/unit/), rarement
 *   nécessaire — KmcApi/KmcFilters/KpiCard sont mockés, pas chargés
 * @param {boolean} [opts.skipBaseDeps] - ne pas charger utils.js (vues qui
 *   n'utilisent pas esc/escAttr)
 */
function loadView(relPath, globalName, opts = {}) {
  jest.resetModules();
  if (!opts.skipBaseDeps) DEFAULT_BASE_DEPS.forEach(requireFresh);
  (opts.extraDeps || []).forEach(requireFresh);
  requireFresh(relPath);

  const View = global[globalName];
  if (!View) {
    throw new Error(
      `loadView: global.${globalName} introuvable après require('${relPath}') — ` +
      `vérifier le nom exact sous lequel la vue s'attache (window.${globalName} = ...)`
    );
  }
  if (typeof View.render === 'function') return View;
  if (typeof View === 'function') return { render: View };
  throw new Error(`loadView: format de vue incompatible pour global.${globalName}`);
}

/**
 * Pose global.KmcApi mocké (remplace api-client.js réel). ApiError est
 * fourni par défaut car plusieurs vues testent la branche 401 dessus.
 * @param {object} [methods] - méthodes KmcApi.xxx à surcharger (jest.fn())
 */
function makeKmcApi(methods = {}) {
  global.KmcApi = {
    ApiError: class ApiError extends Error {
      constructor(msg, status) { super(msg); this.status = status; }
    },
    ...methods,
  };
  return global.KmcApi;
}

/**
 * Pose global.KmcFilters mocké (remplace filters-store.js réel).
 * `_notify(state)` déclenche manuellement les listeners subscribe() dans
 * un test ("KmcFilters.subscribe déclenche loadData").
 * @param {object} [defaults] - valeurs renvoyées par get()
 * @param {object} [methods] - méthodes additionnelles à surcharger
 */
function makeKmcFilters(defaults = {}, methods = {}) {
  const listeners = new Set();
  global.KmcFilters = {
    get: jest.fn(() => ({ from: null, to: null, island: null, ...defaults })),
    subscribe: jest.fn((fn) => { listeners.add(fn); return () => listeners.delete(fn); }),
    _notify: (state) => listeners.forEach((fn) => fn(state)),
    ...methods,
  };
  return global.KmcFilters;
}

/** Pose global.KpiCard mocké (renderBar/render/renderMini en jest.fn()). */
function makeKpiCard(methods = {}) {
  global.KpiCard = {
    render: jest.fn(),
    renderBar: jest.fn(),
    renderMini: jest.fn(),
    ...methods,
  };
  return global.KpiCard;
}

/**
 * Supprime les globals posés par make*() en fin de test — à appeler en
 * afterEach pour éviter toute fuite entre fichiers de test.
 * @param {...string} names - ex: 'KmcApi', 'KmcFilters', 'KpiCard'
 */
function cleanupGlobals(...names) {
  (names.length ? names : ['KmcApi', 'KmcFilters', 'KpiCard']).forEach((n) => { delete global[n]; });
}

/** Vide la microtask queue et avance les fake timers actifs (re-renders différés). */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  const fakeTimersActive = typeof jest !== 'undefined'
    && typeof jest.isMockFunction === 'function'
    && jest.isMockFunction(setTimeout);
  if (fakeTimersActive && jest.getTimerCount() > 0) {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
  }
}

/** Dispatch un submit natif, contourne la validation HTML5 de jsdom. */
function submitForm(form) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/** window.confirm mocké renvoyant `returnValue` (true par défaut). */
function mockConfirm(returnValue = true) {
  window.confirm = jest.fn(() => returnValue);
  return window.confirm;
}

/** window.prompt mocké renvoyant `returnValue`. */
function mockPrompt(returnValue = null) {
  window.prompt = jest.fn(() => returnValue);
  return window.prompt;
}

/** window.alert mocké (silencieux, capturable via expect(...).toHaveBeenCalledWith). */
function mockAlert() {
  window.alert = jest.fn();
  return window.alert;
}

/**
 * Dernier élément correspondant au sélecteur — utile pour repérer l'overlay/
 * modal le plus récent quand plusieurs se sont empilés pendant un test.
 * @param {string} [selector]
 * @returns {Element|null}
 */
function getLatestOverlay(selector = '.modal-overlay, .overlay, [class*="overlay"]') {
  const nodes = document.querySelectorAll(selector);
  return nodes.length ? nodes[nodes.length - 1] : null;
}

/**
 * Monte un container #main minimal dans document.body, comme le fait
 * app.js#invokeView en prod. Retourne le container pour le passer
 * directement à render(container).
 * @param {string} [extraHtml] - contenu additionnel injecté dans #main
 */
function mountContainer(extraHtml = '') {
  document.body.innerHTML = `<div id="main">${extraHtml}</div>`;
  return document.getElementById('main');
}

/**
 * Pose global.esc/escAttr en passthrough simple, pour les tests qui ne
 * veulent pas charger le vrai utils.js mais dont la vue appelle
 * esc(...)/escAttr(...) bare dans son rendu.
 */
function mockEscHelpers() {
  global.esc = (s) => (s == null ? '' : String(s));
  global.escAttr = (s) => (s == null ? '' : String(s));
}

module.exports = {
  loadView,
  makeKmcApi,
  makeKmcFilters,
  makeKpiCard,
  cleanupGlobals,
  flush,
  submitForm,
  mockConfirm,
  mockPrompt,
  mockAlert,
  getLatestOverlay,
  mountContainer,
  mockEscHelpers,
};
