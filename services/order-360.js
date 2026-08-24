/**
 * @komerce-arch
 * @role          canonical-order-360-service
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_order
 * @outputs       order_360_projection
 * @depends       db
 * @used-by       routes/admin-order-360.js
 * @db-read       orders, users, relais, markets, order_items, products, parcels, parcel_items, order_status_history, scans, order_incidents, order_comments, client_notifications, invoices, transaction_documents
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, orders, logistics, notifications, documents, finance, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');

const ORDER_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/;

function normalizeReference(value) {
  const reference = String(value || '').trim();
  return ORDER_REFERENCE.test(reference) ? reference : null;
}

async function resolveOrder(reference) {
  const normalized = normalizeReference(reference);
  if (!normalized) return { invalid: true, order: null };

  const { rows } = await db.query(`
    SELECT
      o.id, o.reference, o.market_id, o.user_id,
      o.status::text AS status,
      o.payment_status::text AS payment_status,
      o.payment_mode::text AS payment_mode,
      o.total_kmf, o.destination_island, o.routing_mode, o.transit_hub,
      o.created_at, o.updated_at,
      u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
      r.name AS relais_name, r.address AS relais_address, r.phone AS relais_phone,
      r.island AS relais_island,
      m.code AS market_code, m.name AS market_name, m.currency AS market_currency
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    LEFT JOIN markets m ON m.id = o.market_id
    WHERE UPPER(o.reference) = UPPER($1)
    LIMIT 1
  `, [normalized]);

  return { invalid: false, order: rows[0] || null };
}

function publicOrder(order) {
  return Object.freeze({
    reference: order.reference,
    status: order.status,
    payment: Object.freeze({
      status: order.payment_status,
      mode: order.payment_mode,
      total_kmf: Number(order.total_kmf) || 0,
    }),
    destination: Object.freeze({
      island: order.destination_island || null,
      routing_mode: order.routing_mode || null,
      transit_hub: order.transit_hub || null,
      relais: Object.freeze({
        name: order.relais_name || null,
        address: order.relais_address || null,
        phone: order.relais_phone || null,
        island: order.relais_island || null,
      }),
    }),
    customer: Object.freeze({
      name: order.customer_name || null,
      email: order.customer_email || null,
      phone: order.customer_phone || null,
    }),
    market: Object.freeze({
      code: order.market_code || null,
      name: order.market_name || null,
      currency: order.market_currency || null,
    }),
    created_at: order.created_at,
    updated_at: order.updated_at,
  });
}

async function loadOrder360(order) {
  if (!order || !order.id) throw new Error('order_360_resolved_order_required');

  const orderId = order.id;
  const [itemsResult, parcelsResult, parcelItemsResult, historyResult, scansResult,
    incidentsResult, commentsResult, notificationsResult, invoicesResult, documentsResult] = await Promise.all([
    db.query(`
      SELECT oi.id, oi.product_id, oi.quantity, oi.price_kmf,
             p.name AS product_name, p.category, p.image_url
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1::uuid
      ORDER BY oi.created_at ASC
    `, [orderId]),
    db.query(`
      SELECT p.id, p.reference, p.tracking_number, p.status::text AS status,
             p.type, p.weight_kg, p.created_at, p.prepared_at, p.shipped_at, p.updated_at
      FROM parcels p
      WHERE p.order_id = $1::uuid AND p.status != 'cancelled'
      ORDER BY p.created_at ASC
    `, [orderId]),
    db.query(`
      SELECT pi.parcel_id, pi.order_item_id, pi.quantity, pr.name AS product_name
      FROM parcel_items pi
      JOIN parcels pa ON pa.id = pi.parcel_id
      LEFT JOIN order_items oi ON oi.id = pi.order_item_id
      LEFT JOIN products pr ON pr.id = oi.product_id
      WHERE pa.order_id = $1::uuid AND pa.status != 'cancelled'
      ORDER BY pa.created_at ASC, pi.id ASC
    `, [orderId]),
    db.query(`
      SELECT h.status::text AS status, h.note, h.created_at, u.full_name AS changed_by_name
      FROM order_status_history h
      LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.order_id = $1::uuid
      ORDER BY h.created_at DESC
    `, [orderId]),
    db.query(`
      SELECT s.step, s.notes, s.created_at, u.full_name AS scanned_by_name
      FROM scans s
      LEFT JOIN users u ON u.id = s.scanned_by
      WHERE s.order_id = $1::uuid
      ORDER BY s.created_at DESC
    `, [orderId]),
    db.query(`
      SELECT i.type, i.description, i.priority, i.status, i.created_at,
             i.resolved_at, i.resolution_note,
             COALESCE(u.full_name, i.reporter_name) AS reporter_name
      FROM order_incidents i
      LEFT JOIN users u ON u.id = i.reporter_id
      WHERE i.order_id = $1::uuid
      ORDER BY i.created_at DESC
    `, [orderId]),
    db.query(`
      SELECT c.author_name, c.author_role, c.text, c.created_at
      FROM order_comments c
      WHERE c.order_id = $1::uuid
      ORDER BY c.created_at DESC
      LIMIT 50
    `, [orderId]),
    db.query(`
      SELECT event_key, severity, title, message, status,
             created_at, acknowledged_at, resolved_at
      FROM client_notifications
      WHERE entity_type = 'order' AND entity_id = $1::uuid
      ORDER BY created_at DESC
    `, [orderId]),
    db.query(`
      SELECT invoice_number, payment_status, delivered_via, delivered_at, created_at
      FROM invoices
      WHERE order_id = $1::uuid
      ORDER BY created_at DESC
    `, [orderId]),
    db.query(`
      SELECT document_type, reference, status, file_url, issued_at
      FROM transaction_documents
      WHERE order_id = $1::uuid
      ORDER BY issued_at DESC
    `, [orderId]),
  ]);

  const parcelItemsByParcel = new Map();
  for (const row of parcelItemsResult.rows) {
    const bucket = parcelItemsByParcel.get(row.parcel_id) || [];
    bucket.push(Object.freeze({ product_name: row.product_name || null, quantity: Number(row.quantity) || 0 }));
    parcelItemsByParcel.set(row.parcel_id, bucket);
  }

  const parcels = parcelsResult.rows.map(row => {
    const parcelItems = parcelItemsByParcel.get(row.id) || [];
    return Object.freeze({
      reference: row.reference,
      tracking_number: row.tracking_number || null,
      status: row.status,
      type: row.type || null,
      weight_kg: row.weight_kg == null ? null : Number(row.weight_kg),
      items_quantity: parcelItems.reduce((sum, item) => sum + item.quantity, 0),
      created_at: row.created_at,
      prepared_at: row.prepared_at,
      shipped_at: row.shipped_at,
      updated_at: row.updated_at,
      items: Object.freeze(parcelItems),
    });
  });

  const items = itemsResult.rows.map(row => Object.freeze({
    product_name: row.product_name || null,
    category: row.category || null,
    quantity: Number(row.quantity) || 0,
    unit_price_kmf: Number(row.price_kmf) || 0,
    image_url: row.image_url || null,
  }));

  const incidents = incidentsResult.rows.map(row => Object.freeze({
    type: row.type,
    description: row.description || null,
    priority: row.priority,
    status: row.status,
    reporter: row.reporter_name || null,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    resolution_note: row.resolution_note || null,
  }));

  const notifications = notificationsResult.rows.map(row => Object.freeze({
    event_key: row.event_key,
    severity: row.severity,
    title: row.title,
    message: row.message,
    status: row.status,
    created_at: row.created_at,
    acknowledged_at: row.acknowledged_at,
    resolved_at: row.resolved_at,
  }));

  const documents = documentsResult.rows.map(row => Object.freeze({
    document_type: row.document_type,
    reference: row.reference,
    status: row.status,
    file_url: row.file_url || null,
    issued_at: row.issued_at,
  }));

  const openIncidents = incidents.filter(row => !['resolved', 'closed'].includes(row.status)).length;
  const totalQuantity = items.reduce((sum, row) => sum + row.quantity, 0);

  return Object.freeze({
    order: publicOrder(order),
    summary: Object.freeze({
      items: items.length,
      quantity: totalQuantity,
      parcels: parcels.length,
      open_incidents: openIncidents,
      notifications: notifications.length,
      documents: documents.length,
    }),
    items: Object.freeze(items),
    parcels: Object.freeze(parcels),
    history: Object.freeze(historyResult.rows.map(row => Object.freeze({
      status: row.status, note: row.note || null, changed_by: row.changed_by_name || null, created_at: row.created_at,
    }))),
    scans: Object.freeze(scansResult.rows.map(row => Object.freeze({
      step: row.step, notes: row.notes || null, scanned_by: row.scanned_by_name || null, created_at: row.created_at,
    }))),
    incidents: Object.freeze(incidents),
    comments: Object.freeze(commentsResult.rows.map(row => Object.freeze({
      author: row.author_name || row.author_role || null,
      role: row.author_role || null,
      text: row.text,
      created_at: row.created_at,
    }))),
    notifications: Object.freeze(notifications),
    invoices: Object.freeze(invoicesResult.rows.map(row => Object.freeze({
      invoice_number: row.invoice_number,
      payment_status: row.payment_status,
      delivered_via: row.delivered_via || null,
      delivered_at: row.delivered_at,
      created_at: row.created_at,
    }))),
    documents: Object.freeze(documents),
    data_quality: Object.freeze({
      generated_at: new Date().toISOString(),
      source_tables: Object.freeze([
        'orders', 'order_items', 'products', 'parcels', 'parcel_items',
        'order_status_history', 'scans', 'order_incidents', 'order_comments',
        'client_notifications', 'invoices', 'transaction_documents',
      ]),
    }),
  });
}

module.exports = { ORDER_REFERENCE, normalizeReference, resolveOrder, publicOrder, loadOrder360 };
