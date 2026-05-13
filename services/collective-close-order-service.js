'use strict';

const db = require('../db');
const engine = require('./collective-workspace-engine');
const stockReservations = require('./collective-stock-reservation-service');

function asInt(v) {
  return parseInt(v, 10) || 0;
}

async function createOrderFromReadyWorkspace(creatorToken, actor = {}) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    await stockReservations.ensureTable(client);

    const wsPublic = await engine.getWorkspaceByCreatorToken(creatorToken);
    if (!wsPublic) throw new Error('workspace_not_found');

    const ws = (await client.query(
      'SELECT * FROM collective_workspaces WHERE id = $1 FOR UPDATE',
      [wsPublic.id]
    )).rows[0];

    if (!ws) throw new Error('workspace_not_found');
    if (ws.order_id) {
      await client.query('COMMIT');
      return { ok: true, idempotent: true, order_id: ws.order_id };
    }
    if (ws.status !== 'ready_to_order') throw new Error('workspace_not_ready_to_order');
    if (!ws.relais_id) throw new Error('missing_relais_id');

    const activeReservations = (await client.query(
      `SELECT product_id, SUM(quantity)::int AS quantity
         FROM collective_stock_reservations
        WHERE workspace_id = $1
          AND status = 'reserved'
          AND reserved_until > NOW()
        GROUP BY product_id`,
      [ws.id]
    )).rows;

    if (!activeReservations.length) throw new Error('stock_reservation_missing_or_expired');

    const session = (await client.query(
      `SELECT * FROM collective_payment_sessions
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [ws.id]
    )).rows[0];

    if (!session) throw new Error('session_not_found');
    if (asInt(session.amount_secured_kmf) < asInt(session.total_to_pay_kmf)) {
      throw new Error('session_not_funded');
    }

    const items = (await client.query(
      'SELECT * FROM collective_workspace_items WHERE workspace_id = $1 ORDER BY created_at',
      [ws.id]
    )).rows;

    if (!items.length) throw new Error('no_items');

    const reference = 'KOM-COL-' + String(ws.id).replace(/-/g, '').slice(0, 8).toUpperCase();
    const total = asInt(session.total_to_pay_kmf);
    const trackingPhone = ws.creator_phone || ws.recipient_phone || null;

    const order = (await client.query(
      `INSERT INTO orders (
         reference, user_id, recipient_id, relais_id,
         total_kmf, payment_mode, payment_status, status,
         tracking_phone, notes
       ) VALUES (
         $1, $2, NULL, $3,
         $4, 'collective', 'paid', 'confirmed',
         $5, $6
       )
       RETURNING id, reference`,
      [
        reference,
        ws.creator_user_id || null,
        ws.relais_id,
        total,
        trackingPhone,
        'Panier collectif clôturé explicitement: ' + ws.event_name,
      ]
    )).rows[0];

    for (const item of items) {
      if (!item.product_id) continue;
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price_kmf) VALUES ($1, $2, $3, $4)',
        [order.id, item.product_id, item.quantity, item.price_snapshot_kmf || 0]
      );
    }

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'confirmed', $2, $3)`,
      [order.id, 'Commande créée après clôture du panier collectif', ws.creator_user_id || null]
    );

    const stockRows = (await client.query(
      `SELECT oi.product_id, oi.quantity, p.stock, p.name
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1 AND p.stock IS NOT NULL
        FOR UPDATE OF p`,
      [order.id]
    )).rows;

    const reservationByProduct = new Map(activeReservations.map(r => [String(r.product_id), asInt(r.quantity)]));
    const missingReserved = stockRows.filter(row => reservationByProduct.get(String(row.product_id)) < asInt(row.quantity));
    const insufficient = stockRows.filter(row => asInt(row.stock) < asInt(row.quantity));
    const stockBlocked = missingReserved.length > 0 || insufficient.length > 0;

    if (stockBlocked) {
      await client.query(
        'UPDATE orders SET notes = COALESCE(notes, \'\') || $1 WHERE id = $2',
        ['\n[INCIDENT collective_close_stock_blocked_or_reservation_missing]', order.id]
      );
    } else {
      for (const row of stockRows) {
        await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [row.quantity, row.product_id]);
      }
      await stockReservations.consumeForWorkspace(ws.id, client);
    }

    await client.query(
      `UPDATE collective_workspaces
          SET status = 'order_created', order_id = $1
        WHERE id = $2 AND order_id IS NULL AND status = 'ready_to_order'`,
      [order.id, ws.id]
    );

    await client.query(
      `UPDATE collective_payment_sessions
          SET status = 'paid', ended_at = COALESCE(ended_at, NOW())
        WHERE id = $1`,
      [session.id]
    );

    await engine.logEvent(client, ws.id, 'order_created_after_close', actor.role || 'creator', actor.id || null, {
      order_id: order.id,
      order_reference: order.reference,
      session_id: session.id,
      stock_blocked: stockBlocked,
      reservations_checked: activeReservations.length,
    });

    await client.query('COMMIT');

    return {
      ok: true,
      order_id: order.id,
      order_reference: order.reference,
      stock_blocked: stockBlocked,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createOrderFromReadyWorkspace };
