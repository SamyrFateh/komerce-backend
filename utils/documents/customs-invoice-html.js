/**
 * @komerce-arch
 * @role          customs-invoice-html
 * @domain        documents
 * @layer         util
 * @criticality   high
 * @inputs        doc (ligne transaction_documents customs_invoice avec metadata)
 * @outputs       string HTML A4 imprimable (facture douanière classifiée)
 * @depends       services/documents/customs-invoice.js
 * @used-by       routes/documents-html.js
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        (none)
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  documents, douane
 * @version       2026-06
 */

'use strict';

const { LOGO_KOMERCE_DATA_URI } = require('./logo-base64');

/**
 * KOMERCE — utils/documents/customs-invoice-html.js
 *
 * Générateur HTML de la facture douane classifiée par colis.
 * C'est le document lu par l'agent douanier à l'aéroport de Moroni.
 *
 * Aucun accès DB. Entrée : doc transaction_documents (customs_invoice).
 * Format A4 (pas thermique 80mm) — ce document est imprimé, pas thermique.
 *
 * Déclencheurs :
 *   - services/customs-shipment-service.js  (declareCustomsPayment → issueForShipment)
 */

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TRANSPORT_LABELS = {
  air:  'Transport aérien',
  sea:  'Transport maritime',
  road: 'Transport routier',
};

/**
 * @param {object} doc - ligne transaction_documents (metadata incluse)
 * @returns {string} HTML A4 complet
 */
