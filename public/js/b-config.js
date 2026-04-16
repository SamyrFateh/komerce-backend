/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-config.js
   Constants, API helpers, utility functions
   Depends on: nothing — must load FIRST
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  // ── CONSTANTS ────────────────────────────────────────────
  K.KOMERCE_WA     = '269321XXXXX'; // ← Remplacer par le vrai numéro
  K.KOMERCE_WA_URL = 'https://wa.me/' + K.KOMERCE_WA;
  K.EUR_RATE       = 495;
  K.PAGE_SIZE      = 16;

  // ── DOM SHORTCUTS ────────────────────────────────────────
  K.$  = (s, ctx) => (ctx || document).querySelector(s);
  K.$$ = (s, ctx) => (ctx || document).querySelectorAll(s);

  // ── IMAGE HELPERS ────────────────────────────────────────
  K.optimizeImgUrl = function (url, w) {
    if (!url || url.indexOf('res.cloudinary.com') === -1) return url;
    if (url.indexOf('f_auto') !== -1) return url;
    return url.replace('/upload/', '/upload/f_auto,q_auto' + (w ? ',w_' + w : '') + '/');
  };

  K.promoImgUrl = function (url, w) {
    return K.optimizeImgUrl(url, w);
  };

  // ── CURRENCY ─────────────────────────────────────────────
  K.detectCurrency = function () {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (/Comoro|Mayotte/i.test(tz)) return 'KMF';
    } catch (e) {}
    return 'EUR';
  };

  K._currency = K.detectCurrency();
  K._rates    = { EUR: K.EUR_RATE, KMF: 1 };

  K.fmt = function (kmf, currency) {
    const c    = currency || K._currency;
    const rate = K._rates[c] || 1;
    const val  = Math.round(kmf / rate);
    return val.toLocaleString('fr-FR') + (c === 'EUR' ? ' €' : ' KMF');
  };

  K.fmtPrice = function (kmf) {
    return new Intl.NumberFormat('fr-FR').format(kmf) + ' KMF';
  };

  K.fmtEur = function (kmf) {
    return '≈ ' + Math.round(kmf / K.EUR_RATE).toLocaleString('fr-FR') + ' €';
  };

  K.sanitize = function (s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  };

  K.productEmoji = function (p) { return p.emoji || '📦'; };

  // ── API ──────────────────────────────────────────────────
  K.apiGet = async function (path) {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(path, { credentials: 'include', signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    } finally { clearTimeout(t); }
  };

  K.apiPost = async function (path, body) {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: ctrl.signal,
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.message || data.error || 'Erreur serveur');
        err.data = data;
        throw err;
      }
      return data;
    } finally { clearTimeout(t); }
  };

  // ── STRIPE (optional) ────────────────────────────────────
  K._stripe = null;
  K._stripeElements = null;
  K._stripeCard = null;
  try {
    K._stripe = typeof Stripe !== 'undefined'
      ? Stripe('pk_test_51TKKX3Enc3Ce0auC9CJERH5p4xism4E0MsJzAFFJbacrZ7m3ttvIRY8Uq7A1kHLLxoTWzofgzJNX9AWPlbNOBX5s00nAUjKiyQ')
      : null;
  } catch (e) { console.warn('Stripe not loaded:', e); }

})(window.K = window.K || {});
