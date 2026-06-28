/**
 * @komerce-arch
 * @role          collective-workspace-items
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        creator_token, product_id, quantity, item_id
 * @outputs       item, ok
 * @depends       services/collective-workspace-internals.js
 * @used-by       services/collective-workspace-engine.js
 * @db-read       collective_workspaces, products
 * @db-write      collective_workspace_events, collective_workspace_items
 * @db-txn        required_for_state_transition
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

const { db, _hashToken, logEvent } = require('./collective-workspace-internals');

async function addItem(creatorToken, { product_id, quantity }) {
  const hash = _hashToken(creatorToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // P0 FIX : SELECT FOR UPDATE pour bloquer toute mutation simultanée (finalize, etc.)
    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE creator_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_modifiable');
    }

    // Snapshot prix actuel + nom
    let nameSnap = null, imgSnap = null, priceSnap = null;
    if (product_id) {
      const p = await client.query(
        `SELECT name, image_url, price_kmf FROM products WHERE id = $1 AND is_active = true`,
        [product_id]
      );
      if (!p.rows.length) {
        await client.query('ROLLBACK');
        throw new Error('product_not_found');
      }
      nameSnap  = p.rows[0].name;
      imgSnap   = p.rows[0].image_url;
      priceSnap = p.rows[0].price_kmf;
    }

    const { rows } = await client.query(
      `INSERT INTO collective_workspace_items
         (workspace_id, product_id, quantity, product_name_snapshot, product_image_snapshot, price_snapshot_kmf)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [ws.id, product_id || null, Math.max(1, parseInt(quantity, 10) || 1), nameSnap, imgSnap, priceSnap]
    );
    await logEvent(client, ws.id, 'item_added', 'creator', null, { product_id, quantity });

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateItem(creatorToken, itemId, { quantity }) {
  const hash = _hashToken(creatorToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE creator_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_modifiable');
    }

    const { rows } = await client.query(
      `UPDATE collective_workspace_items
         SET quantity = $1
       WHERE id = $2 AND workspace_id = $3
       RETURNING *`,
      [Math.max(1, parseInt(quantity, 10) || 1), itemId, ws.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      throw new Error('item_not_found');
    }
    await logEvent(client, ws.id, 'item_updated', 'creator', null, { item_id: itemId, quantity });

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function removeItem(creatorToken, itemId) {
  const hash = _hashToken(creatorToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE creator_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_modifiable');
    }

    const { rowCount } = await client.query(
      `DELETE FROM collective_workspace_items WHERE id = $1 AND workspace_id = $2`,
      [itemId, ws.id]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      throw new Error('item_not_found');
    }
    await logEvent(client, ws.id, 'item_removed', 'creator', null, { item_id: itemId });

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { addItem, updateItem, removeItem };
