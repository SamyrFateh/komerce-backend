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
 * @brief Ligne preuve sociale dans la modal produit â€” vendus, note, rang.
 *
 * Principe Komerce : aucun chiffre inventÃ©.
 * Chaque Ã©lÃ©ment n'est affichÃ© que si la donnÃ©e backend est prÃ©sente et non nulle :
 *   - product.rank        â†’ "#N Bestseller"  (badge coral)
 *   - product.sold_count  â†’ "N vendus"
 *   - product.rating      â†’ "â˜… N,N Â· N avis"  (+ product.review_count si dispo)
 *
 * Si aucune de ces donnÃ©es n'existe, .k-modal-meta reste vide et
 * disparaÃ®t via CSS (.k-modal-meta:empty { display: none }).
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
import { modalZone } from './b-store.js';           // S5 â€” hook DOM centralisÃ©

'use strict';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _fmtRating(r) {
  // "4.8" â†’ "4,8"  (format FR)
  return Number(r).toFixed(1).replace('.', ',');
}

function _fmtCount(n) {
  // sÃ©parateur milliers FR : 1432 â†’ "1 432"
  return Math.round(n).toLocaleString('fr-FR');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  INJECT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function injectSocialProof() {
  let meta = modalZone('.k-modal-meta');
  if (!meta) return;

  let product = state.modalProduct;
  meta.innerHTML = '';

  if (!product) return;

  // â”€â”€ Rang Bestseller â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (product.rank) {
    let rankEl = document.createElement('span');
    rankEl.className = 'k-modal-meta-rank';
    rankEl.textContent = '#' + product.rank + '\u202fBestseller';
    meta.appendChild(rankEl);
  }

  // â”€â”€ Vendus â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Note + avis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  ENTRY POINT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let _installed = false;

export function setupSocialProof() {
  requestAnimationFrame(injectSocialProof);

  if (!_installed) {
    _installed = true;
    // RÃ©injecter si le produit change sans fermer la modal (navigation nav-btn)
    bus.on('modal:product-changed', injectSocialProof);
  }
}
