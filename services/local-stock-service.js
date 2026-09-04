/**
 * @komerce-arch
 * @role          local-stock-local-stock-service
 * @domain        local-stock
 * @layer         service
 * @criticality   high
 * @inputs        product_id, market_id, location, qty_physical, actor_user_id,
 *                order_id, quantity (allocations), checkout_demands
 * @outputs       local_stock_row, availability_projection, allocation_row,
 *                checkout_fulfillment_projection
 * @depends       db
 * @used-by       order-status-machine.js (consume à confirmed, release à
 *                cancelled), order-checkout-service.js (resolve avant pricing),
 *                order-checkout-persistence.js (allocate à la création)
 * @db-read       local_stock, local_stock_allocations, products, markets
 * @db-write      local_stock, local_stock_allocations
 * @db-txn        multi_statement — resolveCheckoutFulfillmentSources/
 *                allocateForOrderItem/consumeAllocationsForOrder/
 *                releaseAllocationsForOrder EXIGENT le client de transaction
 *                appelant (jamais le pool global), pour rester atomiques avec
 *                la mutation orders qui les entoure
 * @doctrine      docs/doctrine/DOCTRINE_FULFILLMENT_MIXTE.md ;
 *                IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md §2.1, §4 ;
 *                RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §I
 * @impact-areas  local-stock, orders
 * @version       2026-09
 */

'use strict';

/**
 * ═══════════════════════════════════════════════════════════════
 * LOCAL STOCK
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
 * Checkout mixte 2026-09 : local-stock décide uniquement si une quantité
 * peut être engagée LOCAL_STOCK dans le marché courant. orders orchestre
 * ensuite le snapshot historique et le transport import ; local-stock ne
 * possède ni le checkout, ni le pricing transport, ni les parcels.
 *
 * La projection publique "Disponible maintenant" existe via la frontière
 * Discovery / GET availability. Elle ne change jamais l'ownership : toute
 * vérité physique, exposition commerciale, résolution et allocation restent
 * ici ; la Boutique ne lit jamais les tables local_stock directement.
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
 * Projection de provenance utilisée uniquement pendant la transaction de
 * checkout. Le snapshot durable appartient à orders (order_items), pas à
 * local-stock.
 */
