/**
 * @komerce-arch
 * @role          orders-checkout-item-resolution
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       services/product-sku-service.js, services/product-sellable-service.js
 * @used-by       services/order-checkout-service.js
 * @db-read       product_variants, products, shared_cart_items, shared_carts, order_items
 * @db-write      none
 * @db-txn        participant (reçoit le client transactionnel de l'appelant, ne BEGIN/COMMIT/ROLLBACK jamais lui-même)
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout, shared-cart
 * @version       2026-08 (LOT 3A — migré vers product-sku-service.js / product-sellable-service.js,
 *                supprime la dépendance checkout → product-admin-service.js)
 */

'use strict';

/**
 * order-checkout-item-resolution.js
 *
 * Extrait de services/order-checkout-service.js (refactoring réel du
 * checkout, post-audit domaine 4/5). Porte la résolution ligne-par-ligne du
 * panier : produit (FOR UPDATE), chemin SKU vs legacy variants, validation
 * de stock, prix canonique (computeSellablePricing), intégrité du claim
 * shared_cart_item_id (FOR UPDATE OF sci), canonicalisation des items
 * (variant_combo, sku résolu, prix effectif écrits directement sur chaque
 * `item`, comme avant l'extraction).
 *
 * LOT 3A (nettoyage architectural) : ce module importe désormais
 * resolveActiveSku/canonicalizeVariantCombo directement depuis
 * product-sku-service.js, et computeSellablePricing depuis
 * product-sellable-service.js — plus aucune dépendance vers
 * product-admin-service.js. Le checkout métier n'a plus besoin du service
 * d'administration produit pour résoudre SKU/variant/prix.
 *
 * ⚠️ Ce module ne possède AUCUNE transaction : il reçoit le `client` déjà
 * ouvert par order-checkout-service.js (BEGIN posé par l'appelant) et ne
 * fait JAMAIS de BEGIN/COMMIT/ROLLBACK lui-même. Sur erreur métier, il
 * renvoie { ok: false, status, body } SANS rollback — c'est
 * order-checkout-service.js qui reste seul propriétaire du ROLLBACK et
 * traduit ce résultat en réponse. Copie exacte du comportement d'origine :
 * mêmes requêtes SQL, même ordre de contrôles, mêmes messages/codes
 * d'erreur — seul le point d'exécution du ROLLBACK, puis le fichier
 * source de resolveActiveSku/canonicalizeVariantCombo/computeSellablePricing,
 * ont changé.
 *
 * Export :
 *   resolveCheckoutItems({ client, items, maxQty, fretPerKg, aedFallback,
 *                           customsPct, pickupCodeRecipient, userId })
 *     → { ok: true, productMap, total_kmf, cost_estimated, pickupCodeRecipientUserId }
 *     | { ok: false, status, body }
 *     ✗ throws sur toute erreur DB/inattendue non couverte ci-dessus (comme avant)
 */

const { resolveActiveSku, canonicalizeVariantCombo } = require('./product-sku-service');
const { computeSellablePricing } = require('./product-sellable-service');

