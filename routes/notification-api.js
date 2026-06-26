/**
 * @komerce-arch
 * @role          notification-notification-api
 * @domain        notification
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       notification_log
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  notification
 * @version       2026-06
 */


'use strict';
/**
 * Notification API — View notification logs
 * GET /api/v2/notifications       → List recent notifications
 * GET /api/v2/notifications/stats → Stats by channel/event
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET / — Recent notifications
router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { parcel_ref, order_ref, channel, event, limit: lim } = req.query;
    const maxRows = Math.min(Number(lim) || 50, 200);

    let where = [];
    let params = [];
    let idx = 1;

    if (parcel_ref) { where.push(`parcel_ref = $${idx++}`); params.push(parcel_ref); }
    if (order_ref) { where.push(`order_ref = $${idx++}`); params.push(order_ref); }
    if (channel) { where.push(`channel = $${idx++}`); params.push(channel); }
    if (event) { where.push(`event = $${idx++}`); params.push(event); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT id, parcel_ref, order_ref, channel, event, recipient, status, detail, created_at
      FROM notification_log
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${maxRows}
    `, params);

    res.json({ count: rows.length, notifications: rows });
  } catch (err) {
    // Table might not exist
    if (err.code === '42P01') {
      return res.json({ count: 0, notifications: [], warning: 'Table notification_log not yet created' });
    }
    next(err);
  }
});

// GET /stats — Stats by channel
router.get('/stats', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: byChannel } = await db.query(`
      SELECT channel, status, COUNT(*)::int AS count
      FROM notification_log
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY channel, status
      ORDER BY channel, status
    `);

    const { rows: byEvent } = await db.query(`
      SELECT event, COUNT(*)::int AS count
      FROM notification_log
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY event
      ORDER BY count DESC
    `);

    const { rows: [totals] } = await db.query(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'link_generated')::int AS links,
        COUNT(*) FILTER (WHERE channel = 'whatsapp')::int AS whatsapp,
        COUNT(*) FILTER (WHERE channel = 'email')::int AS email,
        COUNT(*) FILTER (WHERE channel = 'sms')::int AS sms
      FROM notification_log
      WHERE created_at > NOW() - INTERVAL '30 days'
    `);

    res.json({ totals, by_channel: byChannel, by_event: byEvent });
  } catch (err) {
    if (err.code === '42P01') {
      return res.json({ totals: {}, by_channel: [], by_event: [], warning: 'Table not yet created' });
    }
    next(err);
  }
});

module.exports = router;
