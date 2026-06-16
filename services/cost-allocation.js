/**
 * @komerce-arch
 * @role          economic-engine-cost-allocation
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

/**
 * KOMERCE — Cost Allocation Service (P4 — Reventilation reelle terrain)
 * ════════════════════════════════════════════════════════════════════════
 *
 * DOCTRINE :
 *   - pricing-engine                      = estimation
 *   - order_item_cost_imputations         = verite estimee figee (P3)
 *   - order_item_real_cost_allocations    = verite reelle reventilee (P4 — ce module)
 *   - admin-costing endpoints             = lecture de verite
 *
 *   Ce service NE refait PAS d'estimation. Il consomme les couts reels saisis
 *   par admin (factures transitaire, douane, parcel livre) et les ventile
 *   par cost_type vers les order_items.
 *
 * COST_TYPES alignes sur cost_components (migration 043) :
 *   product_purchase, sourcing, hub, packaging,
 *   freight, customs, port_transitaire, local_distribution, relay,
 *   payment, risk_provision, fixed_overhead,
 *   incident, marketing
 *
 * REGLE ABSOLUE :
 *   Si un coût reel manque, on NE le met JAMAIS a 0.
 *   Au lieu de ca, getOrderCostTruth retourne :
 *     - cost_status = 'partial_real' ou 'incomplete'
 *     - missing_cost_fields = ['fixed_overhead', 'payment', ...]
 *
 *   Le dashboard utilise ces flags pour ne JAMAIS afficher une marge
 *   reelle si elle est partielle, sans le signaler explicitement.
 */

'use strict';

const db = require('../db');

// ─── Constantes doctrine (alignees sur cost_components migration 043) ──
const COST_TYPES = Object.freeze([
  'product_purchase', 'sourcing', 'hub', 'packaging',
  'freight', 'customs', 'port_transitaire', 'local_distribution', 'relay',
  'payment', 'risk_provision', 'fixed_overhead',
  'incident', 'marketing',
]);

const ALLOCATION_METHODS = Object.freeze([
  'direct', 'by_value', 'by_weight', 'by_volume', 'by_taxable_weight',
  'per_item', 'per_order', 'manual', 'estimated_fallback',
]);

// Cost types qui sont "variables tracables" (alloues au fil de l'eau)
const VARIABLE_COST_TYPES = Object.freeze([
  'product_purchase', 'sourcing', 'freight', 'customs',
  'port_transitaire', 'local_distribution', 'relay', 'payment',
]);

// Cost types qui sont "fixes mensuels" (alloues en fin de mois)
const FIXED_COST_TYPES = Object.freeze([
  'hub', 'packaging', 'risk_provision', 'fixed_overhead',
]);

// Cost types exceptionnels (tjrs is_actual=true, manuels)
const EXCEPTIONAL_COST_TYPES = Object.freeze([
  'incident', 'marketing',
]);

// ═══════════════════════════════════════════════════════════════════════
// HELPERS PURS (testables sans BDD)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calcule les parts proportionnelles d'un total selon un poids.
 * @param {number} total
 * @param {Array<{id, weight}>} entries
 * @returns {Array<{id, share, share_pct}>}
 */
function shareByWeight(total, entries) {
  const totalWeight = entries.reduce((s, e) => s + Number(e.weight || 0), 0);
  if (totalWeight === 0 || !entries.length) {
    return entries.map(e => ({ id: e.id, share: 0, share_pct: 0 }));
  }
  return entries.map(e => {
    const w = Number(e.weight || 0);
    return {
      id: e.id,
      share: Math.round(total * w / totalWeight),
      share_pct: Math.round((w / totalWeight) * 10000) / 100,
    };
  });
}

/**
 * Poids taxable selon norme transport (max poids reel vs volumetrique).
 */
