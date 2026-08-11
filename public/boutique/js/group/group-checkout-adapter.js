/**
 * @komerce-arch
 * @role          shared-list-checkout-adapter
 * @domain        shared-cart
 * @layer         adapter
 * @criticality   critical
 * @inputs        shared_list_selection
 * @outputs       checkout_selection, checkout_invocation
 * @depends       ../b-store.js, ../b-checkout.js
 * @used-by       group/group-side-cart.js
 * @doctrine      checkout_logic_agnostic_of_shared_list, checkout_selection_source_de_verite, panier_personnel_intact
 * @impact-areas  shared-cart, checkout
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-checkout-adapter.js
 * @owner Boutique First — adaptateur liste partagée vers checkout canonique.
 *
 * Une sélection de liste est convertie en lignes transactionnelles puis en
 * CheckoutSelection. Le panier personnel state.cart n'est jamais remplacé,
 * vidé, sauvegardé ou restauré par cet adaptateur.
 *
 * Le seul état transversal temporaire conservé est checkoutDisplayContext :
 * il porte le libellé et la relation avec l'organisateur pendant l'affichage
 * du checkout. Il est effacé à la fermeture du modal.
 */

import { state, dom } from '../b-store.js';
import {
  buildCheckoutSelection,
  checkoutCart,
} from '../b-checkout.js';
import {
  computePriceVariations,
  buildPriceVariationSummary,
} from './group-price-variation.js';

function buildSharedCheckoutContext(checkoutContext = {}) {
  return {
    origin: 'SHARED_LIST',
    sharedCartId: checkoutContext.sharedCartId || null,
    isCreator: !!checkoutContext.isCreator,
    creatorFirstName: checkoutContext.creatorFirstName || null,
    title: checkoutContext.title || null,
  };
}

function buildSharedCheckoutLine(item) {
  const line = {
    product: item.product,
    qty: item.quantity || 1,
    shared_cart_item_id: item.shared_cart_item_id,
    variant_combo: item.variant_combo || null,
  };

  if (item.shared_list_context) {
    line.shared_list_context = item.shared_list_context;
  }

  if (item.requested_transport_rail !== undefined) {
    line.requested_transport_rail = item.requested_transport_rail;
  }

  return line;
}

/**
 * Déclenche le checkout d'une sélection de liste partagée.
 *
 * @returns {boolean} false si la sélection n'est pas exploitable.
 */
export function checkoutSharedListSelection(selectedItems, checkoutContext) {
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
    return false;
  }

  const validItems = selectedItems.filter(
    item => item && item.product && item.shared_cart_item_id
  );

  if (!validItems.length) return false;

  /*
   * Aucun état global n'est modifié si le shell checkout n'est pas prêt.
   */
  if (!dom.orderModal) return false;

  const context = buildSharedCheckoutContext(checkoutContext);
  const lines = validItems.map(buildSharedCheckoutLine);
  const selection = buildCheckoutSelection(lines, context);

  if (!selection.items.length) return false;

  /*
   * La variation de prix appartient à shared-cart :
   * comparaison snapshot de publication / prix catalogue courant.
   * Le checkout reçoit uniquement le résultat déjà interprété.
   */
  const priceVariations = computePriceVariations(selection.items);

  selection.priceVariations = priceVariations;
  selection.priceVariationSummary =
    buildPriceVariationSummary(priceVariations);

  state.checkoutDisplayContext = context;

  let cleaned = false;

  function clearCheckoutContext() {
    if (cleaned) return;
    cleaned = true;
    state.checkoutDisplayContext = null;
    observer.disconnect();
  }

  /*
   * L'observer ne restaure plus aucun panier.
   * Il ne fait que borner la durée de vie du contexte décoratif/relationnel.
   */
  const observer = new MutationObserver(() => {
    if (dom.orderModal && !dom.orderModal.classList.contains('open')) {
      clearCheckoutContext();
    }
  });

  observer.observe(dom.orderModal, {
    attributes: true,
    attributeFilter: ['class'],
  });

  try {
    checkoutCart(selection);
    return true;
  } catch (err) {
    clearCheckoutContext();
    throw err;
  }
}
