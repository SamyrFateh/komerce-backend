/**
 * @komerce-arch-lite
 * @role          boutique-b-modal-cart
 * @domain        boutique
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  boutique
 * @version       2026-07
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

import { state, dom } from './b-store.js';
import { addToCart, quickAdd, quickRemove } from './b-cart.js';

'use strict';

function resetAddCartButtonState() {
  if (!dom.addCartBtn) return;
  dom.addCartBtn.disabled = false;
  dom.addCartBtn.onclick = null;
  dom.addCartBtn.classList.remove('added', 'in-cart', 'confirmed');
}

function _syncModalQtyUI() {
  if (!state.modalProduct) return;

  const pid = String(state.modalProduct.id);
  const isSku = state.modalProductDetail?.inventory_model === 'SKU';

  // Une ligne SKU est identifiée par sa sélection, pas uniquement par product.id.
  // Tant que les steppers legacy mutent par product.id, ils ne doivent ni agréger
  // une autre variante ni masquer le bouton permettant d'ajouter la sélection courante.
  const item = isSku
    ? null
    : state.cart.find(i => String(i.product?.id ?? i.id) === pid);

  state.modalQty = item ? item.qty : 1;
  if (dom.modalQtyVal) dom.modalQtyVal.textContent = state.modalQty;

  const actions = dom.addCartBtn && dom.addCartBtn.closest('.k-modal-actions');
  if (actions) actions.classList.toggle('k-modal-actions--filled', Boolean(item));

  if (dom.addCartBtn) {
    if (item) {
      dom.addCartBtn.classList.add('in-cart');
      dom.addCartBtn.innerHTML = '🧺 Dans le panier (' + state.modalQty + ')';
    } else {
      dom.addCartBtn.classList.remove('in-cart');
      dom.addCartBtn.innerHTML = '<img src="/images/panier_tresse_vert.png" width="20" height="20" alt="" style="pointer-events:none;flex-shrink:0"> Ajouter';
    }
  }
}

function setupModalCart() {
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
    addToCart(state.modalProduct, 1, dom.addCartBtn);
    _syncModalQtyUI();
  });
}

export { _syncModalQtyUI, setupModalCart, resetAddCartButtonState };
