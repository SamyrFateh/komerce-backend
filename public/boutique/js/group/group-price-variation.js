/**
 * @komerce-arch
 * @role          shared-list-price-variation
 * @domain        shared-cart
 * @layer         domain-logic
 * @criticality   medium
 * @inputs        cart_line_items
 * @outputs       price_variation_lines, summary_message
 * @depends       none
 * @used-by       ../b-checkout.js
 * @doctrine      prix_snapshot_liste_prix_actuel_checkout
 * @impact-areas  shared-cart, checkout
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-price-variation.js
 * @owner Boutique First — logique pure de comparaison prix snapshot (liste
 * partagée) / prix catalogue actuel (checkout). Module sans DOM, testable
 * isolément ; b-checkout.js ne fait que peindre ce que ce module calcule.
 *
 * Doctrine V2-E §2/§3 : la liste affiche le prix figé au partage, le
 * checkout affiche et facture toujours le prix catalogue courant. Ce
 * module ne fait que signaler l'écart — il ne décide jamais du montant
 * facturé (le backend recalcule indépendamment depuis `products`).
 */

/**
 * Calcule, pour une ligne de panier éphémère issue d'une liste partagée,
 * la variation entre le prix snapshot (figé au partage) et le prix
 * catalogue courant.
 *
 * @param {object} item - Ligne de state.cart (product, shared_list_context)
 * @returns {{snapshotPrice: number, currentPrice: number, changed: boolean}|null}
 *   null si l'item n'est pas issu d'une liste partagée, si le snapshot est
 *   absent/nul, ou si le prix actuel est absent — dans tous ces cas aucun
 *   message ne doit être affiché (doctrine §3).
 */
function computeLineVariation(item) {
  if (!item || !item.shared_list_context) return null;

  const snapshotPrice = Number(item.shared_list_context.snapshot_unit_price_kmf) || 0;
  const currentPrice = Number(item.product?.price_kmf) || 0;

  if (!snapshotPrice || !currentPrice) return null;
  if (snapshotPrice === currentPrice) return null;

  return { snapshotPrice, currentPrice, changed: true };
}

/**
 * Calcule les variations de prix pour l'ensemble d'un panier de checkout
 * (personnel ou éphémère liste). Les lignes sans contexte liste, ou sans
 * variation, sont simplement absentes du résultat.
 *
 * @param {Array<object>} cart - state.cart
 * @returns {Array<{shared_cart_item_id: string|undefined, name: string, snapshotPrice: number, currentPrice: number}>}
 */
export function computePriceVariations(cart) {
  if (!Array.isArray(cart)) return [];

  const variations = [];
  for (const item of cart) {
    const v = computeLineVariation(item);
    if (!v) continue;
    variations.push({
      shared_cart_item_id: item.shared_cart_item_id,
      name: item.shared_list_context.snapshot_name || item.product?.name || '',
      snapshotPrice: v.snapshotPrice,
      currentPrice: v.currentPrice,
    });
  }
  return variations;
}

/**
 * Construit le message de résumé (singulier/pluriel) à afficher si au
 * moins une ligne a changé de prix depuis le partage. null si aucune
 * variation.
 *
 * @param {Array} variations - résultat de computePriceVariations()
 * @returns {string|null}
 */
export function buildPriceVariationSummary(variations) {
  if (!Array.isArray(variations) || variations.length === 0) return null;
  if (variations.length === 1) {
    return 'Le prix d’un article a été actualisé depuis le partage.';
  }
  return `Les prix de ${variations.length} articles ont été actualisés depuis le partage.`;
}
