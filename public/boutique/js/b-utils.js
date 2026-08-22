/**
 * @komerce-arch
 * @role          boutique-ui-utilities
 * @domain        boutique
 * @layer         util
 * @criticality   high
 * @inputs        raw_values, api_paths, product_media, currency_values
 * @outputs       sanitized_html, formatted_values, optimized_images, api_results
 * @depends       b-store.js, fetch, Intl
 * @used-by       all-boutique-js-modules
 * @doctrine      sanitize_before_render, api_errors_lisibles, prix_lisible
 * @impact-areas  all-boutique, security, catalog, checkout, modal, tracking
 * @version       2026-06
 */
'use strict';

import { dom } from './b-store.js';

/**
 * @module b-utils
 * @brief Helpers purs : image Cloudinary, prix, format, sanitize, carousel.
 *
 * Converti de IIFE → ES module (Phase 1 Option C).
 * Rétro-compatible : expose aussi window.KUtils pour tout code legacy.
 *
 * Usage ES module :
 *   import { fmt, fmtPrice, optimizeImgUrl, sanitize } from './b-utils.js';
 *
 * Usage legacy (window.KUtils) :
 *   const { fmt } = window.KUtils;   ← encore valide pendant la migration
 */
/* global Intl, crypto */

/** Affiche une notification UI temporaire — utilitaire transversal. */
export function showToast(msg, type, duration) {
  type = type || '';
  dom.toast.innerHTML = '<div class="k-toast-simple">' + (msg || '') + '</div>';
  dom.toast.className = 'k-toast show' + (type ? ' ' + type : '');
  clearTimeout(dom.toast._t);
  dom.toast._t = setTimeout(() => dom.toast.classList.remove('show'), duration || 2800);
}

/* ── TAUX DE CHANGE ─────────────────────────────────────── */
export const _rates    = { EUR: 495, KMF: 1 };
export const _currency = detectCurrency();

/* ── CURRENCY BOUNDARY ADAPTER (P2, freeze 22-08-2026) ──────
   b-utils.js devient un ADAPTER de la Currency Boundary — il ne porte
   plus sa propre logique de conversion (l'ancien _rates ci-dessus reste
   exporté pour compat mais n'est plus lu par fmt()/fmtPrice() en interne).
   La source unique reste currency_parities (P1, DB), transmise en entier
   via GET /api/public/config — jamais une copie locale maintenue à la
   main dans ce fichier. */

let _parities = null;          // Map<currency, eur_rate> — snapshot de P1
let _parityFetchStarted = false;

function _kickOffParityFetch() {
  if (_parityFetchStarted) return;
  _parityFetchStarted = true;
  fetch('/api/public/config', { credentials: 'include' })
    .then(res => (res.ok ? res.json() : Promise.reject(new Error('config indisponible'))))
    .then(cfg => {
      const map = new Map();
      for (const p of (cfg.currency_parities || [])) map.set(p.currency, Number(p.eur_rate));
      _parities = map;
    })
    .catch(() => { /* silencieux — le repli KMF de fmt() reste actif tant que ça échoue */ });
}
_kickOffParityFetch(); // démarré au chargement du module, jamais bloquant

function _resolveMarket() {
  const km = typeof window !== 'undefined' ? window.KomerceMarket : null;
  if (!km) return { code: 'KM', currency: 'KMF', minor_unit: 0 };
  const overrideCode = km.getPreviewOverride && km.getPreviewOverride();
  const code = overrideCode || km.DEFAULT || 'KM';
  return (km.getByCode && km.getByCode(code)) || { code: 'KM', currency: 'KMF', minor_unit: 0 };
}

/**
 * Projette un montant KMF (source, economic-engine) vers targetCurrency —
 * TOUJOURS dérivé via EUR (invariant 9), même formule et mêmes lignes DB
 * que utils/currency.js#projectAmount() côté serveur, jamais un axe direct
 * KMF-XAF recalculé ou stocké côté client.
 * @returns {number|null} null si les parités ne sont pas encore chargées —
 *   l'appelant sait alors retomber sur un affichage KMF sûr.
 */
