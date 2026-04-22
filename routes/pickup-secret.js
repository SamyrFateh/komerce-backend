/**
 * KOMERCE — Pickup Secret API v1
 *
 * Implémentation du modèle Western Union pour Komerce :
 *   - Code secret généré AU MOMENT DU PAIEMENT (jamais avant)
 *   - Code hashé en DB (sha256 + salt unique par commande)
 *   - Le code clair n'est renvoyé qu'UNE SEULE FOIS (au moment de la génération)
 *   - Validation du code au moment du retrait avec rate limit
 *
 * Voir /docs/SECURITY-MODEL.md pour la doctrine complète.
 *
 * Routes :
 *   POST /api/pickup/pay-cash/:orderId   — Encaissement cash → génère le code
 *   GET  /api/pickup/receipt/:orderId    — HTML imprimable du reçu (agent only, one-shot)
 *   POST /api/pickup/verify/:orderId     — Vérifier un code au retrait (rate-limited)
 *   POST /api/pickup/collect/:orderId    — Marquer comme récupéré (après verify OK)
 *   POST /api/pickup/regenerate/:orderId — Admin : régénérer un code (perte de reçu)
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

// Alphabet sans confusion visuelle : pas de 0/O/I/1/l
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH   = 8;

/**
 * Génère un code secret de 8 caractères groupés par 3 : "A7K-3M9-P2"
 * Espace de code : 32^8 = 1.1e12 combinaisons
 */
function generatePickupCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  // Formatter : A7K-3M9-P2 (groupes 3-3-2)
  return raw.slice(0, 3) + '-' + raw.slice(3, 6) + '-' + raw.slice(6, 8);
}

/**
 * Hash un code avec salt (sha256)
 */
function hashCode(code, salt) {
  const normalized = String(code).replace(/[-\s]/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized + salt).digest('hex');
}

/**
 * Normalise un code saisi (retire tirets et espaces, upper-case)
 */
function normalizeCode(input) {
  return String(input || '').replace(/[-\s]/g, '').toUpperCase();
}

