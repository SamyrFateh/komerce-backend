/**
 * @komerce-arch
 * @role          authenticated-client-notifications
 * @domain        notification
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, notification id
 * @outputs       essential open notifications, acknowledgement
 * @depends       middleware/auth.js, services/client-notification-service.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-notifications.js
 * @db-read       client_notifications, orders, relais
 * @db-write      client_notifications
 * @db-txn        none
 * @doctrine      DOCTRINE_NOTIFICATIONS_CLIENT_KOMERCE.md
 * @impact-areas  notifications, boutique, orders
 * @version       2026-08
 */

'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const notifications = require('../services/client-notification-service');

const router = express.Router();
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const rows = await notifications.listOpenForUser(req.user.id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ notifications: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/ack', async (req, res, next) => {
  try {
    if (!UUID_RX.test(req.params.id)) {
      return res.status(404).json({ error: 'Notification introuvable' });
    }
    const row = await notifications.acknowledgeForUser(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Notification introuvable' });
    return res.json({ notification: row });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
