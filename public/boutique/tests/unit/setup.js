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

/* ── Réduction du bruit console en tests ─────────────────────────
   Les warnings connus (shop-schema fallback, checkout relais, etc.)
   polluent la sortie et noient les vrais FAIL.
   On les filtre ICI (pas dans chaque test) pour que la sortie Jest
   soit lisible d'un coup d'œil.
   Ajouter un pattern ici si un nouveau warning récurrent apparaît.
   ──────────────────────────────────────────────────────────────── */
const KNOWN_NOISE = [
  /\[shop-schema\] API indisponible/,
  /\[checkout\] relais:/,
  /\[PAYPAL\] (?:createOrder|onApprove|erreur SDK|paiement annulé)/,
  /submitOrder:/,
  /Not implemented: navigation/,
];

function isMuted(args) {
  const msg = Array.prototype.slice.call(args).map(String).join(' ');
  return KNOWN_NOISE.some(function(re) { return re.test(msg); });
}

const _origWarn = console.warn;
const _origError = console.error;
const _origInfo = console.info;

console.warn  = function() { if (!isMuted(arguments)) _origWarn.apply(console, arguments); };
console.error = function() { if (!isMuted(arguments)) _origError.apply(console, arguments); };
console.info  = function() { if (!isMuted(arguments)) _origInfo.apply(console, arguments); };