function _projectKmf(amountKmf, targetCurrency) {
  if (targetCurrency === 'KMF') return amountKmf;
  if (!_parities) return null;
  const kmfRate = _parities.get('KMF');
  const targetRate = _parities.get(targetCurrency);
  if (!kmfRate || !targetRate) return null;
  return (amountKmf / kmfRate) * targetRate;
}

/* ── IMAGE CLOUDINARY ───────────────────────────────────── */

/**
 * Optimise une URL Cloudinary avec f_auto/q_auto et largeur optionnelle.
 * @param {string} url - URL image (Cloudinary ou autre)
 * @param {number} [w]  - Largeur cible en pixels
 * @returns {string} URL optimisée
 */
export function optimizeImgUrl(url, w) {
  if (!url || url.indexOf('res.cloudinary.com') === -1) return url;
  if (url.indexOf('f_auto') !== -1) return url;
  return url.replace('/upload/', '/upload/f_auto,q_auto' + (w ? ',w_' + w : '') + '/');
}

/**
 * Alias optimizeImgUrl pour les images promos.
 * @param {string} url - URL image
 * @param {number} [w]  - Largeur cible
 * @returns {string} URL optimisée
 */
export function promoImgUrl(url, w) {
  return optimizeImgUrl(url, w);
}

/* ── SÉCURITÉ ────────────────────────────────────────────── */

/**
 * Échappe du HTML pour éviter les injections XSS.
 * @param {string} s - Chaîne à sécuriser
 * @returns {string} HTML échappé
 */
export function sanitize(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/* ── PRIX & FORMAT ───────────────────────────────────────── */

/**
 * Détecte la devise locale via le fuseau horaire.
 * @returns {'KMF'|'EUR'}
 */
export function detectCurrency() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/Comoro|Mayotte/i.test(tz)) return 'KMF';
  } catch(e) {}
  return 'EUR';
}

/**
 * Formate un montant EXPRIMÉ EN KMF (economic-engine base currency, jamais
 * touchée par ce chantier) pour affichage.
 *
 * SÉMANTIQUE DU 2e ARGUMENT — a changé le 22 août 2026 (P2, Currency
 * Boundary) :
 *
 *   fmt(amount, 'KMF')  'KMF' n'est plus un ordre "force KMF littéral" — il
 *                        devient l'alias "projette vers la devise du MARCHÉ
 *                        COURANT" (résolu via market-context.js, override
 *                        ?market= inclus). Avant l'ouverture de Mayotte/
 *                        Cameroun/Congo, KM était le seul marché existant :
 *                        'KMF' et "marché courant" désignaient la même
 *                        chose par coïncidence, pas par contrat. Les 33
 *                        appels existants de fmt(x, 'KMF') dans ce dépôt
 *                        n'ont PAS été modifiés : ils héritent de ce nouveau
 *                        comportement automatiquement.
 *
 *   fmt(amount, 'EUR')  comportement INCHANGÉ : force EUR, ignore le
 *                        marché — reste un ordre littéral, comme avant.
 *                        Toute devise explicite AUTRE que 'KMF' garde ce
 *                        comportement (ex. b-cart.js, la ligne
 *                        "≈ " + fmt(total, 'EUR') de conversion diaspora,
 *                        continue de fonctionner à l'identique).
 *
 *   fmt(amount)          plus de détection par fuseau horaire — résout le
 *                        marché courant, comme fmt(amount, 'KMF').
 *
 * Repli de sécurité : si les parités (P1) n'ont pas encore fini de charger
 * (fenêtre courte au premier chargement de page), affiche le montant KMF
 * brut plutôt qu'un montant projeté potentiellement faux. Le prochain appel
 * (rendu suivant, navigation) utilisera la valeur correcte.
 *
 * @param {number} kmf - Montant en KMF
 * @param {string} [currency] - voir sémantique ci-dessus
 * @returns {string}
 */
