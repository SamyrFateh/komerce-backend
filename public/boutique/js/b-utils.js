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
 * Formate un montant KMF en devise locale.
 * @param {number} kmf       - Montant en KMF
 * @param {string} [currency] - 'KMF' | 'EUR' (défaut = devise détectée)
 * @returns {string} Montant formaté avec symbole
 */
export function fmt(kmf, currency) {
  const c = currency || _currency;
  const rate = _rates[c] || 1;
  const val = Math.round(kmf / rate);
  return val.toLocaleString('fr-FR') + (c === 'EUR' ? ' €' : ' KMF');
}

/**
 * Formate un montant en KMF (toujours, sans conversion).
 * @param {number} kmf - Montant en KMF
 * @returns {string} Ex: "12 500 KMF"
 */
export function fmtPrice(kmf) {
  return new Intl.NumberFormat('fr-FR').format(kmf) + ' KMF';
}

/* ── PRODUIT ─────────────────────────────────────────────── */

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
    return `<img class="k-card-img" src="" alt="${sanitize(p.name || '')}" loading="lazy" decoding="async">`;
  }
  const slides = imgs.map((src, i) =>
    `<div class="k-card-slide"><img class="k-card-slide-img" src="${optimizeImgUrl(src, width)}" alt="${sanitize(p.name || '')} ${i + 1}" loading="lazy" decoding="async"></div>`
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
