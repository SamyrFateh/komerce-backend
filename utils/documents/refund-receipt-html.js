/**
 * @komerce-arch
 * @role          refund-receipt-html
 * @domain        documents
 * @layer         util
 * @criticality   medium
 * @inputs        displayData (résultat de refund-receipt.js::buildDisplayData)
 * @outputs       string HTML imprimable (reçu de remboursement)
 * @depends       services/documents/refund-receipt.js
 * @used-by       routes/documents-html.js
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        (none)
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  documents, refunds
 * @version       2026-06
 */

'use strict';

const { LOGO_KOMERCE_DATA_URI } = require('./logo-base64');

/**
 * KOMERCE — utils/documents/refund-receipt-html.js
 *
 * Générateur HTML du reçu de remboursement.
 * Aucun accès DB. Entrée : résultat de buildDisplayData() depuis refund-receipt.js
 *
 * Export :
 *   buildReceiptHTML(displayData) → string HTML complet (imprimable / lien WhatsApp)
 *
 * Déclencheurs :
 *   - routes/orders/cancel.js        (annulation commande)
 *   - services/admin-order-refund.js (remboursement admin)
 *   - services/payment-paypal.js     (webhook PayPal refund)
 *   - services/cancel-shared-cart-with-refunds.js
 */

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * @param {object} d - résultat de refundReceiptService.buildDisplayData(doc)
 * @returns {string} HTML complet
 */
function buildReceiptHTML(d) {
  const methodIcon = {
    'Stripe (virement EUR)':    '💳',
    'Avoir Komerce (wallet)':   '👛',
    'Espèces':                  '💵',
    'PayPal':                   '🅿️',
  }[d.method] || '↩';

  const typeLabel = {
    full:    'Remboursement total',
    partial: 'Remboursement partiel',
    parcel:  'Remboursement colis',
  }[d.refund_type] || d.refund_type || '—';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Reçu de remboursement — ${escapeHTML(d.reference)}</title>
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
    max-width: 340px;
    margin: 0 auto;
    padding: 16px;
    border: 1px dashed #666;
  }
  .header {
    text-align: center;
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
    padding: 10px 0 8px;
    margin-bottom: 12px;
  }
  .header img.logo { height: 26px; display: block; margin: 0 auto 4px; }
  .header .doc-type {
    font-weight: bold;
    font-size: 12px;
    letter-spacing: 1px;
  }
  .tag {
    display: inline-block;
    background: #000;
    color: #fff;
    font-size: 10px;
    padding: 2px 6px;
    letter-spacing: 2px;
    margin-bottom: 10px;
  }
  .kv {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px dotted #ccc;
  }
  .kv:last-child { border-bottom: none; }
  .kv .label { color: #555; }
  .section { margin: 10px 0; }
  .amount-box {
    border: 2px solid #000;
    padding: 12px 8px;
    text-align: center;
    margin: 14px 0;
  }
  .amount-label { font-size: 10px; letter-spacing: 2px; margin-bottom: 4px; }
  .amount-kmf { font-size: 22px; font-weight: bold; }
  .amount-eur { font-size: 12px; color: #444; margin-top: 2px; }
  .method-row {
    text-align: center;
    font-size: 12px;
    padding: 6px;
    background: #f5f5f5;
    border: 1px dashed #000;
    margin: 8px 0;
  }
  .reason-box {
    font-size: 11px;
    padding: 6px;
    border: 1px dashed #999;
    margin: 8px 0;
    color: #333;
  }
  .footer {
    text-align: center;
    border-top: 2px solid #000;
    padding-top: 8px;
    margin-top: 12px;
    font-size: 11px;
  }
  .stripe-ref { font-size: 9px; color: #888; margin-top: 4px; word-break: break-all; }
  .print-btn {
    display: block; width: 200px; margin: 20px auto;
    padding: 12px; background: #1a5c9a; color: #fff;
    border: none; border-radius: 8px; font-size: 14px;
    font-weight: bold; cursor: pointer;
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
    <img class="logo" src="${LOGO_KOMERCE_DATA_URI}" alt="Komerce">
    <div class="doc-type">REÇU DE REMBOURSEMENT</div>
  </div>

  <div style="text-align:center">
    <span class="tag">REM</span>
  </div>

  <div class="section">
    <div class="kv"><span class="label">Référence doc :</span><span>${escapeHTML(d.reference)}</span></div>
    <div class="kv"><span class="label">Commande :</span><span>${escapeHTML(d.order_reference)}</span></div>
    ${d.invoice_number ? `<div class="kv"><span class="label">N° facture :</span><span>${escapeHTML(d.invoice_number)}</span></div>` : ''}
    <div class="kv"><span class="label">Type :</span><span>${escapeHTML(typeLabel)}</span></div>
    <div class="kv"><span class="label">Confirmé le :</span><span>${escapeHTML(d.confirmed_at)}</span></div>
    <div class="kv"><span class="label">Émis le :</span><span>${escapeHTML(d.issued_at)}</span></div>
  </div>

  <div class="amount-box">
    <div class="amount-label">MONTANT REMBOURSÉ</div>
    <div class="amount-kmf">${escapeHTML(d.amount_kmf)}</div>
    ${d.amount_eur ? `<div class="amount-eur">(${escapeHTML(d.amount_eur)})</div>` : ''}
  </div>

  <div class="method-row">
    ${methodIcon} Méthode de remboursement : <strong>${escapeHTML(d.method)}</strong>
  </div>

  ${d.reason ? `<div class="reason-box">Motif : ${escapeHTML(d.reason)}</div>` : ''}

  ${d.stripe_refund_id
    ? `<div class="stripe-ref">Ref Stripe : ${escapeHTML(d.stripe_refund_id)}</div>`
    : ''}

  <div class="footer">
    Document officiel Komerce 🇰🇲<br>
    komerce.km
  </div>

</div>
<button class="print-btn" onclick="window.print()">🖨 Imprimer</button>
</body>
</html>`;
}

module.exports = { buildReceiptHTML, escapeHTML };