export function fmt(kmf, currency) {
  const n = Number(kmf) || 0;

  // Devise explicite ≠ 'KMF' : comportement historique inchangé, jamais de
  // projection marché — un ordre littéral (ex. la ligne "≈ EUR" diaspora).
  if (currency && currency !== 'KMF') {
    const rate = _rates[currency] || 1;
    const val = Math.round(n / rate);
    return val.toLocaleString('fr-FR') + (currency === 'EUR' ? ' €' : ' ' + currency);
  }

  // 'KMF' explicite ou absent : résout le marché courant, projette.
  const market = _resolveMarket();
  const projected = _projectKmf(n, market.currency);

  if (projected === null) {
    return Math.round(n).toLocaleString('fr-FR') + ' KMF';
  }

  const minorUnit = market.minor_unit || 0;
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: minorUnit,
    maximumFractionDigits: minorUnit,
  }).format(projected);
  return formatted + ' ' + (market.currency === 'EUR' ? '€' : market.currency);
}

/**
 * Formate un montant EN KMF (source) projeté vers la devise du marché
 * courant — alias de fmt(kmf, 'KMF'). Jusqu'au 22 août 2026, affichait
 * TOUJOURS littéralement 'KMF' sans aucune conversion.
 * @param {number} kmf
 * @returns {string}
 */
export function fmtPrice(kmf) {
  return fmt(kmf, 'KMF');
}

/* ── PRODUIT ─────────────────────────────────────────────── */

/**
 * Fallback image universel — data URI inline, ne dépend d'aucun fichier serveur.
 * Affiche un carré sable neutre avec une icône 📦 centrée.
 *
 * Pourquoi data URI plutôt que /images/placeholder-product.svg :
 *   · Cloudinary peut renvoyer HTTP 200 avec sa propre image d'erreur
 *     (une petite icône cassée) → onerror ne se déclenche jamais, la vraie
 *     URL du serveur n'est jamais atteinte.
 *   · Un data URI est chargé immédiatement depuis la mémoire, sans requête
 *     réseau, sans possibilité d'échec.
 */
export const PRODUCT_IMAGE_FALLBACK_URL = (() => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<rect width="64" height="64" rx="10" fill="#f5f0e8"/>',
    '<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"',
    ' font-size="26" font-family="system-ui,sans-serif">📦</text>',
    '</svg>',
  ].join('');
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
})();

/**
 * Applique le fallback sur une instance IMG existante.
 * Garde le marqueur kFallbackApplied pour éviter toute boucle.
 */
export function applyProductImageFallback(image) {
  if (!image || image.dataset?.kFallbackApplied === '1') return false;
  image.dataset.kFallbackApplied = '1';
  image.removeAttribute('srcset');
  image.alt = '';
  image.classList.add('is-image-fallback');
  image.src = PRODUCT_IMAGE_FALLBACK_URL;
  return true;
}

/**
 * Attribut HTML pour les renderers de chaînes.
 *
 * onload : vérifie les dimensions après chargement.
 *   · Une vraie image produit mesure au minimum MIN_DIM px dans sa plus
 *     petite dimension. L'image d'erreur Cloudinary et les fichiers corrompus
 *     sont typiquement ≤ 8 px.
 *   · Si les dimensions sont insuffisantes → même traitement qu'un 404.
 *
 * onerror : déclenché sur 404 / erreur réseau / image invalide.
 */
const MIN_DIM = 16; // px — seuil de détection d'image d'erreur
export function productImageFallbackAttr() {
  const fb = PRODUCT_IMAGE_FALLBACK_URL;
  const apply = `this.dataset.kFallbackApplied='1';this.removeAttribute('srcset');this.alt='';this.classList.add('is-image-fallback');this.src='${fb}'`;
  const onload  = `if(this.dataset.kFallbackApplied!=='1'&&(this.naturalWidth<${MIN_DIM}||this.naturalHeight<${MIN_DIM})){${apply}}`;
  const onerror = `if(this.dataset.kFallbackApplied!=='1'){${apply}}`;
  return `onload="${onload}" onerror="${onerror}"`;
}

