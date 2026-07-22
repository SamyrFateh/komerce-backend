/**
 * @komerce-arch-lite
 * @role          boutique-b-modal-cart
 * @domain        boutique
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-modal-cart
 * @brief Interactions panier de la fiche produit — extrait de b-modal.js (ARCH-2, PR4).
 *
 * Périmètre (responsabilité « Stepper quantité, bouton ajout panier, sync panier ») :
 *   - _syncModalQtyUI() : synchronise l'affichage du stepper + le libellé du bouton
 *     « Ajouter » avec le contenu réel du panier.
 *   - setupModalCart() : câble le stepper −/+ (ajout/retrait direct) et le bouton
 *     « Ajouter au panier ». Appelé une fois par setupModal().
 *
 * Hors périmètre (restent dans le core avec closeModal) : le bouton « ⚡ Acheter »
 *   (buyNowBtn) et le bouton d'accès panier (modalCartBtn) ferment la modal en direct
 *   — ce sont des actions de fermeture/navigation, pas du stepper/ajout/sync.
 *
 * Découplage : ce module n'appelle ni openModal ni closeModal → il n'importe RIEN de
 *   b-modal.js (aucun cycle, garde-fou check:imports I-2). Corps repris à l'identique.
 *
 * Consommateurs : b-modal.js (openModal appelle _syncModalQtyUI ; setupModal appelle
 *   setupModalCart). Aucun consommateur externe (fonctions internes, non ré-exportées).
 *
 * Dépendances : b-store.js, b-cart.js
 */

import { state, dom }                    from './b-store.js';
import { addToCart, quickAdd, quickRemove } from './b-cart.js';

'use strict';

  /* ── MDP-PROP1 : reset état bouton "Ajouter" à chaque ouverture de produit ──
   * Owner unique de #k-add-cart-btn (avec b-modal-desktop-product.js /
   * b-modal-mobile-product.js en `allow` pour l'état disabled post-fetch).
   * Sans ce reset, un ajout confirmé sur le produit A (classe `confirmed` +
   * onclick custom posés par b-cart.js) fuyait sur l'ouverture du produit B :
   * le clic sur B fermait la modale au lieu d'ajouter B. `_syncModalQtyUI`
   * ne resynchronise que la classe `in-cart` — jamais `confirmed`/`onclick`,
   * d'où cette fonction dédiée, appelée avant elle depuis `openModal`. */
  function resetAddCartButtonState() {
    if (!dom.addCartBtn) return;
    dom.addCartBtn.disabled = false;
    dom.addCartBtn.onclick = null;
    dom.addCartBtn.classList.remove('added', 'in-cart', 'confirmed');
  }

  /* ── FIX: Sync qty stepper display with real cart contents ── */
  function _syncModalQtyUI() {
    if (!state.modalProduct) return;
    const pid = String(state.modalProduct.id);
    const item = state.cart.find(i => String(i.product?.id ?? i.id) === pid);
    state.modalQty = item ? item.qty : 1; /* BUGFIX: défaut 1 (pas 0) — produit pas encore au panier → qty initiale = 1 pour ajouter directement */
    if (dom.modalQtyVal) dom.modalQtyVal.textContent = state.modalQty;
    /* Cycle bouton↔stepper : le conteneur porte is-in-cart quand le produit est
       réellement au panier → CSS affiche le stepper − N + et masque « Ajouter ».
       Retour à 0 (quickRemove) → item disparaît → classe retirée → bouton revient. */
    const _actions = dom.addCartBtn && dom.addCartBtn.closest('.k-modal-actions');
    if (_actions) _actions.classList.toggle('k-modal-actions--filled', !!item);
    // Update "Ajouter" button label
    if (dom.addCartBtn) {
      // FIX: tester item (produit réellement dans le panier), pas modalQty > 0
      // modalQty vaut toujours 1 par défaut même hors panier → bouton montrait
      // "Dans le panier" sur tout produit ouvert même vierge de tout ajout.
      if (item) {
        dom.addCartBtn.classList.add('in-cart');
        dom.addCartBtn.innerHTML = '🧺 Dans le panier (' + state.modalQty + ')';
      } else {
        dom.addCartBtn.classList.remove('in-cart');
        /* FIX Bug 3: utiliser l'image panier_tresse_vert au lieu du SVG générique */
        dom.addCartBtn.innerHTML = '<img src="/images/panier_tresse_vert.png" width="20" height="20" alt="" style="pointer-events:none;flex-shrink:0"> Ajouter';
      }
    }
  }

  /* ── Stepper −/+ + bouton « Ajouter au panier » (câblage) ── */
  function setupModalCart() {
    // FIX: Stepper +/− = ajout/retrait direct du panier (comme cartes suggestions)
    dom.qtyMinus.addEventListener('click', () => {
      if (!state.modalProduct) return;
      const pid = String(state.modalProduct.id);
      quickRemove(pid, dom.qtyMinus);
      _syncModalQtyUI();
    });
    dom.qtyPlus.addEventListener('click', () => {
      if (!state.modalProduct) return;
      const pid = String(state.modalProduct.id);
      quickAdd(pid, dom.qtyPlus);
      _syncModalQtyUI();
    });

    dom.addCartBtn.addEventListener('click', () => {
      if (!state.modalProduct || dom.addCartBtn.disabled || dom.addCartBtn.classList.contains('confirmed')) return;
      // Si pas encore dans le panier, ajouter 1
      addToCart(state.modalProduct, 1, dom.addCartBtn);
      _syncModalQtyUI();
    });
  }


export { _syncModalQtyUI, setupModalCart, resetAddCartButtonState };
