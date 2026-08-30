/**
 * @komerce-arch
 * @role          catalog-product-sellable-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, variant_combo, quantity, resolved_sku
 * @outputs       sellable_unit, pricing_result
 * @depends       services/product-sku-service.js
 * @used-by       services/product-admin-service.js (réexport), services/order-checkout-item-resolution.js,
 *                routes/orders/create.js (via product-admin-service.js), services/shared-cart-creation.js (via product-admin-service.js)
 * @db-read       catalog_media, product_sku_media, product_variants, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/specs/DECISION_MODELE_STOCK_SKU.md, GAP-07
 * @impact-areas  catalog, orders, checkout, shared-cart
 * @version       2026-08 (extrait de product-admin-service.js, LOT 3A — nettoyage architectural)
 */

'use strict';

/**
 * product-sellable-service.js
 *
 * Extrait de services/product-admin-service.js (LOT 3A, nettoyage
 * architectural). Porte la résolution d'une unité de vente : politique de
 * promotion canonique, calcul du prix (base + effectif), image canonique,
 * et resolveSellableUnit() — la boundary GAP-07 unique pour identité/stock/
 * prix/média d'une unité effectivement vendable, quel que soit l'appelant.
 *
 * Bloc auto-contenu déplacé tel quel : aucune règle de pricing, de
 * promotion, de résolution SKU ni de fallback legacy n'a changé. Ce module
 * dépend uniquement de services/product-sku-service.js (resolveActiveSku,
 * canonicalizeVariantCombo) — jamais de product-admin-service.js, pour
 * qu'aucun appelant (checkout notamment) n'ait plus besoin de passer par le
 * service d'administration produit pour résoudre une unité vendable.
 *
 * product-admin-service.js réexporte les 4 fonctions ci-dessous pour API
 * publique inchangée : routes/orders/create.js et
 * services/shared-cart-creation.js (contrat protégé, hors périmètre de ce
 * lot) continuent d'importer resolveSellableUnit depuis
 * product-admin-service.js sans aucun changement.
 *
 * Exports :
 *   applyCanonicalPromotion(baseUnitPriceKmf, product, now?) → number (pure)
 *   computeSellablePricing({ product, resolvedSku?, now? })
 *     → { base_unit_price_kmf, effective_unit_price_kmf } (pure)
 *   resolveSellableUnit(dbClient, { productId, variantCombo?, quantity? })
 *     → { product_id, inventory_model, sku_id, sku, variant_combo, stock,
 *         base_unit_price_kmf, effective_unit_price_kmf, name, image_url, category }
 *     ✗ throws (err.status / err.code) :
 *         404 product_not_found | 409 sellable_unit_not_found |
 *         409 sellable_unit_out_of_stock | 400 variant_invalid | 400 variant_unknown
 */

const { resolveActiveSku, canonicalizeVariantCombo } = require('./product-sku-service');

/**
 * Politique promotionnelle canonique (GAP-07 — lot préalable).
 *
 * Point de vérité UNIQUE pour transformer un prix de base en prix effectif.
 * Reprend exactement la règle déjà en vigueur dans
 * services/shared-cart-creation.js :
 *   promo active ⇔ products.is_promo ET products.promo_pct > 0
 *                   ET (products.promo_until absent OU >= maintenant)
 *   prix effectif = round(prix_base * (1 - promo_pct / 100))
 *
 * Fonction pure (aucun accès DB) — appelable depuis n'importe quel writer
 * ou route sans coût de requête supplémentaire, dès lors que la ligne
 * `products` a déjà été chargée (is_promo, promo_pct, promo_until).
 *
 * @param {number} baseUnitPriceKmf
 * @param {{is_promo?: boolean, promo_pct?: number|null, promo_until?: string|Date|null}} product
 * @param {Date} [now]
 */
function applyCanonicalPromotion(baseUnitPriceKmf, product = {}, now = new Date()) {
  const base = Number(baseUnitPriceKmf) || 0;
  const promoActive = Boolean(product.is_promo) &&
    Number(product.promo_pct) > 0 &&
    (!product.promo_until || new Date(product.promo_until) >= now);
  if (!promoActive) return base;
  return Math.round(base * (1 - Number(product.promo_pct) / 100));
}

