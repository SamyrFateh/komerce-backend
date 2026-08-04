/**
 * @komerce-arch
 * @role          shared-list-checkout-adapter
 * @domain        shared-cart
 * @layer         adapter
 * @criticality   critical
 * @inputs        shared_list_selection
 * @outputs       ephemeral_canonical_cart, checkout_invocation
 * @depends       ../b-store.js, ../b-checkout.js
 * @used-by       group/group-side-cart.js
 * @doctrine      checkout_ne_connait_jamais_la_liste, panier_personnel_source_de_verite
 * @impact-areas  shared-cart, checkout
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-checkout-adapter.js
 * @owner Boutique First — adaptateur entre une sélection de liste et le
 * checkout canonique.
 *
 * Le checkout ne connaît jamais la liste ; la liste ne détourne jamais le
 * panier personnel. Cet adaptateur construit un panier canonique éphémère
 * à partir d'une sélection d'articles de liste, appelle le checkout
 * exactement comme pour un achat personnel, puis restaure le panier
 * personnel dès que le modal de commande se ferme — succès ou annulation,
 * sans distinction : le panier personnel de navigation n'a jamais eu
 * connaissance de la transaction.
 *
 * Zéro modification de b-checkout.js pour l'isolation elle-même : dom
 * (services/b-store.js) est un objet partagé peuplé une fois au boot
 * (initDom()) — dom.orderModal est observable de l'extérieur sans que ce
 * module ait besoin d'un point d'extension dédié. checkoutCart() et
 * closeOrderModal() (b-checkout.js) gèrent tous les chemins de sortie du
 * modal (succès Stripe/cash/wallet, annulation Escape, clic overlay) en
 * retirant la classe 'open' de dom.orderModal — un seul signal à observer.
 *
 * Restauration idempotente et défensive : si aucune sélection valide n'est
 * fournie, aucun appel checkout n'est déclenché et le panier personnel
 * n'est jamais touché.
 */

import { state, dom } from '../b-store.js';
import { checkoutCart } from '../b-checkout.js';

/**
 * Construit un panier canonique éphémère depuis une sélection d'articles
 * de liste partagée, puis déclenche le checkout canonique exactement comme
 * pour un achat personnel. Le panier personnel est sauvegardé avant l'appel
 * et restauré dès la fermeture du modal de commande (tout chemin de sortie).
 *
 * @param {Array<{shared_cart_item_id: string, product: object, quantity: number}>} selectedItems
 * @returns {boolean} true si le checkout a été déclenché, false si la
 *   sélection était vide/invalide (aucun effet de bord dans ce cas).
 */
export function checkoutSharedListSelection(selectedItems) {
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) return false;

  const validItems = selectedItems.filter(it => it && it.product && it.shared_cart_item_id);
  if (!validItems.length) return false;

  const ephemeralCart = validItems.map(it => ({
    product: it.product,
    qty: it.quantity || 1,
    shared_cart_item_id: it.shared_cart_item_id,
  }));

  const personalCart = state.cart;
  state.cart = ephemeralCart;

  let restored = false;
  function restorePersonalCart() {
    if (restored) return;
    restored = true;
    state.cart = personalCart;
    observer.disconnect();
  }

  const observer = new MutationObserver(() => {
    if (dom.orderModal && !dom.orderModal.classList.contains('open')) {
      restorePersonalCart();
    }
  });

  if (dom.orderModal) {
    observer.observe(dom.orderModal, { attributes: true, attributeFilter: ['class'] });
  } else {
    // Garde-fou défensif : si le modal n'est pas encore initialisé (ne
    // devrait jamais arriver après boot normal), on ne laisse jamais le
    // panier personnel remplacé indéfiniment.
    restorePersonalCart();
    return false;
  }

  checkoutCart();
  return true;
}
