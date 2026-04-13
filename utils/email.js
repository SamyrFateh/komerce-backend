/**
 * KOMERCE — Module email via Brevo API (ex-Sendinblue)
 *
 * Remplace nodemailer par l'API REST Brevo.
 * Variables d'environnement :
 *   BREVO_API_KEY       — clé API Brevo (xsmtpsib-...)
 *   BREVO_SENDER_EMAIL  — email expéditeur vérifié dans Brevo
 *   BREVO_SENDER_NAME   — nom expéditeur (défaut: Komerce)
 *   APP_URL             — URL de l'app (pour liens de suivi)
 *
 * Fallback SMTP si SMTP_HOST est configuré (rétro-compatible).
 */

'use strict';

let nodemailer, smtpTransporter;
const BREVO_API  = 'https://api.brevo.com/v3/smtp/email';
const APP_URL    = process.env.APP_URL || 'https://komerce-backend-production.up.railway.app';
const fmtKMF    = (n) => (n || 0).toLocaleString('fr-FR');

// ─── Init: prefer Brevo API, fallback SMTP ──────────────
const BREVO_KEY    = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || process.env.SMTP_FROM?.match(/<(.+)>/)?.[1] || 'noreply@komerce.km';
const SENDER_NAME  = process.env.BREVO_SENDER_NAME || 'Komerce';

if (BREVO_KEY) {
  console.log(`📧 Brevo API configurée (sender: ${SENDER_EMAIL})`);
} else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  try {
    nodemailer = require('nodemailer');
    smtpTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    console.log(`📧 SMTP transporter configuré (${process.env.SMTP_HOST})`);
  } catch (e) {
    console.log('📧 nodemailer non disponible — emails en mode dev');
  }
} else {
  console.log('📧 Email NON configuré — configurer BREVO_API_KEY ou SMTP_HOST');
}

// ─── Core send ──────────────────────────────────────────
async function sendEmail(to, subject, html) {
  if (!to) return { skipped: true, reason: 'no_recipient' };

  // Brevo API (preferred)
  if (BREVO_KEY) {
    try {
      const resp = await fetch(BREVO_API, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': BREVO_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: SENDER_NAME, email: SENDER_EMAIL },
          to: [{ email: to }],
          subject, htmlContent: html
        })
      });
      const data = await resp.json();
      if (resp.ok) {
        console.log(`📧 [BREVO] ✅ → ${to} | ${subject}`);
        return { sent: true, messageId: data.messageId };
      }
      console.error(`📧 [BREVO] ❌ ${resp.status}:`, data.message);
      return { sent: false, error: data.message };
    } catch (err) {
      console.error(`📧 [BREVO] ❌`, err.message);
      return { sent: false, error: err.message };
    }
  }

  // SMTP fallback
  if (smtpTransporter) {
    try {
      const info = await smtpTransporter.sendMail({
        from: `${SENDER_NAME} <${SENDER_EMAIL}>`, to, subject, html
      });
      console.log(`📧 [SMTP] ✅ → ${to}`);
      return { sent: true, messageId: info.messageId };
    } catch (err) {
      console.error(`📧 [SMTP] ❌`, err.message);
      return { sent: false, error: err.message };
    }
  }

  // Dev mode
  console.log(`📧 [DEV] → ${to} | ${subject}`);
  return { skipped: true, reason: 'no_config' };
}

// ─── Email wrapper (branding Archipel) ──────────────────
function wrap(content) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#1a3a5c,#2a5a8c);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:26px;">🏝️ Komerce</h1>
    <p style="margin:4px 0 0;color:#f4e8d1;font-size:13px;">L'archipel du shopping — Dubai → Comores</p>
  </div>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;">${content}</div>
  <p style="text-align:center;color:#999;font-size:11px;margin-top:16px;">
    © 2026 Komerce — <a href="${APP_URL}" style="color:#1a3a5c;">komerce.km</a>
  </p>
</div></body></html>`;
}

function btn(href, label, color = '#e07a5f') {
  return `<div style="text-align:center;margin:24px 0;">
    <a href="${href}" style="background:${color};color:#fff;padding:14px 32px;border-radius:25px;text-decoration:none;font-weight:600;font-size:15px;">${label}</a>
  </div>`;
}

function itemsTable(items) {
  if (!items?.length) return '';
  const rows = items.map(i =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${i.name || i.product_name || 'Produit'}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-size:14px;">×${i.qty || i.quantity}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-size:14px;font-weight:600;">${fmtKMF((i.price_kmf || i.price) * (i.qty || i.quantity))} KMF</td></tr>`
  ).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <thead><tr style="background:#f8f9fa;">
      <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;text-transform:uppercase;">Article</th>
      <th style="padding:8px 12px;text-align:center;font-size:12px;color:#666;">Qté</th>
      <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;">Prix</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function trackUrl(ref) { return `${APP_URL}/suivi.html?ref=${ref}`; }

