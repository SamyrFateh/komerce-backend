/**
 * @komerce-arch
 * @role          email
 * @domain        notification
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       utils/logger.js
 * @db-write      none
 * @db-read      none
 * @used-by       none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */


'use strict';
/*  utils/email.js — Brevo REST API v3
    Envoie des emails transactionnels pour chaque étape de commande.
    Variable requise : BREVO_API_KEY (commence par xkeysib-)
    Optionnel : BREVO_SENDER_EMAIL, APP_URL
*/

const BREVO_KEY = process.env.BREVO_API_KEY || '';
const SENDER    = process.env.BREVO_SENDER_EMAIL || 'no-reply@komerce.km';
const APP       = process.env.APP_URL || 'https://komerce-backend-production.up.railway.app';
const log       = require('./logger').child({ module: 'email' });

/* ─── template wrapper ──────────────────────────────────── */
function wrap(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4e8d1;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4e8d1;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <tr><td style="background:#1a3a5c;padding:24px 32px;text-align:center">
    <h1 style="margin:0;color:#f4e8d1;font-size:22px">🏝️ KOMERCE</h1>
    <p style="margin:4px 0 0;color:#e07a5f;font-size:14px">${title}</p>
  </td></tr>
  <tr><td style="padding:32px">${body}</td></tr>
  <tr><td style="background:#f8f4ee;padding:16px 32px;text-align:center;font-size:12px;color:#888">
    Komerce — E-commerce des Comores 🇰🇲<br>
    <a href="${APP}" style="color:#1a3a5c">komerce.km</a>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function btn(url, label) {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px auto"><tr>
<td style="background:#e07a5f;border-radius:8px;padding:12px 32px">
<a href="${url}" style="color:#fff;text-decoration:none;font-weight:600;font-size:16px">${label}</a>
</td></tr></table>`;
}

/* ─── templates par statut ──────────────────────────────── */
const templates = {
  confirmed: (o) => ({
    subject: `✅ Commande ${o.reference} confirmée`,
    html: wrap('Commande confirmée', `
      <h2 style="color:#1a3a5c;margin:0 0 16px">Merci ${o.customer_name || 'cher client'} !</h2>
      <p style="font-size:16px;color:#333;line-height:1.6">
        Votre commande <strong>${o.reference}</strong> a été confirmée et sera bientôt préparée à Dubai.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="background:#f8f4ee"><td style="padding:12px;font-weight:600">Référence</td><td style="padding:12px">${o.reference}</td></tr>
        <tr><td style="padding:12px;font-weight:600">Montant</td><td style="padding:12px">${(o.total_kmf||o.total||0).toLocaleString('fr-FR')} KMF</td></tr>
        <tr style="background:#f8f4ee"><td style="padding:12px;font-weight:600">Paiement</td><td style="padding:12px">${o.payment_mode==='cash_relais'?'💰 Cash au relais':'💳 Carte'}</td></tr>
        <tr><td style="padding:12px;font-weight:600">Relais</td><td style="padding:12px">${o.relay_name||o.relay_code||'—'}</td></tr>
      </table>
      ${btn(APP+'/suivi.html?ref='+o.reference,'📍 Suivre ma commande')}
      <p style="color:#888;font-size:13px;text-align:center">Conservez votre référence : <strong>${o.reference}</strong></p>
    `)
  }),

  ordered: (o) => ({
    subject: `🛍️ ${o.reference} — Approvisionnement lancé`,
    html: wrap('Commande fournisseur passée', `
      <h2 style="color:#1a3a5c;margin:0 0 16px">C'est en route ! 🛍️</h2>
      <p style="font-size:16px;color:#333;line-height:1.6">
        Nous avons passé commande auprès de nos fournisseurs à Dubai pour votre commande <strong>${o.reference}</strong>.
      </p>
      <p style="font-size:15px;color:#555">Prochaine étape : préparation et emballage.</p>
      ${btn(APP+'/suivi.html?ref='+o.reference,'📍 Suivre ma commande')}
    `)
  }),

  preparation: (o) => ({
    subject: `📦 ${o.reference} — En préparation à Dubai`,
    html: wrap('En préparation', `
      <h2 style="color:#1a3a5c;margin:0 0 16px">Votre colis se prépare ! 📦</h2>
      <p style="font-size:16px;color:#333;line-height:1.6">
        Votre commande <strong>${o.reference}</strong> est en cours de préparation dans notre entrepôt à Dubai.
      </p>
      ${btn(APP+'/suivi.html?ref='+o.reference,'📍 Suivre ma commande')}
    `)
  }),

  shipped: (o) => ({
    subject: `✈️ ${o.reference} — Remise au transitaire`,
    html: wrap('Expédiée !', `
      <h2 style="color:#1a3a5c;margin:0 0 16px">C'est parti ! ✈️</h2>
      <p style="font-size:16px;color:#333;line-height:1.6">
        Votre colis <strong>${o.reference}</strong> a été remis au transitaire à Dubai. Direction les Comores !
      </p>
      <p style="font-size:15px;color:#555">Délai estimé : 3 à 5 semaines par voie maritime 🚢</p>
      ${btn(APP+'/suivi.html?ref='+o.reference,'📍 Suivre ma commande')}
    `)
  }),

  in_transit: (o) => ({
    subject: `🚢 ${o.reference} — En route vers les Comores`,
    html: wrap('En transit maritime', `
      <h2 style="color:#1a3a5c;margin:0 0 16px">Sur les flots ! 🚢</h2>
      <p style="font-size:16px;color:#333;line-height:1.6">
        Votre colis <strong>${o.reference}</strong> navigue vers les Comores.
        Nous vous préviendrons dès qu'il arrive au point relais.
      </p>
      ${btn(APP+'/suivi.html?ref='+o.reference,'📍 Suivre ma commande')}
    `)
  }),

  available: (o) => ({
    subject: `🎉 ${o.reference} — Disponible au relais !`,
    html: wrap('Colis disponible !', `
      <h2 style="color:#1a3a5c;margin:0 0 16px">Votre colis vous attend ! 🎉</h2>
      <p style="font-size:16px;color:#333;line-height:1.6">
        Votre colis <strong>${o.reference}</strong> est disponible au point relais
        <strong>${o.relay_name||o.relay_code||''}</strong>.
      </p>
      ${o.cash_ref_code ? `<div style="background:#fff3e0;border:2px dashed #e07a5f;border-radius:12px;padding:16px;text-align:center;margin:16px 0">
        <p style="margin:0 0 8px;font-size:14px;color:#888">Code de retrait</p>
        <p style="margin:0;font-size:32px;font-weight:700;color:#1a3a5c;letter-spacing:4px">${o.cash_ref_code}</p>
      </div>` : ''}
      ${btn(APP+'/suivi.html?ref='+o.reference,'📍 Voir QR de retrait')}
      <p style="color:#e07a5f;font-size:14px;text-align:center;font-weight:600">
        ${o.payment_mode==='cash_relais'?'💰 Pensez à apporter le montant exact en espèces':'✅ Paiement déjà effectué'}
      </p>
    `)
  }),

  collected: (o) => ({
    subject: `✅ ${o.reference} — Colis récupéré !`,
    html: wrap('Mission accomplie !', `
      <h2 style="color:#1a3a5c;margin:0 0 16px">Merci et à bientôt ! 🎉</h2>
      <p style="font-size:16px;color:#333;line-height:1.6">
        Votre colis <strong>${o.reference}</strong> a bien été récupéré. Merci pour votre confiance !
      </p>
      ${btn(APP+'/Komerce_Boutique.html','🛍️ Continuer mes achats')}
    `)
  }),

  cancelled: (o) => ({
    subject: `❌ ${o.reference} — Commande annulée`,
    html: wrap('Commande annulée', `
      <h2 style="color:#1a3a5c;margin:0 0 16px">Commande annulée</h2>
      <p style="font-size:16px;color:#333;line-height:1.6">
        Votre commande <strong>${o.reference}</strong> a été annulée.
        ${o.payment_status==='paid'?'Un remboursement sera traité sous 48h.':''}
      </p>
      ${btn(APP+'/Komerce_Boutique.html','🛍️ Retour à la boutique')}
    `)
  }),

  cash_reminder: (o) => ({
    subject: `⏰ ${o.reference} — Rappel paiement en attente`,
    html: wrap('Rappel paiement', `
      <h2 style="color:#1a3a5c;margin:0 0 16px">Paiement en attente ⏰</h2>
      <p style="font-size:16px;color:#333;line-height:1.6">
        Votre colis <strong>${o.reference}</strong> vous attend au relais <strong>${o.relay_name||''}</strong>.
      </p>
      <p style="font-size:15px;color:#e07a5f;font-weight:600">
        Pensez à le récupérer et régler le montant de ${(o.total_kmf||o.total||0).toLocaleString('fr-FR')} KMF.
      </p>
      ${btn(APP+'/suivi.html?ref='+o.reference,'📍 Voir les détails')}
    `)
  })
};

/* ─── Envoi via API REST v3 ─────────────────────────────── */
async function sendOrderEmail(order, status) {
  if (!order.customer_email) {
    log.info({ reference: order.reference }, '[EMAIL] Pas d\'email client — skip');
    return { skipped: true, reason: 'no_email' };
  }

  const templateFn = templates[status];
  if (!templateFn) {
    log.info({ status }, '[EMAIL] Pas de template pour ce statut — skip');
    return { skipped: true, reason: 'no_template' };
  }

  if (!BREVO_KEY) {
    log.warn({}, '[EMAIL] BREVO_API_KEY non configurée — email non envoyé');
    return { skipped: true, reason: 'no_api_key' };
  }

  const { subject, html } = templateFn(order);

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'Komerce', email: SENDER },
        to: [{ email: order.customer_email, name: order.customer_name || 'Client' }],
        subject,
        htmlContent: html
      })
    });

    const data = await res.json();

    if (data.messageId) {
      log.info({ status, email: order.customer_email, reference: order.reference, msgId: data.messageId }, '[EMAIL] Email envoyé');
      return { sent: true, messageId: data.messageId };
    } else {
      log.error({ data }, '[EMAIL] ❌ Erreur Brevo');
      return { sent: false, error: data.message || JSON.stringify(data) };
    }
  } catch (err) {
    log.error({ err, status, email: order.customer_email }, '[EMAIL] ❌ Erreur envoi');
    return { sent: false, error: err.message };
  }
}

module.exports = { sendOrderEmail, templates };