// Helper : rôle agent relais ou admin
function isRelaisOrAdmin(req) {
  const role = req.user?.role;
  return role === 'admin' || role === 'agent_relais';
}
function requireRelaisOrAdmin(req, res, next) {
  if (!isRelaisOrAdmin(req)) {
    return res.status(403).json({ error: 'Accès réservé agents relais et admin' });
  }
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. POST /pay-cash/:orderId — Encaissement cash, génère le code secret
// ══════════════════════════════════════════════════════════════════════════════
// L'agent encaisse le cash. Le backend génère le code. Le code clair est renvoyé
// UNE SEULE FOIS (l'agent doit l'imprimer immédiatement). Après ça, seul le hash
// reste en DB.
router.post('/pay-cash/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const agentId     = req.user.id;
    const {
      payer_name,                 // obligatoire : nom du payeur qui paie physiquement
      payer_id_type,              // optionnel : 'CNI' | 'passport' | 'permis' | ...
      payer_id_number,            // optionnel : numéro de la pièce
      payer_note,                 // optionnel : note libre agent ("c'est la tante")
      tracking_phone_primary,     // optionnel : confirmer/corriger le numéro de suivi principal
      tracking_phone_secondary,   // optionnel : second numéro "personne de confiance"
    } = req.body;

    if (!payer_name || !payer_name.trim()) {
      return res.status(400).json({ error: 'Le nom du payeur est obligatoire' });
    }

    // Validation légère du format des numéros (si fournis)
    const phoneRx = /^[+]?[0-9\s().-]{6,20}$/;
    if (tracking_phone_primary && !phoneRx.test(tracking_phone_primary)) {
      return res.status(400).json({ error: 'Numéro principal invalide' });
    }
    if (tracking_phone_secondary && !phoneRx.test(tracking_phone_secondary)) {
      return res.status(400).json({ error: 'Numéro secondaire invalide' });
    }

    // 1. Vérifier que la commande existe et est en pending_payment
    const { rows: [order] } = await db.query(`
      SELECT id, reference, total_kmf, payment_mode, status, pickup_secret_hash,
             tracking_phone, tracking_phone_secondary, relais_id
      FROM orders WHERE id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    if (order.payment_mode !== 'cash_relais') {
      return res.status(400).json({ error: 'Cette commande n\'est pas en paiement cash relais' });
    }
    if (order.pickup_secret_hash) {
      return res.status(409).json({
        error: 'Un code secret existe déjà pour cette commande. Si le reçu est perdu, utilisez la procédure de régénération admin.',
      });
    }

    // 2. Générer le code secret + salt (avec anti-collision sur last4 du relais)
    // Les 4 derniers caractères alphanumériques servent de "short code" que
    // l'agent saisira au guichet. On s'assure qu'aucun autre code ACTIF du
    // même relais n'a les mêmes 4 derniers chars.
    let code, last4, hash;
    const salt = crypto.randomBytes(16).toString('hex');
    let attempts = 0;
    const MAX_GEN_ATTEMPTS = 50;
    while (attempts < MAX_GEN_ATTEMPTS) {
      code  = generatePickupCode();
      last4 = code.replace(/-/g, '').slice(-4);
      // Vérifier qu'aucune commande ACTIVE du même relais n'a le même last4
      const { rows: [dup] } = await db.query(`
        SELECT id FROM orders
        WHERE pickup_secret_last4 = $1
          AND relais_id IS NOT DISTINCT FROM $2
          AND status NOT IN ('collected', 'cancelled', 'refunded')
          AND (pickup_secret_expires_at IS NULL OR pickup_secret_expires_at > NOW())
        LIMIT 1
      `, [last4, order.relais_id || null]);
      if (!dup) break;
      attempts++;
    }
    if (attempts >= MAX_GEN_ATTEMPTS) {
      console.error('[PICKUP-SECRET] Impossible de générer un code unique pour le relais ' + order.relais_id);
      return res.status(500).json({ error: 'Génération du code impossible (saturation) — contactez un admin' });
    }
    hash = hashCode(code, salt);
    const now     = new Date();
    const expires = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // +60 jours

    // Déterminer les numéros finaux : si agent corrige → utiliser valeur agent,
    // sinon conserver celle déjà en DB
    const finalPhonePrimary   = (tracking_phone_primary && tracking_phone_primary.trim())
                                  ? tracking_phone_primary.trim()
                                  : (order.tracking_phone || null);
    const finalPhoneSecondary = (tracking_phone_secondary && tracking_phone_secondary.trim())
                                  ? tracking_phone_secondary.trim()
                                  : null;

    // 3. Enregistrer en DB
    await db.query(`
      UPDATE orders
      SET pickup_secret_hash              = $1,
          pickup_secret_salt              = $2,
          pickup_secret_last4             = $13,
          pickup_secret_created_at        = $3,
          pickup_secret_expires_at        = $4,
          payment_received_at             = $3,
          payment_received_by_agent_id    = $5,
          payer_name                      = $6,
          payer_id_type                   = $7,
          payer_id_number                 = $8,
          payer_note                      = $9,
          tracking_phone                  = $10,
          tracking_phone_secondary        = $11,
          tracking_phone_confirmed_at     = $3,
          tracking_phone_confirmed_by_agent_id = $5,
          payment_status                  = 'paid',
          status                          = 'confirmed',
          confirmed_at                    = $3,
          updated_at                      = NOW()
      WHERE id = $12
    `, [hash, salt, now, expires, agentId, payer_name.trim(),
        payer_id_type || null, payer_id_number || null, payer_note || null,
        finalPhonePrimary, finalPhoneSecondary, orderId, last4]);

    // 4. Log d'audit (en cash_collections pour rester cohérent avec l'existant)
    await db.query(`
      INSERT INTO cash_collections (order_id, amount_kmf, collected_by, relais_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (order_id) DO NOTHING
    `, [orderId, Number(order.total_kmf), agentId, null]);

    console.log(`[PICKUP-SECRET] Généré pour ${order.reference} — agent=${agentId} payeur="${payer_name}"`);

    // 5. Renvoyer le code CLAIR une seule fois, avec un token d'impression
    // Le token d'impression permet d'accéder à /receipt/:orderId pendant 2 min
    const printToken = crypto.randomBytes(24).toString('hex');
    req.session = req.session || {};
    // Stocker en mémoire process (MVP — à migrer vers Redis pour multi-instance)
    printTokens.set(printToken, {
      orderId,
      code,
      payer_name: payer_name.trim(),
      expires_at: Date.now() + 2 * 60 * 1000,
    });

    res.json({
      success: true,
      message: `Paiement encaissé. Imprimez le reçu maintenant.`,
      code,                         // clair — à afficher à l'agent UNE FOIS
      print_token: printToken,      // utilisé pour /receipt/:orderId
      order_ref: order.reference,
      amount_kmf: Number(order.total_kmf),
    });

  } catch (err) { next(err); }
});

// Stockage mémoire temporaire des tokens d'impression
// TODO : migrer vers Redis quand on passera multi-instance
const printTokens = new Map();

// GC des tokens expirés toutes les 5 min
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of printTokens.entries()) {
    if (data.expires_at < now) printTokens.delete(token);
  }
}, 5 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /receipt/:orderId?token=... — HTML imprimable du reçu
// ══════════════════════════════════════════════════════════════════════════════
// Accès protégé par print_token (valable 2 min après encaissement).
// Retourne un HTML prêt à être imprimé (window.print()).
router.get('/receipt/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { token }   = req.query;

    if (!token) {
      return res.status(400).send('<h1>Token manquant</h1>');
    }

    const data = printTokens.get(token);
    if (!data || data.orderId !== orderId) {
      return res.status(403).send('<h1>Token invalide ou expiré</h1>');
    }
    if (data.expires_at < Date.now()) {
      printTokens.delete(token);
      return res.status(410).send('<h1>Token expiré (2 min). Relancez l\'encaissement.</h1>');
    }

    // Récupérer les détails de la commande pour le reçu
    const { rows: [order] } = await db.query(`
      SELECT
        o.reference, o.total_kmf, o.created_at,
        o.payment_received_at,
        o.payer_name,
        r.name AS relais_name, r.city AS relais_city,
        u.full_name AS agent_name
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      LEFT JOIN users u ON u.id = o.payment_received_by_agent_id
      WHERE o.id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).send('<h1>Commande introuvable</h1>');
    }

    // Récupérer les articles
    const { rows: items } = await db.query(`
      SELECT oi.quantity, oi.price_kmf, p.name AS product_name
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
    `, [orderId]);

    // Générer le HTML imprimable
    const html = buildReceiptHTML({
      code:       data.code,
      order,
      items,
    });

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) { next(err); }
});

