/**
 * @komerce-arch
 * @role          local-stock-local-stock-service
 * @domain        local-stock
 * @layer         service
 * @criticality   high
 * @inputs        product_id, market_id, location, qty_physical, actor_user_id
 * @outputs       local_stock_row, availability_projection
 * @depends       db
 * @used-by       (aucun — shadow, appel direct scripts/tests dans cette PR)
 * @db-read       local_stock, products, markets
 * @db-write      local_stock
 * @db-txn        single_statement_sufficient
 * @doctrine      IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md §2.1, §4 (capacité
 *                sœur d'inventory, jamais une extension — invariants distincts)
 * @impact-areas  local-stock
 * @version       2026-08
 */

'use strict';

/**
 * ═══════════════════════════════════════════════════════════════
 * LOCAL STOCK — Vague 1 Shadow (PR A)
 *
 * Stock physique vendable détenu par Komerce dans un marché donné.
 * STRICTEMENT DISTINCT de :
 *   - inventory_items (feature inventory)      → stock EN TRANSIT hub,
 *     invariant "jamais négatif au dispatch". Domaine logistique, pas
 *     commercial.
 *   - products.stock / product_skus.stock      → stock IMPORT/NATIONAL,
 *     jamais scopé par lieu (products.stock a un défaut de 100 — largement
 *     conventionnel pour l'import, jamais une vérité physique).
 *
 * Ce module ne lit JAMAIS products.stock ni product_skus.stock pour
 * répondre à une question de disponibilité locale. C'est l'invariant
 * central de cette feature — voir tests/unit/local-stock-service.test.js.
 *
 * SHADOW STRICT : aucune route HTTP dans cette PR, aucun consommateur
 * Boutique/checkout. Le service existe pour être observé (Pilotage,
 * scripts, tests), jamais pour être appelé par un parcours client.
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../db');

const DEFAULT_LOCATION = 'KM_MAIN';

/**
 * Disponibilité — deux états seulement.
 *
 * ETA a été délibérément écarté (voir manifest, perimeter.out) : un délai
 * de mise à disposition est déjà un concept possédé par le domaine
 * transport rail (DOCTRINE_TRANSPORT_RAILS.md) pour l'import. Le stock
 * local n'a pas de "délai" — soit l'unité est physiquement présente, soit
 * elle ne l'est pas. Lui inventer un troisième état confondrait deux
 * promesses de nature différente.
 */
const AVAILABILITY = Object.freeze({
  AVAILABLE_NOW: 'AVAILABLE_NOW',
  UNAVAILABLE:   'UNAVAILABLE',
});

/**
 * Lit la ligne de stock local brute pour un produit/marché/lieu.
 * Retourne null si aucune ligne n'existe — distinct de qty_physical = 0
 * (une ligne à 0 est une donnée ; l'absence de ligne est une absence de
 * donnée). Cette distinction reste visible ici pour l'observabilité
 * Pilotage ; la projection availability() l'aplati volontairement (voir
 * plus bas) car un client n'a pas besoin de cette nuance.
 *
 * @param {string} productId
 * @param {string} marketId
 * @param {string} [location]
 * @returns {Promise<object|null>}
 */
async function getLocalStock(productId, marketId, location = DEFAULT_LOCATION) {
  if (!productId || !marketId) {
    throw new Error('getLocalStock: product_id et market_id sont requis');
  }
  const { rows } = await db.query(
    `SELECT id, product_id, market_id, location, qty_physical,
            updated_by, created_at, updated_at
       FROM local_stock
      WHERE product_id = $1 AND market_id = $2 AND location = $3`,
    [productId, marketId, location]
  );
  return rows[0] || null;
}

/**
 * Projection de disponibilité — calculée, jamais persistée.
 *
 * Aucune ligne locale ou qty_physical = 0 mènent au même résultat client
 * (UNAVAILABLE) : du point de vue de la promesse "disponible maintenant",
 * les deux signifient identiquement "pas d'unité physique ici". La
 * distinction (jamais suivi vs suivi-et-épuisé) reste lisible via
 * getLocalStock() pour qui a besoin de ce niveau de détail (Pilotage).
 *
 * @param {string} productId
 * @param {string} marketId
 * @param {string} [location]
 * @returns {Promise<'AVAILABLE_NOW'|'UNAVAILABLE'>}
 */
async function getAvailability(productId, marketId, location = DEFAULT_LOCATION) {
  const row = await getLocalStock(productId, marketId, location);
  if (!row) return AVAILABILITY.UNAVAILABLE;
  return row.qty_physical > 0 ? AVAILABILITY.AVAILABLE_NOW : AVAILABILITY.UNAVAILABLE;
}

/**
 * Ajuste (crée ou met à jour) le stock local d'un produit à un marché/lieu
 * donné. Mutation directe et tracée (updated_by) — un opérateur déclare ce
 * qu'il constate, ce n'est jamais un delta calculé automatiquement à ce
 * stade (pas de réservation, pas de consommation via checkout : L4
 * différé, voir manifest perimeter.out).
 *
 * @param {object} params
 * @param {string} params.productId
 * @param {string} params.marketId
 * @param {string} [params.location]
 * @param {number} params.qtyPhysical
 * @param {string} [params.actorUserId]
 * @returns {Promise<object>} la ligne local_stock résultante
 */
async function setLocalStock({ productId, marketId, location = DEFAULT_LOCATION, qtyPhysical, actorUserId = null }) {
  if (!productId || !marketId) {
    throw new Error('setLocalStock: product_id et market_id sont requis');
  }
  if (!Number.isInteger(qtyPhysical) || qtyPhysical < 0) {
    throw new Error('setLocalStock: qty_physical doit être un entier >= 0');
  }

  const { rows: productRows } = await db.query(
    'SELECT id FROM products WHERE id = $1',
    [productId]
  );
  if (!productRows.length) {
    throw new Error(`setLocalStock: produit introuvable (${productId})`);
  }

  const { rows: marketRows } = await db.query(
    'SELECT id FROM markets WHERE id = $1 AND is_active = true',
    [marketId]
  );
  if (!marketRows.length) {
    throw new Error(`setLocalStock: marché introuvable ou inactif (${marketId})`);
  }

  const { rows } = await db.query(
    `INSERT INTO local_stock (product_id, market_id, location, qty_physical, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id, market_id, location)
     DO UPDATE SET qty_physical = EXCLUDED.qty_physical,
                   updated_by   = EXCLUDED.updated_by,
                   updated_at   = now()
     RETURNING id, product_id, market_id, location, qty_physical,
               updated_by, created_at, updated_at`,
    [productId, marketId, location, qtyPhysical, actorUserId]
  );
  return rows[0];
}

module.exports = {
  AVAILABILITY,
  DEFAULT_LOCATION,
  getLocalStock,
  getAvailability,
  setLocalStock,
};
