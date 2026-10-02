/**
 * @komerce-arch
 * @role          purchasing-grouped-service
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        supplier id, procurement hub ref, purchase line ids, purchase order id, cancel reason, actor
 * @outputs       open-line groups, draft grouped purchase order, detach/discard/cancel results
 * @depends       db, services/purchase-line-snapshot.js, utils/logger.js
 * @used-by       routes/purchasing.js, services/purchasing-admin-service.js, services/purchasing-receive-service.js
 * @db-read       purchase_lines, purchase_orders, order_items, orders, products, suppliers
 * @db-write      purchase_lines, purchase_orders
 * @db-txn        owned
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, admin-dashboard
 * @version       2026-10
 */

'use strict';

/**
 * Forme regroupée des purchase_orders (PR 4/8, MISSION_PURCHASE_LINES), derrière KOMERCE_GROUPED_PURCHASING.
 *
 * Une ligne ouverte (purchase_lines sans PO) est regroupée par (fournisseur, hub) dans une PO `draft` ; la PO
 * regroupée n'a pas de colonnes de ligne (order_id, qty, supplier_sku… NULL). Les gardes I2–I5 sont en base ;
 * ce service donne des erreurs lisibles et pose l'ordre de verrouillage commun : PO d'abord, lignes ensuite
 * (identifiants triés), pour qu'annulation de commande, détachement et abandon ne s'interbloquent pas.
 *
 * Hors périmètre (PR 5) : soumission, confirmation par PO, règlement et reliquats.
 */

const db = require('../db');
const log = require('../utils/logger').child({ module: 'purchasing-grouped' });

const GROUPED_ROUTE_CODE = 'PURCHASE_ORDER_GROUPED_USE_PO_ROUTES';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isGroupedPurchasingEnabled(env = process.env) {
  return String(env.KOMERCE_GROUPED_PURCHASING || '').trim() === '1';
}

function fail(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function requireEnabled() {
  if (!isGroupedPurchasingEnabled()) {
    throw fail(409, 'GROUPED_PURCHASING_DISABLED', 'Achats regroupés désactivés (KOMERCE_GROUPED_PURCHASING)');
  }
}

function requireUuid(value, name) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw fail(400, 'INVALID_INPUT', `${name} invalide`);
  }
  return value;
}

function requireLineIds(lineIds) {
  if (!Array.isArray(lineIds) || lineIds.length === 0) {
    throw fail(400, 'INVALID_INPUT', 'line_ids doit contenir au moins une ligne');
  }
  const ids = lineIds.map((id) => requireUuid(id, 'line_ids[]'));
  if (new Set(ids).size !== ids.length) {
    throw fail(400, 'INVALID_INPUT', 'line_ids contient des doublons');
  }
  return [...ids].sort();
}

/** Les routes historiques ne servent que la forme historique : une PO regroupée y répond 409. */
function groupedRouteError() {
  return fail(409, GROUPED_ROUTE_CODE, 'Cette PO est regroupée : utilisez les routes /po/:po_id de purchasing');
}

async function withTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapDbError(err);
  } finally {
    client.release();
  }
}

// Les gardes de base lèvent 23514 avec un préfixe de code lisible : on les remonte en 409.
function mapDbError(err) {
  if (err && err.status) return err;
  const match = /^(purchase_line_[a-z_]+)/.exec(err && err.message ? err.message : '');
  if (err && err.code === '23514' && match) {
    return fail(409, match[1].toUpperCase(), err.message);
  }
  return err;
}

