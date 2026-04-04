/**
 * KOMERCE — Module email (D2/BUG-017)
 *
 * Envoie des emails transactionnels (confirmation commande, etc.)
 * Configuration via variables d'environnement :
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Si les variables ne sont pas configurées, les emails sont loggés
 * en console sans être envoyés (mode développement).
 */

'use strict';

const nodemailer = require('nodemailer');

let transporter = null;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || 'Komerce <noreply@komerce.km>';

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  console.log(`📧 Email transporter configuré (${SMTP_HOST}:${SMTP_PORT})`);
} else {
  console.log('📧 Email transporter NON configuré — emails loggés en console uniquement');
  console.log('   → Configurer SMTP_HOST, SMTP_USER, SMTP_PASS pour activer l\'envoi');
}

/**
 * Envoie un email. Si le transporter n'est pas configuré, log en console.
 */
async function sendEmail(to, subject, html) {
  if (!to) {
    console.warn('[EMAIL] Pas d\'adresse email — email ignoré');
    return { skipped: true, reason: 'no_recipient' };
  }

  if (!transporter) {
    console.log(`[EMAIL-DEV] To: ${to} | Subject: ${subject}`);
    console.log(`[EMAIL-DEV] Body preview: ${html.replace(/<[^>]*>/g, '').substring(0, 150)}...`);
    return { skipped: true, reason: 'no_smtp_config' };
  }

  try {
    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html,
    });
    console.log(`[EMAIL] ✅ Envoyé à ${to} — messageId: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL] ❌ Erreur envoi à ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Email de confirmation de commande — template HTML responsive
 */
async function sendOrderConfirmation(order, userEmail, items) {
  if (!userEmail) return { skipped: true, reason: 'no_email' };

  const fmtKMF = (n) => (n || 0).toLocaleString('fr-FR');

  const itemsHtml = (items || []).map(i =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px">${i.name || 'Produit'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:14px">${i.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:14px;font-weight:600">${fmtKMF(i.price_kmf * i.qty)} KMF</td>
    </tr>`
  ).join('');

  const trackingUrl = (process.env.FRONTEND_URL || 'https://komerce-backend-production.up.railway.app') + '/#tracking';

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0fdf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#ffffff">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#15803d,#16a34a);padding:24px;text-align:center;border-radius:12px 12px 0 0">
      <h1 style="color:#ffffff;font-size:24px;margin:0;font-family:'Segoe UI',sans-serif">
        <span style="color:#ffffff">Ko</span><span style="color:#f59e0b">merce</span>
      </h1>
      <p style="color:#dcfce7;font-size:14px;margin:8px 0 0">Votre commande est confirmée ! 🎉</p>
    </div>

    <!-- Body -->
    <div style="padding:24px">

      <!-- Référence -->
      <div style="background:#f0fdf4;border-radius:10px;padding:16px;text-align:center;margin-bottom:20px">
        <p style="font-size:13px;color:#64748b;margin:0 0 4px">Référence de commande</p>
        <p style="font-size:22px;font-weight:800;color:#15803d;letter-spacing:1px;margin:0">${order.reference}</p>
      </div>

      <p style="font-size:15px;color:#1e293b;margin-bottom:16px;line-height:1.6">
        Bonjour,<br><br>
        Merci pour votre commande ! Nous l'avons bien reçue et elle est en cours de traitement.
        Conservez votre référence <strong>${order.reference}</strong> pour suivre votre colis.
      </p>

      <!-- Articles -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead>
          <tr style="background:#f0fdf4">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase">Article</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;text-transform:uppercase">Qté</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;text-transform:uppercase">Prix</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <!-- Total -->
      <div style="background:#f0fdf4;border-radius:10px;padding:14px 16px;margin-bottom:16px">
        <table style="width:100%"><tr>
          <td style="font-weight:700;font-size:16px;color:#1e293b">Total</td>
          <td style="font-weight:800;font-size:18px;color:#15803d;text-align:right">${fmtKMF(order.total_kmf)} KMF</td>
        </tr></table>
      </div>

      ${order.relais_name ? `
      <!-- Relais -->
      <div style="padding:14px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:16px">
        <p style="font-size:12px;color:#64748b;margin:0 0 4px">📍 Point relais de livraison</p>
        <p style="font-weight:700;margin:0;color:#1e293b;font-size:15px">${order.relais_name}</p>
      </div>` : ''}

      <!-- CTA -->
      <div style="text-align:center;margin-top:24px">
        <a href="${trackingUrl}"
           style="display:inline-block;background:#16a34a;color:#ffffff;padding:14px 36px;border-radius:10px;font-weight:700;text-decoration:none;font-size:15px">
          📍 Suivre ma commande
        </a>
      </div>

    </div>

    <!-- Footer -->
    <div style="background:#0f172a;padding:20px;text-align:center;border-radius:0 0 12px 12px">
      <p style="color:#64748b;font-size:12px;margin:0">
        © 2026 Komerce — Le e-commerce qui rapproche la diaspora des Comores<br>
        <a href="mailto:contact@komerce.km" style="color:#94a3b8">contact@komerce.km</a>
      </p>
    </div>

  </div>
</body>
</html>`;

  return sendEmail(userEmail, `✅ Commande ${order.reference} confirmée — Komerce`, html);
}

module.exports = { sendEmail, sendOrderConfirmation };
