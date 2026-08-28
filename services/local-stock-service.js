/**
 * @komerce-arch
 * @role          local-stock-local-stock-service
 * @domain        local-stock
 * @layer         service
 * @criticality   high
 * @inputs        product_id, market_id, location, qty_physical, actor_user_id,
 *                order_id, quantity (allocations)
 * @outputs       local_stock_row, availability_projection, allocation_row
 * @depends       db
 * @used-by       order-status-machine.js (consume à confirmed, release à
 *                cancelled), routes/orders/create.js (allocate à la création)
 * @db-read       local_stock, local_stock_allocations, products, markets
 * @db-write      local_stock, local_stock_allocations
 * @db-txn        multi_statement — allocateForOrderItem/consumeAllocationsForOrder/
 *                releaseAllocationsForOrder EXIGENT le client de transaction
 *                appelant (jamais le pool global), pour rester atomiques avec
 *                la mutation orders qui les entoure
 * @doctrine      IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md §2.1, §4 (capacité
 *                sœur d'inventory, jamais une extension — invariants distincts) ;
 *                RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §I (allocation
 *                minimale avant exposition, pas de réservation TTL complète) ;
 *                micro-arbitrage 2026-08-28 (cycle allocate/consume/release,
 *                pas de qty_allocated matérialisé, pas de branchement
 *                unsold-resolution)
 * @impact-areas  local-stock, orders
 * @version       2026-08
 */

'use strict';

/**
 * ═══════════════════════════════════════════════════════════════
 * LOCAL STOCK — Vague 1 Shadow (PR A) + Vague 2 D2
 *
 * Stock physique vendable détenu par Komerce dans un marché donné.
 * STRICTEMENT DISTINCT de :
 *   - inventory_items (feature inventory)      → stock EN TRANSIT hub,
 *     invariant "jamais négatif au dispatch". Domaine logistique, pas
 *     commercial.
 *   - products.stock / product_skus.stock      → stock IMPORT/NATIONAL,
 *     jamais scopé par lieu (products.stock a un défaut de 100 — largement
 *     conventionnel pour l'import, jamais une vérité physique). Le bloc
 *     "5b. Auto-effects: cancelled → stock restore" d'order-status-machine.js
 *     restaure CE stock-là (products/product_skus) — totalement indépendant
 *     du cycle allocate/consume/release de ce fichier.
 *
 * Ce module ne lit JAMAIS products.stock ni product_skus.stock pour
 * répondre à une question de disponibilité locale. C'est l'invariant
 * central de cette feature — voir tests/unit/local-stock-service.test.js.
 *
 * D2 — le SEUL point d'intégration avec orders : allocateForOrderItem()
 * appelé depuis routes/orders/create.js (dans la même transaction que la
 * commande), consumeAllocationsForOrder()/releaseAllocationsForOrder()
 * appelés depuis order-status-machine.js (transitions confirmed/cancelled).
 * Toute la LOGIQUE d'allocation reste ici — orders n'est qu'un appelant,
 * jamais un propriétaire de cette règle métier.
 *
 * SHADOW toujours strict côté FRONTEND : aucune route HTTP publique dans
 * cette PR, aucun composant Boutique, `commercial_exposure` reste DISABLED
 * par défaut. Le service existe pour être observé (Pilotage, scripts,
 * tests) et pour protéger le stock réel dès la première commande réelle —
 * mais rien n'est encore visible côté client.
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
 * Vague 2 D2 : tient compte des allocations actives (local_stock_
 * allocations, consumed_at IS NULL AND released_at IS NULL), pas seulement
 * qty_physical brut — sinon le badge "Disponible maintenant" mentirait dès
 * qu'une commande en cours de paiement détient déjà la dernière unité.
 * Micro-arbitrage validé 2026-08-28 : available = qty_physical -
 * SUM(allocations actives), calculé à la volée, jamais qty_allocated
 * matérialisé (pas de besoin de performance constaté à ce stade).
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
  const available = row.qty_physical - await _activeAllocatedQuantity(row.id);
  return available > 0 ? AVAILABILITY.AVAILABLE_NOW : AVAILABILITY.UNAVAILABLE;
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

// ── Exposition ───────────────────────────────────────────────────────────

/**
 * Même patron que isServiceExposable/isPhysicalOfferExposable
 * (providers-service.js) : exposable seulement si l'exposition est activée
 * ET qu'une quantité réellement disponible existe (allocations actives
 * déduites) — un stock à exposure=ENABLED mais entièrement alloué n'est
 * PAS exposable, exposer reviendrait à mentir.
 *
 * @param {string} productId
 * @param {string} marketId
 * @param {string} [location]
 * @returns {Promise<boolean>}
 */