function taxableWeight(weightKg, volumeM3, mode = 'sea') {
  const factor = mode === 'air' ? 167 : 1000;
  const volumetricKg = (Number(volumeM3) || 0) * factor;
  return Math.max(Number(weightKg) || 0, volumetricKg);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. lockEstimatedCostsForOrder — delegue a order-cost-snapshot
// ═══════════════════════════════════════════════════════════════════════

async function lockEstimatedCostsForOrder(orderId, dbClient, options = {}) {
  // Delegue a order-cost-snapshot pour eviter la duplication de logique.
  const snapshot = require('./order-cost-snapshot');
  return await snapshot.lockEstimatedCostsForOrder(orderId, dbClient, options);
}

// ═══════════════════════════════════════════════════════════════════════
// 2. allocateShipmentRealCosts — ventile customs + freight + port d'un shipment
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ventile les couts reels d'un shipment vers ses parcels puis vers ses order_items.
 *
 * Etapes :
 *   1. Charger le shipment (customs_paid_kmf, freight_kmf)
 *   2. Pour chaque parcel lie :
 *      a. Determiner sa part (par customs_share_kmf si saisi, sinon ventilation)
 *      b. Eclater cette part entre les order_items du parcel via parcel_items
 *   3. INSERT order_item_real_cost_allocations pour chaque (cost_type, order_item)
 *   4. Idempotent : on supprime d'abord les allocations existantes liees a ce
 *      shipment_id avant d'inserer (sinon recalcul = doublons)
 *
 * @param {string} shipmentId
 * @param {object} dbClient - optionnel (sinon transaction propre)
 * @returns {Promise<{shipment_id, allocations_count, ...}>}
 */
async function allocateShipmentRealCosts(shipmentId, dbClient = null) {
  const ownTx = !dbClient;
  const client = dbClient || await db.pool.connect();

  try {
    if (ownTx) await client.query('BEGIN');

    // 1. Charger shipment
    const shipRes = await client.query(
      `SELECT * FROM customs_shipments WHERE id = $1`,
      [shipmentId]
    );
    if (!shipRes.rows.length) {
      if (ownTx) await client.query('ROLLBACK');
      return { shipment_id: shipmentId, allocations_count: 0, error: 'shipment_not_found' };
    }
    const ship = shipRes.rows[0];

    // 2. Charger parcels du shipment + ventilations existantes
    const parcelsRes = await client.query(
      `SELECT
         p.id AS parcel_id,
         p.order_id,
         csp.parcel_cif_kmf,
         csp.parcel_weight_kg,
         csp.customs_share_kmf,
         csp.allocation_basis
       FROM customs_shipment_parcels csp
       JOIN parcels p ON p.id = csp.parcel_id
       WHERE csp.shipment_id = $1`,
      [shipmentId]
    );

    if (!parcelsRes.rows.length) {
      if (ownTx) await client.query('COMMIT');
      return { shipment_id: shipmentId, allocations_count: 0, reason: 'no_parcels' };
    }
    const parcels = parcelsRes.rows;

    // 3. Idempotence : supprimer les allocations existantes liees a ce shipment
    await client.query(
      `DELETE FROM order_item_real_cost_allocations WHERE shipment_id = $1`,
      [shipmentId]
    );

    // 4. Calculer les parts shipment → parcels
    const totalCustoms = Number(ship.customs_paid_kmf) || 0;
    const totalFreight = Number(ship.freight_kmf) || 0;
    const allocMethod  = ship.allocation_method || 'by_cif_value';

    // Pour customs : utiliser customs_share_kmf saisi si dispo, sinon recalculer
    const parcelsCustomsShares = parcels.map(p => ({
      parcel_id: p.parcel_id,
      order_id: p.order_id,
      customs_share: Number(p.customs_share_kmf) || null,
    }));

    const allCustomsSharesSet = parcelsCustomsShares.every(p => p.customs_share != null);
    let customsShares;
    if (allCustomsSharesSet) {
      customsShares = parcelsCustomsShares;
    } else {
      // Recalculer la ventilation customs
      const weights = parcels.map(p => ({
        id: p.parcel_id,
        order_id: p.order_id,
        weight: allocMethod === 'by_weight'
          ? Number(p.parcel_weight_kg) || 0
          : Number(p.parcel_cif_kmf) || 0,  // by_cif_value (defaut)
      }));
      const shares = shareByWeight(totalCustoms, weights);
      customsShares = shares.map((s, i) => ({
        parcel_id: s.id,
        order_id: weights[i].order_id,
        customs_share: s.share,
      }));
    }

    // Pour freight : ventilation par poids
    const freightWeights = parcels.map(p => ({
      id: p.parcel_id,
      order_id: p.order_id,
      weight: Number(p.parcel_weight_kg) || 0,
    }));
    const freightSharesArr = shareByWeight(totalFreight, freightWeights);
    const freightShares = freightSharesArr.map((s, i) => ({
      parcel_id: s.id,
      order_id: freightWeights[i].order_id,
      freight_share: s.share,
    }));

    // 5. Pour chaque parcel, eclater sa part entre order_items
    let totalAllocations = 0;

    for (const parcel of parcels) {
      const customsShare = customsShares.find(c => c.parcel_id === parcel.parcel_id)?.customs_share || 0;
      const freightShare = freightShares.find(f => f.parcel_id === parcel.parcel_id)?.freight_share || 0;

      // Charger les order_items du parcel via parcel_items
      const parcelItemsRes = await client.query(
        `SELECT
           pi.order_item_id,
           pi.quantity AS parcel_qty,
           oi.price_kmf,
           oi.quantity AS order_item_qty,
           oi.product_id,
           p.weight_kg,
           p.cost_kmf
         FROM parcel_items pi
         JOIN order_items oi ON oi.id = pi.order_item_id
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE pi.parcel_id = $1`,
        [parcel.parcel_id]
      );

      if (!parcelItemsRes.rows.length) continue;
      const items = parcelItemsRes.rows;

      // Eclater customs par valeur (cost_kmf × quantite)
      const customsWeights = items.map(it => ({
        id: it.order_item_id,
        weight: (Number(it.cost_kmf) || 0) * (Number(it.parcel_qty) || 1),
      }));
      const customsSplit = shareByWeight(customsShare, customsWeights);

      // Eclater freight par poids
      const freightWeightsItems = items.map(it => ({
        id: it.order_item_id,
        weight: (Number(it.weight_kg) || 0) * (Number(it.parcel_qty) || 1),
      }));
      const freightSplit = shareByWeight(freightShare, freightWeightsItems);

      // INSERT pour chaque order_item
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const cShare = customsSplit[i].share;
        const fShare = freightSplit[i].share;

        if (cShare > 0) {
          await client.query(
            `INSERT INTO order_item_real_cost_allocations
               (order_id, order_item_id, parcel_id, shipment_id,
                cost_type, amount_kmf, allocation_method,
                source, is_actual, confidence)
             VALUES ($1,$2,$3,$4,'customs',$5,'by_value','customs_shipments',TRUE,'high')`,
            [parcel.order_id, it.order_item_id, parcel.parcel_id, shipmentId, cShare]
          );
          totalAllocations++;
        }

        if (fShare > 0) {
          await client.query(
            `INSERT INTO order_item_real_cost_allocations
               (order_id, order_item_id, parcel_id, shipment_id,
                cost_type, amount_kmf, allocation_method,
                source, is_actual, confidence)
             VALUES ($1,$2,$3,$4,'freight',$5,'by_weight','customs_shipments',TRUE,'high')`,
            [parcel.order_id, it.order_item_id, parcel.parcel_id, shipmentId, fShare]
          );
          totalAllocations++;
        }
      }
    }

    if (ownTx) await client.query('COMMIT');

    return {
      shipment_id: shipmentId,
      allocations_count: totalAllocations,
      total_customs_kmf: totalCustoms,
      total_freight_kmf: totalFreight,
      parcels_processed: parcels.length,
    };
  } catch (err) {
    if (ownTx) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (ownTx) client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. allocateParcelRealCosts — distribution locale + relais d'un parcel livre
// ═══════════════════════════════════════════════════════════════════════

/**
 * Quand un parcel passe en 'collected', on alloue :
 *   - local_distribution (transport hub→relais) : par poids, depuis finance_config
 *   - relay (commission relais) : per_item, depuis finance_config
 *
 * Ces couts sont calcules a partir des moyennes finance_config faute de
 * factures detaillees au parcel pres. is_actual=TRUE car ils sont engages
 * de facon predictible.
 */
async function allocateParcelRealCosts(parcelId, dbClient = null) {
  const ownTx = !dbClient;
  const client = dbClient || await db.pool.connect();

  try {
    if (ownTx) await client.query('BEGIN');

    // Charger parcel + order
    const parcelRes = await client.query(
      `SELECT p.id, p.order_id, p.status
       FROM parcels p
       WHERE p.id = $1`,
      [parcelId]
    );
    if (!parcelRes.rows.length) {
      if (ownTx) await client.query('ROLLBACK');
      return { parcel_id: parcelId, allocations_count: 0, error: 'parcel_not_found' };
    }
    const parcel = parcelRes.rows[0];

    // Idempotence : supprimer les allocations local_distribution + relay existantes
    await client.query(
      `DELETE FROM order_item_real_cost_allocations
       WHERE parcel_id = $1 AND cost_type IN ('local_distribution', 'relay')`,
      [parcelId]
    );

    // Charger order_items du parcel
    const itemsRes = await client.query(
      `SELECT pi.order_item_id, pi.quantity, p.weight_kg
       FROM parcel_items pi
       JOIN order_items oi ON oi.id = pi.order_item_id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE pi.parcel_id = $1`,
      [parcelId]
    );
    if (!itemsRes.rows.length) {
      if (ownTx) await client.query('COMMIT');
      return { parcel_id: parcelId, allocations_count: 0, reason: 'no_items' };
    }
    const items = itemsRes.rows;

    // Charger finance_config (commission relais standard, transport)
    const fcRes = await client.query(
      `SELECT commission_relais_standard_kmf
       FROM finance_config LIMIT 1`
    );
    const fc = fcRes.rows[0] || {};
    const commissionPerItem = Number(fc.commission_relais_standard_kmf) || 500;

    let allocations = 0;

    // Allocation 'relay' : per_item × commission
    for (const it of items) {
      const amount = commissionPerItem * (Number(it.quantity) || 1);
      await client.query(
        `INSERT INTO order_item_real_cost_allocations
           (order_id, order_item_id, parcel_id,
            cost_type, amount_kmf, allocation_method,
            source, is_actual, confidence)
         VALUES ($1,$2,$3,'relay',$4,'per_item','finance_config',TRUE,'medium')`,
        [parcel.order_id, it.order_item_id, parcelId, amount]
      );
      allocations++;
    }

    // Allocation 'local_distribution' : actuellement non saisi finement.
    // On NE met PAS de fallback estime ici. Restera 'missing' tant qu'il
    // n'y a pas de saisie reelle — coherent avec doctrine "jamais 0 pour manquant".

    if (ownTx) await client.query('COMMIT');

    return {
      parcel_id: parcelId,
      allocations_count: allocations,
      items_count: items.length,
    };
  } catch (err) {
    if (ownTx) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (ownTx) client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. allocateMonthlyFixedCosts — alloue les fixes mensuels en fin de mois
// ═══════════════════════════════════════════════════════════════════════

/**
 * En fin de mois, alloue les couts fixes mensuels (loyer hub, salaires admin,
 * frais Stripe agreges, provision risque) sur toutes les commandes du mois.
 *
 * Methode :
 *   - Total des couts fixes du mois (depuis finance_config × jours travailles)
 *   - Diviser par le nombre d'order_items du mois
 *   - INSERT per_order ou per_item selon le cost_type
 *
 * @param {string} yearMonth - format 'YYYY-MM'
 * @param {object} options - { dryRun: false, costTypes: [...] }
 * @returns {Promise<{year_month, allocations_count, total_fixed_kmf, ...}>}
 *
 * REGLE : si on appelle 2x sur le meme mois, le 2e appel REMPLACE les
 * allocations precedentes (DELETE + INSERT). Idempotent.
 */
async function allocateMonthlyFixedCosts(yearMonth, options = {}) {
  const dryRun = !!options.dryRun;

  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error('yearMonth must be YYYY-MM');
  }
  const monthStart = `${yearMonth}-01`;
  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthEnd = nextMonth.toISOString().slice(0, 10);

  const client = await db.pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');

    // 1. Compter les order_items du mois (commandes confirmees)
    const itemsCountRes = await client.query(
      `SELECT COUNT(oi.id)::int AS items_count,
              COUNT(DISTINCT o.id)::int AS orders_count
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.created_at >= $1 AND o.created_at < $2
         AND o.payment_status = 'paid'
         AND o.status NOT IN ('cancelled', 'refunded')`,
      [monthStart, monthEnd]
    );
    const itemsCount = Number(itemsCountRes.rows[0].items_count) || 0;
    const ordersCount = Number(itemsCountRes.rows[0].orders_count) || 0;

    if (itemsCount === 0) {
      if (!dryRun) await client.query('COMMIT');
      return {
        year_month: yearMonth,
        allocations_count: 0,
        items_count: 0,
        reason: 'no_items_for_month',
        dry_run: dryRun,
      };
    }

    // 2. Charger finance_config
    const fcRes = await client.query(
      `SELECT * FROM finance_config LIMIT 1`
    );
    const fc = fcRes.rows[0] || {};

    // 3. Calculer les enveloppes mensuelles
    const taxAed = Number(fc.taux_aed_kmf) || 138;
    const hubMonthlyKmf = (Number(fc.hub_monthly_cost_aed) || 7000) * taxAed;
    // Provision risque : 1% du CA du mois (forfait raisonnable)
    const revenueRes = await client.query(
      `SELECT COALESCE(SUM(total_kmf), 0)::int AS revenue
       FROM orders
       WHERE created_at >= $1 AND created_at < $2
         AND payment_status = 'paid'
         AND status NOT IN ('cancelled', 'refunded')`,
      [monthStart, monthEnd]
    );
    const monthRevenue = Number(revenueRes.rows[0].revenue) || 0;
    // R6 FIX — provision_risque_pct depuis finance_config (patch P1-6 manquant ici)
    const riskPct = Number(fc.provision_risque_pct) || 0.01;
    const riskMonthlyKmf = Math.round(monthRevenue * riskPct);

    // Allocation par order_item
    const hubPerItem  = Math.round(hubMonthlyKmf / itemsCount);
    const riskPerItem = Math.round(riskMonthlyKmf / itemsCount);

    // 4. Idempotence : supprimer les allocations fixes deja faites pour ce mois
    if (!dryRun) {
      await client.query(
        `DELETE FROM order_item_real_cost_allocations
         WHERE source = 'monthly_recalc'
           AND created_at >= $1 AND created_at < $2`,
        [monthStart, monthEnd]
      );
    }

    if (dryRun) {
      // FIX: pas de BEGIN en dryRun → pas de ROLLBACK à appeler (évite warning PostgreSQL)
      return {
        year_month: yearMonth,
        dry_run: true,
        proposal: {
          orders_count: ordersCount,
          items_count: itemsCount,
          hub_monthly_kmf: hubMonthlyKmf,
          risk_monthly_kmf: riskMonthlyKmf,
          hub_per_item: hubPerItem,
          risk_per_item: riskPerItem,
        },
      };
    }

    // 5. INSERT pour chaque order_item du mois
    const itemsRes = await client.query(
      `SELECT oi.id AS order_item_id, oi.order_id
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.created_at >= $1 AND o.created_at < $2
         AND o.payment_status = 'paid'
         AND o.status NOT IN ('cancelled', 'refunded')`,
      [monthStart, monthEnd]
    );

    let allocations = 0;
    for (const it of itemsRes.rows) {
      if (hubPerItem > 0) {
        await client.query(
          `INSERT INTO order_item_real_cost_allocations
             (order_id, order_item_id, cost_type, amount_kmf, allocation_method, source, is_actual, confidence)
           VALUES ($1, $2, 'hub', $3, 'per_item', 'monthly_recalc', TRUE, 'medium')`,
          [it.order_id, it.order_item_id, hubPerItem]
        );
        allocations++;
      }
      if (riskPerItem > 0) {
        await client.query(
          `INSERT INTO order_item_real_cost_allocations
             (order_id, order_item_id, cost_type, amount_kmf, allocation_method, source, is_actual, confidence)
           VALUES ($1, $2, 'risk_provision', $3, 'per_item', 'monthly_recalc', TRUE, 'medium')`,
          [it.order_id, it.order_item_id, riskPerItem]
        );
        allocations++;
      }
    }

    await client.query('COMMIT');

    return {
      year_month: yearMonth,
      allocations_count: allocations,
      items_count: itemsCount,
      orders_count: ordersCount,
      hub_monthly_kmf: hubMonthlyKmf,
      risk_monthly_kmf: riskMonthlyKmf,
      hub_per_item: hubPerItem,
      risk_per_item: riskPerItem,
      dry_run: false,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5. allocateProductPurchaseCosts — coût d'achat AED (direct, par order_item)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Pour un order_item donne, alloue le coût d'achat AED en KMF (direct).
 * Source : products.cost_kmf au moment du snapshot, ou alors la facture
 * fournisseur reelle si elle est saisie ailleurs.
 *
 * Idempotent : supprime puis insere.
 */
async function allocateProductPurchaseCosts(orderId, dbClient = null) {
  const ownTx = !dbClient;
  const client = dbClient || await db.pool.connect();

  try {
    if (ownTx) await client.query('BEGIN');

    // Idempotence
    await client.query(
      `DELETE FROM order_item_real_cost_allocations
       WHERE order_id = $1 AND cost_type = 'product_purchase'`,
      [orderId]
    );

    // Charger les order_items (cost_kmf produit = approximation tant qu'on n'a
    // pas de facture fournisseur reelle attachee a la commande)
    const itemsRes = await client.query(
      `SELECT oi.id AS order_item_id, oi.quantity, p.cost_kmf
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    let count = 0;
    for (const it of itemsRes.rows) {
      const amount = (Number(it.cost_kmf) || 0) * (Number(it.quantity) || 1);
      if (amount > 0) {
        await client.query(
          `INSERT INTO order_item_real_cost_allocations
             (order_id, order_item_id, cost_type, amount_kmf, allocation_method, source, is_actual, confidence)
           VALUES ($1, $2, 'product_purchase', $3, 'direct', 'products.cost_kmf', TRUE, 'medium')`,
          [orderId, it.order_item_id, amount]
        );
        count++;
      }
    }

    if (ownTx) await client.query('COMMIT');
    return { order_id: orderId, allocations_count: count };
  } catch (err) {
    if (ownTx) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (ownTx) client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 6. computeOrderCostVariance — compare estime vs reel par cost_type
// ═══════════════════════════════════════════════════════════════════════

async function computeOrderCostVariance(orderId) {
  // Estime
  const estRes = await db.query(
    `SELECT
       SUM(estimated_landed_relay_cost_kmf) AS landed,
       SUM(estimated_business_complete_cost_kmf) AS business,
       SUM(estimated_margin_kmf) AS margin,
       jsonb_object_agg(
         coalesce(cb_key.k, 'unknown'),
         coalesce((cost_breakdown->cb_key.k->>'total')::numeric, 0)
       ) FILTER (WHERE cost_breakdown IS NOT NULL) AS by_cost_type
     FROM order_item_cost_imputations imp
     LEFT JOIN LATERAL jsonb_object_keys(imp.cost_breakdown) cb_key(k) ON TRUE
     WHERE order_id = $1`,
    [orderId]
  );

  // Reel
  const realRes = await db.query(
    `SELECT cost_type, SUM(amount_kmf) AS amount
     FROM order_item_real_cost_allocations
     WHERE order_id = $1
     GROUP BY cost_type`,
    [orderId]
  );

  const realByType = {};
  let totalReal = 0;
  for (const r of realRes.rows) {
    realByType[r.cost_type] = Number(r.amount);
    totalReal += Number(r.amount);
  }

  const est = estRes.rows[0] || {};
  const totalEstBusiness = Number(est.business) || 0;
  const totalEstLanded = Number(est.landed) || 0;

  return {
    order_id: orderId,
    estimated: {
      landed_kmf: Math.round(totalEstLanded),
      business_kmf: Math.round(totalEstBusiness),
      by_cost_type: est.by_cost_type || {},
    },
    real: {
      total_kmf: Math.round(totalReal),
      by_cost_type: realByType,
    },
    variance: {
      total_kmf: Math.round(totalReal - totalEstBusiness),
      total_pct: totalEstBusiness > 0
        ? Number((((totalReal - totalEstBusiness) / totalEstBusiness) * 100).toFixed(2))
        : null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 7. computeProductCostVariance — agrege par produit sur N commandes
// ═══════════════════════════════════════════════════════════════════════

async function computeProductCostVariance(productId, options = {}) {
  // NOTE: options.from / options.to non supportés dans cette version — simpleSql lit tous les orders.
  // La version filtrée par dates (sql complexe avec $${i-2}) avait un bug de paramétrage et n'était pas utilisée.
  // À implémenter proprement si besoin filtrage par date.

  // Version robuste (filtre uniquement par product_id)
  const simpleSql = `
    SELECT
      imp.product_id,
      SUM(imp.quantity)::int AS quantity_sold,
      SUM(imp.estimated_business_complete_cost_kmf) AS total_estimated_kmf,
      COALESCE((
        SELECT SUM(alc.amount_kmf)
        FROM order_item_real_cost_allocations alc
        WHERE alc.order_item_id IN (
          SELECT id FROM order_items WHERE product_id = $1
        )
      ), 0) AS total_real_kmf,
      COUNT(DISTINCT imp.order_id)::int AS orders_count
    FROM order_item_cost_imputations imp
    WHERE imp.product_id = $1
    GROUP BY imp.product_id
  `;
  const r = await db.query(simpleSql, [productId]);
  if (!r.rows.length) {
    return { product_id: productId, no_data: true };
  }
  const row = r.rows[0];
  const est = Number(row.total_estimated_kmf) || 0;
  const real = Number(row.total_real_kmf) || 0;
  return {
    product_id: row.product_id,
    quantity_sold: row.quantity_sold,
    orders_count: row.orders_count,
    total_estimated_kmf: Math.round(est),
    total_real_kmf: Math.round(real),
    variance_kmf: Math.round(real - est),
    variance_pct: est > 0 ? Number((((real - est) / est) * 100).toFixed(2)) : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 8. getOrderCostTruth — verite economique complete d'une order
// ═══════════════════════════════════════════════════════════════════════

/**
 * Retourne la verite complete sur une commande :
 *   - estime (depuis order_item_cost_imputations)
 *   - reel (depuis order_item_real_cost_allocations, par cost_type)
 *   - variance
 *   - cost_status : 'estimated' | 'partial_real' | 'actual' | 'incomplete'
 *   - missing_cost_fields : liste des cost_types manquants
 *
 * REGLE : on ne met JAMAIS 0 pour un cout manquant. On le declare 'missing'
 * dans missing_cost_fields. Le dashboard sait ainsi quoi afficher en transparence.
 */
async function getOrderCostTruth(orderId) {
  // 1. Charger order
  const orderRes = await db.query(
    `SELECT id, reference, status, payment_status, total_kmf, created_at
     FROM orders WHERE id = $1`,
    [orderId]
  );
  if (!orderRes.rows.length) return null;
  const order = orderRes.rows[0];

  // 2. Estime agrégé
  const estRes = await db.query(
    `SELECT
       COUNT(*) AS imputations_count,
       SUM(quantity) AS items_quantity,
       SUM(sale_total_kmf) AS sale_total,
       SUM(estimated_landed_relay_cost_kmf) AS estimated_landed,
       SUM(estimated_business_complete_cost_kmf) AS estimated_business,
       SUM(estimated_margin_kmf) AS estimated_margin
     FROM order_item_cost_imputations
     WHERE order_id = $1`,
    [orderId]
  );
  const est = estRes.rows[0] || {};

  // 3. Reel par cost_type
  const realRes = await db.query(
    `SELECT cost_type, SUM(amount_kmf) AS amount, BOOL_AND(is_actual) AS all_actual
     FROM order_item_real_cost_allocations
     WHERE order_id = $1
     GROUP BY cost_type`,
    [orderId]
  );

  const realByType = {};
  let totalRealKmf = 0;
  for (const r of realRes.rows) {
    realByType[r.cost_type] = {
      amount_kmf: Math.round(Number(r.amount)),
      is_actual: r.all_actual,
    };
    totalRealKmf += Number(r.amount);
  }

  // 4. Determiner cost_status + missing_cost_fields
  // ENUM CANONIQUE (Sprint 1) :
  //   estimated      = snapshot pricing-engine seul, aucun cout reel alloue
  //   partial_real   = couts variables alloues mais pas tous les types attendus
  //   actual         = tous les types attendus alloues (= ex-'complete')
  //   incomplete     = imputation absente / cas pathologique
  const expectedVariable = ['product_purchase', 'freight', 'customs', 'local_distribution', 'relay'];
  const expectedFixed = ['hub', 'risk_provision', 'fixed_overhead'];
  const expectedAll = [...expectedVariable, ...expectedFixed, 'payment'];

  const present = Object.keys(realByType);
  const missingVariable = expectedVariable.filter(t => !present.includes(t));
  const missingFixed = expectedFixed.filter(t => !present.includes(t));
  const missingPayment = !present.includes('payment') ? ['payment'] : [];

  const missing = [...missingVariable, ...missingFixed, ...missingPayment];

  let costStatus;
  if (Number(est.imputations_count) === 0) {
    costStatus = 'incomplete';            // ex 'no_imputations'
  } else if (totalRealKmf === 0) {
    costStatus = 'estimated';             // ex 'provisional'
  } else if (missingVariable.length > 0) {
    costStatus = 'partial_real';
  } else if (missingFixed.length > 0 || missingPayment.length > 0) {
    costStatus = 'partial_real';
  } else {
    costStatus = 'actual';                // ex 'complete'
  }

  // 5. Marge reelle UNIQUEMENT si actual
  const sale = Number(est.sale_total) || Number(order.total_kmf) || 0;
  const realMarginKmf = costStatus === 'actual' ? (sale - totalRealKmf) : null;
  const realMarginPct = (realMarginKmf != null && sale > 0)
    ? Number(((realMarginKmf / sale) * 100).toFixed(2))
    : null;

  // Variance
  const totalEstBusiness = Number(est.estimated_business) || 0;
  const variance = totalRealKmf > 0 && totalEstBusiness > 0 ? {
    total_kmf: Math.round(totalRealKmf - totalEstBusiness),
    total_pct: Number((((totalRealKmf - totalEstBusiness) / totalEstBusiness) * 100).toFixed(2)),
  } : null;

  return {
    order_id: order.id,
    reference: order.reference,
    status: order.status,
    payment_status: order.payment_status,
    sale: {
      total_kmf: Math.round(sale),
    },
    estimated: {
      landed_relay_cost_kmf: Math.round(Number(est.estimated_landed) || 0),
      business_complete_cost_kmf: Math.round(totalEstBusiness),
      margin_kmf: Math.round(Number(est.estimated_margin) || 0),
      margin_pct: totalEstBusiness > 0 && sale > 0
        ? Number(((sale - totalEstBusiness) / sale * 100).toFixed(2))
        : null,
      imputations_count: Number(est.imputations_count),
    },
    real: {
      total_kmf: totalRealKmf > 0 ? Math.round(totalRealKmf) : null,
      margin_kmf: realMarginKmf != null ? Math.round(realMarginKmf) : null,
      margin_pct: realMarginPct,
      by_cost_type: realByType,
    },
    variance,
    cost_status: costStatus,
    missing_cost_fields: missing,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  // Constantes doctrine
  COST_TYPES, ALLOCATION_METHODS,
  VARIABLE_COST_TYPES, FIXED_COST_TYPES, EXCEPTIONAL_COST_TYPES,

  // Helpers purs
  shareByWeight, taxableWeight,

  // Snapshot estime (delegue)
  lockEstimatedCostsForOrder,

  // Allocations reelles
  allocateShipmentRealCosts,
  allocateParcelRealCosts,
  allocateProductPurchaseCosts,
  allocateMonthlyFixedCosts,

  // Lecture
  computeOrderCostVariance,
  computeProductCostVariance,
  getOrderCostTruth,
};
