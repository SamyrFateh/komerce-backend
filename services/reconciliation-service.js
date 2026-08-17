/**
 * @komerce-arch
 * @role          reconciliation-service
 * @domain        payment
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/incident-write-service.js, utils/logger.js, utils/parcels.js
 * @used-by       none
 * @db-read       incidents, order_items, orders, parcel_items, parcels, scan_events
 * @db-write-via:incident-write-service incidents
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */


'use strict';
/**
 * reconciliation-service.js — Moteur de réconciliation Komerce
 * 
 * Vérifie la cohérence entre :
 *   1. Commande ↔ Order Items (quantités commandées)
 *   2. Order Items ↔ Parcel Items (allocation correcte)
 *   3. Parcels ↔ Scan Events (statuts cohérents)
 *   4. Quantités cascadées (chaîne complète)
 *
 * Toute incohérence → incident créé automatiquement
 * 
 * Peut tourner :
 *   - À la demande (reconcileOrder, reconcileParcel)
 *   - En batch (reconcileAll — via cron)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  PATCH P0.2b (15/04/2026):                                         ║
 * ║  - CHECK 4: Plus d'auto-correction directe (UPDATE orders SET...)   ║
 * ║  - Remplacé par LOG WARNING + incident (read-only + alerting)       ║
 * ║  - La réconciliation est désormais OBSERVATRICE, pas CORRECTRICE    ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  PATCH P0.3 (normalisation canonique):                             ║
 * ║  - Suppression de computeOrderStatusFromParcels() locale           ║
 * ║  - CHECK 4 branchée sur computeOrderStatus() depuis utils/parcels   ║
 * ║  - Source de vérité unique pour le calcul agrégé colis → commande  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const pool = require('../db');
const { createReconciliationIncident } = require('./incident-write-service');
// ── CANONIQUE: source de vérité unique pour le calcul agrégé colis → commande ──
const { computeOrderStatus } = require('../utils/parcels');
const log = require('../utils/logger').child({ module: 'reconciliation-service' });

// ════════════════════════════════════════════════════════════════
// RÉCONCILIATION D'UNE COMMANDE
// ════════════════════════════════════════════════════════════════

async function reconcileOrder(orderId) {
  const client = await pool.connect();
  const issues = [];

  try {
    await client.query('BEGIN');

    // 1. Charger la commande
    const { rows: [order] } = await client.query(
      `SELECT * FROM orders WHERE id = $1`, [orderId]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Commande introuvable', issues: [] };
    }

    // 2. Charger les order_items
    const { rows: orderItems } = await client.query(
      `SELECT * FROM order_items WHERE order_id = $1`, [orderId]
    );

    // 3. Charger les colis actifs
    const { rows: parcels } = await client.query(
      `SELECT * FROM parcels WHERE order_id = $1 AND status != 'cancelled'`, [orderId]
    );

    // 4. Charger les parcel_items
    const parcelIds = parcels.map(p => p.id);
    let parcelItems = [];
    if (parcelIds.length > 0) {
      const { rows } = await client.query(
        `SELECT * FROM parcel_items WHERE parcel_id = ANY($1)`, [parcelIds]
      );
      parcelItems = rows;
    }

    // ── CHECK 1: Allocation vs Commandé ──
    for (const oi of orderItems) {
      const allocated = parcelItems
        .filter(pi => pi.order_item_id === oi.id)
        .reduce((sum, pi) => sum + (pi.qty_allocated || 0), 0);
      
      const ordered = oi.qty_ordered || oi.quantity || 1;

      if (allocated > ordered) {
        const issue = {
          type: 'over_allocation',
          severity: 'high',
          order_item_id: oi.id,
          message: `Sur-allocation: ${allocated} alloué(s) pour ${ordered} commandé(s)`,
          details: { ordered, allocated, product_id: oi.product_id }
        };
        issues.push(issue);
        await createReconciliationIncident(client, orderId, null, oi.id, issue);
      }
    }

    // ── CHECK 2: Quantités cascadées cohérentes (par parcel_item) ──
    for (const pi of parcelItems) {
      const chain = [
        { field: 'qty_allocated', value: pi.qty_allocated || 0 },
        { field: 'qty_packed', value: pi.qty_packed || 0 },
        { field: 'qty_shipped', value: pi.qty_shipped || 0 },
        { field: 'qty_received', value: pi.qty_received || 0 },
        { field: 'qty_collected', value: pi.qty_collected || 0 }
      ];

      for (let i = 1; i < chain.length; i++) {
        if (chain[i].value > chain[i - 1].value) {
          const issue = {
            type: 'quantity_chain_break',
            severity: 'high',
            parcel_item_id: pi.id,
            message: `${chain[i].field} (${chain[i].value}) > ${chain[i - 1].field} (${chain[i - 1].value})`,
            details: { parcel_id: pi.parcel_id, chain: chain.map(c => ({ [c.field]: c.value })) }
          };
          issues.push(issue);
          await createReconciliationIncident(client, orderId, pi.parcel_id, pi.order_item_id, issue);
        }
      }
    }

    // ── CHECK 3: Statut colis cohérent avec dernier scan ──
    for (const parcel of parcels) {
      const { rows: [lastScan] } = await client.query(
        `SELECT event_type, created_at FROM scan_events 
         WHERE parcel_id = $1 AND status = 'applied'
         ORDER BY created_at DESC LIMIT 1`,
        [parcel.id]
      );

      if (lastScan) {
        const expectedStatuses = getExpectedStatuses(lastScan.event_type);
        if (expectedStatuses && !expectedStatuses.includes(parcel.status)) {
          const issue = {
            type: 'status_scan_mismatch',
            severity: 'medium',
            parcel_id: parcel.id,
            message: `Colis ${parcel.reference}: statut=${parcel.status} mais dernier scan=${lastScan.event_type}`,
            details: { 
              parcel_status: parcel.status, 
              last_scan: lastScan.event_type,
              expected_statuses: expectedStatuses 
            }
          };
          issues.push(issue);
          await createReconciliationIncident(client, orderId, parcel.id, null, issue);
        }
      }
    }

    // ── CHECK 4: Statut commande cohérent avec colis ──
    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║  PATCH P0.2b: Plus d'auto-correction directe.                      ║
    // ║  On LOG le drift + on crée un incident, mais on NE MODIFIE PAS     ║
    // ║  le statut directement. La correction doit passer par la state     ║
    // ║  machine (transitionOrderStatus) si nécessaire.                    ║
    // ╠══════════════════════════════════════════════════════════════════════╣
    // ║  PATCH P0.3: Branché sur computeOrderStatus() (utils/parcels.js).  ║
    // ║  Plus de logique locale — source de vérité unique.                 ║
    // ║  Note: `parcels` ici est déjà filtré (status != 'cancelled'),      ║
    // ║  donc les colis actifs = tous → le résultat est identique.         ║
    // ╚══════════════════════════════════════════════════════════════════════╝
    const computedStatus = computeOrderStatus(parcels);
    if (computedStatus && order.status !== computedStatus) {
      const issue = {
        type: 'order_status_drift',
        severity: 'medium',
        message: `Statut commande=${order.status} mais devrait être ${computedStatus} d'après les colis`,
        details: {
          current_status: order.status,
          computed_status: computedStatus,
          parcel_statuses: parcels.map(p => ({ ref: p.reference, status: p.status }))
        }
      };
      issues.push(issue);

      // PATCH P0.2b: LOG WARNING au lieu de UPDATE direct
      // L'auto-correction est désactivée — la réconciliation est observatrice.
      // Un opérateur ou un processus automatisé doit corriger via la state machine.
      log.warn(`[RECONCILIATION] ⚠️ Status drift détecté: order=${orderId} current=${order.status} computed=${computedStatus} — PAS d'auto-correction (P0.2b)`);
      
      await createReconciliationIncident(client, orderId, null, null, issue);
      issue.auto_corrected = false;
      issue.logged_only = true;
    }

    // ── CHECK 5: Colis bloqués (aucun scan depuis X jours) ──
    for (const parcel of parcels) {
      if (['collected', 'cancelled'].includes(parcel.status)) continue;

      const { rows: [lastActivity] } = await client.query(
        `SELECT MAX(created_at) AS last_at FROM scan_events 
         WHERE parcel_id = $1 AND status = 'applied'`,
        [parcel.id]
      );

      const lastAt = lastActivity?.last_at || parcel.created_at;
      const daysSince = Math.floor((Date.now() - new Date(lastAt).getTime()) / (86400000));

      if (daysSince >= 7) {
        const issue = {
          type: 'stale_parcel',
          severity: daysSince >= 14 ? 'high' : 'medium',
          parcel_id: parcel.id,
          message: `Colis ${parcel.reference} sans activité depuis ${daysSince} jours (statut: ${parcel.status})`,
          details: { last_activity: lastAt, days_since: daysSince }
        };
        issues.push(issue);
        await createReconciliationIncident(client, orderId, parcel.id, null, issue);
      }
    }

    // ── CHECK 6: Order items orphelins (non alloués à aucun colis) ──
    for (const oi of orderItems) {
      const allocated = parcelItems
        .filter(pi => pi.order_item_id === oi.id)
        .reduce((sum, pi) => sum + (pi.qty_allocated || 0), 0);
      
      const ordered = oi.qty_ordered || oi.quantity || 1;

      if (allocated === 0 && parcels.length > 0) {
        const issue = {
          type: 'unallocated_item',
          severity: 'medium',
          order_item_id: oi.id,
          message: `Article non alloué à aucun colis (${ordered} commandé(s))`,
          details: { ordered, product_id: oi.product_id }
        };
        issues.push(issue);
        await createReconciliationIncident(client, orderId, null, oi.id, issue);
      } else if (allocated < ordered) {
        const issue = {
          type: 'partial_allocation',
          severity: 'low',
          order_item_id: oi.id,
          message: `Allocation partielle: ${allocated}/${ordered}`,
          details: { ordered, allocated, remaining: ordered - allocated }
        };
        issues.push(issue);
        // Pas d'incident pour une allocation partielle — c'est normal (backorder)
      }
    }

    await client.query('COMMIT');

    return {
      ok: issues.length === 0,
      order_id: orderId,
      order_ref: order.reference,
      total_checks: 6,
      issues_found: issues.length,
      issues,
      auto_corrections: issues.filter(i => i.auto_corrected).length
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════════
// RÉCONCILIATION D'UN COLIS
// ════════════════════════════════════════════════════════════════

async function reconcileParcel(parcelId) {
  const { rows: [parcel] } = await pool.query(
    `SELECT * FROM parcels WHERE id = $1`, [parcelId]
  );
  if (!parcel) return { ok: false, error: 'Colis introuvable' };
  if (!parcel.order_id) return { ok: true, issues: [], message: 'Colis sans commande' };

  return reconcileOrder(parcel.order_id);
}

// ════════════════════════════════════════════════════════════════
// RÉCONCILIATION EN BATCH
// ════════════════════════════════════════════════════════════════

async function reconcileAll(options = {}) {
  const { limit = 100, onlyActive = true } = options;

  // Trouver les commandes à vérifier
  let query = `
    SELECT DISTINCT o.id 
    FROM orders o 
    JOIN parcels p ON p.order_id = o.id
  `;
  if (onlyActive) {
    query += ` WHERE o.status NOT IN ('collected', 'cancelled', 'refunded')`;
  }
  query += ` ORDER BY o.id LIMIT $1`;

  const { rows: orders } = await pool.query(query, [limit]);
  
  const results = {
    total: orders.length,
    ok: 0,
    issues: 0,
    errors: 0,
    details: []
  };

  for (const { id } of orders) {
    try {
      const result = await reconcileOrder(id);
      if (result.ok) {
        results.ok++;
      } else {
        results.issues++;
      }
      results.details.push(result);
    } catch (err) {
      results.errors++;
      results.details.push({
        order_id: id,
        ok: false,
        error: err.message
      });
    }
  }

  return results;
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD DATA — Compteurs réconciliation
// ════════════════════════════════════════════════════════════════

async function getReconciliationStats() {
  const { rows: [stats] } = await pool.query(`
    SELECT
      -- Incidents ouverts
      COUNT(*) FILTER (WHERE status = 'open') AS open_incidents,
      COUNT(*) FILTER (WHERE status = 'investigating') AS investigating_incidents,
      COUNT(*) FILTER (WHERE severity = 'critical' AND status IN ('open', 'investigating')) AS critical_incidents,
      COUNT(*) FILTER (WHERE severity = 'high' AND status IN ('open', 'investigating')) AS high_incidents,
      -- Par type
      COUNT(*) FILTER (WHERE incident_type = 'missing_item' AND status = 'open') AS missing_items,
      COUNT(*) FILTER (WHERE incident_type = 'unexpected_item' AND status = 'open') AS unexpected_items,
      COUNT(*) FILTER (WHERE incident_type = 'weight_mismatch' AND status = 'open') AS weight_mismatches,
      COUNT(*) FILTER (WHERE incident_type = 'quantity_mismatch' AND status = 'open') AS quantity_mismatches,
      COUNT(*) FILTER (WHERE incident_type = 'scan_anomaly' AND status = 'open') AS scan_anomalies,
      COUNT(*) FILTER (WHERE incident_type = 'reconciliation_error' AND status = 'open') AS reconciliation_errors,
      COUNT(*) FILTER (WHERE incident_type = 'delay' AND status = 'open') AS delays,
      -- Impact client
      COUNT(*) FILTER (WHERE client_impact != 'none' AND status = 'open') AS client_impacting,
      COUNT(*) FILTER (WHERE client_impact = 'blocked' AND status = 'open') AS client_blocked,
      -- Résolutions récentes (24h)
      COUNT(*) FILTER (WHERE resolved_at > NOW() - INTERVAL '24 hours') AS resolved_24h
    FROM incidents
  `);

  // Colis stale (sans scan depuis 7+ jours, pas terminé)
  const { rows: [stale] } = await pool.query(`
    SELECT COUNT(*) AS stale_parcels
    FROM parcels p
    WHERE p.status NOT IN ('collected', 'cancelled')
    AND NOT EXISTS (
      SELECT 1 FROM scan_events se 
      WHERE se.parcel_id = p.id AND se.status = 'applied'
      AND se.created_at > NOW() - INTERVAL '7 days'
    )
    AND p.created_at < NOW() - INTERVAL '7 days'
  `);

  return { ...stats, stale_parcels: stale?.stale_parcels || 0 };
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function getExpectedStatuses(eventType) {
  const map = {
    preparation_started: ['preparation'],
    packed: ['preparation'],
    sealed: ['preparation'],
    ready_to_ship: ['preparation'],
    shipped: ['shipped'],
    transit_confirmed: ['in_transit', 'shipped'],
    relais_received: ['available', 'arrived'],
    customer_collected: ['collected'],
    pickup_failed: ['available']
  };
  return map[eventType] || null;
}

module.exports = {
  reconcileOrder,
  reconcileParcel,
  reconcileAll,
  getReconciliationStats
};