async function isStockExposable(productId, marketId, location = DEFAULT_LOCATION) {
  const row = await getLocalStock(productId, marketId, location);
  if (!row) return false;
  if (row.commercial_exposure !== 'ENABLED') return false;
  const available = row.qty_physical - await _activeAllocatedQuantity(row.id);
  return available > 0;
}

// ── Cycle allocate → consume | release ──────────────────────────────────
//
// Micro-arbitrage validé 2026-08-28. Une allocation engage une commande sur
// un stock local, AVANT tout paiement — c'est ce qui empêche la survente
// dès l'instant T, quel que soit le mode de paiement (cash payé au retrait,
// carte pouvant échouer après création de la commande). PAS de qty_allocated
// matérialisé : la vérité active se lit toujours depuis
// local_stock_allocations. PAS de TTL / cron dédié — le release se
// déclenche uniquement sur un événement réel déjà émis par orders
// (annulation, échec paiement, abandon cash), jamais une horloge inventée
// par ce domaine. Voir migration 157 pour le détail de la doctrine.

/**
 * Somme des quantités actuellement engagées (ni consommées, ni libérées)
 * pour un local_stock_id donné.
 * @param {string} localStockId
 * @param {object} [client] — client de transaction optionnel (cohérence de
 *   lecture sous verrou dans allocateForOrderItem)
 * @returns {Promise<number>}
 */
