/**
 * @komerce-arch
 * @role          demo-order-flow-trace
 * @domain        dashboard
 * @layer         route
 * @criticality   medium
 * @inputs        authenticated_admin, order_id
 * @outputs       order_status_history, client_notifications, invoices, transaction_documents
 * @depends       db.js, middleware/auth.js, services/client-notification-service.js
 * @used-by       public/dashboards/canonical/js/demo-order-flow.js
 * @db-read       orders, users, relais, markets, order_status_history, client_notifications, invoices, transaction_documents
 * @db-write-via  client-notification-service
 * @db-txn        none
 * @doctrine      demo_reads_business_truth
 * @impact-areas  dashboard, orders, notifications, documents
 * @version       2026-08
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const clientNotifications = require('../../services/client-notification-service');

const guard = [authenticate, requireRole(['admin'])];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/demo/orders/:orderId/timeline', ...guard, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    if (!UUID.test(orderId)) {
      return res.status(400).json({ error: 'orderId invalide — UUID attendu' });
    }

    const { rows: [order] } = await db.query(
      `SELECT o.id, o.reference, o.user_id, o.market_id, o.status,
              o.payment_status, o.payment_mode, o.total_kmf, o.created_at,
              u.full_name AS customer_name,
              r.name AS relais_name,
              m.code AS market_code
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN relais r ON r.id = o.relais_id
         LEFT JOIN markets m ON m.id = o.market_id
        WHERE o.id = $1::uuid`,
      [orderId]
    );

    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    if (order.user_id) {
      await clientNotifications.reconcileOrderMilestonesForUser(order.user_id);
    }

    const [historyResult, notificationsResult, invoicesResult, documentsResult] = await Promise.all([
      db.query(
        `SELECT h.id, h.status, h.note, h.created_at,
                u.full_name AS changed_by_name
           FROM order_status_history h
           LEFT JOIN users u ON u.id = h.changed_by
          WHERE h.order_id = $1::uuid
          ORDER BY h.created_at DESC`,
        [orderId]
      ),
      db.query(
        `SELECT id, event_key, severity, title, message, status,
                created_at, acknowledged_at, resolved_at
           FROM client_notifications
          WHERE entity_type = 'order' AND entity_id = $1::uuid
          ORDER BY created_at DESC`,
        [orderId]
      ),
      db.query(
        `SELECT id, invoice_number, payment_status, delivered_via,
                delivered_at, created_at
           FROM invoices
          WHERE order_id = $1::uuid
          ORDER BY created_at DESC`,
        [orderId]
      ),
      db.query(
        `SELECT id, document_type, reference, status, file_url, issued_at
           FROM transaction_documents
          WHERE order_id = $1::uuid
          ORDER BY issued_at DESC`,
        [orderId]
      ),
    ]);

    return res.json({
      order,
      history: historyResult.rows,
      notifications: notificationsResult.rows,
      invoices: invoicesResult.rows,
      documents: documentsResult.rows,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
