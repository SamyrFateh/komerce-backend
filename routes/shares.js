/**
 * @komerce-arch
 * @role          shares
 * @domain        shared-cart
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       cart_contributions, cart_shares, products
 * @db-write      cart_contributions, cart_shares
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */


'use strict';
// routes/shares.js — v2 (event shares + contributions)
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db');
const { sharedCartLimiter } = require('../middleware/rate-limit');
const log = require('../utils/logger').child({ module: 'shares' });

// ── DDL géré par migrations/075_hub_shares_collective_schema.sql ────────────

/* ── helpers ─────────────────────────────────────── */
// [TOK-02] CSPRNG (crypto.randomBytes) au lieu de Math.random() —
// alphabet base58-like (ambiguïtés 0/O/I/l retirées), longueur ≥ 12.
// share_token est VARCHAR(20) (migrations/057) : 12 <= 20, compatible.
function genToken(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let t = '';
  for (let i = 0; i < len; i++) t += chars[bytes[i] % chars.length];
  return t;
}

async function enrichItems(items) {
  if (!items || !items.length) return [];
  const ids = [...new Set(items.map(i => i.product_id).filter(Boolean))];
  if (!ids.length) return items;
  const { rows } = await db.query(
    `SELECT id, name, price_kmf, promo_pct, is_promo, promo_until, images FROM products WHERE id = ANY($1)`,
    [ids]
  );
  const byId = {};
  rows.forEach(p => byId[p.id] = p);
  return items.map(item => {
    const p = byId[item.product_id] || {};
    return {
      product_id: item.product_id,
      qty: item.qty || 1,
      product: {
        id: item.product_id,
        name: p.name || item.name || 'Produit',
        price_kmf: (() => {
          const now = new Date();
          const promoActive = p.is_promo && p.promo_pct > 0 &&
            (!p.promo_until || new Date(p.promo_until) >= now);
          return promoActive
            ? Math.round(p.price_kmf * (1 - p.promo_pct / 100))
            : (p.price_kmf || item.price_kmf || 0);
        })(),
        images: p.images || []
      }
    };
  });
}