async function _activeAllocatedQuantity(localStockId, client = db) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS active
       FROM local_stock_allocations
      WHERE local_stock_id = $1 AND consumed_at IS NULL AND released_at IS NULL`,
    [localStockId]
  );
  return rows[0].active;
}

/**
 * Engage une commande sur le stock local d'un produit, à la création de la
 * commande — avant tout paiement. No-op silencieux (retourne null) si ce
 * produit n'a pas de ligne local_stock à ce marché/lieu : le stock local
 * est strictement opt-in, la majorité des produits n'en ont pas.
 *
 * DOIT être appelé avec le client de transaction de la commande elle-même
 * (dbClient d'orders/create.js) — le verrou FOR UPDATE posé ici tient tant
 * que cette transaction n'est pas commit/rollback, ce qui sérialise deux
 * allocations concurrentes sur le même produit (protection contre la
 * survente, même esprit que les migrations 123/129 : arbitrage par la base,
 * jamais par du code applicatif seul).
 *
 * @param {object} client — client de transaction (obligatoire, jamais `db` global)
 * @param {object} params
 * @param {string} params.productId
 * @param {string} params.marketId
 * @param {string} params.orderId
 * @param {string} [params.location]
 * @param {number} params.quantity
 * @returns {Promise<object|null>} la ligne d'allocation créée, ou null si
 *   ce produit n'est pas suivi en stock local à ce marché/lieu
 */
async function allocateForOrderItem(client, { productId, marketId, orderId, location = DEFAULT_LOCATION, quantity }) {
  if (!client) throw new Error('allocateForOrderItem: client de transaction requis');
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('allocateForOrderItem: quantity doit être un entier positif');
  }

  const { rows: stockRows } = await client.query(
    `SELECT id, qty_physical FROM local_stock
      WHERE product_id = $1 AND market_id = $2 AND location = $3
      FOR UPDATE`,
    [productId, marketId, location]
  );
  if (!stockRows.length) return null; // produit non suivi en stock local — no-op, pas une erreur

  const localStock = stockRows[0];
  const active = await _activeAllocatedQuantity(localStock.id, client);
  const available = localStock.qty_physical - active;
  if (available < quantity) {
    const err = new Error(
      `allocateForOrderItem: stock local insuffisant (disponible ${available}, demandé ${quantity})`
    );
    err.code = 'local_stock_insufficient';
    throw err;
  }

  const { rows } = await client.query(
    `INSERT INTO local_stock_allocations (local_stock_id, order_id, quantity)
     VALUES ($1, $2, $3)
     RETURNING id, local_stock_id, order_id, quantity, allocated_at, consumed_at, released_at`,
    [localStock.id, orderId, quantity]
  );
  return rows[0];
}

/**
 * Consomme toutes les allocations actives d'une commande — décrémente
 * réellement qty_physical. Appelée au moment où le paiement est
 * effectivement confirmé (point d'accroche unique : order-status-machine.js,
 * même bloc que payment_status='paid').
 *
 * Idempotente par construction : la garde WHERE consumed_at IS NULL AND
 * released_at IS NULL fait qu'un appel répété (webhook rejoué) ne trouve
 * plus rien à consommer la deuxième fois — jamais un double décrément.
 *
 * @param {object} client — client de transaction
 * @param {string} orderId
 * @returns {Promise<number>} nombre d'allocations consommées
 */
async function consumeAllocationsForOrder(client, orderId) {
  if (!client) throw new Error('consumeAllocationsForOrder: client de transaction requis');
  const { rows: allocations } = await client.query(
    `SELECT id, local_stock_id, quantity FROM local_stock_allocations
      WHERE order_id = $1 AND consumed_at IS NULL AND released_at IS NULL
      FOR UPDATE`,
    [orderId]
  );
  for (const alloc of allocations) {
    await client.query(
      `UPDATE local_stock_allocations SET consumed_at = now()
        WHERE id = $1 AND consumed_at IS NULL AND released_at IS NULL`,
      [alloc.id]
    );
    await client.query(
      `UPDATE local_stock SET qty_physical = qty_physical - $2, updated_at = now()
        WHERE id = $1`,
      [alloc.local_stock_id, alloc.quantity]
    );
  }
  return allocations.length;
}

/**
 * Libère toutes les allocations actives d'une commande — sans jamais
 * toucher qty_physical (l'unité n'avait jamais été réellement prélevée).
 * Appelée sur toute transition d'annulation (point d'accroche unique :
 * order-status-machine.js, transition vers 'cancelled', quelle que soit la
 * source — annulation utilisateur/admin, chaos simulateur, abandon cash
 * automatique via cash-reminder-service.js : les trois passent déjà par
 * transitionOrderStatus, un seul point suffit).
 *
 * Idempotente par la même garde que consumeAllocationsForOrder.
 *
 * @param {object} client — client de transaction
 * @param {string} orderId
 * @returns {Promise<number>} nombre d'allocations libérées
 */
async function releaseAllocationsForOrder(client, orderId) {
  if (!client) throw new Error('releaseAllocationsForOrder: client de transaction requis');
  const { rowCount } = await client.query(
    `UPDATE local_stock_allocations SET released_at = now()
      WHERE order_id = $1 AND consumed_at IS NULL AND released_at IS NULL`,
    [orderId]
  );
  return rowCount;
}

module.exports = {
  AVAILABILITY,
  DEFAULT_LOCATION,
  getLocalStock,
  getAvailability,
  setLocalStock,
  isStockExposable,
  allocateForOrderItem,
  consumeAllocationsForOrder,
  releaseAllocationsForOrder,
};
