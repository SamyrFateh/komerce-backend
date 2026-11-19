/**
 * @komerce-arch
 * @role          unsold
 * @domain        unsold-resolution
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, products, unsold_items, v_unsold_pipeline
 * @db-write      unsold_items
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */


'use strict';
// routes/unsold.js — Komerce v8
// Gestion des invendus : listing, résolution, WhatsApp broadcast, revendeurs
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireAdmin, requireRole } = require('../middleware/auth');
const { listAuthorizedMarketsForCapability } = require('../services/market-delegation-service');

// Toujours résoudre les marchés depuis la délégation active : jamais depuis
// les query params, ni depuis le rôle market_operator pris isolément.
async function requireUnsoldMarketRead(req, res, next) {
  try {
    const markets = await listAuthorizedMarketsForCapability(db, {
      userId: req.user.id, requiredCapability: 'operations.read',
    });
    if (!markets.length) return res.status(403).json({
      code: 'MARKET_READ_CAPABILITY_REQUIRED',
      error: 'Lecture des invendus non autorisée sur un marché actif.',
    });
    req.unsoldMarketIds = markets.map(m => m.market_id);
    next();
  } catch (error) { next(error); }
}

// Projection de consultation uniquement : les mutations historiques restent
// strictement Admin, et les commandes payées restent exclues.
router.get('/my', authenticate, requireRole(['market_operator']), requireUnsoldMarketRead, async (req,res,next) => {
  try {
    const {rows} = await db.query(`SELECT v.* FROM v_unsold_pipeline v
      JOIN unsold_items ui ON ui.id = v.id
      JOIN orders o ON o.id = ui.order_id
      WHERE o.market_id = ANY($1::uuid[])
        AND o.payment_status IS DISTINCT FROM 'paid'
      ORDER BY o.created_at DESC`, [req.unsoldMarketIds]);
    res.set('Cache-Control','private, no-store');
    res.json(rows);
  } catch(error) { next(error); }
});

router.get('/my/stats/summary', authenticate, requireRole(['market_operator']), requireUnsoldMarketRead, async(req,res,next) => {
  try {
    const {rows} = await db.query(`SELECT COUNT(*) AS total_actifs,
      COALESCE(SUM(v.unsold_price_kmf),0) AS valeur_liquidation_kmf,
      COALESCE(SUM(v.original_price_kmf),0) AS valeur_initiale_kmf
      FROM v_unsold_pipeline v
      JOIN unsold_items ui ON ui.id = v.id
      JOIN orders o ON o.id = ui.order_id
      WHERE o.market_id = ANY($1::uuid[])
        AND o.payment_status IS DISTINCT FROM 'paid'`,[req.unsoldMarketIds]);
    res.set('Cache-Control','private, no-store');
    res.json(rows[0]||{total_actifs:0,valeur_liquidation_kmf:0,valeur_initiale_kmf:0});
  } catch(error) { next(error); }
});


// ── GET /api/unsold — liste des invendus disponibles ──────────────────────────
router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT v.* FROM v_unsold_pipeline v
       JOIN unsold_items ui ON ui.id = v.id
       JOIN orders o ON o.id = ui.order_id
       WHERE o.payment_status IS DISTINCT FROM 'paid'`);
    res.json(rows);
  } catch(err) { next(err); }
});

// F3 #4107/#4115 : aucun délai ne transfère à Komerce la propriété d'un
// colis payé. auto_unsold() modifie aujourd'hui l'ordre entier et rend le
// même article vendable alors que son code client peut encore fonctionner.
// Avant doctrine de garde / clôture financière et circuit par colis : arrêt.
router.post('/scan', authenticate, requireAdmin, (_req, res) => res.status(409).json({
  code: 'UNSOLD_NO_SHOW_NOT_CERTIFIED',
  error: 'Pas de liquidation automatique de colis non retiré : intervention du marché requise.'
}));

// ── GET /api/unsold/stats — statistiques invendus ─────────────────────────────
router.get('/stats/summary', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*)                                    AS total_actifs,
        SUM(v.unsold_price_kmf)                       AS valeur_liquidation_kmf,
        SUM(v.original_price_kmf)                     AS valeur_initiale_kmf,
        AVG(v.jours_en_stock)::NUMERIC(5,1)           AS jours_moy_en_stock,
        COUNT(*) FILTER (WHERE v.channel = 'whatsapp') AS canal_whatsapp,
        COUNT(*) FILTER (WHERE v.channel = 'reseller') AS canal_revendeur,
        COUNT(*) FILTER (WHERE v.channel = 'both')     AS canal_both
      FROM v_unsold_pipeline v
      JOIN unsold_items ui ON ui.id = v.id
      JOIN orders o ON o.id = ui.order_id
      WHERE o.payment_status IS DISTINCT FROM 'paid'
    `);
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// ── GET /api/unsold/:id — détail d'un invendu ─────────────────────────────────
router.get('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT v.* FROM v_unsold_pipeline v
       JOIN unsold_items ui ON ui.id = v.id
       JOIN orders o ON o.id = ui.order_id
       WHERE v.id = $1 AND o.payment_status IS DISTINCT FROM 'paid'`, [req.params.id]
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
      `UPDATE unsold_items ui
       SET unsold_price_kmf = COALESCE($1, ui.unsold_price_kmf),
           channel          = COALESCE($2, ui.channel),
           notes            = COALESCE($3, ui.notes)
       WHERE ui.id = $4 AND ui.status = 'available'
         AND EXISTS (SELECT 1 FROM orders o WHERE o.id = ui.order_id
                       AND o.payment_status IS DISTINCT FROM 'paid')
       RETURNING ui.*`,
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
      `UPDATE unsold_items ui
       SET status             = $1,
           resolved_at        = NOW(),
           resolved_price_kmf = $2,
           reseller_id        = $3,
           notes              = COALESCE($4, ui.notes)
       WHERE ui.id = $5 AND ui.status = 'available'
         AND EXISTS (SELECT 1 FROM orders o WHERE o.id = ui.order_id
                       AND o.payment_status IS DISTINCT FROM 'paid')
       RETURNING ui.*`,
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
      `SELECT v.* FROM v_unsold_pipeline v
       JOIN unsold_items ui ON ui.id = v.id
       JOIN orders o ON o.id = ui.order_id
       WHERE v.id = $1 AND o.payment_status IS DISTINCT FROM 'paid'`, [req.params.id]
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