// ─── Status email templates ─────────────────────────────
const STATUS_EMAILS = {
  ordered: (o) => ({
    subject: `✅ Commande ${o.reference} confirmée — Komerce`,
    html: wrap(`
      <h2 style="color:#1a3a5c;margin-top:0;">Commande confirmée ! 🎉</h2>
      <p>Bonjour <strong>${o.customer_name || ''}</strong>,</p>
      <p>Votre commande <strong>${o.reference}</strong> a bien été enregistrée.</p>
      ${itemsTable(o.items)}
      <div style="background:#f0f7f0;border-radius:10px;padding:14px;text-align:center;margin:16px 0;">
        <span style="font-size:13px;color:#666;">Total</span><br>
        <strong style="font-size:22px;color:#1a3a5c;">${fmtKMF(o.total_kmf)} KMF</strong>
      </div>
      ${o.relais_name ? `<p>📍 Relais de livraison : <strong>${o.relais_name}</strong></p>` : ''}
      <p>Nous préparons votre colis à Dubai. Vous recevrez une notification à chaque étape.</p>
      ${btn(trackUrl(o.reference), '📍 Suivre ma commande')}
    `)
  }),

  confirmed: (o) => STATUS_EMAILS.ordered(o),

  preparation: (o) => ({
    subject: `🛍️ Commande ${o.reference} en préparation — Komerce`,
    html: wrap(`
      <h2 style="color:#1a3a5c;margin-top:0;">En préparation à Dubai 🛍️</h2>
      <p>Bonjour <strong>${o.customer_name || ''}</strong>,</p>
      <p>Votre commande <strong>${o.reference}</strong> est en cours de préparation dans notre entrepôt.</p>
      ${btn(trackUrl(o.reference), '📍 Suivre ma commande')}
    `)
  }),

  shipped: (o) => ({
    subject: `🚢 Commande ${o.reference} expédiée — Komerce`,
    html: wrap(`
      <h2 style="color:#1a3a5c;margin-top:0;">Colis expédié ! 🚢</h2>
      <p>Bonjour <strong>${o.customer_name || ''}</strong>,</p>
      <p>Votre commande <strong>${o.reference}</strong> a été remise au transitaire à Dubai.</p>
      <div style="background:#e3f2fd;border-radius:10px;padding:14px;margin:16px 0;">
        <p style="margin:0;text-align:center;">⏱️ Temps estimé : <strong>3 à 5 semaines</strong></p>
      </div>
      ${btn(trackUrl(o.reference), '📍 Suivre ma commande')}
    `)
  }),

  in_transit: (o) => ({
    subject: `🌊 Commande ${o.reference} en transit — Komerce`,
    html: wrap(`
      <h2 style="color:#1a3a5c;margin-top:0;">En route vers les Comores 🌊</h2>
      <p>Bonjour <strong>${o.customer_name || ''}</strong>,</p>
      <p>Votre colis <strong>${o.reference}</strong> est embarqué sur le bateau !</p>
      <p>Nous vous préviendrons dès qu'il sera disponible dans votre relais.</p>
      ${btn(trackUrl(o.reference), '📍 Suivre ma commande')}
    `)
  }),

  available: (o) => ({
    subject: `📦 Colis ${o.reference} disponible ! — Komerce`,
    html: wrap(`
      <h2 style="color:#e07a5f;margin-top:0;">Colis disponible ! 📦🎉</h2>
      <p>Bonjour <strong>${o.customer_name || ''}</strong>,</p>
      <p>Votre colis <strong>${o.reference}</strong> est arrivé et vous attend :</p>
      <div style="background:#f0f7f0;border-radius:12px;padding:16px;margin:16px 0;border-left:4px solid #27ae60;">
        <strong>📍 ${o.relais_name || 'Votre point relais'}</strong>
        ${o.relais_address ? `<br><span style="color:#666;">${o.relais_address}</span>` : ''}
      </div>
      ${o.pickup_code ? `
      <div style="background:#fff3e0;border-radius:12px;padding:20px;margin:16px 0;text-align:center;">
        <p style="margin:0 0 8px;color:#666;font-size:13px;">Votre code de retrait</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#e07a5f;">${o.pickup_code}</div>
      </div>` : ''}
      ${btn(trackUrl(o.reference), '👉 Voir mon QR de retrait', '#27ae60')}
      <p style="color:#888;font-size:13px;">Présentez ce code ou le QR au relais pour récupérer votre colis.</p>
    `)
  }),

  collected: (o) => ({
    subject: `✅ Colis ${o.reference} récupéré — Merci ! — Komerce`,
    html: wrap(`
      <h2 style="color:#27ae60;margin-top:0;">Colis récupéré ! ✅🎉</h2>
      <p>Bonjour <strong>${o.customer_name || ''}</strong>,</p>
      <p>Votre colis <strong>${o.reference}</strong> a bien été récupéré. Merci pour votre confiance !</p>
      ${btn(APP_URL, '🛍️ Continuer mes achats', '#1a3a5c')}
    `)
  }),

  cancelled: (o) => ({
    subject: `❌ Commande ${o.reference} annulée — Komerce`,
    html: wrap(`
      <h2 style="color:#c0392b;margin-top:0;">Commande annulée</h2>
      <p>Bonjour <strong>${o.customer_name || ''}</strong>,</p>
      <p>Votre commande <strong>${o.reference}</strong> a été annulée.</p>
      ${o.refund_info ? `<p>💰 ${o.refund_info}</p>` : '<p>Aucun paiement n\'a été prélevé.</p>'}
      ${btn(APP_URL, '🛍️ Retour à la boutique', '#1a3a5c')}
    `)
  }),
};

