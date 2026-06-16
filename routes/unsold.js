/**
 * @komerce-arch
 * @role          unsold
 * @domain        unknown
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

// routes/unsold.js — Komerce v8
// Gestion des invendus : listing, résolution, WhatsApp broadcast, revendeurs
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ── GET /api/unsold — liste des invendus disponibles ──────────────────────────
router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM v_unsold_pipeline');
    res.json(rows);
  } catch(err) { next(err); }
});

// ── POST /api/unsold/scan — déclencher le scan d'invendus manuellement ─────────
router.post('/scan', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT auto_unsold() AS count');
    const count = rows[0].count;

    // Créer les unsold_items pour chaque commande fraîchement basculée
    const { rows: newUnsold } = await db.query(`
      SELECT o.id AS order_id, o.total_kmf, o.unsold_price_kmf,
             p.id AS product_id, p.name AS product_name, p.price_kmf
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.unsold_at >= NOW() - INTERVAL '1 minute'
        AND NOT EXISTS (SELECT 1 FROM unsold_items ui WHERE ui.order_id = o.id)
    `);

    for (const row of newUnsold) {
      await db.query(
        `INSERT INTO unsold_items
           (order_id, product_id, product_name, original_price_kmf, unsold_price_kmf)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [row.order_id, row.product_id, row.product_name || 'Article',
         row.price_kmf || row.total_kmf, row.unsold_price_kmf || Math.round((row.price_kmf || row.total_kmf) * 0.75)]
      );
    }

    res.json({ scanned: parseInt(count), items_created: newUnsold.length });
  } catch(err) { next(err); }
});

// ── GET /api/unsold/stats — statistiques invendus ─────────────────────────────
router.get('/stats/summary', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*)                                    AS total_actifs,
        SUM(unsold_price_kmf)                       AS valeur_liquidation_kmf,
        SUM(original_price_kmf)                     AS valeur_initiale_kmf,
        AVG(jours_en_stock)::NUMERIC(5,1)           AS jours_moy_en_stock,
        COUNT(*) FILTER (WHERE channel = 'whatsapp') AS canal_whatsapp,
        COUNT(*) FILTER (WHERE channel = 'reseller') AS canal_revendeur,
        COUNT(*) FILTER (WHERE channel = 'both')     AS canal_both
      FROM v_unsold_pipeline
    `);
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// ── GET /api/unsold/:id — détail d'un invendu ─────────────────────────────────
router.get('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM v_unsold_pipeline WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invendu introuvable' });
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// ── PATCH /api/unsold/:id — mettre à jour prix ou canal ───────────────────────
router.patch('/:id', authenticate, requireAdmin, async (req, res, next) => {
  const { unsold_price_kmf, channel, notes } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE unsold_items
       SET unsold_price_kmf = COALESCE($1, unsold_price_kmf),
           channel          = COALESCE($2, channel),
           notes            = COALESCE($3, notes)
       WHERE id = $4 RETURNING *`,
      [unsold_price_kmf, channel, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invendu introuvable' });
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// ── POST /api/unsold/:id/resolve — marquer comme vendu/donné/détruit ──────────
router.post('/:id/resolve', authenticate, requireAdmin, async (req, res, next) => {
  const { status, resolved_price_kmf, reseller_id, notes } = req.body;
  const VALID = ['sold_whatsapp', 'sold_reseller', 'donated', 'destroyed'];
  if (!VALID.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

  try {
    const { rows } = await db.query(
      `UPDATE unsold_items
       SET status             = $1,
           resolved_at        = NOW(),
           resolved_price_kmf = $2,
           reseller_id        = $3,
           notes              = COALESCE($4, notes)
       WHERE id = $5 RETURNING *`,
      [status, resolved_price_kmf, reseller_id, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invendu introuvable' });
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// ── GET /api/unsold/:id/whatsapp — générer le message WA de liquidation ────────
router.get('/:id/whatsapp', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM v_unsold_pipeline WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invendu introuvable' });
    const item = rows[0];

    const N = v => new Intl.NumberFormat('fr-FR').format(Math.round(v));
    const remise = Math.round((1 - item.unsold_price_kmf / item.original_price_kmf) * 100);

    const message = [
      `🏷️ *PROMOTION KOMERCE — Stock limité*`,
      ``,
      `📦 *${item.product_name}*`,
      ``,
      `~~Prix normal : ${N(item.original_price_kmf)} KMF~~`,
      `✅ *Prix soldé : ${N(item.unsold_price_kmf)} KMF* (-${remise}%)`,
      ``,
      `Pour commander : répondez à ce message ou contactez-nous sur WhatsApp.`,
      ``,
      `_Komerce · Dubai → Comores_`,
    ].join('\n');

    res.json({ message, item });
  } catch(err) { next(err); }
});


module.exports = router;
