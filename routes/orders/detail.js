/**
 * @komerce-arch
 * @role          orders-detail
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, order_status_history, orders, parcels, products, relais, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

/**
 * KOMERCE — Détail commande & historique
 *
 * GET /:ref         → détail + suivi public par référence
 * GET /:id/history  → historique statuts
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate } = require('../../middleware/auth');
const { softAuthenticate } = require('../../middleware/soft-auth'); // F3 LOT-387

// ─── GET /api/orders/:ref — détail + suivi (public par référence) ─────────────

router.get('/:ref', softAuthenticate, async (req, res, next) => {
  try {
    const isUuid = /^[0-9a-f-]{36}$/.test(req.params.ref);

    // Deux requêtes explicites pour éviter l'interpolation de nom de colonne
    const { rows: [order] } = isUuid
      ? await db.query(
          `SELECT o.*, r.name AS relais_name, r.address AS relais_address,
                  r.phone AS relais_phone, r.hours AS relais_hours, r.zone AS relais_zone
           FROM orders o LEFT JOIN relais r ON r.id = o.relais_id WHERE o.id = $1`,
          [req.params.ref]
        )
      : await db.query(
          `SELECT o.*, r.name AS relais_name, r.address AS relais_address,
                  r.phone AS relais_phone, r.hours AS relais_hours, r.zone AS relais_zone
           FROM orders o LEFT JOIN relais r ON r.id = o.relais_id WHERE o.reference = $1`,
          [req.params.ref]
        );

    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Articles de la commande
    const { rows: items } = await db.query(
      `SELECT
         oi.id, oi.quantity, oi.price_kmf,
         oi.module_type, oi.module_fabric_type,
         oi.module_size, oi.module_retouche,
         oi.module_qty_meters, oi.module_accessories,
         p.name AS product_name, p.image_url, p.category, p.has_couture, p.emoji
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at ASC`,
      [order.id]
    );

    // Historique des statuts
    const { rows: history } = await db.query(
      `SELECT status, note, created_at
       FROM order_status_history
       WHERE order_id = $1
       ORDER BY created_at ASC`,
      [order.id]
    );

    // softAuthenticate (branché sur la route) peuple req.user si token valide,
    // sans jamais bloquer les accès publics. cash_ref_code masqué pour le public.
    const isAdmin       = req.user && ['admin', 'agent_relais', 'agent_hub'].includes(req.user.role);
    const isRelaisAdmin = req.user && ['admin', 'agent_relais'].includes(req.user.role);

    // If not authenticated, return minimal public data + parcel tracking
    if (!req.user) {
      const { rows: trackParcels } = await db.query(
        `SELECT reference, status FROM parcels WHERE order_id = $1 ORDER BY created_at ASC`,
        [order.id]
      );
      return res.json({
        reference:  order.reference,
        status:     order.status,
        created_at: order.created_at,
        parcels: trackParcels.map(p => ({ reference: p.reference, status: p.status })),
      });
    }

    res.json({
      id:                  order.id,
      reference:           order.reference,
      status:              order.status,
      total_kmf:           order.total_kmf,
      total_eur:           order.total_eur,
      payment_mode:        order.payment_mode,
      payment_status:      order.payment_status,
      // cash_ref_code exposé uniquement aux agents et admins
      ...(isAdmin       ? { cash_ref_code: order.cash_ref_code } : {}),
      // pickup_code (masqué) exposé uniquement à l'admin et l'agent relais (pas au public, pas à l'agent hub)
      ...(isRelaisAdmin ? { pickup_code: require('../../services/pickup-secret-service').maskLast4(order.pickup_secret_last4) } : {}),
      confection_type:       order.confection_type,
      module_type:           order.module_type,
      module_size:           order.module_size,
      module_retouche:       order.module_retouche,
      purchasing_at:         order.purchasing_at,
      shipped_at:            order.shipped_at,
      in_transit_at:         order.in_transit_at,
      // Routing logistique
      destination_island:    order.destination_island   || null,
      routing_mode:          order.routing_mode         || null,
      transit_hub:           order.transit_hub           || null,
      available_at:          order.available_at,
      collected_at:          order.collected_at,
      created_at:            order.created_at,
      // Traçabilité fournisseur (v7.6) — admin seulement
      ...(req.user?.role === 'admin' ? {
        supplier_name:        order.supplier_name        || null,
        supplier_invoice_url: order.supplier_invoice_url || null,
      } : {}),
      items,
      relais: order.relais_name ? {
        name:    order.relais_name,
        address: order.relais_address,
        phone:   order.relais_phone,
        hours:   order.relais_hours,
        zone:    order.relais_zone,
      } : null,
      history,
    });

  } catch(err) { next(err); }
});

// ─── GET /api/orders/:id/history ─────────────────────────────────────────────

router.get('/:id/history', authenticate, async (req, res, next) => {
  try {
    // Vérifier que la commande appartient à l'utilisateur (sauf admin/agents)
    const isPrivileged = ['admin', 'agent_hub', 'agent_relais'].includes(req.user.role);

    if (!isPrivileged) {
      const { rows: [order] } = await db.query(
        'SELECT id FROM orders WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      if (!order) return res.status(403).json({ error: 'Accès refusé' });
    }

    const { rows } = await db.query(
      `SELECT h.status, h.note, h.created_at, u.full_name AS changed_by_name
       FROM order_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.order_id = $1
       ORDER BY h.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

module.exports = router;
