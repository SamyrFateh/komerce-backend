/**
 * KOMERCE — /api/shares
 *
 * Route A — POST /api/shares     : Créer un partage de panier
 * Route B — GET  /api/shares/:token : Récupérer un panier partagé
 */

'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Token court de 8 caractères URL-safe */
function generateShareToken() {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

/** SHA256 sans stocker de PII (IP, User-Agent) */
function sha256(str) {
  return crypto.createHash('sha256').update(str || '').digest('hex');
}

// ── Route A — POST /api/shares ─────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { cart_items, sharer_name } = req.body;

    if (!Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({ error: 'cart_items[] obligatoire (tableau, min 1 article)' });
    }

    // Validation des items
    for (const item of cart_items) {
      if (!item.product_id || typeof item.product_id !== 'string') {
        return res.status(400).json({ error: 'Chaque item doit avoir un product_id (string)' });
      }
      const qty = parseInt(item.qty, 10);
      if (!qty || qty < 1) {
        return res.status(400).json({ error: `qty invalide pour product_id: ${item.product_id}` });
      }
    }

    // Récupère les produits pour calculer le total et vérifier l'existence
    const productIds = cart_items.map(i => i.product_id);
    const { rows: products } = await db.query(
      'SELECT id, name, price_kmf, image_url FROM products WHERE id = ANY($1) AND is_active = TRUE',
      [productIds]
    );

    if (products.length === 0) {
      return res.status(404).json({ error: 'Aucun produit actif trouvé dans le panier' });
    }

    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    let cart_total_kmf = 0;
    let items_count = 0;

    for (const item of cart_items) {
      const product = productMap[item.product_id];
      if (!product) continue; // produit inconnu ignoré silencieusement
      const qty = parseInt(item.qty, 10) || 1;
      cart_total_kmf += product.price_kmf * qty;
      items_count += qty;
    }

    if (items_count === 0) {
      return res.status(400).json({ error: 'Aucun article valide dans le panier' });
    }

    // Hash IP + UA (anti-spam, zéro PII stocké)
    const rawIp = req.ip || req.headers['x-forwarded-for'] || '';
    const rawUa = req.headers['user-agent'] || '';
    const sharer_ip_hash = sha256(rawIp);
    const sharer_ua_hash = sha256(rawUa);

    // Génère un token unique (retry sur collision, probabilité infime)
    let share_token;
    for (let i = 0; i < 5; i++) {
      const candidate = generateShareToken();
      const { rows: existing } = await db.query(
        'SELECT id FROM cart_shares WHERE share_token = $1',
        [candidate]
      );
      if (existing.length === 0) { share_token = candidate; break; }
    }

    if (!share_token) {
      return res.status(503).json({ error: 'Impossible de générer un token unique, réessayez' });
    }

    const { rows: [share] } = await db.query(
      `INSERT INTO cart_shares (
        share_token, cart_items, cart_total_kmf, items_count,
        sharer_name, sharer_ip_hash, sharer_ua_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING share_token, created_at`,
      [
        share_token,
        JSON.stringify(cart_items),
        cart_total_kmf,
        items_count,
        sharer_name ? sharer_name.slice(0, 50) : null,
        sharer_ip_hash,
        sharer_ua_hash,
      ]
    );

    const baseUrl = process.env.FRONTEND_URL || 'https://komerce.km';
    const share_url = `${baseUrl}/Komerce_Boutique.html?share=${share.share_token}`;

    return res.status(201).json({
      share_token: share.share_token,
      share_url,
      created_at: share.created_at,
    });

  } catch (err) {
    next(err);
  }
});

// ── Route B — GET /api/shares/:token ──────────────────────────────────────

router.get('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    // Validation légère du format du token
    if (!token || token.length > 20 || !/^[\w-]+$/.test(token)) {
      return res.status(400).json({ error: 'Format de token invalide' });
    }

    const { rows: [share] } = await db.query(
      'SELECT * FROM cart_shares WHERE share_token = $1',
      [token]
    );

    if (!share) {
      return res.status(404).json({ error: 'Partage introuvable ou expiré' });
    }

    // Incrémente open_count + set first_opened_at (fire-and-forget, non bloquant)
    db.query(
      `UPDATE cart_shares
       SET open_count       = open_count + 1,
           first_opened_at  = COALESCE(first_opened_at, NOW())
       WHERE share_token = $1`,
      [token]
    ).catch(e => console.error('[SHARES] open_count update error:', e.message));

    // Enrichit les items avec le snapshot produit courant
    const cartItems = share.cart_items; // JSONB → déjà parsé par le driver pg
    const productIds = cartItems.map(i => i.product_id);

    const { rows: products } = await db.query(
      'SELECT id, name, price_kmf, image_url FROM products WHERE id = ANY($1)',
      [productIds]
    );
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    const enrichedItems = cartItems.map(item => ({
      product_id: item.product_id,
      qty: item.qty,
      product_snapshot: productMap[item.product_id]
        ? {
            name:  productMap[item.product_id].name,
            price: productMap[item.product_id].price_kmf,
            image: productMap[item.product_id].image_url,
          }
        : null,
    }));

    return res.json({
      cart_items:  enrichedItems,
      total_kmf:   share.cart_total_kmf,
      sharer_name: share.sharer_name,
      items_count: share.items_count,
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
