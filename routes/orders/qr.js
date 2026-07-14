/**
 * @komerce-arch
 * @role          orders-qr
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, recipients, relais
 * @db-write      orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

/**
 * KOMERCE — QR Code retrait
 *
 * POST /:id/qr-token      → générer token QR (admin/agent_relais)
 * GET  /retrait/:token    → page HTML retrait client (publique)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { getRule }                   = require('../../utils/rules');
const log = require('../../utils/logger').child({ module: 'qr' });

// ─── POST /api/orders/:id/qr-token ───────────────────────────────────────────
// Génère un token QR unique pour une commande disponible.
// Le token est stocké en DB avec une expiration 48h.
// Rôles : admin, agent_relais
//
// INSÉRER AVANT router.get('/:ref', ...) — mais après router.get('/relais') et router.get('/problems')

router.post('/:id/qr-token', authenticate, requireRole(['admin', 'agent_relais']), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Vérifier que la commande est dans un état compatible (available)
    const { rows: [order] } = await db.query(
      `SELECT o.*, rc.full_name AS recipient_name, r.name AS relais_name
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE o.id = $1`,
      [id]
    );

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // GOV-02 (volet 2) — IDOR cross-relais : un agent_relais ne peut générer
    // un QR de retrait que pour une commande de SON relais. admin a une
    // portée globale, non concerné par ce garde-fou.
    if (req.user.role === 'agent_relais' && String(order.relais_id) !== String(req.user.relais_id)) {
      log.warn(`[IDOR] bloqué — user ${req.user.id} (relais ${req.user.relais_id}) → order ${order.id} (relais ${order.relais_id})`);
      return res.status(403).json({ error: "Cette commande n'appartient pas à votre relais" });
    }

    if (order.status !== 'available') {
      return res.status(422).json({
        error: `Impossible de générer un QR — statut actuel : ${order.status} (attendu : available)`,
        current_status: order.status,
      });
    }

    // [TOK-01] Token QR = CSPRNG pur (crypto.randomBytes), non dérivé des
    // inputs (id/relaisId/timestamp/QR_SECRET). QR_SECRET reste requis au
    // boot (fail-closed via bootstrap/env.js, inchangé) mais n'entre plus
    // dans le calcul du token — le token est stocké puis relu par égalité
    // stricte (WHERE qr_token = $1), jamais recalculé.
    const token = crypto.randomBytes(24).toString('hex'); // 48 car. hex

    const qrHours   = await getRule('QR_EXPIRATION_HOURS', 48);
    const expiration = new Date(Date.now() + qrHours * 60 * 60 * 1000);

    // Sauvegarder en DB
    await db.query(
      `UPDATE orders
       SET qr_token = $1, qr_expires_at = $2, updated_at = NOW()
       WHERE id = $3`,
      [token, expiration, id]
    );

    log.info(`[QR-TOKEN] Généré pour ${order.reference} — token: ${token.slice(0, 8)}... expires: ${expiration.toISOString()}`);

    // Payload QR complet — sera encodé en JSON dans le QR code côté frontend
    const qr_payload = {
      orderId:    id,
      reference:  order.reference,
      clientName: order.recipient_name || 'Client',
      relaisId:   order.relais_id,
      relaisName: order.relais_name,
      token,
      expiration: expiration.toISOString(),
    };

    res.json({
      success:    true,
      token,
      expiration: expiration.toISOString(),
      qr_payload, // le frontend encode ce JSON en QR
    });

  } catch(err) { next(err); }
});

// ─── GET /api/orders/retrait/:token — Page HTML retrait client (publique) ──────
// Affiche le QR code dans une page web que le client peut ouvrir, screenshot ou télécharger.
// Lien envoyé via WhatsApp / email / n'importe quel canal.
// Token validé (non expiré) mais PAS invalidé — l'invalidation se fait au scan (verify-qr).

router.get('/retrait/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const { rows: [order] } = await db.query(
      `SELECT o.reference, o.qr_expires_at,
              rc.full_name AS client_name, rc.phone AS client_phone,
              r.name AS relais_name, r.address AS relais_address
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE o.qr_token = $1`,
      [token]
    );

    if (!order) {
      return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Komerce — Lien invalide</title>
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;text-align:center;padding:20px}</style>
        </head><body><div>
          <div style="font-size:48px;margin-bottom:16px">❌</div>
          <h2>Lien invalide ou expiré</h2>
          <p style="color:#94a3b8">Ce lien de retrait n'est plus valide.<br>Contactez votre point relais pour en obtenir un nouveau.</p>
        </div></body></html>`);
    }

    const expires    = new Date(order.qr_expires_at);
    const expired    = expires < new Date();
    const expiresStr = expires.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

    // Payload QR = le token lui-même (sera vérifié via verify-qr)
    const qrData    = JSON.stringify({ token, reference: order.reference });
    const qrDataB64 = Buffer.from(qrData).toString('base64');

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Komerce — Retrait colis</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border-radius: 16px; padding: 28px 24px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    .logo { font-size: 1.4rem; font-weight: 700; color: #6366f1; letter-spacing: 1px; margin-bottom: 4px; }
    .logo-sub { font-size: 0.8rem; color: #64748b; margin-bottom: 20px; }
    .title { font-size: 1.15rem; font-weight: 600; margin-bottom: 4px; }
    .ref { font-family: monospace; font-size: 1rem; color: #6366f1; background: #0f172a; padding: 4px 12px; border-radius: 6px; display: inline-block; margin-bottom: 16px; }
    .qr-wrap { background: white; border-radius: 12px; padding: 16px; display: inline-block; margin: 12px 0 8px; }
    .expired-banner { background: #7f1d1d; color: #fca5a5; border-radius: 8px; padding: 10px 16px; margin: 8px 0 12px; font-size: 0.85rem; font-weight: 600; }
    .info-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #334155; font-size: 0.875rem; }
    .info-row:last-child { border-bottom: none; }
    .info-lbl { color: #94a3b8; }
    .info-val { font-weight: 600; text-align: right; max-width: 55%; }
    .info-block { background: #0f172a; border-radius: 10px; padding: 12px 16px; margin: 14px 0; }
    .btn-dl { display: block; width: 100%; padding: 12px; background: #6366f1; color: white; border: none; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 14px; text-decoration: none; }
    .btn-dl:hover { background: #4f46e5; }
    .tip { font-size: 0.78rem; color: #475569; margin-top: 14px; line-height: 1.5; }
    .expire-ok { font-size: 0.8rem; color: #34d399; margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">KOMERCE</div>
    <div class="logo-sub">Votre colis vous attend</div>

    <div class="title">📦 Code de retrait</div>
    <div class="ref">${order.reference}</div>

    ${expired ? '<div class="expired-banner">⏰ Ce QR code a expiré — demandez-en un nouveau à votre relais</div>' : ''}

    <div class="qr-wrap" id="qr-container"></div>

    ${!expired ? `<div class="expire-ok">✅ Valable jusqu'au ${expiresStr}</div>` : ''}

    <div class="info-block">
      <div class="info-row"><span class="info-lbl">Client</span><span class="info-val">${order.client_name || '—'}</span></div>
      <div class="info-row"><span class="info-lbl">Point relais</span><span class="info-val">${order.relais_name || '—'}</span></div>
      ${order.relais_address ? `<div class="info-row"><span class="info-lbl">Adresse</span><span class="info-val">${order.relais_address}</span></div>` : ''}
    </div>

    <button class="btn-dl" id="btn-dl" ${expired ? 'disabled style="opacity:0.4"' : ''}>⬇️ Télécharger le QR Code</button>

    <p class="tip">Présentez ce QR code à l'agent relais lors du retrait.<br>Usage unique · ${expired ? 'Expiré' : 'Expire le ' + expiresStr}</p>
  </div>

  <!-- AUD-04: script externalisé — retrait unsafe-inline CSP -->
  <div id="qr-data" data-qrb64="${qrDataB64}" data-ref="${order.reference}"></div>
  <script src="/js/qr-viewer.js"></script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) {
    log.error({ err }, '[orders/retrait] Erreur:');
    res.status(500).send('<h1>Erreur serveur</h1>');
  }
});

module.exports = router;