const FULFILLMENT_SOURCE = Object.freeze({
  LOCAL_STOCK: 'LOCAL_STOCK',
  IMPORT:      'IMPORT',
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
    `SELECT id, product_id, market_id, location, qty_physical, commercial_exposure,
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
 * stade.
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
 * Met à jour le commercial_exposure d'une ligne local_stock existante.
 * La ligne doit déjà exister (créée via setLocalStock) — pas de création implicite.
 *
 * @param {string} productId
 * @param {string} marketId
 * @param {'ENABLED'|'DISABLED'} exposure
 * @param {string} [location]
 * @returns {Promise<object>} la ligne local_stock mise à jour
 */
async function setLocalStockExposure(productId, marketId, exposure, location = DEFAULT_LOCATION) {
  if (!['ENABLED', 'DISABLED'].includes(exposure)) {
    throw new Error(`setLocalStockExposure: exposure invalide (${exposure})`);
  }
  const { rows } = await db.query(
    `UPDATE local_stock
        SET commercial_exposure = $1, updated_at = now()
      WHERE product_id = $2 AND market_id = $3 AND location = $4
      RETURNING *`,
    [exposure, productId, marketId, location]
  );
  if (!rows.length) {
    throw new Error(`setLocalStockExposure: ligne local_stock introuvable (${productId}, ${marketId}, ${location})`);
  }
  return rows[0];
}

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

// ── Cycle resolve → allocate → consume | release ─────────────────────────

/**
 * Somme des quantités actuellement engagées (ni consommées, ni libérées)
 * pour un local_stock_id donné.
 * @param {string} localStockId
 * @param {object} [client] — client de transaction optionnel (cohérence de
 *   lecture sous verrou dans les mutations checkout)
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
 * Résout la provenance transactionnelle d'un ensemble de demandes checkout.
 *
 * Règles V1 :
 * - pas de marché ou pas de ligne locale exposée → IMPORT ;
 * - ligne ENABLED + quantité agrégée suffisante → LOCAL_STOCK ;
 * - ligne ENABLED mais quantité agrégée insuffisante → conflit explicite ;
 * - jamais de fallback silencieux LOCAL_STOCK → IMPORT après promesse locale.
 *
 * Les quantités d'un même product_id sont agrégées avant décision. Les locks
 * sont acquis dans l'ordre trié des product_id pour réduire le risque de
 * deadlock entre deux paniers contenant les mêmes produits dans un ordre
 * différent. Tous les FOR UPDATE restent détenus jusqu'au COMMIT/ROLLBACK du
 * checkout owner.
 *
 * @param {object} client client transactionnel orders
 * @param {object} params
 * @param {string|null} params.marketId
 * @param {Array<{productId:string, quantity:number}>} params.demands
 * @param {string} [params.location]
 * @returns {Promise<Record<string,'LOCAL_STOCK'|'IMPORT'>>}
 */
async function resolveCheckoutFulfillmentSources(
  client,
  { marketId = null, demands = [], location = DEFAULT_LOCATION } = {}
) {
  if (!client) throw new Error('resolveCheckoutFulfillmentSources: client de transaction requis');
  if (!Array.isArray(demands)) {
    throw new Error('resolveCheckoutFulfillmentSources: demands doit être un tableau');
  }

  const grouped = new Map();
  for (const demand of demands) {
    const productId = String(demand?.productId || '').trim();
    const quantity = Number(demand?.quantity);
    if (!productId) {
      throw new Error('resolveCheckoutFulfillmentSources: productId requis');
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('resolveCheckoutFulfillmentSources: quantity doit être un entier positif');
    }
    grouped.set(productId, (grouped.get(productId) || 0) + quantity);
  }

  const sources = {};
  const productIds = [...grouped.keys()].sort();

  if (!marketId) {
    for (const productId of productIds) sources[productId] = FULFILLMENT_SOURCE.IMPORT;
    return sources;
  }

  for (const productId of productIds) {
    const quantity = grouped.get(productId);
    const { rows } = await client.query(
      `SELECT id, qty_physical, commercial_exposure
         FROM local_stock
        WHERE product_id = $1 AND market_id = $2 AND location = $3
        FOR UPDATE`,
      [productId, marketId, location]
    );

    const localStock = rows[0] || null;
    if (!localStock || localStock.commercial_exposure !== 'ENABLED') {
      sources[productId] = FULFILLMENT_SOURCE.IMPORT;
      continue;
    }

    const active = await _activeAllocatedQuantity(localStock.id, client);
    const available = localStock.qty_physical - active;
    if (available < quantity) {
      const err = new Error(
        `resolveCheckoutFulfillmentSources: stock local insuffisant pour ${productId} ` +
        `(disponible ${available}, demandé ${quantity})`
      );
      err.code = 'local_stock_insufficient';
      err.product_id = productId;
      err.available = available;
      err.requested = quantity;
      throw err;
    }

    sources[productId] = FULFILLMENT_SOURCE.LOCAL_STOCK;
  }

  return sources;
}

/**
 * Engage une commande sur le stock local d'un produit, à la création de la
 * commande — avant tout paiement. No-op silencieux (retourne null) si ce
 * produit n'a pas de ligne local_stock exposée à ce marché/lieu.
 *
 * DOIT être appelé avec le client de transaction de la commande elle-même.
 * En checkout normal, resolveCheckoutFulfillmentSources() a déjà verrouillé
 * la ligne locale ; ce second SELECT FOR UPDATE est donc réentrant dans la
 * même transaction et valide le verdict au moment de l'allocation.
 *
 * @param {object} client — client de transaction (obligatoire, jamais `db` global)
 * @param {object} params
 * @param {string} params.productId
 * @param {string} params.marketId
 * @param {string} params.orderId
 * @param {string} [params.location]
 * @param {number} params.quantity
 * @returns {Promise<object|null>}
 */
async function allocateForOrderItem(client, { productId, marketId, orderId, location = DEFAULT_LOCATION, quantity }) {
  if (!client) throw new Error('allocateForOrderItem: client de transaction requis');
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('allocateForOrderItem: quantity doit être un entier positif');
  }

  const { rows: stockRows } = await client.query(
    `SELECT id, qty_physical, commercial_exposure FROM local_stock
      WHERE product_id = $1 AND market_id = $2 AND location = $3
      FOR UPDATE`,
    [productId, marketId, location]
  );
  if (!stockRows.length) return null;

  const localStock = stockRows[0];
  // migration 157 garantit NOT NULL + CHECK ENABLED|DISABLED. Le fallback
  // undefined conserve seulement la compatibilité des anciens mocks unitaires.
  if (localStock.commercial_exposure === 'DISABLED') return null;

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
  FULFILLMENT_SOURCE,
  DEFAULT_LOCATION,
  getLocalStock,
  getAvailability,
  setLocalStock,
  setLocalStockExposure,
  isStockExposable,
  resolveCheckoutFulfillmentSources,
  allocateForOrderItem,
  consumeAllocationsForOrder,
  releaseAllocationsForOrder,
};