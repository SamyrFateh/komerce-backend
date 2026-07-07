/**
 * @komerce-arch
 * @role          dashboard-dashboard-hub
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, parcel_items, parcels, products, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const log = require('../utils/logger').child({ module: 'dashboard' });
const { cached, setCache, getEurKmf, loadDashConfig } = require('./dashboard-shared');

router.get('/hub-dubai', async (req, res, next) => {
  try {
    const hit = cached('hub-dubai');
    if (hit) return res.json(hit);

    // 1. Commandes sans colis (en attente d'optimisation)
    const { rows: ordersToOptimize } = await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf, o.created_at,
        u.full_name AS client_nom,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::int AS nb_articles,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS jours
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.status IN ('confirmed', 'ordered')
        AND NOT EXISTS (SELECT 1 FROM parcels p2 WHERE p2.order_id = o.id AND p2.status != 'cancelled')
      ORDER BY o.created_at ASC
    `);

    // 2. Colis actifs au hub (draft, preparation, shipped)
    const { rows: parcels } = await db.query(`
      SELECT p.id, p.reference, p.status, p.type, p.weight_kg, p.items_count,
        p.created_at, p.external_code, p.seal_code,
        o.id AS order_id, o.reference AS order_reference, o.total_kmf AS order_total_kmf,
        u.full_name AS client_nom,
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400 AS jours
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE p.status IN ('draft', 'preparation', 'shipped')
      ORDER BY p.created_at ASC
    `);

    // 3. Contenu des colis (parcel_items)
    const parcelIds = parcels.map(p => p.id);
    const itemsMap = {};
    if (parcelIds.length > 0) {
      const { rows: items } = await db.query(`
        SELECT pi.parcel_id, pr.name AS nom, pi.quantity AS quantite,
          oi.price_kmf AS prix_kmf, pr.stock,
          CASE
            WHEN pr.is_active = FALSE THEN 'annule'
            WHEN pr.stock IS NOT NULL AND pr.stock <= 0 THEN 'hors_stock'
            WHEN pr.stock IS NOT NULL AND pr.stock > 0 THEN 'complet'
            ELSE 'en_attente'
          END AS stock_status
        FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        JOIN products pr ON pr.id = oi.product_id
        WHERE pi.parcel_id = ANY($1)
      `, [parcelIds]);
      for (const item of items) {
        if (!itemsMap[item.parcel_id]) itemsMap[item.parcel_id] = [];
        itemsMap[item.parcel_id].push({
          nom: item.nom,
          quantite: Number(item.quantite),
          prix_kmf: Number(item.prix_kmf),
          stock_status: item.stock_status,
        });
      }
    }

    function toHubParcel(p) {
      const jours = Math.round(Number(p.jours));
      return {
        id: p.id,
        reference: p.reference,
        status: p.status,
        type: p.type,
        weight_kg: p.weight_kg ? Number(p.weight_kg) : null,
        items_count: Number(p.items_count || 0),
        external_code: p.external_code,
        seal_code: p.seal_code,
        order_id: p.order_id,
        order_reference: p.order_reference,
        order_total_kmf: Number(p.order_total_kmf),
        client_nom: p.client_nom || 'Client',
        produits: itemsMap[p.id] || [],
        date_creation: p.created_at,
        jours,
        priorite: jours > 7 ? 'urgente' : 'normale',
      };
    }

    const result = {
      a_optimiser: ordersToOptimize.map(o => ({
        id: o.id,
        reference: o.reference,
        status: o.status,
        total_kmf: Number(o.total_kmf),
        client_nom: o.client_nom || 'Client',
        nb_articles: Number(o.nb_articles),
        date_commande: o.created_at,
        jours: Math.round(Number(o.jours)),
      })),
      a_emballer: parcels.filter(p => ['draft', 'preparation'].includes(p.status)).map(toHubParcel),
      a_expedier: parcels.filter(p => p.status === 'shipped').map(toHubParcel),
      kpi: {
        a_optimiser: ordersToOptimize.length,
        a_emballer: parcels.filter(p => ['draft', 'preparation'].includes(p.status)).length,
        a_expedier: parcels.filter(p => p.status === 'shipped').length,
        total_poids_kg: Math.round(parcels.reduce((s, p) => s + (p.weight_kg ? Number(p.weight_kg) : 0), 0) * 10) / 10,
      },
    };

    setCache('hub-dubai', result);
    res.json(result);
  } catch(err) { next(err); }
});



// Alias: /hub → /hub-dubai (frontend compatibility)
router.get('/hub', (req, res, next) => {
  req.url = '/hub-dubai';
  router.handle(req, res, next);
});

module.exports = router;
