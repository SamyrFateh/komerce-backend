/**
 * @komerce-arch
 * @role          pickup-proof-html
 * @domain        documents
 * @layer         util
 * @criticality   low
 * @inputs        displayData (résultat de pickup-proof.js::buildDisplayData)
 * @outputs       string HTML imprimable (preuve de retrait)
 * @depends       services/documents/pickup-proof.js
 * @used-by       routes/documents-html.js
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        (none)
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  documents, orders
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — utils/documents/pickup-proof-html.js
 *
 * Générateur HTML de la preuve de retrait colis.
 * Aucun accès DB. Entrée : résultat de buildDisplayData() depuis pickup-proof.js
 *
 * Déclencheurs :
 *   - services/verify-qr-collection.js  (scan QR retrait au relais)
 *   - routes/orders/status.js           (transition → collected)
 */

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * @param {object} d - résultat de pickupProofService.buildDisplayData(doc)
 * @returns {string} HTML complet
 */
function buildReceiptHTML(d) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Preuve de retrait — ${escapeHTML(d.reference)}</title>
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
    padding: 8px 0;
    margin-bottom: 12px;
    font-weight: bold;
    font-size: 14px;
    letter-spacing: 1px;
  }
  .tag {
    display: inline-block;
    background: #4a6f28;
    color: #fff;
    font-size: 10px;
    padding: 2px 6px;
    letter-spacing: 2px;
    margin-bottom: 10px;
  }
  .confirm-box {
    border: 3px solid #4a6f28;
    padding: 14px 8px;
    text-align: center;
    margin: 14px 0;
    background: #f0f7eb;
  }
  .confirm-icon { font-size: 36px; }
  .confirm-label { font-size: 11px; letter-spacing: 2px; margin-top: 4px; color: #4a6f28; font-weight: bold; }
  .kv {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px dotted #ccc;
  }
  .kv .label { color: #555; }
  .section { margin: 10px 0; }
  .relais-box {
    padding: 8px;
    background: #f5f5f5;
    border: 1px dashed #999;
    margin: 8px 0;
    text-align: center;
    font-size: 12px;
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
  .footer {
    text-align: center;
    border-top: 2px solid #000;
    padding-top: 8px;
    margin-top: 12px;
    font-size: 11px;
  }
  .print-btn {
    display: block; width: 200px; margin: 20px auto;
    padding: 12px; background: #4a6f28; color: #fff;
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
    KOMERCE<br>
    PREUVE DE RETRAIT
  </div>

  <div style="text-align:center">
    <span class="tag">RET</span>
  </div>

  <div class="confirm-box">
    <div class="confirm-icon">✅</div>
    <div class="confirm-label">COLIS RETIRÉ</div>
  </div>

  <div class="section">
    <div class="kv"><span class="label">Référence :</span><span>${escapeHTML(d.reference)}</span></div>
    <div class="kv"><span class="label">Commande :</span><span>${escapeHTML(d.order_reference)}</span></div>
    <div class="kv"><span class="label">Bénéficiaire :</span><span>${escapeHTML(d.recipient_name)}</span></div>
    ${d.recipient_phone ? `<div class="kv"><span class="label">Tél bénéficiaire :</span><span>${escapeHTML(d.recipient_phone)}</span></div>` : ''}
    <div class="kv"><span class="label">Retiré le :</span><span>${escapeHTML(d.collected_at)}</span></div>
    <div class="kv"><span class="label">Document émis :</span><span>${escapeHTML(d.issued_at)}</span></div>
  </div>

  <div class="relais-box">
    📦 Point relais : <strong>${escapeHTML(d.relais_name)}</strong>
  </div>

  <div class="signature">
    Signature du bénéficiaire :
    <div class="signature-line"></div>
    <div style="margin-top:4px">Pièce d'identité présentée : ___________</div>
  </div>

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