// ─── WhatsApp message templates ─────────────────────────
const WA_MESSAGES = {
  ordered:     (o) => `✅ Commande *${o.reference}* confirmée !\nMontant : *${fmtKMF(o.total_kmf)} KMF*\n\n📍 Suivi : ${trackUrl(o.reference)}\n\n🏝️ Komerce`,
  confirmed:   (o) => WA_MESSAGES.ordered(o),
  preparation: (o) => `🛍️ Commande *${o.reference}* en préparation à Dubai !\n\n📍 Suivi : ${trackUrl(o.reference)}\n\n🏝️ Komerce`,
  shipped:     (o) => `🚢 Colis *${o.reference}* expédié !\nTemps estimé : 3-5 semaines\n\n📍 Suivi : ${trackUrl(o.reference)}\n\n🏝️ Komerce`,
  in_transit:  (o) => `🌊 Colis *${o.reference}* en route vers les Comores !\n\n📍 Suivi : ${trackUrl(o.reference)}\n\n🏝️ Komerce`,
  available:   (o) => `📦 *Colis disponible !*\n\n*${o.reference}* au relais *${o.relais_name || ''}*\n${o.pickup_code ? `\nCode retrait : *${o.pickup_code}*` : ''}\n\n👉 ${trackUrl(o.reference)}\n\n🏝️ Komerce`,
  collected:   (o) => `✅ Colis *${o.reference}* récupéré !\n\nMerci et à bientôt ! 🎉\n🛍️ ${APP_URL}\n\n🏝️ Komerce`,
  cancelled:   (o) => `❌ Commande *${o.reference}* annulée.\n${o.refund_info || 'Aucun paiement prélevé.'}\n\n🏝️ Komerce`,
};

function whatsappLink(phone, message) {
  if (!phone) return null;
  const clean = phone.replace(/[^\d+]/g, '');
  const intl = clean.startsWith('+') ? clean.substring(1) : clean.startsWith('269') ? clean : `269${clean}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

// ─── Unified send for status change ─────────────────────
async function sendStatusEmail(order, status) {
  const template = STATUS_EMAILS[status];
  if (!template) return null;

  const email = order.customer_email || order.user_email;
  if (!email) return { skipped: true, reason: 'no_email' };

  const { subject, html } = template(order);
  return sendEmail(email, subject, html);
}

function getWhatsAppLink(order, status) {
  const msgFn = WA_MESSAGES[status];
  if (!msgFn) return null;
  const phone = order.customer_phone || order.user_phone;
  if (!phone) return null;
  return whatsappLink(phone, msgFn(order));
}

// ─── Cash reminder email ────────────────────────────────
async function sendCashReminder(order) {
  const email = order.customer_email || order.user_email;
  if (!email) return { skipped: true };
  return sendEmail(email, `💰 Rappel paiement — ${order.reference} — Komerce`, wrap(`
    <h2 style="color:#e07a5f;margin-top:0;">Rappel de paiement 💰</h2>
    <p>Bonjour <strong>${order.customer_name || ''}</strong>,</p>
    <p>Votre commande <strong>${order.reference}</strong> est en attente de paiement cash au relais.</p>
    <div style="background:#fff3e0;border-radius:10px;padding:14px;text-align:center;margin:16px 0;">
      <strong style="font-size:22px;color:#e07a5f;">${fmtKMF(order.total_kmf)} KMF</strong>
    </div>
    <p style="color:#c0392b;">⚠️ Sans paiement sous 36h, la commande sera annulée automatiquement.</p>
    ${btn(trackUrl(order.reference), '📍 Voir ma commande')}
  `));
}

function getCashReminderWA(order) {
  const phone = order.customer_phone || order.user_phone;
  if (!phone) return null;
  return whatsappLink(phone, `💰 *Rappel paiement*\n\nCommande *${order.reference}* : *${fmtKMF(order.total_kmf)} KMF*\n⚠️ Sans paiement sous 36h → annulation\n\n🏝️ Komerce`);
}

// ─── Legacy compat: sendOrderConfirmation ───────────────
async function sendOrderConfirmation(order, userEmail, items) {
  if (!userEmail) return { skipped: true, reason: 'no_email' };
  const enriched = { ...order, customer_email: userEmail, items };
  const tpl = STATUS_EMAILS.ordered(enriched);
  return sendEmail(userEmail, tpl.subject, tpl.html);
}

module.exports = {
  sendEmail,
  sendOrderConfirmation,
  sendStatusEmail,
  getWhatsAppLink,
  sendCashReminder,
  getCashReminderWA,
  whatsappLink,
  STATUS_EMAILS,
  WA_MESSAGES,
};
