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
const { authenticate } = require('../middleware/auth');
const { generateBasketCode } = require('../utils/reference');
const { sendSMS } = require('../utils/sms');

async function getRates() {
  const { rows } = await db.query('SELECT eur_kmf, aed_kmf FROM exchange_rates ORDER BY valid_from DESC LIMIT 1');
  return rows[0] || { eur_kmf: 492, aed_kmf: 138 };
}

// POST /api/baskets/share
router.post('/share', async (req, res) => {
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

    for (const item of items) {
      const p = await db.query('SELECT price_kmf FROM products WHERE id=$1 AND is_active=TRUE', [item.product_id]);
      if (!p.rows.length) continue;
      await db.query(
        'INSERT INTO basket_items (basket_id, product_id, added_by, quantity, price_kmf) VALUES ($1,$2,$3,$4,$5)',
        [basket.id, item.product_id, owner_id, item.quantity||1, p.rows[0].price_kmf]
      );
    }

    const url = `${process.env.FRONTEND_URL||'https://komerce.km'}/panier/${code}`;
    const msg = `Komerce — ${creator_name||'Votre proche'} vous partage un panier. Cliquez pour payer depuis la France : ${url} (valable 7 jours)`;

    res.status(201).json({
      code, url, expires_at,
      whatsapp_message: msg,
      whatsapp_url: `https://wa.me/?text=${encodeURIComponent(msg)}`,
    });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur panier partagé' }); }
});

// GET /api/baskets/:code
router.get('/:code([A-Z]-[A-Z0-9]{4})', async (req, res) => {
  try {
    const { rows: [basket] } = await db.query(
      'SELECT * FROM baskets WHERE code=$1 AND expires_at>NOW() AND is_locked=FALSE',
      [req.params.code]
    );
    if (!basket) return res.status(404).json({ error: 'Panier introuvable ou expiré' });

    const { rows: items } = await db.query(
      'SELECT bi.*, p.name, p.emoji, p.category, p.price_kmf FROM basket_items bi JOIN products p ON p.id=bi.product_id WHERE bi.basket_id=$1',
      [basket.id]
    );

    const total_kmf = items.reduce((s,i) => s + i.price_kmf * i.quantity, 0);
    const rates     = await getRates();

    res.json({ basket, items, total_kmf, total_eur: Math.round(total_kmf/rates.eur_kmf) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PATCH /api/baskets/:code
router.patch('/:code', async (req, res) => {
  try {
    const { rows: [basket] } = await db.query(
      'SELECT * FROM baskets WHERE code=$1 AND expires_at>NOW() AND is_locked=FALSE', [req.params.code]
    );
    if (!basket) return res.status(404).json({ error: 'Panier introuvable ou verrouillé' });

    const { add=[], remove=[], update_qty={} } = req.body;
    const uid = req.user?.id || null;

    for (const item of add) {
      const p = await db.query('SELECT price_kmf FROM products WHERE id=$1', [item.product_id]);
      if (!p.rows.length) continue;
      const ex = await db.query('SELECT id FROM basket_items WHERE basket_id=$1 AND product_id=$2', [basket.id, item.product_id]);
      if (ex.rows.length) await db.query('UPDATE basket_items SET quantity=quantity+$1 WHERE id=$2', [item.quantity||1, ex.rows[0].id]);
      else await db.query('INSERT INTO basket_items (basket_id,product_id,added_by,quantity,price_kmf) VALUES ($1,$2,$3,$4,$5)', [basket.id, item.product_id, uid, item.quantity||1, p.rows[0].price_kmf]);
    }

    if (remove.length) await db.query('DELETE FROM basket_items WHERE basket_id=$1 AND product_id=ANY($2)', [basket.id, remove]);

    for (const [pid, qty] of Object.entries(update_qty)) {
      if (parseInt(qty) <= 0) await db.query('DELETE FROM basket_items WHERE basket_id=$1 AND product_id=$2', [basket.id, pid]);
      else await db.query('UPDATE basket_items SET quantity=$1 WHERE basket_id=$2 AND product_id=$3', [qty, basket.id, pid]);
    }

    const { rows: items } = await db.query(
      'SELECT bi.*, p.name, p.emoji, p.price_kmf FROM basket_items bi JOIN products p ON p.id=bi.product_id WHERE bi.basket_id=$1',
      [basket.id]
    );
    res.json({ code: req.params.code, items, total_kmf: items.reduce((s,i)=>s+i.price_kmf*i.quantity,0) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur modification panier' }); }
});

// POST /api/baskets/:code/pay — Amina paie
router.post('/:code/pay', authenticate, async (req, res) => {
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
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur paiement panier' }); }
});

// POST /api/baskets/gift — Ali offre un panier
router.post('/gift', authenticate, async (req, res) => {
  try {
    const { items, recipient_phone, recipient_name } = req.body;
    if (!items?.length || !recipient_phone) return res.status(400).json({ error: 'items et recipient_phone requis' });

    const code       = generateBasketCode();
    const expires_at = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const { rows: [basket] } = await db.query(
      "INSERT INTO baskets (code,type,owner_id,expires_at) VALUES ($1,'gift',$2,$3) RETURNING *",
      [code, req.user.id, expires_at]
    );

    let total_kmf = 0;
    for (const item of items) {
      const p = await db.query('SELECT price_kmf, name FROM products WHERE id=$1', [item.product_id]);
      if (!p.rows.length) continue;
      const price = p.rows[0].price_kmf;
      await db.query(
        'INSERT INTO basket_items (basket_id,product_id,added_by,quantity,price_kmf,note) VALUES ($1,$2,$3,$4,$5,$6)',
        [basket.id, item.product_id, req.user.id, item.quantity||1, price, item.note||null]
      );
      total_kmf += price * (item.quantity||1);
    }

    res.status(201).json({ basket_id: basket.id, code, expires_at, total_kmf, recipient_phone, recipient_name,
      message: 'Cadeau créé — payer via /api/payments puis confirmer via POST /api/baskets/gift/'+code+'/confirm' });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur cadeau' }); }
});

// POST /api/baskets/gift/:code/confirm — SMS destinataire
router.post('/gift/:code/confirm', authenticate, async (req, res) => {
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
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur confirmation cadeau' }); }
});

module.exports = router;
