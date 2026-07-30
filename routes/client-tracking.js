/**
 * @komerce-arch
 * @role          logistics-client-tracking
 * @domain        logistics
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       invoices, order_items, orders, parcels, products, relais, scan_events
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { computeOrderStatusDetail, getOrderStatusDetailMessage } = require('../utils/parcels');
const { maskLast4 } = require('../services/pickup-secret-service');
const log = require('../utils/logger').child({ module: 'client-tracking' });

const STATUS_LABELS = {
  pending: 'En attente de paiement',
  confirmed: 'Confirmée',
  ordered: 'Commandée',
  preparation: 'En préparation',
  shipped: 'Expédiée',
  in_transit: 'En transit',
  available: 'Disponible au retrait',
  collected: 'Retirée',
  cancelled: 'Annulée',
  refunded: 'Remboursée'
};

const STATUS_ORDER = [
  'ordered', 'preparation', 'shipped',
  'in_transit', 'available', 'collected'
];


/**
 * GET /api/client/tracking
 * Returns ALL orders for the authenticated client with full timelines
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch all orders for this user
    const { rows: orders } = await pool.query(`
      SELECT 
        o.id, o.reference, o.status, o.total_kmf,
        o.payment_mode, o.payment_status,
        o.pickup_secret_last4, o.qr_token,
        o.created_at, o.ordered_at, o.preparation_at,
        o.shipped_at, o.in_transit_at, o.available_at, o.collected_at,
        o.destination_island,
        r.name AS relais_name, r.address AS relais_address, r.island AS relais_island
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
    `, [userId]);

    if (orders.length === 0) {
      return res.json({ orders: [], message: 'Aucune commande trouvée.' });
    }

    // Fetch items for all orders in one query
    const orderIds = orders.map(o => o.id);
    const { rows: allItems } = await pool.query(`
      SELECT 
        oi.order_id, oi.quantity, oi.price_kmf,
        p.name AS product_name, p.emoji, p.image_url, p.sku
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ANY($1)
    `, [orderIds]);

    // Fetch parcels for all orders
    const { rows: allParcels } = await pool.query(`
      SELECT 
        p.id, p.order_id, p.reference, p.status, p.weight_kg,
        p.destination_island, p.destination_relais,
        p.shipped_at, p.available_at, p.collected_at, p.created_at
      FROM parcels p
      WHERE p.order_id = ANY($1)
      ORDER BY p.created_at ASC
    `, [orderIds]);

    // Fetch scan events for all parcels
    const parcelIds = allParcels.map(p => p.id);
    let allScans = [];
    if (parcelIds.length > 0) {
      const { rows } = await pool.query(`
        SELECT 
          se.parcel_id, se.event_type, se.location, se.notes, se.created_at
        FROM scan_events se
        WHERE se.parcel_id = ANY($1) AND se.status = 'applied'
        ORDER BY se.created_at ASC
      `, [parcelIds]);
      allScans = rows;
    }

    // Fetch invoices for all orders
    const { rows: allInvoices } = await pool.query(`
      SELECT 
        inv.order_id, inv.invoice_number, inv.total_kmf,
        inv.payment_mode, inv.created_at
      FROM invoices inv
      WHERE inv.order_id = ANY($1)
      ORDER BY inv.created_at DESC
    `, [orderIds]);

    // Group by order
    const itemsByOrder = {};
    for (const item of allItems) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    }

    const parcelsByOrder = {};
    for (const parcel of allParcels) {
      if (!parcelsByOrder[parcel.order_id]) parcelsByOrder[parcel.order_id] = [];
      parcelsByOrder[parcel.order_id].push(parcel);
    }

    const scansByParcel = {};
    for (const scan of allScans) {
      if (!scansByParcel[scan.parcel_id]) scansByParcel[scan.parcel_id] = [];
      scansByParcel[scan.parcel_id].push(scan);
    }

    const invoicesByOrder = {};
    for (const inv of allInvoices) {
      if (!invoicesByOrder[inv.order_id]) invoicesByOrder[inv.order_id] = [];
      invoicesByOrder[inv.order_id].push(inv);
    }

    // Build response
    const result = orders.map(order => {
      // Timeline
      const timeline = buildTimeline(order);

      // Is at relay?
      const isAtRelay = ['available', 'collected'].includes(order.status);

      // Items
      const items = (itemsByOrder[order.id] || []).map(i => ({
        name: i.product_name,
        emoji: i.emoji,
        imageUrl: i.image_url,
        sku: i.sku,
        quantity: i.quantity,
        priceKmf: i.price_kmf
      }));

      // Parcels with events
      const orderParcels = parcelsByOrder[order.id] || [];
      const parcels = orderParcels.map(p => ({
        reference: p.reference,
        status: p.status,
        statusLabel: STATUS_LABELS[p.status] || p.status,
        weightKg: p.weight_kg,
        destinationIsland: p.destination_island,
        events: (scansByParcel[p.id] || []).map(s => ({
          type: s.event_type,
          label: STATUS_LABELS[s.event_type] || s.event_type,
          location: s.location,
          date: s.created_at
        }))
      }));

      // Invoices
      const invoices = (invoicesByOrder[order.id] || []).map(inv => ({
        invoiceNumber: inv.invoice_number,
        totalKmf: inv.total_kmf,
        paymentMode: inv.payment_mode,
        createdAt: inv.created_at
      }));

      // Status detail — second niveau UX, dérivé des colis à la volée
      const statusDetail = computeOrderStatusDetail(orderParcels);
      const statusMessage = getOrderStatusDetailMessage(statusDetail);

      return {
        reference: order.reference,
        status: order.status,
        statusLabel: STATUS_LABELS[order.status] || order.status,
        statusDetail,
        statusMessage,
        totalKmf: order.total_kmf,
        paymentMode: order.payment_mode,
        paymentStatus: order.payment_status,
        destinationIsland: order.destination_island,
        createdAt: order.created_at,
        relay: {
          name: order.relais_name,
          address: order.relais_address,
          island: order.relais_island
        },
        pickupCode: isAtRelay ? maskLast4(order.pickup_secret_last4) : null,
        items,
        parcels,
        invoices,
        timeline
      };
    });

    res.json({
      orders: result,
      count: result.length
    });
  } catch (err) {
    next(err);
  }
});

function buildTimeline(order) {
  const timeline = [];

  const steps = [
    { status: 'ordered', date: order.ordered_at || order.created_at },
    { status: 'preparation', date: order.preparation_at },
    { status: 'shipped', date: order.shipped_at },
    { status: 'in_transit', date: order.in_transit_at },
    { status: 'available', date: order.available_at },
    { status: 'collected', date: order.collected_at }
  ];

  const currentIdx = STATUS_ORDER.indexOf(order.status);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const completed = step.date != null || i <= currentIdx;
    timeline.push({
      status: step.status,
      label: STATUS_LABELS[step.status] || step.status,
      date: step.date || null,
      completed,
      current: i === currentIdx && !steps[i + 1]?.date
    });
  }

  return timeline;
}

module.exports = router;