/**
 * Calcule le prix de base et le prix effectif d'une unité vendable, à
 * partir d'une ligne `products` déjà chargée et, le cas échéant, d'une
 * ligne `product_skus` déjà résolue (résultat de resolveActiveSku).
 *
 * Fonction pure — pas de requête DB. C'est la brique de calcul que
 * resolveSellableUnit() (ci-dessous) et routes/orders/create.js partagent,
 * pour ne jamais dupliquer la règle de fallback / la politique promo.
 *
 * Règle de prix de base (GAP-07 §5) :
 *   produit SKU  → product_skus.price_kmf si renseigné, sinon products.price_kmf
 *   produit non-SKU → products.price_kmf (product_skus n'existe pas pour lui)
 *
 * @returns {{ base_unit_price_kmf: number, effective_unit_price_kmf: number }}
 */
function computeSellablePricing({ product, resolvedSku = null, now = new Date() }) {
  const baseUnitPriceKmf = resolvedSku && resolvedSku.price_kmf != null
    ? Number(resolvedSku.price_kmf)
    : Number(product.price_kmf) || 0;

  return {
    base_unit_price_kmf: baseUnitPriceKmf,
    effective_unit_price_kmf: applyCanonicalPromotion(baseUnitPriceKmf, product, now),
  };
}

/**
 * Résout l'image canonique d'une unité vendable (GAP-07 §8) :
 *   média explicitement rattaché au SKU (product_sku_media → catalog_media)
 *   → sinon image produit legacy (products.image_url).
 *
 * Lecture seule, requête additionnelle — n'est appelée que par
 * resolveSellableUnit() ci-dessous (jamais par routes/orders/create.js,
 * qui n'a pas besoin d'une image pour écrire order_items).
 */
async function _resolveCanonicalImage(dbClient, { product, skuId }) {
  if (skuId) {
    const { rows: [media] } = await dbClient.query(
      `SELECT cm.url
         FROM product_sku_media psm
         JOIN catalog_media cm ON cm.id = psm.media_id AND cm.is_active = true
        WHERE psm.sku_id = $1
        ORDER BY psm.display_order NULLS LAST, psm.created_at ASC
        LIMIT 1`,
      [skuId]
    );
    if (media?.url) return media.url;
  }
  return product.image_url || null;
}

/**
 * Boundary canonique d'unité vendable (GAP-07 §5).
 *
 * Point d'entrée UNIQUE pour résoudre, quel que soit l'appelant (commande
 * personnelle, writers shared-cart, ajout unitaire...), l'identité, le
 * stock, le prix et le média d'une unité effectivement vendable. Réutilise
 * resolveActiveSku() — ne réimplémente jamais la résolution SKU.
 *
 * @param {object} dbClient
 * @param {{ productId: string, variantCombo?: object|null, quantity?: number }} args
 * @returns {Promise<{
 *   product_id: string, inventory_model: string,
 *   sku_id: string|null, sku: string|null, variant_combo: object|null,
 *   stock: number,
 *   base_unit_price_kmf: number, effective_unit_price_kmf: number,
 *   name: string, image_url: string|null, category: string|null,
 * }>}
 *
 * Erreurs (err.status / err.code) :
 *   404 product_not_found        — produit introuvable ou inactif
 *   409 sellable_unit_not_found  — produit SKU, combinaison inconnue/inactive
 *   409 sellable_unit_out_of_stock — stock insuffisant pour la quantité demandée
 *   400 variant_unknown          — produit legacy, variante inconnue
 */
