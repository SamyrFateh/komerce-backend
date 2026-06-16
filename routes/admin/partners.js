/**
 * @komerce-arch
 * @role          dashboard-partners
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { admin } = require('../../validators');
const log = require('../../utils/logger').child({ module: 'admin/partners' });

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/admin/partners ───────────────────────────────────────
router.get('/partners', ...guard, async (req, res, next) => {
  try {
    const { type, island, country, active } = req.query;
    const conditions = ['1=1'];
    const params = [];
    let pi = 1;
    if (type)    { conditions.push(`partner_type = $${pi++}`);  params.push(type); }
    if (island)  { conditions.push(`island = $${pi++}`);        params.push(island); }
    if (country) { conditions.push(`country_code = $${pi++}`);  params.push(country); }
    if (active !== undefined) {
      conditions.push(`is_active = $${pi++}`);
      params.push(active === 'true' || active === '1');
    }
    const { rows } = await db.query(
      `SELECT * FROM partners WHERE ${conditions.join(' AND ')} ORDER BY partner_type, name`, params
    );
    res.json(rows);
  } catch (err) {
    // partners table may not exist
    res.json([]);
  }
});

// ─── GET /api/admin/partners/stats ─────────────────────────────────
// Récupère les KPI agrégés depuis la vue suppliers_stats
router.get('/partners/stats', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM suppliers_stats`);
    res.json(rows);
  } catch (err) {
    // Vue pas encore créée (migration 035 non passée)
    res.json([]);
  }
});

// ─── GET /api/admin/partners/:id ───────────────────────────────────
router.get('/partners/:id', ...guard, async (req, res, next) => {
  try {
    const { rows: [partner] } = await db.query(
      `SELECT * FROM partners WHERE id = $1`, [req.params.id]
    );
    if (!partner) return res.status(404).json({ error: 'Partenaire introuvable' });

    // Charger les stats inline si dispo
    let stats = null;
    try {
      const { rows: [s] } = await db.query(
        `SELECT * FROM suppliers_stats WHERE partner_id = $1`, [req.params.id]
      );
      stats = s || null;
    } catch (_) { /* vue pas dispo */ }

    res.json({ partner, stats });
  } catch (err) { next(err); }
});

// ─── POST /api/admin/partners ──────────────────────────────────────
router.post('/partners', ...guard, validate(admin.createPartner), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows: [partner] } = await db.query(
      `INSERT INTO partners (
         name, partner_type,
         contact_name, contact_phone, contact_email, whatsapp_url, website_url,
         address, island, zone, country_code, country_label,
         currency, lead_time_days, payment_terms, commission_kmf,
         product_categories, pricing_notes, rating, notes, is_active
       ) VALUES (
         $1, $2,
         $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12,
         $13, $14, $15, $16,
         $17, $18, $19, $20, $21
       ) RETURNING *`,
      [
        b.name, b.partner_type,
        b.contact_name || null, b.contact_phone || null, b.contact_email || null,
        b.whatsapp_url || null, b.website_url || null,
        b.address || null, b.island || null, b.zone || null,
        b.country_code || null, b.country_label || null,
        b.currency || null, b.lead_time_days || null, b.payment_terms || null,
        b.commission_kmf || 0,
        b.product_categories || null, b.pricing_notes || null,
        b.rating || null, b.notes || null,
        b.is_active !== false,
      ]
    );
    res.status(201).json(partner);
  } catch(err) { next(err); }
});

// ─── PUT /api/admin/partners/:id ───────────────────────────────────
router.put('/partners/:id', ...guard, validate(admin.updatePartner), async (req, res, next) => {
  try {
    const fields = [
      'name', 'partner_type',
      'contact_name', 'contact_phone', 'contact_email', 'whatsapp_url', 'website_url',
      'address', 'island', 'zone', 'country_code', 'country_label',
      'currency', 'lead_time_days', 'payment_terms', 'commission_kmf',
      'product_categories', 'pricing_notes', 'rating', 'notes', 'is_active',
    ];
    const updates = [], values = [];
    let pi = 1;
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${pi++}`);
        values.push(req.body[field]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    values.push(req.params.id);
    const { rows: [partner] } = await db.query(
      `UPDATE partners SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${pi} RETURNING *`, values
    );
    if (!partner) return res.status(404).json({ error: 'Partenaire introuvable' });
    res.json(partner);
  } catch (err) { next(err); }
});

// ─── DELETE /api/admin/partners/:id ────────────────────────────────
// Suppression définitive. Les FK customs_shipments.supplier_id et
// orders.supplier_id sont configurées en ON DELETE SET NULL (migration 035),
// donc les liens deviennent NULL mais aucune commande / envoi n'est perdu.
router.delete('/partners/:id', ...guard, validate(admin.deletePartner), async (req, res, next) => {
  try {
    // Compter les liens existants pour info
    let linkedShipments = 0, linkedOrders = 0;
    try {
      const { rows: [a] } = await db.query(
        `SELECT COUNT(*)::int AS c FROM customs_shipments WHERE supplier_id = $1`,
        [req.params.id]
      );
      linkedShipments = a.c;
    } catch (_) {}
    try {
      const { rows: [b] } = await db.query(
        `SELECT COUNT(*)::int AS c FROM orders WHERE supplier_id = $1`,
        [req.params.id]
      );
      linkedOrders = b.c;
    } catch (_) {}

    const { rowCount } = await db.query(
      `DELETE FROM partners WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Partenaire introuvable' });

    res.json({
      deleted: true,
      id: req.params.id,
      links_unset: { shipments: linkedShipments, orders: linkedOrders },
      message: linkedShipments + linkedOrders > 0
        ? `Partenaire supprimé. ${linkedShipments} envois et ${linkedOrders} commandes ont été dissociés.`
        : 'Partenaire supprimé.',
    });
  } catch (err) { next(err); }
});

module.exports = router;
