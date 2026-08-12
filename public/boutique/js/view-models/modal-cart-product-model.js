/**
 * @komerce-arch
 * @role          modal-cart-product-snapshot-model
 * @domain        catalog
 * @layer         view-model
 * @criticality   high
 * @inputs        catalog_product, product_detail_v1, modal_selection_state
 * @outputs       cart_product_snapshot
 * @depends       none
 * @used-by       b-modal-cart.js, b-modal-buybox-shared.js, b-modal-mobile-product.js, b-modal-desktop-product.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @impact-areas  product-modal, cart, sku-selection, pricing
 * @version       2026-07
 */

'use strict';

function activeSellableUnit(detail, selection) {
  const selectedSkuId = selection?.selected_sku_id;
  if (!selectedSkuId) return null;
  return (detail?.sellable_units || []).find(
    (unit) => String(unit.sku_id) === String(selectedSkuId)
  ) || null;
}

/**
 * Frontiere transactionnelle unique de la modale produit.
 *
 * - SKU : une unite vendable reelle et disponible doit etre resolue ;
 * - LEGACY_VARIANTS avec axes : le contrat sait qu'un choix existe mais ne
 *   sait pas le convertir en SKU canonique, donc l'achat reste bloque ;
 * - SIMPLE / legacy sans axe : le produit parent reste l'unite vendable.
 *
 * Le second cas est volontairement fail-closed : fabriquer un faux SKU depuis
 * les anciens axes remettrait exactement la divergence stock/prix que le
 * Product Detail Contract est charge d'eliminer.
 */
export function isModalPurchaseReady(product, detail, selection) {
  if (!product || !detail || !detail.inventory_model) return false;

  if (detail.inventory_model === 'SKU') {
    const unit = activeSellableUnit(detail, selection);
    return Boolean(unit && unit.stock_status !== 'OUT_OF_STOCK');
  }

  const hasLegacyOptions = Boolean(product.has_variants)
    || (Array.isArray(detail.option_axes) && detail.option_axes.length > 0);
  if (detail.inventory_model === 'LEGACY_VARIANTS' && hasLegacyOptions) return false;

  return detail.inventory_model === 'SIMPLE'
    || detail.inventory_model === 'LEGACY_VARIANTS';
}

/**
 * Construit le snapshot produit persiste dans le panier depuis la selection
 * courante de la modale. Pour un produit SKU, le prix, la reference et le media
 * proviennent exclusivement du Product Detail Contract. Pour un produit legacy,
 * l'objet d'origine est retourne tel quel afin de conserver le comportement
 * historique et l'identite d'objet attendue par les tests/consommateurs.
 */
export function buildModalCartProduct(product, detail, selection) {
  if (!product) return product;

  const unit = activeSellableUnit(detail, selection);
  if (!unit) return product;

  const selectedMedia = Array.isArray(selection?.selected_media)
    ? selection.selected_media[0]
    : null;
  const unitPrice = unit.price_kmf
    ?? detail?.pricing?.price_kmf
    ?? product.price_kmf
    ?? product.price
    ?? 0;

  return {
    ...product,
    price_kmf: unitPrice,
    price: unitPrice,
    sku: unit.sku || product.sku || null,
    sku_id: unit.sku_id,
    selected_sku_id: unit.sku_id,
    image_url: selectedMedia?.url || product.image_url || product.image || '',
  };
}

export const _modalCartProductModelTestApi = Object.freeze({
  activeSellableUnit,
});
