'use strict';

/**
 * I-SWEEP-4B — Repair des réservations stock collectives.
 *
 * Cas couvert : workspace collectif avec order_id créée mais réservations
 * encore status='reserved'. Le repair les passe en consumed.
 */

const db = require('../db');
const stockReservations = require('./collective-stock-reservation-service');

async function repairCollectiveStockReservations({ dryRun = true, limit = 50, user }) {
  if (!user?.id || user.role !== 'admin') {
    return { status: 403, body: { error: 'Accès réservé admin' } };
  }

  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
  await stockReservations.ensureTable();

  const { rows: candidates } = await db.query(`
    SELECT cw.id AS workspace_id, cw.order_id, cw.status,
           COUNT(csr.id)::int AS reservations_count
    FROM collective_workspaces cw
    JOIN collective_stock_reservations csr ON csr.workspace_id = cw.id
    WHERE cw.order_id IS NOT NULL
      AND csr.status = 'reserved'
    GROUP BY cw.id, cw.order_id, cw.status
    ORDER BY cw.updated_at DESC NULLS LAST, cw.created_at DESC
    LIMIT $1
  `, [safeLimit]);

  if (dryRun) {
    return {
      status: 200,
      body: {
        dry_run: true,
        count: candidates.length,
        candidates,
      },
    };
  }

  const repaired = [];
  const failed = [];

  for (const c of candidates) {
    try {
      await stockReservations.consumeForWorkspace(c.workspace_id);
      repaired.push(c);
    } catch (err) {
      failed.push({ ...c, error: err.message });
      try {
        await db.query(
          `INSERT INTO alerts (level, source, message, payload)
           VALUES ('elevated', 'collective_stock_reservation_repair', $1, $2)`,
          [
            `Collective stock reservation repair failed for workspace ${c.workspace_id}`,
            JSON.stringify({ workspace_id: c.workspace_id, order_id: c.order_id, error: err.message }),
          ]
        );
      } catch (_) { /* non-bloquant */ }
    }
  }

  return {
    status: failed.length ? 207 : 200,
    body: {
      dry_run: false,
      scanned: candidates.length,
      repaired_count: repaired.length,
      failed_count: failed.length,
      repaired,
      failed,
    },
  };
}

module.exports = { repairCollectiveStockReservations };
