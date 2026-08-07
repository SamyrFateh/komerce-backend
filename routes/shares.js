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
 * @db-read       cart_shares, products
 * @db-write      cart_shares
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */


'use strict';
// routes/shares.js — partage simple de snapshot
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

/* ── POST /api/shares — créer un lien simple ── */
router.post('/', sharedCartLimiter, async (req, res, next) => {
  try {
  
    const { cart_items, sharer_name = null } = req.body;

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
       VALUES ($1, $2, 'simple', NULL, $3, 'active', 0, $4)`,
      [token, JSON.stringify(cart_items), sharer_name, expiresAt]
    );

    const host = process.env.APP_URL || `https://${req.headers.host}`;
    return res.json({
      token,
      url:      `${host}/c/${token}`,
      redirect: `/boutique/?share=${token}`,
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

    return res.json({
      token,
      sharer_name: share.sharer_name || null,
      status:      share.status || 'active',
      expires_at:  share.expires_at,
      items,
      total_kmf
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
