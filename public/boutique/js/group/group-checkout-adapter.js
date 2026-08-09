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
 * @doctrine      checkout_logic_agnostic_of_shared_list, panier_personnel_source_de_verite
 * @impact-areas  shared-cart, checkout
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-checkout-adapter.js
 * @owner Boutique First — adaptateur entre une sélection de liste et le
 * checkout canonique.
 *
 * Doctrine (mise à jour, LOT 13 §F) — checkout_logic_agnostic_of_shared_list :
 * le checkout n'a besoin d'AUCUNE logique métier de la liste (prix, lignes,
 * paiement, livraison, OTP, lifecycle du modal restent strictement ceux du
 * panier personnel) ; le seul lien métier réel est celui déjà nécessaire au
 * claim atomique côté serveur (`shared_cart_item_id`, propagé par ligne
 * ci-dessous, inchangé). Ce module peut en revanche transmettre un contexte
 * structuré minimal — origine, identifiant de liste, relation créateur et
 * libellé — consommé par b-checkout.js. Les prix et lignes restent ceux du
 * panier éphémère ; la relation sert uniquement au libellé et au choix sûr
 * buyer|organizer du destinataire du code secret.
 *
 * La liste ne détourne jamais le panier personnel. Cet adaptateur construit
 * un panier canonique éphémère à partir d'une sélection d'articles de liste,
 * appelle le checkout exactement comme pour un achat personnel, puis
 * restaure le panier personnel ET efface le contexte d'affichage dès que le
 * modal de commande se ferme — succès ou annulation, sans distinction : le
 * panier personnel de navigation n'a jamais eu connaissance de la
 * transaction, et le prochain checkout personnel ne voit jamais ce bandeau.
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
 *
 * Correctif P0 ownership (mandat §9, audit archéologie) — le panier
 * personnel réel n'est plus JAMAIS exposé à une écriture localStorage
 * pendant qu'il est temporairement remplacé par le panier éphémère :
 * state.cartIsEphemeral (b-store.js) est levé avant le swap et consulté
 * par b-cart-core.js::saveCart(), qui n'écrit alors plus dans
 * localStorage. Le checkout canonique appelle toujours clearCart() après
 * succès (b-checkout.js, inchangé) : cet appel opère bien sur le panier
 * éphémère (`state.cart = []`), mais ce `[]` n'est plus jamais persisté —
 * seul le panier personnel réel, jamais retouché sur disque pendant tout
 * ce temps, reste dans localStorage. `state.cart` est restauré en mémoire
 * ET resynchronisé sur disque (`saveCart()`) dès la fermeture du modal de
 * commande. Avant ce correctif, seule la mémoire était restaurée — un
 * reload pendant l'écran de succès (avant fermeture manuelle du modal)
 * perdait le panier personnel pour de bon.
 */

import { state, dom } from '../b-store.js';
import { checkoutCart } from '../b-checkout.js';
import { saveCart } from '../b-cart-core.js';

/**
 * Construit un panier canonique éphémère depuis une sélection d'articles
 * de liste partagée, puis déclenche le checkout canonique exactement comme
 * pour un achat personnel. Le panier personnel est sauvegardé avant l'appel
 * et restauré dès la fermeture du modal de commande (tout chemin de sortie).
 *
 * @param {Array<{shared_cart_item_id: string, product: object, quantity: number, variant_combo?: object|null}>} selectedItems
 * @param {{origin?: 'SHARED_LIST', sharedCartId?: string|null,
 *   isCreator?: boolean, creatorFirstName?: string|null, title?: string}} [checkoutContext]
 *   Contexte relationnel minimal. Aucun téléphone ou destinataire libre ne
 *   transite ici.
 * @returns {boolean} true si le checkout a été déclenché, false si la
 *   sélection était vide/invalide (aucun effet de bord dans ce cas).
 */
export function checkoutSharedListSelection(selectedItems, checkoutContext) {
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) return false;

  const validItems = selectedItems.filter(it => it && it.product && it.shared_cart_item_id);
  if (!validItems.length) return false;

  const ephemeralCart = validItems.map(it => {
    const line = {
      product: it.product,
      qty: it.quantity || 1,
      shared_cart_item_id: it.shared_cart_item_id,
      // GAP-07 §12 — propagé tel quel jusqu'à b-checkout.js (qui lit
      // line.variant_combo directement, jamais line.product.variant_combo)
      // puis jusqu'à POST /api/orders → resolveActiveSku côté serveur.
      // null pour un produit non-SKU ou une ligne sans combinaison —
      // jamais un objet vide fabriqué ici.
      variant_combo: it.variant_combo || null,
    };
    // Correctif V2-E §2 — propager le contexte snapshot (prix/nom/image au
    // moment du partage) uniquement quand fourni par l'appelant, pour le
    // rendu de variation de prix côté checkout (group-price-variation.js).
    // Jamais consommé par b-checkout.js pour le calcul du total ou le
    // payload de commande — lecture exclusive de it.product.
    if (it.shared_list_context) {
      line.shared_list_context = it.shared_list_context;
    }
    return line;
  });

  const personalCart = state.cart;
  // Le verrou de persistance est posé AVANT le swap : aucune observation
  // synchrone ne peut voir le panier éphémère comme panier personnel.
  state.cartIsEphemeral = true;
  state.cart = ephemeralCart;

  state.checkoutDisplayContext = checkoutContext?.origin === 'SHARED_LIST'
    ? {
        origin: 'SHARED_LIST',
        sharedCartId: checkoutContext.sharedCartId || null,
        isCreator: !!checkoutContext.isCreator,
        creatorFirstName: checkoutContext.creatorFirstName || null,
        title: checkoutContext.title || null,
      }
    : null;

  let restored = false;
  function restorePersonalCart() {
    if (restored) return;
    restored = true;
    state.cart = personalCart;
    // Ordre important : lever le flag AVANT saveCart(), sinon saveCart()
    // continuerait de considérer state.cart comme éphémère et sauterait
    // l'écriture — ce qui laisserait localStorage sur le dernier état
    // connu avant checkout au lieu du panier personnel actuel restauré.
    state.cartIsEphemeral = false;
    // Resynchronise explicitement le disque avec le panier personnel
    // restauré (défensif : localStorage n'a normalement pas bougé pendant
    // l'éphémère, mais on ne laisse jamais dépendre la cohérence disque
    // d'une simple absence d'écriture — un appel explicite le garantit).
    saveCart();
    // Efface le bandeau avec le checkout — ne doit jamais survivre pour
    // contaminer le prochain checkout personnel (§F, mandat explicite).
    state.checkoutDisplayContext = null;
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

  try {
    checkoutCart();
    return true;
  } catch (err) {
    restorePersonalCart();
    throw err;
  }
}
