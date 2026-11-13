/**
 * @komerce-arch
 * @role          supplier-shortage-refund-trigger
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        purchase_line, order_item, missing_quantity, actor
 * @outputs       supplier_shortage_incident, supplier_shortage_refund_required_alert
 * @depends       services/incident-write-service.js, utils/alerts.js
 * @used-by       services/purchasing-engagement-service.js, services/purchasing-completion-service.js
 * @db-read       order_items, purchase_lines, incidents, alerts
 * @db-write      incidents, alerts
 * @db-txn        caller_owned_queryable
 * @doctrine      lifecycle_owner_boundary, incident_proof_required, no_automatic_refund
 * @impact-areas  purchasing, orders, refunds
 * @version       2026-11
 */
'use strict';

const { createSupplierShortageIncident } = require('./incident-write-service');
const { createAlert } = require('../utils/alerts');

/**
 * Décision propriétaire (H1, #3998) : la clôture Hub d'une ligne sans reliquat crée automatiquement l'incident
 * « rupture fournisseur » par le writer canonique, et une alerte qui y pointe. L'admin lance ensuite la réservation
 * puis l'exécution du remboursement de ligne existant (E7) : aucun remboursement automatique.
 * Idempotent par ligne d'achat (incident) et par incident (alerte).
 */
async function openSupplierShortage(executor, { purchaseLineId, orderItemId, missingQuantity, receivedQuantity = null, reason = null, actorId = null }) {
  const { rows: [item] } = await executor.query('SELECT order_id FROM order_items WHERE id = $1', [orderItemId]);
  if (!item) return { incident: null, created: false, alert_created: false };
  const { incident, created } = await createSupplierShortageIncident(executor, {
    purchaseLineId, orderId: item.order_id, orderItemId, missingQuantity, receivedQuantity, reason, actorId,
  });
  const { rows: openAlert } = await executor.query(
    "SELECT 1 FROM alerts WHERE type = 'supplier_shortage_refund_required' AND entity_id = $1 AND resolved_at IS NULL LIMIT 1",
    [incident.id]
  );
  let alertCreated = false;
  if (!openAlert.length) {
    await createAlert(executor, {
      type: 'supplier_shortage_refund_required', entityType: 'incident', entityId: incident.id, severity: 'high',
      title: `Rupture fournisseur : ${missingQuantity} unité(s) à rembourser — commande ${item.order_id}`,
      description: `incident_id=${incident.id} order_id=${item.order_id} order_item_id=${orderItemId} manquant=${missingQuantity} ; `
        + `admin : POST /api/admin/orders/${item.order_id}/items/${orderItemId}/refund-reservations (incident_id, quantity, operation_key, reason) `
        + 'puis /execute. Aucun remboursement automatique.',
    });
    alertCreated = true;
  }
  return { incident, created, alert_created: alertCreated };
}

module.exports = { openSupplierShortage };
