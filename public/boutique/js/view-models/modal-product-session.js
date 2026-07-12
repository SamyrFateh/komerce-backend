/**
 * @komerce-arch
 * @role          product-modal-session
 * @domain        catalog
 * @layer         state
 * @criticality   high
 * @inputs        public_product_detail_v1, modal_selection_state
 * @outputs       current_modal_product_detail, current_modal_selection
 * @depends       none
 * @used-by       b-modal-product-detail-mobile.js, b-modal-cart.js, future desktop product detail adapter
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, sku-selection, responsive-product-detail
 * @version       2026-07
 */

'use strict';

/**
 * Instance mutable courante du Product Detail Contract et de son reducer.
 *
 * Le reducer `modal-selection-model.js` reste pur. Ce module possède uniquement
 * la session courante partagée par les compositions mobile et desktop.
 *
 * Elle ne vit pas dans `b-store.js` : ce contexte n'est pas un état global de
 * la Boutique, mais l'instance transactionnelle de la fiche produit ouverte.
 */
export const modalProductSession = {
  detail: null,
  selection: null,
};

export function setModalProductDetail(detail) {
  modalProductSession.detail = detail;
}

export function setModalProductSelection(selection) {
  modalProductSession.selection = selection;
}

export function resetModalProductSession() {
  modalProductSession.detail = null;
  modalProductSession.selection = null;
}