async function lockGroupedPo(client, poId, { requireDraft = true } = {}) {
  const { rows: [po] } = await client.query(
    'SELECT id, order_id, status, supplier_id, procurement_hub_ref FROM purchase_orders WHERE id = $1 FOR UPDATE',
    [poId]
  );
  if (!po) throw fail(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order introuvable');
  if (po.order_id !== null) {
    throw fail(409, 'PURCHASE_ORDER_NOT_GROUPED', 'Cette PO est de forme historique');
  }
  if (requireDraft && po.status !== 'draft') {
    throw fail(409, 'PURCHASE_ORDER_NOT_DRAFT', `PO au statut "${po.status}" : seule une PO draft est modifiable`, {
      current_status: po.status,
    });
  }
  return po;
}

// ─── Lecture : lignes ouvertes regroupées par (fournisseur, hub) ─────────────────────────────────

async function listOpenLines(q = db) {
  requireEnabled();
  const { rows } = await q.query(`
    SELECT pl.id AS line_id, pl.supplier_id, s.name AS supplier_name, pl.procurement_hub_ref,
           pl.order_item_id, oi.order_id, o.reference AS order_reference,
           p.name AS product_name, pl.product_sku_id, pl.supplier_sku, pl.supplier_unit_ref,
           pl.quantity, pl.supplier_unit_price, pl.supplier_currency, pl.created_at,
           (pl.product_sku_id IS NOT NULL AND pl.supplier_unit_ref IS NOT NULL
              AND pl.supplier_order_identity IS NOT NULL AND pl.supplier_unit_price IS NOT NULL
              AND pl.supplier_currency IS NOT NULL) AS groupable
      FROM purchase_lines pl
      JOIN suppliers s ON s.id = pl.supplier_id
      JOIN order_items oi ON oi.id = pl.order_item_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE pl.purchase_order_id IS NULL AND pl.cancelled_at IS NULL
     ORDER BY s.name, pl.procurement_hub_ref, pl.created_at, pl.id
  `);

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.supplier_id}|${row.procurement_hub_ref}`;
    if (!groups.has(key)) {
      groups.set(key, {
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        procurement_hub_ref: row.procurement_hub_ref,
        currencies: new Set(),
        lines: [],
        by_supplier_unit_ref: new Map(),
      });
    }
    const group = groups.get(key);
    if (row.supplier_currency) group.currencies.add(row.supplier_currency);
    group.lines.push({
      line_id: row.line_id,
      order_id: row.order_id,
      order_reference: row.order_reference,
      order_item_id: row.order_item_id,
      product_name: row.product_name || null,
      product_sku_id: row.product_sku_id,
      supplier_sku: row.supplier_sku,
      supplier_unit_ref: row.supplier_unit_ref,
      quantity: row.quantity,
      expected_unit_price: row.supplier_unit_price === null ? null : Number(row.supplier_unit_price),
      supplier_currency: row.supplier_currency,
      groupable: row.groupable,
      created_at: row.created_at,
    });
    if (row.supplier_unit_ref) {
      const agg = group.by_supplier_unit_ref.get(row.supplier_unit_ref) || { supplier_unit_ref: row.supplier_unit_ref, quantity: 0, lines: 0 };
      agg.quantity += Number(row.quantity);
      agg.lines += 1;
      group.by_supplier_unit_ref.set(row.supplier_unit_ref, agg);
    }
  }

  return {
    groups: [...groups.values()].map((g) => ({
      supplier_id: g.supplier_id,
      supplier_name: g.supplier_name,
      procurement_hub_ref: g.procurement_hub_ref,
      currencies: [...g.currencies].sort(),
      lines: g.lines,
      by_supplier_unit_ref: [...g.by_supplier_unit_ref.values()],
    })),
    total_lines: rows.length,
  };
}

// ─── Préparation d'une PO regroupée (draft) ───────────────────────────────────────────────────────

async function preparePurchaseOrder({ supplier_id, procurement_hub_ref, line_ids } = {}, { actor = null } = {}) {
  requireEnabled();
  const supplierId = requireUuid(supplier_id, 'supplier_id');
  const hub = typeof procurement_hub_ref === 'string' ? procurement_hub_ref.trim() : '';
  if (!hub) throw fail(400, 'INVALID_INPUT', 'procurement_hub_ref obligatoire');
  const ids = requireLineIds(line_ids);

  return withTransaction(async (client) => {
    const { rows: [supplier] } = await client.query(
      'SELECT id, platform FROM suppliers WHERE id = $1 AND deleted_at IS NULL',
      [supplierId]
    );
    if (!supplier) throw fail(404, 'SUPPLIER_NOT_FOUND', 'Fournisseur introuvable');
    const triggerMode = supplier.platform === 'whatsapp' ? 'whatsapp' : 'manual';

    // qty est passé explicitement à NULL : la colonne garde son DEFAULT 1 pour les écrivains historiques.
    const { rows: [po] } = await client.query(`
      INSERT INTO purchase_orders (order_id, supplier_id, status, trigger_mode, procurement_hub_ref, qty, supplier_sku, notes)
      VALUES (NULL, $1, 'draft', $2, $3, NULL, NULL, $4)
      RETURNING *
    `, [supplierId, triggerMode, hub, actor && actor.id ? `[GROUPED] préparée par ${actor.id}` : '[GROUPED] préparée']);

    await client.query('SELECT id FROM purchase_lines WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
    // I2 : rattachement uniquement depuis l'état ouvert ; tout écart de compte annule tout.
    const { rows: attached } = await client.query(`
      UPDATE purchase_lines
         SET purchase_order_id = $1, updated_at = NOW()
       WHERE id = ANY($2::uuid[]) AND purchase_order_id IS NULL AND cancelled_at IS NULL
       RETURNING id
    `, [po.id, ids]);
    if (attached.length !== ids.length) {
      throw fail(409, 'PURCHASE_LINES_ALREADY_ATTACHED', 'Une ou plusieurs lignes sont déjà rattachées, annulées ou introuvables', {
        requested: ids.length,
        attached: attached.length,
      });
    }

    log.info({ po_id: po.id, supplier_id: supplierId, lines: ids.length }, '[PURCHASING] PO regroupée préparée (draft)');
    return { purchase_order: po, line_ids: ids };
  });
}

// ─── Détachement, abandon, annulation de ligne ───────────────────────────────────────────────────

async function detachLines(poId, lineIds) {
  requireEnabled();
  requireUuid(poId, 'po_id');
  const ids = requireLineIds(lineIds);

  return withTransaction(async (client) => {
    const po = await lockGroupedPo(client, poId);
    await client.query('SELECT id FROM purchase_lines WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
    const { rows: detached } = await client.query(`
      UPDATE purchase_lines SET purchase_order_id = NULL, updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND purchase_order_id = $2
       RETURNING id
    `, [ids, po.id]);
    if (detached.length !== ids.length) {
      throw fail(409, 'PURCHASE_LINE_NOT_IN_PURCHASE_ORDER', 'Une ou plusieurs lignes ne sont pas rattachées à cette PO', {
        requested: ids.length,
        detached: detached.length,
      });
    }
    const { rows: [rest] } = await client.query(
      'SELECT count(*)::int AS n FROM purchase_lines WHERE purchase_order_id = $1 AND cancelled_at IS NULL',
      [po.id]
    );
    return { purchase_order_id: po.id, detached: ids, remaining_lines: rest.n };
  });
}

async function discardPurchaseOrder(poId) {
  requireEnabled();
  requireUuid(poId, 'po_id');

  return withTransaction(async (client) => {
    const po = await lockGroupedPo(client, poId);
    await client.query('SELECT id FROM purchase_lines WHERE purchase_order_id = $1 ORDER BY id FOR UPDATE', [po.id]);
    const { rows: detached } = await client.query(`
      UPDATE purchase_lines SET purchase_order_id = NULL, updated_at = NOW()
       WHERE purchase_order_id = $1 AND cancelled_at IS NULL
       RETURNING id
    `, [po.id]);
    // Les lignes déjà annulées restent attachées : le trigger d'annulation de PO est sans effet sur elles.
    await client.query(
      `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW(),
              notes = CONCAT(COALESCE(notes, ''), E'\\n[GROUPED] abandonnée en brouillon') WHERE id = $1`,
      [po.id]
    );
    return { purchase_order_id: po.id, status: 'cancelled', detached: detached.map((r) => r.id) };
  });
}

async function cancelLine(lineId, reason) {
  requireEnabled();
  requireUuid(lineId, 'line_id');
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (!cleanReason) throw fail(400, 'INVALID_INPUT', 'reason obligatoire');

  return withTransaction(async (client) => {
    // Ordre commun : PO d'abord. La PO de la ligne est lue sans verrou, verrouillée, puis la ligne est relue.
    const { rows: [peek] } = await client.query('SELECT id, purchase_order_id FROM purchase_lines WHERE id = $1', [lineId]);
    if (!peek) throw fail(404, 'PURCHASE_LINE_NOT_FOUND', 'Ligne d\'achat introuvable');
    let po = null;
    if (peek.purchase_order_id) po = await lockGroupedPo(client, peek.purchase_order_id, { requireDraft: false });

    const { rows: [line] } = await client.query(
      'SELECT id, purchase_order_id, cancelled_at FROM purchase_lines WHERE id = $1 FOR UPDATE',
      [lineId]
    );
    if (line.cancelled_at) throw fail(409, 'PURCHASE_LINE_ALREADY_CANCELLED', 'Ligne déjà annulée');
    if (String(line.purchase_order_id || '') !== String(peek.purchase_order_id || '')) {
      throw fail(409, 'PURCHASE_LINE_CONCURRENT_CHANGE', 'La ligne a changé pendant l\'opération, réessayez');
    }
    if (po && po.status !== 'draft') {
      throw fail(409, 'PURCHASE_LINE_NOT_CANCELLABLE', `PO au statut "${po.status}" : la ligne est engagée auprès du fournisseur`, {
        current_status: po.status,
      });
    }

    if (po) {
      await client.query('UPDATE purchase_lines SET purchase_order_id = NULL, updated_at = NOW() WHERE id = $1', [lineId]);
    }
    await client.query(
      'UPDATE purchase_lines SET cancelled_at = NOW(), cancel_reason = $2, updated_at = NOW() WHERE id = $1',
      [lineId, cleanReason]
    );
    return { line_id: lineId, cancelled: true, detached_from: po ? po.id : null };
  });
}

module.exports = {
  GROUPED_ROUTE_CODE,
  isGroupedPurchasingEnabled,
  groupedRouteError,
  listOpenLines,
  preparePurchaseOrder,
  detachLines,
  discardPurchaseOrder,
  cancelLine,
};
