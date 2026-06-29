/**
 * @komerce-arch
 * @role          wallet-receipt-html
 * @domain        documents
 * @layer         util
 * @criticality   low
 * @inputs        doc (ligne transaction_documents wallet_receipt avec metadata)
 * @outputs       string HTML imprimable (reçu wallet/avoir)
 * @depends       services/documents/wallet-receipt.js
 * @used-by       routes/documents-html.js
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        (none)
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  documents, wallet
 * @version       2026-06
 */

'use strict';

const { LOGO_KOMERCE_DATA_URI } = require('./logo-base64');

/**
 * KOMERCE — utils/documents/wallet-receipt-html.js
 *
 * Générateur HTML du reçu de mouvement wallet.
 * Aucun accès DB. Entrée : doc transaction_documents (wallet_receipt).
 *
 * Déclencheurs :
 *   - services/wallet-service.js       (crédit, avoir commande)
 *   - routes/wallet.js                 (admin credit / reverse-lot)
 */

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const REASON_LABELS = {
  order_cancel:  'Remboursement annulation commande',
  admin_gift:    'Avoir administrateur',
  refund:        'Avoir remboursement',
  loyalty:       'Bonus fidélité',
  reversal:      'Reprise avoir (reversal)',
  order_credit:  'Crédit commande',
};

/**
 * @param {object} doc - ligne transaction_documents (metadata incluse)
 * @returns {string} HTML complet
 */
function buildReceiptHTML(doc) {
  const meta = typeof doc.metadata === 'string'
    ? JSON.parse(doc.metadata)
    : doc.metadata || {};

  const fmtKMF = n => n != null
    ? new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' KMF'
    : '—';
  const fmtDate = d => d
    ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  const isCredit  = meta.direction === 'credit';
  const reasonLbl = REASON_LABELS[meta.reason] || meta.reason || '—';
  const dirIcon   = isCredit ? '⬆️ CRÉDIT' : '⬇️ DÉBIT';
  const dirColor  = isCredit ? '#1a7a2e' : '#9a1a1a';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Reçu wallet — ${escapeHTML(doc.reference)}</title>
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
    background: #1a5c9a;
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
  .kv .label { color: #555; }
  .section { margin: 10px 0; }
  .amount-box {
    border: 2px solid;
    padding: 14px 8px;
    text-align: center;
    margin: 14px 0;
  }
  .dir-badge {
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 2px;
    margin-bottom: 6px;
  }
  .amount-kmf { font-size: 26px; font-weight: bold; }
  .reason-row {
    text-align: center;
    font-size: 12px;
    padding: 6px;
    background: #f5f5f5;
    border: 1px dashed #999;
    margin: 8px 0;
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
    <div class="doc-type">REÇU WALLET / AVOIR</div>
  </div>

  <div style="text-align:center">
    <span class="tag">WAL</span>
  </div>

  <div class="section">
    <div class="kv"><span class="label">Référence :</span><span>${escapeHTML(doc.reference)}</span></div>
    <div class="kv"><span class="label">Titulaire :</span><span>${escapeHTML(meta.user_name || '—')}</span></div>
    ${meta.user_phone ? `<div class="kv"><span class="label">Tél :</span><span>${escapeHTML(meta.user_phone)}</span></div>` : ''}
    ${meta.order_id ? `<div class="kv"><span class="label">Commande liée :</span><span>${escapeHTML(meta.order_id)}</span></div>` : ''}
    <div class="kv"><span class="label">Émis le :</span><span>${fmtDate(meta.issued_at || doc.issued_at)}</span></div>
  </div>

  <div class="amount-box" style="border-color:${dirColor}">
    <div class="dir-badge" style="color:${dirColor}">${dirIcon}</div>
    <div class="amount-kmf" style="color:${dirColor}">${fmtKMF(meta.amount_kmf)}</div>
  </div>

  <div class="reason-row">
    👛 ${escapeHTML(reasonLbl)}
  </div>

  ${meta.note ? `<div style="font-size:11px;padding:6px;border:1px dashed #ccc;margin:8px 0;color:#444">Note : ${escapeHTML(meta.note)}</div>` : ''}

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