/* ── POST /api/shares — créer un lien (simple ou événement) ── */
router.post('/', sharedCartLimiter, async (req, res, next) => {
  try {
  
    const {
      cart_items,
      type        = 'simple',   // 'simple' | 'event'
      event_label = null,       // ex: "Mariage de Samyr 🎉"
      sharer_name = null
    } = req.body;

    if (!cart_items || !Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({ error: 'cart_items requis' });
    }

    // Calculer le total snapshot
    const total_kmf = cart_items.reduce((sum, i) => {
      return sum + ((i.price_kmf || i.product?.price_kmf || 0) * (i.qty || 1));
    }, 0);

    let token;
    let attempts = 0;
    while (attempts < 5) {
      token = genToken(12);
      const { rowCount } = await db.query(
        'SELECT 1 FROM cart_shares WHERE share_token = $1', [token]
      );
      if (rowCount === 0) break;
      attempts++;
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000); // 30 jours

    await db.query(
      `INSERT INTO cart_shares
         (share_token, cart_items, type, event_label, sharer_name, status, contributed_kmf, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'active', 0, $6)`,
      [token, JSON.stringify(cart_items), type, event_label, sharer_name, expiresAt]
    );

    const host = process.env.APP_URL || `https://${req.headers.host}`;
    return res.json({
      token,
      url:      `${host}/c/${token}`,
      redirect: `/boutique/?share=${token}`,
      type,
      event_label,
      total_kmf
    });
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/shares/:token — lire un panier partagé ── */
router.get('/:token', async (req, res, next) => {
  try {
  
    const { token } = req.params;
    const { rows } = await db.query(
      `SELECT * FROM cart_shares WHERE share_token = $1`, [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lien introuvable ou expiré' });

    const share = rows[0];

    // Vérifier expiration
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Ce lien a expiré' });
    }

    const rawItems = typeof share.cart_items === 'string'
      ? JSON.parse(share.cart_items)
      : share.cart_items || [];

    const items = await enrichItems(rawItems);

    const total_kmf = items.reduce((s, i) => s + (i.product.price_kmf * i.qty), 0);

    // Contributions si mode événement
    let contributions = [];
    let contributed_kmf = share.contributed_kmf || 0;
    if (share.type === 'event') {
      const cRes = await db.query(
        `SELECT contributor_name, mode, product_id, amount_kmf, message, status, created_at
         FROM cart_contributions
         WHERE share_token = $1
         ORDER BY created_at ASC`,
        [token]
      );
      contributions = cRes.rows;
      contributed_kmf = contributions
        .filter(c => c.status !== 'cancelled')
        .reduce((s, c) => s + (c.amount_kmf || 0), 0);
    }

    return res.json({
      token,
      type:          share.type || 'simple',
      event_label:   share.event_label || null,
      sharer_name:   share.sharer_name || null,
      status:        share.status || 'active',
      expires_at:    share.expires_at,
      items,
      total_kmf,
      contributed_kmf,
      remaining_kmf: Math.max(0, total_kmf - contributed_kmf),
      contributions
    });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/shares/:token/contributions — pledger ── */
router.post('/:token/contributions', sharedCartLimiter, async (req, res, next) => {
  try {
  
    const { token } = req.params;
    const {
      contributor_name,
      mode       = 'amount',  // 'item' | 'amount'
      product_id = null,
      amount_kmf = null,
      message    = null
    } = req.body;

    if (!contributor_name) return res.status(400).json({ error: 'contributor_name requis' });
    if (mode === 'item' && !product_id) return res.status(400).json({ error: 'product_id requis pour mode item' });
    if (mode === 'amount' && (!amount_kmf || amount_kmf <= 0)) return res.status(400).json({ error: 'amount_kmf requis' });

    // Vérifier que le share existe et est actif
    const { rows } = await db.query(
      `SELECT type, status, expires_at FROM cart_shares WHERE share_token = $1`, [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lien introuvable' });
    const share = rows[0];
    if (share.status !== 'active') return res.status(400).json({ error: 'Ce panier est clôturé' });
    if (share.type !== 'event') return res.status(400).json({ error: 'Ce panier ne supporte pas les contributions' });
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Ce lien a expiré' });
    }

    // Calculer montant si mode item
    let finalAmount = amount_kmf;
    if (mode === 'item' && product_id) {
      const pRes = await db.query(
        `SELECT CASE WHEN is_promo AND promo_pct > 0 AND (promo_until IS NULL OR promo_until >= CURRENT_DATE) THEN ROUND(price_kmf * (1 - promo_pct / 100.0)) ELSE price_kmf END AS price FROM products WHERE id = $1`, [product_id]
      );
      if (pRes.rows.length) finalAmount = pRes.rows[0].price;
    }

    const { rows: insertRows } = await db.query(
      `INSERT INTO cart_contributions
         (share_token, contributor_name, mode, product_id, amount_kmf, message, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pledged')
       RETURNING id, contributor_name, mode, amount_kmf, message, status, created_at`,
      [token, contributor_name, mode, product_id, finalAmount, message]
    );

    // Mettre à jour contributed_kmf sur cart_shares
    await db.query(
      `UPDATE cart_shares SET contributed_kmf = (
        SELECT COALESCE(SUM(amount_kmf), 0) FROM cart_contributions
        WHERE share_token = $1 AND status != 'cancelled'
      ) WHERE share_token = $1`,
      [token]
    );

    return res.status(201).json({ contribution: insertRows[0] });
  } catch (err) {
    next(err);
  }
});

/* ── PATCH /api/shares/:token/contributions/:id — confirmer paiement (admin) ── */
router.patch('/:token/contributions/:id', async (req, res, next) => {
  try {
  
    const { token, id } = req.params;
    const { status } = req.body; // 'paid' | 'cancelled'
    if (!['paid', 'cancelled'].includes(status)) return res.status(400).json({ error: 'status invalide' });

    await db.query(
      `UPDATE cart_contributions SET status = $1 WHERE id = $2 AND share_token = $3`,
      [status, id, token]
    );

    // Recalculer contributed_kmf
    await db.query(
      `UPDATE cart_shares SET contributed_kmf = (
        SELECT COALESCE(SUM(amount_kmf), 0) FROM cart_contributions
        WHERE share_token = $1 AND status != 'cancelled'
      ) WHERE share_token = $1`,
      [token]
    );

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.genToken = genToken; // exposé pour preuve TOK-02 (CSPRNG, cf. tests/unit/shares-token-entropy.test.js)
module.exports = router;