async function resolveSellableUnit(dbClient, { productId, variantCombo = null, quantity = 1 }) {
  const { rows: [product] } = await dbClient.query(
    `SELECT id, name, image_url, category, price_kmf, is_active,
            inventory_model, has_variants, stock,
            promo_pct, is_promo, promo_until
       FROM products
      WHERE id = $1`,
    [productId]
  );
  if (!product || !product.is_active) {
    const e = new Error(`Produit introuvable ou inactif : ${productId}`);
    e.status = 404; e.code = 'product_not_found';
    throw e;
  }

  const qty = Number(quantity) || 1;

  if (product.inventory_model === 'SKU') {
    const resolvedSku = await resolveActiveSku(dbClient, productId, variantCombo);
    if (!resolvedSku) {
      const e = new Error(`Combinaison indisponible pour ${product.name}`);
      e.status = 409; e.code = 'sellable_unit_not_found';
      throw e;
    }
    if (resolvedSku.stock < qty) {
      const e = new Error(`Stock insuffisant pour ${product.name} — disponible : ${resolvedSku.stock}`);
      e.status = 409; e.code = 'sellable_unit_out_of_stock';
      e.available_stock = resolvedSku.stock;
      throw e;
    }

    const { base_unit_price_kmf, effective_unit_price_kmf } =
      computeSellablePricing({ product, resolvedSku });
    const imageUrl = await _resolveCanonicalImage(dbClient, { product, skuId: resolvedSku.id });

    return {
      product_id: product.id,
      inventory_model: product.inventory_model,
      sku_id: resolvedSku.id,
      sku: resolvedSku.sku,
      variant_combo: canonicalizeVariantCombo(variantCombo ?? null),
      stock: resolvedSku.stock,
      base_unit_price_kmf,
      effective_unit_price_kmf,
      name: product.name,
      image_url: imageUrl,
      category: product.category,
    };
  }

  // ── Produit non-SKU (LEGACY_VARIANTS ou sans variante) ──────────────
  // La combinaison legacy est conservée telle quelle lorsqu'elle existe
  // (référence d'affichage/historique — cf. product_variants), mais elle
  // n'identifie jamais une unité vendable à prix distinct : products ne
  // porte qu'un seul price_kmf pour toutes ses variantes.
  let combo = null;
  if (variantCombo && typeof variantCombo === 'object' && !Array.isArray(variantCombo)) {
    if (!product.has_variants) {
      combo = null;
    } else {
      combo = {};
      for (const [vType, vValue] of Object.entries(variantCombo)) {
        if (typeof vType !== 'string' || typeof vValue !== 'string') {
          const e = new Error(`variant_combo invalide pour ${productId} : ${vType}=${vValue}`);
          e.status = 400; e.code = 'variant_invalid';
          throw e;
        }
        const { rows: [variant] } = await dbClient.query(
          `SELECT stock FROM product_variants
            WHERE product_id = $1 AND variant_type = $2 AND variant_value = $3`,
          [productId, vType, vValue]
        );
        if (!variant) {
          const e = new Error(`Variante inconnue pour ${product.name} : ${vType}=${vValue}`);
          e.status = 400; e.code = 'variant_unknown';
          throw e;
        }
        if (variant.stock !== null && variant.stock < qty) {
          const e = new Error(`Stock insuffisant pour ${product.name} — ${vType}: ${vValue} — disponible : ${variant.stock}`);
          e.status = 409; e.code = 'sellable_unit_out_of_stock';
          e.available_stock = variant.stock;
          throw e;
        }
        combo[vType] = vValue;
      }
    }
  }

  if (combo === null && product.stock !== null && product.stock < qty) {
    const e = new Error(`Stock insuffisant pour ${product.name} — disponible : ${product.stock}`);
    e.status = 409; e.code = 'sellable_unit_out_of_stock';
    e.available_stock = product.stock;
    throw e;
  }

  const { base_unit_price_kmf, effective_unit_price_kmf } =
    computeSellablePricing({ product, resolvedSku: null });

  return {
    product_id: product.id,
    inventory_model: product.inventory_model || 'LEGACY_VARIANTS',
    sku_id: null,
    sku: null,
    variant_combo: combo,
    stock: product.stock,
    base_unit_price_kmf,
    effective_unit_price_kmf,
    name: product.name,
    image_url: product.image_url || null,
    category: product.category,
  };
}

module.exports = {
  applyCanonicalPromotion,
  computeSellablePricing,
  resolveSellableUnit,
};
