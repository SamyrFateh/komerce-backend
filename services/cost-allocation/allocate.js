/**
 * @komerce-arch
 * @role          economic-engine-cost-allocation-allocate
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, ./_helpers (shareByWeight), utils/relay-commission.js
 * @used-by       services/cost-allocation/index.js
 * @db-read       cost_components, customs_shipment_parcels, customs_shipments, finance_config, order_items, orders, parcel_items, parcels, products
 * @db-write      order_item_real_cost_allocations
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

/**
 * KOMERCE — Cost Allocation — Allocations reelles (Lot C5)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Extrait de services/cost-allocation.js (914L) — Lot B/C Refacto.
 *
 * DOCTRINE :
 *   Ce module NE refait PAS d'estimation. Il consomme les couts reels saisis
 *   par admin (factures transitaire, douane, parcel livre) et les ventile
 *   par cost_type vers les order_items dans order_item_real_cost_allocations.
 *
 *   allocateShipmentRealCosts    — ventile customs + freight d'un shipment
 *   allocateParcelRealCosts      — distribution locale + relais d'un parcel livre
 *   allocateMonthlyFixedCosts    — alloue les fixes mensuels en fin de mois
 *   allocateProductPurchaseCosts — coût d'achat AED (direct, par order_item)
 *
 * Couvertes par tests/unit/cost-allocation-allocate.test.js (12 cas de
 * caractérisation, posés avant ce split — voir LOT_B_C_REFACTO.md, C5).
 */

'use strict';

const db = require('../../db');
const { shareByWeight } = require('./_helpers');
const { resolveRelayCommissionCurrent } = require('../../utils/relay-commission');

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
         csp.parcel_volume_cm3,
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

    // Pour freight : le poids ne fait PAS partie de l'équation en maritime
    // (doctrine — le fret LCL est acheté au m³, jamais au kg). Donc :
    //   - sea + volume snapshoté        → ventilation par volume (réel)
    //   - sea + volume absent (legacy)  → répartition égale entre colis,
    //                                      PAS par poids (le poids n'a aucun
    //                                      sens économique ici ; mieux vaut
    //                                      un signal neutre "pas de donnée"
    //                                      qu'un signal faux). Marqué
    //                                      estimated_fallback / confidence low.
    //   - air / land / non renseigné    → ventilation par poids (inchangé)
    const isMaritime = ship.transport_mode === 'sea';
    const totalParcelVolume = parcels.reduce((s, p) => s + (Number(p.parcel_volume_cm3) || 0), 0);
    const useVolumeForFreight = isMaritime && totalParcelVolume > 0;
    const useEqualSplitForFreight = isMaritime && !useVolumeForFreight;

    const freightAllocationMethod = useVolumeForFreight
      ? 'by_volume'
      : useEqualSplitForFreight
        ? 'estimated_fallback'
        : 'by_weight';
    const freightConfidence = useEqualSplitForFreight ? 'low' : 'high';

    const freightWeights = parcels.map(p => ({
      id: p.parcel_id,
      order_id: p.order_id,
      weight: useVolumeForFreight
        ? Number(p.parcel_volume_cm3) || 0
        : useEqualSplitForFreight
          ? 1                                   // répartition égale, pas de poids
          : Number(p.parcel_weight_kg) || 0,
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
           p.volume_cm3,
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

      // Eclater freight par volume si dispo (maritime), sinon répartition égale
      // par quantité pour le maritime (jamais par poids), poids sinon (non-maritime).
      const itemsVolumeTotal = items.reduce(
        (s, it) => s + (Number(it.volume_cm3) || 0) * (Number(it.parcel_qty) || 1), 0
      );
      const useVolumeForItems = useVolumeForFreight && itemsVolumeTotal > 0;
      const useEqualSplitForItems = isMaritime && !useVolumeForItems;
      const freightWeightsItems = items.map(it => ({
        id: it.order_item_id,
        weight: useVolumeForItems
          ? (Number(it.volume_cm3) || 0) * (Number(it.parcel_qty) || 1)
          : useEqualSplitForItems
            ? (Number(it.parcel_qty) || 1)      // pas de poids, quantité comme neutre
            : (Number(it.weight_kg) || 0) * (Number(it.parcel_qty) || 1),
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
             VALUES ($1,$2,$3,$4,'freight',$5,$6,'customs_shipments',TRUE,$7)`,
            [parcel.order_id, it.order_item_id, parcel.parcel_id, shipmentId, fShare, freightAllocationMethod, freightConfidence]
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
      freight_allocation_method: freightAllocationMethod,
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
 *   - relay (commission relais) : per_item, autorité cost_components
 *     (`commission_relais_kmf`), avec finance_config.standard en fallback legacy.
 *
 * LOT 1A-3 : aucune sélection implicite showroom. Tant qu'aucun contexte runtime
 * ne porte explicitement ce type de relais, le composant global est la vérité.
 * is_actual=TRUE car la commission est engagée de façon prévisible.
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

    // LOT 1A-3 — une priorité runtime explicite :
    //   1. cost_components.commission_relais_kmf (autorité OWNED)
    //   2. finance_config.commission_relais_standard_kmf (fallback legacy)
    //   3. 500 KMF (fallback CURRENT)
    // commission_relais_pct/showroom ne sont jamais devinés ici.
    const relayCfgRes = await client.query(`
      SELECT
        (SELECT default_value
           FROM cost_components
          WHERE key = 'commission_relais_kmf'
            AND is_active = TRUE
            AND is_exceptional = FALSE
            AND (active_from IS NULL OR active_from <= CURRENT_DATE)
            AND (active_until IS NULL OR active_until >= CURRENT_DATE)
          ORDER BY display_order, key
          LIMIT 1) AS component_value,
        (SELECT commission_relais_standard_kmf
           FROM finance_config
          WHERE id = 1) AS legacy_standard_value
    `);
    const relayCommission = resolveRelayCommissionCurrent(relayCfgRes.rows[0] || {});
    const commissionPerItem = relayCommission.amount_kmf;

    let allocations = 0;

    // Allocation 'relay' : per_item × commission
    for (const it of items) {
      const amount = commissionPerItem * (Number(it.quantity) || 1);
      await client.query(
        `INSERT INTO order_item_real_cost_allocations
           (order_id, order_item_id, parcel_id,
            cost_type, amount_kmf, allocation_method,
            source, is_actual, confidence)
         VALUES ($1,$2,$3,'relay',$4,'per_item',$5,TRUE,'medium')`,
        [parcel.order_id, it.order_item_id, parcelId, amount, relayCommission.source]
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
      relay_commission_kmf: commissionPerItem,
      relay_commission_source: relayCommission.source,
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


module.exports = {
  allocateShipmentRealCosts,
  allocateParcelRealCosts,
  allocateMonthlyFixedCosts,
  allocateProductPurchaseCosts,
};