async function resolveCheckoutItems({
  client,
  items,
  maxQty,
  fretPerKg,
  aedFallback,
  customsPct,
  pickupCodeRecipient,
  userId,
}) {
  const productIds = items.map(i => i.product_id);

  const { rows: products } = await client.query(
    'SELECT * FROM products WHERE id = ANY($1) AND is_active = TRUE FOR UPDATE',
    [productIds]
  );
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));

  let total_kmf = 0;
  let cost_estimated = 0;
  let sharedCartId = null;
  let sharedListOrganizerUserId = null;
  let hasSharedListItems = false;
  let hasPersonalItems = false;

  for (const item of items) {
    if (!item.product_id || typeof item.product_id !== 'string') {
      return { ok: false, status: 400, body: { error: 'product_id invalide' } };
    }

    const product = productMap[item.product_id];
    if (!product) {
      return { ok: false, status: 404, body: { error: `Produit introuvable : ${item.product_id}` } };
    }

    const qty = parseInt(item.quantity, 10) || 1;

    if (qty < 1 || qty > maxQty) {
      return { ok: false, status: 400, body: { error: `Quantité invalide pour ${item.product_id}: min 1, max ${maxQty}` } };
    }

    if (product.inventory_model === 'SKU') {
      // ── Lot 3 — chemin SKU exclusif ────────────────────────────────
      // Doctrine migration 104 : un produit en mode SKU ne lit/écrit
      // JAMAIS products.stock ni product_variants.stock. Le stock et la
      // disponibilité viennent uniquement de product_skus, résolu via
      // resolveActiveSku (services/product-sku-service.js).
      const comboRaw = (item.variant_combo && typeof item.variant_combo === 'object' && !Array.isArray(item.variant_combo))
        ? item.variant_combo
        : null;

      let resolvedSku;
      try {
        resolvedSku = await resolveActiveSku(client, item.product_id, comboRaw);
      } catch (e) {
        return { ok: false, status: e.status || 400, body: { error: e.message } };
      }

      if (!resolvedSku) {
        const comboLabel = comboRaw
          ? ' : ' + Object.entries(comboRaw).map(([k, v]) => `${k}=${v}`).join(', ')
          : '';
        return {
          ok: false, status: 409,
          body: { error: `Combinaison indisponible pour ${product.name}${comboLabel}` },
        };
      }

      if (resolvedSku.stock < qty) {
        return {
          ok: false, status: 409,
          body: {
            error: `Stock insuffisant pour ${product.name} — disponible : ${resolvedSku.stock}`,
            available_stock: resolvedSku.stock,
          },
        };
      }

      item.variant_combo = comboRaw;
      item._resolved_sku_id = resolvedSku.id;
      // GAP-07 (lot préalable) — le prix facturé DOIT être celui de
      // l'unité vendable résolue (SKU), jamais le prix générique du
      // produit. computeSellablePricing() est la même fonction pure que
      // shared-cart / catalogue : un SKU au prix spécifique produit le
      // même prix quel que soit le point d'entrée. Pas de requête DB
      // supplémentaire ici : `product` (SELECT *) porte déjà promo_pct/
      // is_promo/promo_until.
      item._effective_unit_price_kmf =
        computeSellablePricing({ product, resolvedSku }).effective_unit_price_kmf;
    } else {
      // ── Chemin legacy (LEGACY_VARIANTS, défaut) — inchangé ──────────
      if (product.stock !== null && product.stock < qty) {
        return {
          ok: false, status: 409,
          body: {
            error: `Stock insuffisant pour ${product.name} — disponible : ${product.stock}`,
            available_stock: product.stock,
          },
        };
      }

      // ── VAGUE 3 — Validation stock par variante ────────────────────────
      // Si l'item porte un variant_combo, on vérifie le stock de chaque
      // variante constituante. Le frontend ne devrait pas envoyer une combo
      // si le produit n'a pas has_variants=true, mais on protège quand même.
      if (item.variant_combo && typeof item.variant_combo === 'object' && !Array.isArray(item.variant_combo)) {
        if (!product.has_variants) {
          // Combo envoyée mais le produit n'a pas de variantes → on ignore
          // silencieusement (rétrocompat) plutôt que de planter une commande.
          item.variant_combo = null;
        } else {
          for (const [vType, vValue] of Object.entries(item.variant_combo)) {
            if (typeof vType !== 'string' || typeof vValue !== 'string') {
              return {
                ok: false, status: 400,
                body: { error: `variant_combo invalide pour ${item.product_id} : ${vType}=${vValue}` },
              };
            }
            const { rows: [variant] } = await client.query(
              `SELECT stock FROM product_variants
                WHERE product_id = $1 AND variant_type = $2 AND variant_value = $3`,
              [item.product_id, vType, vValue]
            );
            if (!variant) {
              return {
                ok: false, status: 400,
                body: { error: `Variante inconnue pour ${product.name} : ${vType}=${vValue}` },
              };
            }
            if (variant.stock !== null && variant.stock < qty) {
              return {
                ok: false, status: 409,
                body: {
                  error: `Stock insuffisant pour ${product.name} — ${vType}: ${vValue} — disponible : ${variant.stock}`,
                  available_stock: variant.stock,
                },
              };
            }
          }
        }
      }

      // GAP-07 — même politique de prix que le chemin SKU ci-dessus :
      // aucun produit acheté n'échappe à la boundary de prix canonique.
      // Pour un produit legacy, product_skus n'existe pas — resolvedSku
      // est simplement absent, computeSellablePricing retombe sur
      // product.price_kmf comme base, puis applique la même politique
      // promo que le catalogue et le shared-cart (§5/§6).
      item._effective_unit_price_kmf =
        computeSellablePricing({ product, resolvedSku: null }).effective_unit_price_kmf;
    }

    // ── Mandat §6 — intégrité du claim en commande ──────────────────
    // La contrainte unique order_items_shared_cart_item_id_unique
    // (migration 123, catch dans order-checkout-service.js) arbitre
    // uniquement la concurrence (deux acheteurs sur la même ligne). Elle
    // ne garantit RIEN sur la cohérence produit/SKU/statut : sans ce
    // bloc, un client pourrait envoyer un product_id/sku différent tout
    // en portant le shared_cart_item_id d'une autre ligne, et la
    // commande serait créée avec un claim incohérent (achat du produit B
    // en réclamant la ligne partagée du produit A — interdiction
    // explicite §19).
    //
    // FOR UPDATE sur shared_cart_items sérialise aussi les tentatives de
    // claim concurrentes sur la MÊME ligne : une deuxième transaction
    // visant le même shared_cart_item_id bloque ici jusqu'au commit/
    // rollback de la première, puis relit un état à jour — ceinture et
    // bretelles avec la contrainte unique, jamais un remplacement.
    if (item.shared_cart_item_id) {
      const { rows: sciRows } = await client.query(
        `SELECT sci.id, sci.shared_cart_id, sci.product_id, sci.sku_id, sci.variant_combo_snapshot,
                sci.quantity, sc.organizer_user_id, sc.status AS cart_status,
                EXISTS (
                  SELECT 1 FROM order_items oi WHERE oi.shared_cart_item_id = sci.id
                ) AS already_claimed
           FROM shared_cart_items sci
           JOIN shared_carts sc ON sc.id = sci.shared_cart_id
          WHERE sci.id = $1
          FOR UPDATE OF sci`,
        [item.shared_cart_item_id]
      );

      if (!sciRows.length) {
        return {
          ok: false, status: 409,
          body: { error: 'Article de liste partagée introuvable.', code: 'shared_cart_item_mismatch' },
        };
      }
      const sci = sciRows[0];
      hasSharedListItems = true;

      if (sharedCartId && String(sharedCartId) !== String(sci.shared_cart_id)) {
        return {
          ok: false, status: 409,
          body: { error: 'Une commande de liste partagée ne peut concerner qu’une seule liste.', code: 'mixed_shared_lists_forbidden' },
        };
      }
      sharedCartId = sci.shared_cart_id;
      sharedListOrganizerUserId = sci.organizer_user_id;

      if (sci.cart_status !== 'open') {
        return {
          ok: false, status: 409,
          body: { error: 'Cette liste partagée est fermée, l\'article ne peut plus être acheté.', code: 'shared_cart_closed' },
        };
      }

      if (sci.already_claimed) {
        return {
          ok: false, status: 409,
          body: { error: 'Cet article de la liste a déjà été acheté.', code: 'shared_cart_item_already_claimed' },
        };
      }

      if (String(sci.product_id) !== String(item.product_id)) {
        return {
          ok: false, status: 409,
          body: { error: 'L\'article de la liste partagée ne correspond pas au produit commandé.', code: 'shared_cart_item_mismatch' },
        };
      }

      if (product.inventory_model === 'SKU') {
        if (String(sci.sku_id || '') !== String(item._resolved_sku_id || '')) {
          return {
            ok: false, status: 409,
            body: { error: 'Le SKU de la liste partagée ne correspond pas au SKU commandé.', code: 'shared_cart_item_mismatch' },
          };
        }
        const orderedCombo = JSON.stringify(canonicalizeVariantCombo(item.variant_combo));
        const snapshotCombo = JSON.stringify(
          canonicalizeVariantCombo(sci.variant_combo_snapshot || null)
        );
        if (orderedCombo !== snapshotCombo) {
          return {
            ok: false, status: 409,
            body: { error: 'La combinaison de la liste partagée ne correspond pas à celle commandée.', code: 'shared_cart_item_mismatch' },
          };
        }
      }

      if (qty !== Number(sci.quantity)) {
        return {
          ok: false, status: 409,
          body: {
            error: `La quantité commandée doit correspondre exactement à la ligne figée : ${sci.quantity}`,
            code: 'shared_cart_item_mismatch',
          },
        };
      }
    } else {
      hasPersonalItems = true;
    }

    total_kmf += item._effective_unit_price_kmf * qty;

    const fret_kmf = (product.weight_kg || 0.5) * qty * fretPerKg;
    const base_aed_kmf = (product.price_aed || 0) * aedFallback * qty;
    const customs_est = base_aed_kmf * (customsPct / 100) * (product.customs_risk_coeff || 1.0);
    cost_estimated += base_aed_kmf + fret_kmf + customs_est;
  }

  if (hasSharedListItems && hasPersonalItems) {
    return {
      ok: false, status: 409,
      body: { error: 'Le panier personnel et une liste partagée doivent être commandés séparément.', code: 'mixed_checkout_origins_forbidden' },
    };
  }

  if (pickupCodeRecipient === 'organizer' && !hasSharedListItems) {
    return {
      ok: false, status: 400,
      body: { error: 'Le destinataire organisateur est réservé à un achat depuis une liste reçue.', code: 'pickup_code_recipient_invalid' },
    };
  }

  const pickupCodeRecipientUserId =
    pickupCodeRecipient === 'organizer' ? sharedListOrganizerUserId : userId;

  return {
    ok: true,
    productMap,
    total_kmf,
    cost_estimated,
    pickupCodeRecipientUserId,
  };
}

module.exports = { resolveCheckoutItems };