function buildInvoiceHTML(doc) {
  const meta = typeof doc.metadata === 'string'
    ? JSON.parse(doc.metadata)
    : doc.metadata || {};

  const lines = meta.lines || [];
  const fmtKMF = n => n != null
    ? new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' KMF'
    : '—';
  const fmtPct = p => p != null ? Number(p).toFixed(1) + ' %' : '—';
  const fmtDate = d => d
    ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  const totalMarchandises = lines.reduce((s, l) => s + (Number(l.line_total_kmf) || 0), 0);
  const transportMode = TRANSPORT_LABELS[meta.transport_mode] || meta.transport_mode || '—';

  const linesHTML = lines.map((l, i) => `
    <tr${l.classification_defaulted ? ' class="defaulted"' : ''}>
      <td>${i + 1}</td>
      <td>${escapeHTML(l.product_name)}</td>
      <td class="center">${escapeHTML(String(l.quantity))}</td>
      <td class="right">${fmtKMF(l.unit_price_kmf)}</td>
      <td class="right">${fmtKMF(l.line_total_kmf)}</td>
      <td class="center">${escapeHTML(l.sh_code || '—')}</td>
      <td class="center">${fmtPct(l.douane_pct)}</td>
      <td class="center">${fmtPct(l.tva_pct)}</td>
      ${l.classification_defaulted ? '<td class="center warn-cell">⚠</td>' : '<td></td>'}
    </tr>
  `).join('');

  const defaultedWarning = meta.has_defaulted_lines
    ? `<div class="warning-box">
        ⚠️ Certains articles (⚠ dans le tableau) utilisent la classification de repli — 
        la classification HS/SH définitive devra être confirmée par l'administration douanière.
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Facture douane — ${escapeHTML(doc.reference)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    line-height: 1.4;
    color: #000;
    background: #fff;
    padding: 24px;
  }
  .page {
    max-width: 800px;
    margin: 0 auto;
  }

  /* ── En-tête ── */
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #000;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .brand img.logo { height: 30px; display: block; }
  .brand-sub { font-size: 10px; color: #555; margin-top: 4px; }
  .doc-title-block { text-align: right; }
  .doc-title {
    font-size: 16px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .doc-ref { font-size: 13px; font-weight: bold; margin-top: 4px; }
  .doc-date { font-size: 10px; color: #555; margin-top: 2px; }

  /* ── Grille info ── */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .info-block {
    border: 1px solid #ccc;
    padding: 8px 10px;
    border-radius: 2px;
  }
  .info-block h3 {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #666;
    margin-bottom: 6px;
    border-bottom: 1px dashed #ccc;
    padding-bottom: 3px;
  }
  .kv { display: flex; justify-content: space-between; padding: 2px 0; }
  .kv .lbl { color: #555; }
  .kv .val { font-weight: 500; text-align: right; max-width: 55%; word-break: break-word; }

  /* ── Tableau lignes ── */
  .lines-section { margin: 16px 0; }
  .lines-section h3 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #333;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 2px solid #000;
  }
  table { width: 100%; border-collapse: collapse; }
  th {
    background: #1a1a2e;
    color: #fff;
    padding: 5px 4px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  td { padding: 4px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr:nth-child(even) td { background: #f9f9f9; }
  tr.defaulted td { background: #fff8e1 !important; }
  .warn-cell { color: #e65100; font-weight: bold; }
  .center { text-align: center; }
  .right { text-align: right; }

  /* ── Totaux ── */
  .totals-block {
    margin-top: 12px;
    border-top: 2px solid #000;
    padding-top: 8px;
  }
  .total-row {
    display: flex;
    justify-content: flex-end;
    gap: 40px;
    padding: 3px 0;
    font-size: 12px;
  }
  .total-row.main { font-weight: bold; font-size: 14px; border-top: 1px solid #000; padding-top: 6px; margin-top: 4px; }
  .total-row .tlbl { color: #555; min-width: 200px; text-align: right; }
  .total-row .tval { min-width: 120px; text-align: right; font-weight: 600; }

  /* ── Avertissements ── */
  .warning-box {
    border: 2px solid #e65100;
    padding: 8px 12px;
    margin: 12px 0;
    font-size: 10px;
    color: #bf360c;
    background: #fff3e0;
  }

  /* ── Clause légale ── */
  .legal {
    margin-top: 16px;
    font-size: 9px;
    color: #666;
    border-top: 1px dashed #ccc;
    padding-top: 8px;
    line-height: 1.6;
  }

  /* ── Signature ── */
  .signature-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-top: 20px;
    border-top: 1px solid #000;
    padding-top: 12px;
  }
  .sig-block { font-size: 10px; }
  .sig-line { margin-top: 30px; border-top: 1px dotted #000; }

  /* ── Pied de page ── */
  .doc-footer {
    margin-top: 16px;
    text-align: center;
    font-size: 9px;
    color: #888;
    border-top: 1px solid #ccc;
    padding-top: 6px;
  }

  .print-btn {
    display: block; width: 220px; margin: 20px auto;
    padding: 12px; background: #1a1a2e; color: #fff;
    border: none; border-radius: 4px; font-size: 14px;
    font-weight: bold; cursor: pointer;
  }
  @media print {
    body { padding: 0; }
    .print-btn { display: none; }
    .page { max-width: 100%; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- En-tête -->
  <div class="doc-header">
    <div>
      <div class="brand"><img class="logo" src="${LOGO_KOMERCE_DATA_URI}" alt="Komerce"></div>
      <div class="brand-sub">Plateforme e-commerce diaspora comorienne<br>komerce.km</div>
    </div>
    <div class="doc-title-block">
      <div class="doc-title">Facture douanière</div>
      <div class="doc-ref">${escapeHTML(doc.reference)}</div>
      <div class="doc-date">Déclarée le ${fmtDate(meta.declared_at || meta.issued_at)}</div>
    </div>
  </div>

  <!-- Infos expédition & colis -->
  <div class="info-grid">
    <div class="info-block">
      <h3>Expédition</h3>
      <div class="kv"><span class="lbl">Référence exp. :</span><span class="val">${escapeHTML(meta.shipment_reference || '—')}</span></div>
      <div class="kv"><span class="lbl">Date expédition :</span><span class="val">${fmtDate(meta.shipment_date)}</span></div>
      <div class="kv"><span class="lbl">Mode transport :</span><span class="val">${escapeHTML(transportMode)}</span></div>
      <div class="kv"><span class="lbl">Transitaire :</span><span class="val">${escapeHTML(meta.transitaire_name || '—')}</span></div>
    </div>
    <div class="info-block">
      <h3>Colis déclaré</h3>
      <div class="kv"><span class="lbl">Réf. colis :</span><span class="val">${escapeHTML(meta.parcel_reference || '—')}</span></div>
      <div class="kv"><span class="lbl">Réf. commande :</span><span class="val">${escapeHTML(meta.order_reference || '—')}</span></div>
      <div class="kv"><span class="lbl">Destination :</span><span class="val">${escapeHTML(meta.relais_name || '—')}</span></div>
      <div class="kv"><span class="lbl">Île :</span><span class="val">${escapeHTML(meta.relais_island || '—')}</span></div>
    </div>
  </div>

  <!-- Lignes classifiées -->
  <div class="lines-section">
    <h3>Articles déclarés — classification douanière</h3>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Désignation</th>
          <th class="center">Qté</th>
          <th class="right">PU (KMF)</th>
          <th class="right">Total (KMF)</th>
          <th class="center">Code SH</th>
          <th class="center">Droits</th>
          <th class="center">TVA</th>
          <th class="center">⚠</th>
        </tr>
      </thead>
      <tbody>
        ${linesHTML || '<tr><td colspan="9" style="text-align:center;padding:8px;color:#999">Aucune ligne</td></tr>'}
      </tbody>
    </table>
  </div>

  <!-- Totaux -->
  <div class="totals-block">
    <div class="total-row">
      <span class="tlbl">Total marchandises (HT) :</span>
      <span class="tval">${fmtKMF(totalMarchandises)}</span>
    </div>
    <div class="total-row">
      <span class="tlbl">Valeur CIF colis :</span>
      <span class="tval">${fmtKMF(meta.cif_kmf)}</span>
    </div>
    <div class="total-row main">
      <span class="tlbl">Part douane allouée (${escapeHTML(meta.allocation_basis || 'CIF')}) :</span>
      <span class="tval">${fmtKMF(meta.customs_share_kmf)}</span>
    </div>
  </div>

  ${defaultedWarning}

  <!-- Clause légale -->
  <div class="legal">
    Komerce déclare que les informations figurant sur ce document reflètent fidèlement
    la nature, la quantité et la valeur des marchandises expédiées à destination des
    Comores, conformément aux obligations douanières en vigueur (ODASC).
    Tout ajustement ultérieur de classification fera l'objet d'un document rectificatif.
  </div>

  <!-- Signatures -->
  <div class="signature-grid">
    <div class="sig-block">
      Signature Komerce (déclarant) :
      <div class="sig-line"></div>
    </div>
    <div class="sig-block">
      Cachet et visa douaniers :
      <div class="sig-line"></div>
    </div>
  </div>

  <div class="doc-footer">
    Document émis le ${fmtDate(meta.issued_at)} — Réf. ${escapeHTML(doc.reference)} —
    komerce.km — Ce document est généré automatiquement et fait foi.
  </div>

</div>
<button class="print-btn" onclick="window.print()">🖨 Imprimer (A4)</button>
</body>
</html>`;
}

module.exports = { buildInvoiceHTML, escapeHTML };
