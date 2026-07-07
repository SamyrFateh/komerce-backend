/**
 * @komerce-arch
 * @role          pickup-receipt-html
 * @domain        logistics
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      none
 * @db-read      none
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Générateur HTML du reçu de retrait pickup
 *
 * Extrait de routes/pickup-secret.js (GOD-FILES-0).
 * Contient uniquement la logique de présentation : aucun accès DB, aucun effet
 * de bord, aucune dépendance externe.
 *
 * Exports :
 *   buildReceiptHTML({ code, order, items }) → string HTML complet
 *   escapeHTML(s)                            → string échappée pour insertion HTML
 */

/**
 * Échappe les caractères spéciaux HTML.
 * @param {*} s
 * @returns {string}
 */
function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Construit le HTML imprimable du reçu (format A4 réduit ou thermique 80mm).
 * Le CSS utilise @media print pour optimiser l'impression.
 *
 * @param {{ code: string, order: object, items: object[] }} param
 * @returns {string} HTML complet prêt à envoyer en text/html
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
  // Payload du QR : JSON encodé en base64url pour dissuader la lecture directe
  // par une app caméra standard. Le hub relais décode et parse le JSON.
  // Format interne : { c: code, o: orderRef }
  let qrPayloadRaw = JSON.stringify({
    c: ${JSON.stringify(code)},
    o: ${JSON.stringify(order.reference)}
  });
  // base64url (sans padding, - et _ au lieu de + et /)
  let qrPayload = 'KMR1.' + btoa(qrPayloadRaw)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function renderQR() {
    if (typeof QRious === 'undefined') {
      // Fallback API externe si la lib n'a pas chargé (offline relais)
      let img = document.createElement('img');
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' +
                encodeURIComponent(qrPayload);
      img.width = 160; img.height = 160;
      let canvas = document.getElementById('pickup-qr');
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

module.exports = { buildReceiptHTML, escapeHTML };