/**
 * Retourne l'emoji associé à un produit.
 * @param {Object} p - Objet produit
 * @returns {string} Emoji ou '📦'
 */
export function productEmoji(p) {
  return p.emoji || '📦';
}

/**
 * Génère une clé d'idempotence UUID v4.
 * @returns {string} UUID
 */
export function genIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/* ── CAROUSEL PRODUIT ────────────────────────────────────── */

/**
 * Génère le HTML du carousel d'images d'un produit.
 * @param {Object} p      - Objet produit (images, image_url, name)
 * @param {number} [width=400] - Largeur cible Cloudinary
 * @returns {string} HTML du carousel avec dots
 */
export function renderProductCarousel(p, width) {
  width = width || 400;
  let imgs = [];
  if (p.images) {
    try { imgs = typeof p.images === 'string' ? JSON.parse(p.images) : p.images; }
    catch(_) { imgs = []; }
  }
  if (Array.isArray(imgs)) {
    const seen = new Set();
    imgs = imgs.filter((src) => {
      const key = String(src || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (!Array.isArray(imgs) || imgs.length === 0) {
    imgs = p.image_url ? [p.image_url] : [];
  }
  if (!imgs.length) {
    return `<img class="k-card-img is-image-fallback" src="${PRODUCT_IMAGE_FALLBACK_URL}" alt="" loading="lazy" decoding="async">`;
  }
  const slides = imgs.map((src, i) =>
    `<div class="k-card-slide"><img class="k-card-slide-img" src="${optimizeImgUrl(src, width)}" alt="" loading="lazy" decoding="async" ${productImageFallbackAttr()}></div>`
  ).join('');
  const dots = imgs.length > 1
    ? `<div class="k-card-dots">${imgs.map((_, i) => `<span class="k-card-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
    : '';
  return `<div class="k-card-carousel">${slides}</div>${dots}`;
}

/**
 * Bind les dots de navigation sur un carousel de carte produit.
 * Gère scroll, touch et mouse pour sync dots + flag justSwiped.
 * @param {Element} card - Élément .k-card contenant le carousel
 */
export function bindCarouselDots(card) {
  const carousel = card.querySelector('.k-card-carousel');
  const dots      = card.querySelectorAll('.k-card-dot');
  if (!carousel || carousel.dataset.bound) return;
  carousel.dataset.bound = '1';
  if (dots.length > 1) {
    let raf = null;
    carousel.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const idx = Math.round(carousel.scrollLeft / carousel.clientWidth);
        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
      });
    }, { passive: true });
  }
  let sx = 0, sy = 0, moved = false;
  const onStart = (e) => { const t = e.touches ? e.touches[0] : e; sx = t.clientX; sy = t.clientY; moved = false; };
  const onMove  = (e) => { const t = e.touches ? e.touches[0] : e; if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) moved = true; };
  const onEnd   = ()  => { if (moved) { card.dataset.justSwiped = '1'; setTimeout(() => delete card.dataset.justSwiped, 250); } };
  carousel.addEventListener('touchstart', onStart, { passive: true });
  carousel.addEventListener('touchmove',  onMove,  { passive: true });
  carousel.addEventListener('touchend',   onEnd,   { passive: true });
  carousel.addEventListener('mousedown',  onStart);
  carousel.addEventListener('mousemove',  (e) => { if (e.buttons) onMove(e); });
  carousel.addEventListener('mouseup',    onEnd);
}

// ── API helpers (wrappers around window.K.request) ──
function _assertApi() {
  if (!window.K?.request) throw new Error('[Komerce] komerce-api.js manquant ou en erreur');
}

/**
 * ARCH-4 : accès centralisé et guardé à l'API globale K.
 * Tous les modules qui ont besoin de K doivent passer par getAPI()
 * plutôt que d'accéder directement à window.K — permet de détecter
 * les usages avant que komerce-api.js soit chargé.
 * @returns {typeof K} L'instance K
 * @throws {Error} Si K n'est pas encore disponible
 */
