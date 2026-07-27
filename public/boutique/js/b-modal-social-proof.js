/**
 * @komerce-arch-lite
 * @role          boutique-b-modal-social-proof
 * @domain        shared-cart-modal
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-modal-social-proof
 * @brief Ligne preuve sociale dans la modal produit — vendus, note, rang.
 *
 * Principe Komerce : aucun chiffre inventé.
 * Chaque élément n'est affiché que si la donnée backend est présente et non nulle :
 *   - product.rank        → "#N Bestseller"  (badge coral)
 *   - product.sold_count  → "N vendus"
 *   - product.rating      → "★ N,N · N avis"  (+ product.review_count si dispo)
 *
 * Si aucune de ces données n'existe, .k-modal-meta reste vide et
 * disparaît via CSS (.k-modal-meta:empty { display: none }).
 *
 * Mobile + desktop : pas de garde isDesktop().
 *
 * Point d'entrée : setupSocialProof().
 * Câblé sur bus.on('modal:product-changed') (pas modal:opened — le social proof
 * doit se rejouer à chaque changement de produit affiché, y compris navigation
 * précédent/suivant sans fermeture de la modal).
 */

import { bus }       from './b-bus.js';
import { state }     from './b-store.js';
import { modalZone } from './b-store.js';           // S5 — hook DOM centralisé

'use strict';

// ── Helpers ───────────────────────────────────────────────────

function _fmtRating(r) {
  // "4.8" → "4,8"  (format FR)
  return Number(r).toFixed(1).replace('.', ',');
}

function _fmtCount(n) {
  // séparateur milliers FR : 1432 → "1 432"
  return Math.round(n).toLocaleString('fr-FR');
}

// ═══════════════════════════════════════════════════════════════
//  INJECT
// ═══════════════════════════════════════════════════════════════

function injectSocialProof() {
  let meta = modalZone('.k-modal-meta');
  if (!meta) return;

  let product = state.modalProduct;
  meta.innerHTML = '';

  if (!product) return;

  // ── Rang Bestseller ───────────────────────────────────────
  if (product.rank) {
    let rankEl = document.createElement('span');
    rankEl.className = 'k-modal-meta-rank';
    rankEl.textContent = '#' + product.rank + '\u202fBestseller';
    meta.appendChild(rankEl);
  }

  // ── Vendus ────────────────────────────────────────────────
  if (product.sold_count && product.sold_count > 0) {
    let soldEl = document.createElement('span');
    soldEl.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
        '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>' +
        '<line x1="3" y1="6" x2="21" y2="6"/>' +
        '<path d="M16 10a4 4 0 0 1-8 0"/>' +
      '</svg>' +
      '\u202f' + _fmtCount(product.sold_count) + ' vendus';
    meta.appendChild(soldEl);
  }

  // ── Note + avis ───────────────────────────────────────────
  if (product.rating && product.rating > 0) {
    let ratingEl = document.createElement('span');
    let reviewPart = product.review_count
      ? '\u00a0\u00b7\u00a0' + _fmtCount(product.review_count) + ' avis'
      : '';
    ratingEl.innerHTML =
      '<span class="k-modal-meta-star" aria-hidden="true">\u2605</span>' +
      '\u202f' + _fmtRating(product.rating) +
      reviewPart;
    ratingEl.setAttribute(
      'aria-label',
      'Note ' + _fmtRating(product.rating) + ' sur 5' +
      (product.review_count ? ', ' + _fmtCount(product.review_count) + ' avis' : '')
    );
    meta.appendChild(ratingEl);
  }
}

// ═══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════

let _installed = false;

export function setupSocialProof() {
  requestAnimationFrame(injectSocialProof);

  if (!_installed) {
    _installed = true;
    // Réinjecter si le produit change sans fermer la modal (navigation nav-btn)
    bus.on('modal:product-changed', injectSocialProof);
  }
}
