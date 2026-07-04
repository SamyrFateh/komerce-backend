// tests/unit/setup.js — mocks globaux pour l'environnement jsdom
global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
// jsdom n'implémente pas scrollIntoView — plusieurs modules (b-checkout.js
// notamment) l'appellent dans des setTimeout qui peuvent se déclencher
// pendant un test suivant si non pollyfillé, faisant planter des tests
// sans lien avec le scroll.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
global.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};