/**
 * Construit le HTML imprimable du reçu (format A4 réduit ou thermique 80mm).
 * Le CSS utilise @media print pour optimiser l'impression.
 */
function buildReceiptHTML({ code, order, items }) {
  const fmtKmf = (n) => Number(n || 0).toLocaleString('fr-FR') + ' KMF';
  const dateFr = (d) => {
    const dt = new Date(d);
    return dt.toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const itemsHTML = (items || []).map(i => `
    <tr>
      <td>${i.quantity}× ${escapeHTML(i.product_name)}</td>
      <td class="right">${fmtKmf(i.price_kmf * i.quantity)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Reçu Komerce — ${escapeHTML(order.reference)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.5;
    color: #000;
    background: #fff;
    padding: 20px;
  }
  .receipt {
    max-width: 320px;
    margin: 0 auto;
    padding: 16px;
    border: 1px dashed #666;
  }
  .header, .footer {
    text-align: center;
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
    padding: 8px 0;
    margin: 8px 0;
    font-weight: bold;
  }
  .section {
    margin: 10px 0;
  }
  .kv {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
  }
  td {
    padding: 3px 0;
    vertical-align: top;
  }
  td.right {
    text-align: right;
    white-space: nowrap;
  }
  .total {
    border-top: 1px dashed #000;
    font-weight: bold;
    font-size: 14px;
    padding-top: 6px;
  }
  .code-box {
    border: 3px solid #000;
    padding: 16px 8px;
    text-align: center;
    margin: 16px 0;
  }
  .code-label {
    font-size: 10px;
    letter-spacing: 2px;
    margin-bottom: 8px;
  }
  .code-value {
    font-size: 24px;
    font-weight: bold;
    letter-spacing: 4px;
    font-family: 'Courier New', monospace;
  }
  .qr-wrap {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed #000;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .qr-wrap canvas {
    display: block;
    width: 160px;
    height: 160px;
    background: #fff;
  }
  .qr-label {
    font-size: 10px;
    letter-spacing: 1px;
    color: #000;
    margin-top: 4px;
  }
  .warning {
    font-size: 10px;
    text-align: center;
    margin: 8px 0;
    padding: 6px;
    border: 1px dashed #000;
  }
  .signature {
    margin-top: 20px;
    border-top: 1px solid #000;
    padding-top: 10px;
    font-size: 10px;
  }
  .signature-line {
    margin-top: 30px;
    border-top: 1px dotted #000;
    height: 1px;
  }
  .print-btn {
    display: block;
    width: 200px;
    margin: 20px auto;
    padding: 12px;
    background: #4a9040;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
  }
  @media print {
    body { padding: 0; }
    .receipt { border: none; max-width: 100%; }
    .print-btn { display: none; }
  }
</style>
</head>
<body>
<div class="receipt">

  <div class="header">
    KOMERCE<br>
    REÇU DE PAIEMENT
  </div>

  <div class="section">
    <div class="kv"><span>Référence :</span><span>${escapeHTML(order.reference)}</span></div>
    <div class="kv"><span>Date :</span><span>${dateFr(order.payment_received_at || order.created_at)}</span></div>
    <div class="kv"><span>Relais :</span><span>${escapeHTML(order.relais_name || '-')}</span></div>
    <div class="kv"><span>Agent :</span><span>${escapeHTML(order.agent_name || '-')}</span></div>
    <div class="kv"><span>Payé par :</span><span>${escapeHTML(order.payer_name || '-')}</span></div>
  </div>

  <div class="section">
    <table>
      ${itemsHTML}
      <tr class="total">
        <td>TOTAL PAYÉ CASH</td>
        <td class="right">${fmtKmf(order.total_kmf)}</td>
      </tr>
    </table>
  </div>

  <div class="code-box">
    <div class="code-label">CODE SECRET DE RETRAIT</div>
    <div class="code-value">${escapeHTML(code)}</div>
    <div class="qr-wrap">
      <canvas id="pickup-qr" width="160" height="160"></canvas>
      <div class="qr-label">Scannez au relais</div>
    </div>
  </div>

  <div class="warning">
    ⚠ CONSERVEZ CE REÇU PRÉCIEUSEMENT<br>
    Présentez le QR code au relais pour retirer<br>
    votre colis (3 à 4 semaines).<br>
    En cas de perte, présentez-vous<br>
    avec une pièce d'identité.
  </div>

  <div class="signature">
    Signature du payeur :
    <div class="signature-line"></div>
  </div>

  <div class="footer">
    Merci de votre confiance 🇰🇲<br>
    komerce.km
  </div>

</div>

<button class="print-btn" onclick="window.print()">🖨 Imprimer maintenant</button>

<!-- QR generation -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js"></script>
<script>
  // Payload du QR : JSON compact { c: code, o: orderRef }
  // Le relais scanne → JSON parsé → verify avec le code complet
  var qrPayload = JSON.stringify({
    c: ${JSON.stringify(code)},
    o: ${JSON.stringify(order.reference)}
  });

  function renderQR() {
    if (typeof QRious === 'undefined') {
      // Fallback API externe si la lib n'a pas chargé (offline relais)
      var img = document.createElement('img');
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' +
                encodeURIComponent(qrPayload);
      img.width = 160; img.height = 160;
      var canvas = document.getElementById('pickup-qr');
      canvas.parentNode.replaceChild(img, canvas);
      return;
    }
    new QRious({
      element: document.getElementById('pickup-qr'),
      value: qrPayload,
      size: 160,
      level: 'M',
      background: '#ffffff',
      foreground: '#000000',
    });
  }

  renderQR();

  // Auto-print après avoir rendu le QR (léger delay pour laisser le canvas peindre)
  setTimeout(function() {
    try { window.print(); } catch(_) {}
  }, 800);
</script>

</body>
</html>`;
}

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. POST /verify/:orderId — Vérifier un code au retrait (rate-limited)
// ══════════════════════════════════════════════════════════════════════════════
// L'agent au retrait (visite 2) saisit le code donné par le client.
// Rate limit : 3 tentatives max par commande, puis blocage 15 min.
router.post('/verify/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { code }    = req.body;
    const agentId     = req.user.id;

    if (!code) {
      return res.status(400).json({ error: 'Code requis' });
    }

    const { rows: [order] } = await db.query(`
      SELECT id, reference, status,
             pickup_secret_hash, pickup_secret_salt, pickup_secret_last4,
             pickup_secret_expires_at,
             pickup_secret_attempts, pickup_secret_blocked_until
      FROM orders WHERE id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    if (!order.pickup_secret_hash) {
      return res.status(400).json({ error: 'Cette commande n\'a pas encore de code (paiement non effectué ?)' });
    }

    // Rate limit : si bloqué, refuser
    const now = new Date();
    if (order.pickup_secret_blocked_until && new Date(order.pickup_secret_blocked_until) > now) {
      const retryAfter = Math.ceil((new Date(order.pickup_secret_blocked_until) - now) / 1000 / 60);
      return res.status(429).json({
        error: `Trop de tentatives. Réessayez dans ${retryAfter} min.`,
        blocked_until: order.pickup_secret_blocked_until,
      });
    }

    // Expiration du code ?
    if (order.pickup_secret_expires_at && new Date(order.pickup_secret_expires_at) < now) {
      return res.status(410).json({ error: 'Code expiré. Escalade admin nécessaire.' });
    }

    // Vérifier le code : 2 modes selon la longueur saisie
    // - 4 chars : compare avec pickup_secret_last4 (saisie rapide au guichet)
    // - 8 chars (code complet) : compare avec le hash salé
    const normalized = normalizeCode(code);
    let matched = false;

    if (normalized.length === 4) {
      // Mode court : comparaison directe du last4 (non-sensible, unique par relais actif)
      matched = !!(order.pickup_secret_last4 && normalized === order.pickup_secret_last4);
    } else if (normalized.length === 8) {
      // Mode complet : comparaison du hash
      const testHash = hashCode(normalized, order.pickup_secret_salt);
      matched = (testHash === order.pickup_secret_hash);
    } else {
      return res.status(400).json({ error: 'Code attendu : 4 caractères (raccourci) ou 8 caractères (complet)' });
    }

    if (!matched) {
      // Incrémenter le compteur de tentatives
      const attempts = (order.pickup_secret_attempts || 0) + 1;
      let blockUntil = null;
      if (attempts >= 3) {
        blockUntil = new Date(now.getTime() + 15 * 60 * 1000); // +15 min
      }
      await db.query(`
        UPDATE orders
        SET pickup_secret_attempts     = $1,
            pickup_secret_blocked_until = $2,
            updated_at                 = NOW()
        WHERE id = $3
      `, [attempts, blockUntil, orderId]);

      console.warn(`[PICKUP-SECRET] Tentative échouée ${attempts}/3 pour ${order.reference} agent=${agentId}`);

      return res.status(401).json({
        error: 'Code incorrect',
        attempts,
        remaining: Math.max(0, 3 - attempts),
        blocked_until: blockUntil,
      });
    }

    // Succès : reset compteur, ne pas marquer collected encore (séparation verify/collect)
    await db.query(`
      UPDATE orders
      SET pickup_secret_attempts = 0,
          pickup_secret_blocked_until = NULL,
          updated_at = NOW()
      WHERE id = $1
    `, [orderId]);

    console.log(`[PICKUP-SECRET] ✅ Code vérifié pour ${order.reference}`);

    res.json({
      success: true,
      message: 'Code valide. Vous pouvez remettre le colis.',
      order_ref: order.reference,
    });

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. POST /collect/:orderId — Marquer la commande comme récupérée
// ══════════════════════════════════════════════════════════════════════════════
// À appeler après un verify réussi et remise physique du colis.
router.post('/collect/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const agentId     = req.user.id;
    const { collected_by_name } = req.body;

    const { rows: [order] } = await db.query(`
      SELECT id, reference, status FROM orders WHERE id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    if (order.status === 'collected') {
      return res.status(409).json({ error: 'Cette commande est déjà marquée comme récupérée' });
    }

    await db.query(`
      UPDATE orders
      SET status                 = 'collected',
          collected_at           = NOW(),
          collected_by_name      = $1,
          updated_at             = NOW()
      WHERE id = $2
    `, [collected_by_name || null, orderId]);

    console.log(`[PICKUP-SECRET] 📦 Colis remis pour ${order.reference} à "${collected_by_name || '(anonyme)'}"`);

    res.json({
      success: true,
      message: 'Colis remis. Commande marquée comme récupérée.',
      order_ref: order.reference,
    });

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. POST /regenerate/:orderId — Admin régénère un code (perte de reçu)
// ══════════════════════════════════════════════════════════════════════════════
// Réservé admin. Invalide l'ancien code et en génère un nouveau.
// Utilisé quand un client vient déclarer la perte de son reçu après avoir
// présenté sa pièce d'identité.
router.post('/regenerate/:orderId', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const adminId     = req.user.id;
    const { reason }  = req.body;

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'Motif obligatoire (min 5 caractères)' });
    }

    const { rows: [order] } = await db.query(`
      SELECT id, reference, pickup_secret_hash, relais_id FROM orders WHERE id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // Génération anti-collision last4 (même logique que pay-cash)
    let code, last4, hash;
    const salt = crypto.randomBytes(16).toString('hex');
    let attempts = 0;
    const MAX_GEN_ATTEMPTS = 50;
    while (attempts < MAX_GEN_ATTEMPTS) {
      code  = generatePickupCode();
      last4 = code.replace(/-/g, '').slice(-4);
      const { rows: [dup] } = await db.query(`
        SELECT id FROM orders
        WHERE pickup_secret_last4 = $1
          AND relais_id IS NOT DISTINCT FROM $2
          AND id <> $3
          AND status NOT IN ('collected', 'cancelled', 'refunded')
          AND (pickup_secret_expires_at IS NULL OR pickup_secret_expires_at > NOW())
        LIMIT 1
      `, [last4, order.relais_id || null, orderId]);
      if (!dup) break;
      attempts++;
    }
    if (attempts >= MAX_GEN_ATTEMPTS) {
      return res.status(500).json({ error: 'Génération du code impossible (saturation)' });
    }
    hash = hashCode(code, salt);
    const now     = new Date();
    const expires = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    await db.query(`
      UPDATE orders
      SET pickup_secret_hash        = $1,
          pickup_secret_salt        = $2,
          pickup_secret_last4       = $7,
          pickup_secret_created_at  = $3,
          pickup_secret_expires_at  = $4,
          pickup_secret_attempts    = 0,
          pickup_secret_blocked_until = NULL,
          pickup_secret_regen_count = COALESCE(pickup_secret_regen_count, 0) + 1,
          pickup_secret_regen_reason = $5,
          updated_at = NOW()
      WHERE id = $6
    `, [hash, salt, now, expires, reason.trim(), orderId, last4]);

    console.log(`[PICKUP-SECRET] 🔄 Régénéré pour ${order.reference} par admin ${adminId} motif="${reason}"`);

    // Le nouveau code en clair est renvoyé à l'admin UNE SEULE FOIS
    // L'admin est responsable de le transmettre par canal sécurisé à l'agent relais
    res.json({
      success: true,
      message: 'Nouveau code généré. Transmettez-le par canal sécurisé à l\'agent relais.',
      code,
      order_ref: order.reference,
    });

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. GET /status/:orderId — Status du code (pas le code clair, jamais)
// ══════════════════════════════════════════════════════════════════════════════
// Utile pour l'agent relais qui cherche à savoir si une commande a déjà un code
// (= payée) ou pas encore.
router.get('/status/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const { rows: [order] } = await db.query(`
      SELECT o.id, o.reference, o.status, o.payment_status, o.total_kmf,
             o.payer_name,
             o.tracking_phone,
             o.tracking_phone_secondary,
             o.tracking_phone_confirmed_at,
             o.pickup_secret_created_at,
             o.pickup_secret_expires_at,
             o.pickup_secret_attempts,
             o.pickup_secret_blocked_until,
             o.pickup_secret_regen_count,
             o.pickup_secret_last4,
             o.collected_at, o.collected_by_name,
             u.full_name AS client_name,
             u.phone     AS client_phone
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    res.json({
      order_ref: order.reference,
      status: order.status,
      payment_status: order.payment_status,
      total_kmf: Number(order.total_kmf || 0),
      client_name: order.client_name,
      payer_name: order.payer_name,
      tracking: {
        // Numéro principal : priorité à tracking_phone, fallback sur phone user
        primary:   order.tracking_phone || order.client_phone || null,
        secondary: order.tracking_phone_secondary || null,
        confirmed_at: order.tracking_phone_confirmed_at,
      },
      secret: {
        exists: !!order.pickup_secret_created_at,
        created_at: order.pickup_secret_created_at,
        expires_at: order.pickup_secret_expires_at,
        attempts: order.pickup_secret_attempts || 0,
        blocked_until: order.pickup_secret_blocked_until,
        regen_count: order.pickup_secret_regen_count || 0,
        // Affichage masqué à l'agent : "•••-•••-XX" (les 4 derniers chars visibles)
        // L'agent n'a jamais accès au code complet via l'API, c'est voulu.
        last4:  order.pickup_secret_last4 || null,
        masked: order.pickup_secret_last4
                  ? ('•••-•' + order.pickup_secret_last4.slice(0, 2) + '-' + order.pickup_secret_last4.slice(2))
                  : null,
      },
      collected: {
        at: order.collected_at,
        by_name: order.collected_by_name,
      },
    });

  } catch (err) { next(err); }
});

module.exports = router;
