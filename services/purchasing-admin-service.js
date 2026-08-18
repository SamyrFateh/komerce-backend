/**
 * @komerce-arch
 * @role          dashboard-purchasing-admin-service
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js
 * @used-by       routes/purchasing.js
 * @db-read       purchase_orders, suppliers
 * @db-write      orders, product_suppliers, purchase_orders, suppliers
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * purchasing-admin-service.js
 * ════════════════════════════
 * Mutations admin du domaine purchasing : gestion fournisseurs et purchase orders.
 *
 * Fonctions exportées :
 *   deleteSupplier(id, forceDelete)         → soft-delete fournisseur + POs + mappings
 *   confirmPurchaseOrder(poId, orderId, data) → UPDATE purchase_order → confirmed
 *   cancelPurchaseOrder(poId, forceDelete)   → UPDATE purchase_order → cancelled
 *
 * Chaque fonction gère sa propre transaction.
 */

const db  = require('../db');
const { setSupplierSnapshot } = require('./order-mutation-service');
const log = require('../utils/logger').child({ module: 'purchasing-admin-service' });

// ─── Fournisseurs ──────────────────────────────────────────────────────────────

/**
 * Soft-delete un fournisseur, ses mappings et ses POs non confirmées.
 *
 * @param {string} id           - UUID du fournisseur
 * @param {boolean} forceDelete - true = forcer même sur fournisseur [TEST] avec POs confirmées
 * @returns {{ deleted: true, id, name, mappings_deleted, pos_cancelled }}
 * @throws {{ status, error }} si non trouvé (404) ou POs confirmées sans force (409)
 */
async function deleteSupplier(id, forceDelete = false) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: [sup] } = await client.query(
      'SELECT id, name FROM suppliers WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!sup) {
      await client.query('ROLLBACK');
      const err = new Error('Fournisseur non trouvé');
      err.status = 404;
      throw err;
    }

    const isTestSupplier = sup.name.includes('[TEST]');

    const { rows: confirmedPOs } = await client.query(
      `SELECT id FROM purchase_orders WHERE supplier_id = $1 AND status = 'confirmed' LIMIT 1`,
      [id]
    );
    if (confirmedPOs.length && !(isTestSupplier && forceDelete)) {
      await client.query('ROLLBACK');
      const err = new Error("Impossible de supprimer ce fournisseur : des commandes confirmées existent. Annulez-les d'abord.");
      err.status = 409;
      throw err;
    }

    const posQuery = (isTestSupplier && forceDelete)
      ? `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE supplier_id = $1 AND status != 'cancelled'`
      : `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE supplier_id = $1 AND status IN ('pending', 'notified')`;
    const { rowCount: posCancelled } = await client.query(posQuery, [id]);

    const { rowCount: mappingsDeleted } = await client.query(
      'UPDATE product_suppliers SET deleted_at = NOW() WHERE supplier_id = $1 AND deleted_at IS NULL',
      [id]
    );

    await client.query('UPDATE suppliers SET deleted_at = NOW() WHERE id = $1', [id]);
    await client.query('COMMIT');

    log.info(`[PURCHASING] Fournisseur désactivé (soft-delete) : ${sup.name} (${id}) — ${mappingsDeleted} mapping(s), ${posCancelled} PO(s) annulée(s)`);

    return { deleted: true, id, name: sup.name, mappings_deleted: mappingsDeleted, pos_cancelled: posCancelled };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Purchase orders ───────────────────────────────────────────────────────────

/**
 * Confirme une purchase order (pending/notified → confirmed).
 *
 * @param {string} poId     - UUID de la PO
 * @param {string} orderId  - UUID de la commande parente (vérification appartenance)
 * @param {{ supplier_order_id?, unit_price_aed?, tracking_url?, tracking_number?, notes? }} data
 * @returns {{ success: true, purchase_order: object }}
 * @throws {{ status, error }} 404 si non trouvée, 409 si statut incompatible
 */
async function confirmPurchaseOrder(poId, orderId, data = {}) {
  const { supplier_order_id, unit_price_aed, tracking_url, tracking_number, notes } = data;

  const CONFIRMABLE_STATUSES = ['pending', 'notified'];

  const { rows: [currentPo] } = await db.query(
    'SELECT id, status FROM purchase_orders WHERE id = $1 AND order_id = $2',
    [poId, orderId]
  );
  if (!currentPo) {
    const err = new Error('Purchase order introuvable');
    err.status = 404;
    throw err;
  }
  if (!CONFIRMABLE_STATUSES.includes(currentPo.status)) {
    const err = new Error(`Impossible de confirmer une PO au statut "${currentPo.status}". Statuts autorisés : pending, notified.`);
    err.status = 409;
    err.current_status = currentPo.status;
    throw err;
  }

  const { rows: [po] } = await db.query(
    `UPDATE purchase_orders
      SET
        status            = 'confirmed',
        supplier_order_id = COALESCE($1, supplier_order_id),
        unit_price_aed    = COALESCE($2, unit_price_aed),
        tracking_url      = COALESCE($3, tracking_url),
        tracking_number   = COALESCE($4, tracking_number),
        notes             = COALESCE($5, notes),
        ordered_at        = COALESCE(ordered_at, NOW()),
        confirmed_at      = NOW(),
        updated_at        = NOW()
      WHERE id = $6 AND order_id = $7
      RETURNING *`,
    [supplier_order_id, unit_price_aed, tracking_url, tracking_number, notes, poId, orderId]
  );
  if (!po) {
    const err = new Error('Purchase order introuvable');
    err.status = 404;
    throw err;
  }

  // Dénormalisation : mettre à jour le nom fournisseur sur la commande
  const { rows: [sup] } = await db.query('SELECT name FROM suppliers WHERE id = $1', [po.supplier_id]);
  if (sup) {
    await setSupplierSnapshot(db, {
      orderId,
      supplierName: sup.name,
      supplierInvoiceUrl: tracking_url || null,
    });
  }

  return { success: true, purchase_order: po };
}

/**
 * Annule une purchase order.
 * Bloque les statuts de réception sauf si forceDelete.
 *
 * @param {string} poId         - UUID de la PO
 * @param {boolean} forceDelete - true = forcer même sur statuts reçus
 * @returns {{ cancelled: true, po_id, previous_status }}
 * @throws {{ status, error }} 404 si non trouvée, 409 si statut terminal sans force
 */
async function cancelPurchaseOrder(poId, forceDelete = false) {
  const TERMINAL_RECEIVED = ['received', 'partially_received', 'hub_received'];

  const { rows: [po] } = await db.query(
    'SELECT * FROM purchase_orders WHERE id = $1',
    [poId]
  );
  if (!po) {
    const err = new Error('Purchase order introuvable');
    err.status = 404;
    throw err;
  }

  if (TERMINAL_RECEIVED.includes(po.status) && !forceDelete) {
    const err = new Error(`Impossible d'annuler une PO au statut "${po.status}". Utilisez x-force-delete si l'annulation est intentionnelle.`);
    err.status = 409;
    err.current_status = po.status;
    throw err;
  }

  await db.query(
    `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [poId]
  );

  log.info(`[PURCHASING] PO annulée : ${poId} (était: ${po.status})`);
  return { cancelled: true, po_id: poId, previous_status: po.status };
}

module.exports = {
  deleteSupplier,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
};