export function getAPI() {
  if (typeof K === 'undefined' || !K) {
    throw new Error('[Komerce] komerce-api.js non chargé — getAPI() appelé trop tôt');
  }
  return K;
}

/**
 * GET via la couche centrale K.request.
 * @param {string} path
 * @param {{signal?: AbortSignal, timeoutMs?: number, retries?: number}} [options]
 *   FIX 2026-07-10 : les options (signal, timeoutMs) sont désormais TRANSMISES
 *   à K.request — avant, apiGet(path) les ignorait silencieusement et les
 *   AbortController posés côté checkout n'avaient aucun effet.
 */
export function apiGet(path, options) {
  _assertApi();
  const opts = options || {};
  const retries = Number.isFinite(opts.retries) ? opts.retries : 2;
  return window.K.request(path, 'GET', null, retries, opts);
}

/** Télécharge un fichier privé via la session httpOnly courante. */
export function apiDownload(path, options) {
  _assertApi();
  return window.K.download(path, options || {});
}
export function apiPost(path, body, options) {
  _assertApi();
  const opts = options || {};
  const retries = Number.isFinite(opts.retries) ? opts.retries : 2;
  return window.K.request(path, 'POST', body || null, retries, opts);
}
/**
 * PUT via la couche centrale K.request.
 * Lot 4 (Mon Komerce) : nécessaire pour PUT /api/auth/me (Mes informations,
 * Mes préférences). Par défaut retries: 0 — une requête PUT mute un état
 * serveur, on ne la rejoue pas silencieusement comme un GET.
 */
export function apiPut(path, body, options) {
  _assertApi();
  const opts = options || {};
  const retries = Number.isFinite(opts.retries) ? opts.retries : 0;
  return window.K.request(path, 'PUT', body || null, retries, opts);
}
/**
 * DELETE via la couche centrale K.request.
 * Lot 5 (retrait exceptionnel) : nécessaire pour
 * DELETE /api/auth/me/pickup-authorization. Retries: 0 par défaut, même
 * doctrine que apiPut — une DELETE mute un état serveur.
 */
export function apiDelete(path, options) {
  _assertApi();
  const opts = options || {};
  const retries = Number.isFinite(opts.retries) ? opts.retries : 0;
  return window.K.request(path, 'DELETE', null, retries, opts);
}
/**
 * PATCH via la couche centrale K.request.
 * Amendement V2 §B (PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_
 * CART_V2) : nécessaire pour PATCH /api/shared-carts/:id/items/:itemId
 * (modification unitaire de quantité). Retries: 0 par défaut, même
 * doctrine que apiPut/apiDelete — un PATCH mute un état serveur.
 */
export function apiPatch(path, body, options) {
  _assertApi();
  const opts = options || {};
  const retries = Number.isFinite(opts.retries) ? opts.retries : 0;
  return window.K.request(path, 'PATCH', body || null, retries, opts);
}

/* ── COMPAT LEGACY window.KUtils ─────────────────────────── */
// Conservé pendant la migration pour tout code qui consomme window.KUtils
// À supprimer quand boutique.js sera entièrement migré en ES module (Phase 7)
if (typeof window !== 'undefined') {
  window.KUtils = {
    optimizeImgUrl,
    sanitize,
    promoImgUrl,
    renderProductCarousel,
    bindCarouselDots,
    detectCurrency,
    fmt,
    fmtPrice,
    productEmoji,
    genIdempotencyKey,
    _currency,
    _rates,
  };
}

// ── Utilitaire XSS — FRESH-061 ───────────────────────────────────────────────
// Échapper les données utilisateur avant injection dans innerHTML.
// Usage : el.innerHTML = `<p>${escHtml(userInput)}</p>`;
// Préférer textContent pour les nœuds texte simples.
if (typeof window !== 'undefined' && !window.escHtml) {
  window.escHtml = function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
}
