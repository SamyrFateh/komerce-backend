/**
 * KOMERCE — Panier Partagé M10 + Offrir un panier
 * POST /api/baskets/share          → lien K-XXXX partageable WhatsApp
 * GET  /api/baskets/:code          → consulter panier
 * PATCH /api/baskets/:code         → modifier panier (Ali ou Amina)
 * POST /api/baskets/:code/pay      → Amina paie depuis la France
 * POST /api/baskets/gift           → Ali offre un panier complet
 * POST /api/baskets/gift/:code/confirm → SMS destinataire + code retrait
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const log     = require('../utils/logger').child({ module: 'baskets' });
const { authenticate } = require('../middleware/auth');
const { generateBasketCode } = require('../utils/reference');
const { sendSMS } = require('../utils/sms');

const { getRates } = require('../utils/rates');
const { validate } = require('../middleware/validate');
const { baskets } = require('../validators');

// GET /api/baskets — lister les paniers (admin: tous, client: les siens)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const baseQuery = `
      SELECT b.*,
             u.full_name AS owner_name,
             COUNT(bi.id) AS item_count,
             COALESCE(SUM(bi.price_kmf * bi.quantity), 0) AS total_kmf
      FROM baskets b
      LEFT JOIN users u ON u.id = b.owner_id
      LEFT JOIN basket_items bi ON bi.basket_id = b.id
      ${isAdmin ? '' : 'WHERE b.owner_id = $1'}
      GROUP BY b.id, u.full_name
      ORDER BY b.created_at DESC
    `;
    const { rows } = isAdmin
      ? await db.query(baseQuery)
      : await db.query(baseQuery, [req.user.id]);
    res.json(rows);
  } catch(e) { next(e); }
});

// POST /api/baskets/share
router.post('/share', validate(baskets.share), async (req, res, next) => {
  try {
    const { items, creator_name } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'Panier vide' });

    const code       = generateBasketCode();
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const owner_id   = req.user?.id || null;

    const { rows: [basket] } = await db.query(
      "INSERT INTO baskets (code, type, owner_id, expires_at) VALUES ($1,'shared',$2,$3) RETURNING *",
      [code, owner_id, expires_at]
    );

    // Charger tous les produits en une seule requête (batch)
    const productIds = items.map(i => i.product_id);
    const { rows: products } = await db.query(
      'SELECT id, price_kmf FROM products WHERE id = ANY($1) AND is_active = TRUE',
      [productIds]
    );
    const priceMap = Object.fromEntries(products.map(p => [p.id, p.price_kmf]));

    // Insérer tous les articles valides en un seul INSERT multi-valeurs
    const validItems = items.filter(i => priceMap[i.product_id] != null);
    if (validItems.length) {
      const vals = validItems.flatMap((item, idx) => [
        basket.id, item.product_id, owner_id, item.quantity || 1, priceMap[item.product_id],
      ]);
      const ph = validItems.map((_, idx) =>
        `($${idx * 5 + 1},$${idx * 5 + 2},$${idx * 5 + 3},$${idx * 5 + 4},$${idx * 5 + 5})`
      ).join(',');
      await db.query(
        `INSERT INTO basket_items (basket_id, product_id, added_by, quantity, price_kmf) VALUES ${ph}`,
        vals
      );
    }

    const url = `${process.env.FRONTEND_URL||'https://komerce.km'}/panier/${code}`;
    const msg = `Komerce — ${creator_name||'Votre proche'} vous partage un panier. Cliquez pour payer depuis la France : ${url} (valable 7 jours)`;

    res.status(201).json({
      code, url, expires_at,
      whatsapp_message: msg,
      whatsapp_url: `https://wa.me/?text=${encodeURIComponent(msg)}`,
    });
  } catch(e) { next(e); }
});

// GET /api/baskets/:code
router.get('/:code([A-Z]-[A-Z0-9]{4})', async (req, res, next) => {
  try {
    const { rows: [basket] } = await db.query(
      'SELECT * FROM baskets WHERE code=$1 AND expires_at>NOW() AND is_locked=FALSE',
      [req.params.code]
    );
    if (!basket) return res.status(404).json({ error: 'Panier introuvable ou expiré' });

    // BASKETS-1 : alias explicites pour détecter la divergence snapshot vs catalogue (2026-05-26)
    const { rows: items } = await db.query(
      `SELECT bi.product_id, bi.quantity, bi.added_by, bi.note,
              bi.price_kmf  AS snapshot_price_kmf,
              p.price_kmf   AS current_price_kmf,
              p.name, p.emoji, p.category
         FROM basket_items bi
         JOIN products p ON p.id = bi.product_id
        WHERE bi.basket_id = $1`,
      [basket.id]
    );

    // Détection divergence prix snapshot vs catalogue
    const divergedItems = items.filter(i => i.snapshot_price_kmf !== i.current_price_kmf);
    if (divergedItems.length > 0) {
      log.warn({
        basket_code: basket.code,
        basket_id: basket.id,
        diverged: divergedItems.map(i => ({
          product_id: i.product_id,
          snapshot_price_kmf: i.snapshot_price_kmf,
          current_price_kmf: i.current_price_kmf,
          delta_kmf: i.current_price_kmf - i.snapshot_price_kmf,
        })),
      }, 'BASKETS-1 price_divergence: snapshot price differs from catalogue');
    }

    // On expose le prix snapshot (celui qui sera utilisé à la commande) + un flag divergence
    const itemsForClient = items.map(i => ({
      ...i,
      price_kmf: i.snapshot_price_kmf,
      price_changed: i.snapshot_price_kmf !== i.current_price_kmf,
    }));

    const total_kmf = itemsForClient.reduce((s, i) => s + i.snapshot_price_kmf * i.quantity, 0);
    const rates     = await getRates();

    res.json({
      basket,
      items: itemsForClient,
      total_kmf,
      total_eur: Math.round(total_kmf / rates.eur_kmf),
      price_divergence: divergedItems.length > 0,
    });
  } catch(e) { next(e); }
});

// PATCH /api/baskets/:code
// ⚠️ SECURITY FIX: Wrapped in transaction for atomicity
router.patch('/:code', authenticate, validate(baskets.updateBasket), async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [basket] } = await client.query(
      'SELECT * FROM baskets WHERE code=$1 AND expires_at>NOW() AND is_locked=FALSE', [req.params.code]
    );
    if (!basket) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Panier introuvable ou verrouillé' });
    }

    const { add=[], remove=[], update_qty={} } = req.body;
    const uid = req.user?.id || null;

    for (const item of add) {
      const p = await client.query('SELECT price_kmf FROM products WHERE id=$1', [item.product_id]);
      if (!p.rows.length) continue;
      const ex = await client.query('SELECT id FROM basket_items WHERE basket_id=$1 AND product_id=$2', [basket.id, item.product_id]);
      if (ex.rows.length) await client.query('UPDATE basket_items SET quantity=quantity+$1 WHERE id=$2', [item.quantity||1, ex.rows[0].id]);
      else await client.query('INSERT INTO basket_items (basket_id,product_id,added_by,quantity,price_kmf) VALUES ($1,$2,$3,$4,$5)', [basket.id, item.product_id, uid, item.quantity||1, p.rows[0].price_kmf]);
    }

    if (remove.length) await client.query('DELETE FROM basket_items WHERE basket_id=$1 AND product_id=ANY($2)', [basket.id, remove]);

    for (const [pid, qty] of Object.entries(update_qty)) {
      if (parseInt(qty) <= 0) await client.query('DELETE FROM basket_items WHERE basket_id=$1 AND product_id=$2', [basket.id, pid]);
      else await client.query('UPDATE basket_items SET quantity=$1 WHERE basket_id=$2 AND product_id=$3', [qty, basket.id, pid]);
    }

    const { rows: items } = await client.query(
      'SELECT bi.*, p.name, p.emoji, p.price_kmf FROM basket_items bi JOIN products p ON p.id=bi.product_id WHERE bi.basket_id=$1',
      [basket.id]
    );

    await client.query('COMMIT');
    res.json({ code: req.params.code, items, total_kmf: items.reduce((s,i)=>s+i.price_kmf*i.quantity,0) });
  } catch(e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

// POST /api/baskets/:code/pay — Amina paie
router.post('/:code/pay', authenticate, async (req, res, next) => {
  try {
    const { rows: [basket] } = await db.query(
      'SELECT * FROM baskets WHERE code=$1 AND expires_at>NOW() AND is_locked=FALSE', [req.params.code]
    );
    if (!basket) return res.status(404).json({ error: 'Panier introuvable ou expiré' });

    await db.query('UPDATE baskets SET is_locked=TRUE WHERE id=$1', [basket.id]);

    if (basket.owner_id) {
      const [creator, payer] = await Promise.all([
        db.query('SELECT phone, full_name FROM users WHERE id=$1', [basket.owner_id]),
        db.query('SELECT full_name FROM users WHERE id=$1', [req.user.id]),
      ]);
      if (creator.rows[0]?.phone) {
        await sendSMS(creator.rows[0].phone,
          `Komerce · ${payer.rows[0]?.full_name||'Quelqu\'un'} a payé votre panier ${basket.code} ! Commande en cours de traitement.`,
          'basket_paid', null
        );
      }
    }

    const { rows: items } = await db.query(
      'SELECT product_id, quantity, price_kmf FROM basket_items WHERE basket_id=$1', [basket.id]
    );

    res.json({ basket_id: basket.id, code: basket.code, items,
      message: 'Panier verrouillé — créer commande via POST /api/orders avec ces items' });
  } catch(e) { next(e); }
});

// POST /api/baskets/gift — Ali offre un panier
router.post('/gift', authenticate, validate(baskets.gift), async (req, res, next) => {
  try {
    const { items, recipient_phone, recipient_name } = req.body;
    if (!items?.length || !recipient_phone) return res.status(400).json({ error: 'items et recipient_phone requis' });

    const code       = generateBasketCode();
    const expires_at = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const { rows: [basket] } = await db.query(
      "INSERT INTO baskets (code,type,owner_id,expires_at) VALUES ($1,'gift',$2,$3) RETURNING *",
      [code, req.user.id, expires_at]
    );

    // Charger tous les produits en une seule requête (batch)
    const giftProductIds = items.map(i => i.product_id);
    const { rows: giftProducts } = await db.query(
      'SELECT id, price_kmf, name FROM products WHERE id = ANY($1)',
      [giftProductIds]
    );
    const giftPriceMap = Object.fromEntries(giftProducts.map(p => [p.id, p.price_kmf]));

    const validGiftItems = items.filter(i => giftPriceMap[i.product_id] != null);
    let total_kmf = 0;

    if (validGiftItems.length) {
      const vals = validGiftItems.flatMap((item, idx) => [
        basket.id, item.product_id, req.user.id, item.quantity || 1,
        giftPriceMap[item.product_id], item.note || null,
      ]);
      const ph = validGiftItems.map((_, idx) =>
        `($${idx * 6 + 1},$${idx * 6 + 2},$${idx * 6 + 3},$${idx * 6 + 4},$${idx * 6 + 5},$${idx * 6 + 6})`
      ).join(',');
      await db.query(
        `INSERT INTO basket_items (basket_id, product_id, added_by, quantity, price_kmf, note) VALUES ${ph}`,
        vals
      );
      total_kmf = validGiftItems.reduce((s, item) =>
        s + giftPriceMap[item.product_id] * (item.quantity || 1), 0
      );
    }

    res.status(201).json({ basket_id: basket.id, code, expires_at, total_kmf, recipient_phone, recipient_name,
      message: 'Cadeau créé — payer via /api/payments puis confirmer via POST /api/baskets/gift/'+code+'/confirm' });
  } catch(e) { next(e); }
});

// POST /api/baskets/gift/:code/confirm — SMS destinataire
router.post('/gift/:code/confirm', authenticate, validate(baskets.giftConfirm), async (req, res, next) => {
  try {
    const { recipient_phone, recipient_name, relais_name, order_reference } = req.body;
    if (!recipient_phone) return res.status(400).json({ error: 'recipient_phone requis' });

    await db.query("UPDATE baskets SET is_locked=TRUE WHERE code=$1 AND type='gift'", [req.params.code]);

    const payer = await db.query('SELECT full_name FROM users WHERE id=$1', [req.user.id]);
    const payerName  = payer.rows[0]?.full_name || 'Votre proche';
    const relay      = relais_name || 'votre point relais';
    const codeRetrait = order_reference || req.params.code;

    await sendSMS(
      recipient_phone,
      `Komerce · ${payerName} vous a offert un panier cadeau ! Code de retrait : ${codeRetrait} au ${relay}. Aucun paiement requis de votre part.`,
      'gift', null
    );

    res.json({ message: 'SMS envoyé au destinataire', recipient_phone, code_retrait: codeRetrait });
  } catch(e) { next(e); }
});

module.exports = router;
