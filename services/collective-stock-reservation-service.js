/**
 * @komerce-arch
 * @role          shared-cart-collective-stock-reservation-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/collective-workspace-engine.js
 * @used-by       services/repair-collective-stock-reservations.js
 * @db-read       collective_stock_reservations, collective_workspace_items, collective_workspaces, products
 * @db-write      collective_stock_reservations
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

const db = require('../db');
const engine = require('./collective-workspace-engine');

// ── DDL géré par migrations/075_hub_shares_collective_schema.sql ────────────

function asInt(v) {
  return parseInt(v, 10) || 0;
}

async function reserveForCreatorToken(creatorToken, opts = {}) {
  const ttlHours = Math.max(1, Math.min(168, parseInt(opts.ttl_hours, 10) || 72));
  const ws = await engine.getWorkspaceByCreatorToken(creatorToken);
  if (!ws) throw new Error('workspace_not_found');
  return reserveForWorkspace(ws.id, { ttl_hours: ttlHours });
}

async function reserveForWorkspace(workspaceId, opts = {}) {
  const ttlHours = Math.max(1, Math.min(168, parseInt(opts.ttl_hours, 10) || 72));
  const reservedUntil = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
  
    const ws = (await client.query('SELECT id, status FROM collective_workspaces WHERE id = $1 FOR UPDATE', [workspaceId])).rows[0];
    if (!ws) throw new Error('workspace_not_found');
    if (!['conception', 'payment_pending', 'ready_to_order'].includes(ws.status)) {
      throw new Error('workspace_not_reservable');
    }

    await client.query(
      `UPDATE collective_stock_reservations
          SET status = 'released', released_at = NOW()
        WHERE workspace_id = $1 AND status = 'reserved'`,
      [workspaceId]
    );

    const items = (await client.query(
      `SELECT product_id, SUM(quantity)::int AS quantity
         FROM collective_workspace_items
        WHERE workspace_id = $1 AND product_id IS NOT NULL
        GROUP BY product_id`,
      [workspaceId]
    )).rows;

    const reservations = [];
    const shortages = [];

    for (const item of items) {
      const product = (await client.query(
        'SELECT id, name, stock, inventory_model FROM products WHERE id = $1 FOR UPDATE',
        [item.product_id]
      )).rows[0];

      if (!product) {
        shortages.push({ product_id: item.product_id, reason: 'product_not_found' });
        continue;
      }

      // PDC-7 (Lot 7) — collective_workspace_items ne porte que product_id +
      // quantity, jamais sku_id : la réservation collective n'a donc pas
      // l'identité exacte requise pour verrouiller un product_skus précis.
      // INTERDIT (doctrine) : réserver via products.stock pour un produit
      // SKU, répartir une quantité produit entre SKU, ou inventer un sku_id
      // depuis les axes de variante. Chemin fermé explicitement — échec
      // métier clair plutôt qu'un contournement silencieux. La propagation
      // de l'identité SKU dans le modèle collectif est un chantier
      // shared-cart séparé, hors périmètre PDC-7.
      if (product.inventory_model === 'SKU') {
        shortages.push({
          product_id: item.product_id,
          product_name: product.name,
          reason: 'sku_reservation_unsupported',
          detail: 'collective_workspace_items ne porte pas sku_id — réservation collective impossible pour un produit inventory_model=SKU sans identité SKU exacte',
        });
        continue;
      }

      if (product.stock === null || product.stock === undefined) {
        continue;
      }

      const activeReserved = asInt((await client.query(
        `SELECT COALESCE(SUM(quantity),0)::int AS qty
           FROM collective_stock_reservations
          WHERE product_id = $1
            AND status = 'reserved'
            AND reserved_until > NOW()
            AND workspace_id <> $2`,
        [item.product_id, workspaceId]
      )).rows[0]?.qty);

      const wanted = asInt(item.quantity);
      const available = asInt(product.stock) - activeReserved;

      if (available < wanted) {
        shortages.push({
          product_id: item.product_id,
          product_name: product.name,
          requested: wanted,
          available,
          active_reserved: activeReserved,
          stock: asInt(product.stock),
        });
        continue;
      }

      const inserted = (await client.query(
        `INSERT INTO collective_stock_reservations
           (workspace_id, product_id, quantity, status, reserved_until)
         VALUES ($1, $2, $3, 'reserved', $4)
         RETURNING id, workspace_id, product_id, quantity, status, reserved_until`,
        [workspaceId, item.product_id, wanted, reservedUntil]
      )).rows[0];

      reservations.push(inserted);
    }

    if (shortages.length) {
      throw Object.assign(new Error('stock_reservation_shortage'), { shortages });
    }

    await engine.logEvent(client, workspaceId, 'stock_reserved', 'system', null, {
      reservations_count: reservations.length,
      reserved_until: reservedUntil,
    });

    await client.query('COMMIT');
    return { ok: true, reservations, reserved_until: reservedUntil };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function releaseForWorkspace(workspaceId, reason = 'released') {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
      await client.query(
      `UPDATE collective_stock_reservations
          SET status = CASE WHEN reserved_until <= NOW() THEN 'expired' ELSE 'released' END,
              released_at = CASE WHEN reserved_until > NOW() THEN NOW() ELSE released_at END,
              expired_at = CASE WHEN reserved_until <= NOW() THEN NOW() ELSE expired_at END
        WHERE workspace_id = $1 AND status = 'reserved'`,
      [workspaceId]
    );
    await engine.logEvent(client, workspaceId, 'stock_reservation_released', 'system', null, { reason });
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function consumeForWorkspace(workspaceId, client = db) {
  await client.query(
    `UPDATE collective_stock_reservations
        SET status = 'consumed', consumed_at = NOW()
      WHERE workspace_id = $1 AND status = 'reserved'`,
    [workspaceId]
  );
}

// BUGFIX (tests/missing-p1-finance) : ensureTable était référencé dans
// module.exports sans jamais être défini, provoquant un ReferenceError au
// chargement du module (et donc un crash de tout appelant, dont
// repair-collective-stock-reservations.js qui l'invoque). Le DDL de
// collective_stock_reservations est géré par
// migrations/075_hub_shares_collective_schema.sql (cf. commentaire en tête
// de fichier), donc ce hook reste un no-op idempotent : il ne doit pas
// exécuter de DDL au runtime.
async function ensureTable() {}

module.exports = {
  ensureTable,
  reserveForCreatorToken,
  reserveForWorkspace,
  releaseForWorkspace,
  consumeForWorkspace,
};
