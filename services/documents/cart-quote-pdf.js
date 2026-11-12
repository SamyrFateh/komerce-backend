/**
 * @komerce-arch
 * @role          boutique-non-transactional-cart-quotation
 * @domain        boutique
 * @layer         service
 * @criticality   medium
 * @inputs        canonical_checkout_preview_only
 * @outputs       ephemeral_pdf_buffer
 * @db-read       none
 * @db-write      none
 * @doctrine      devis_avant_commande_sans_engagement_ni_facture
 * @impact-areas  boutique, checkout, documents
 * @version       2026-11
 */
'use strict';

const PDFDocument = require('pdfkit');

const money = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Montant du devis invalide');
  return Math.round(n).toLocaleString('fr-FR') + ' KMF';
};

function variantLabel(combo) {
  if (!combo || typeof combo !== 'object' || Array.isArray(combo)) return '';
  return Object.entries(combo).map(([axis, value]) => String(axis) + ' : ' + String(value)).join(' / ');
}

/**
 * Document informatif NON OFFICIEL : aucun invoice, order, transaction_document,
 * référence de commande, paiement, notification ou stockage n'est créé.
 * Les lignes et leurs prix viennent EXCLUSIVEMENT du preview serveur.
 */
function renderCartQuotePdf(preview, issuedAt = new Date()) {
  if (!preview || !Array.isArray(preview.items) || !preview.items.length) {
    throw new Error('Lignes canoniques du devis absentes');
  }
  if (!Number.isFinite(Number(preview.total_kmf)) || preview.total_kmf == null) {
    throw new Error('Total canonique absent');
  }
  const sum = preview.items.reduce((acc, item) => acc + Number(item.line_total_kmf), 0);
  if (!Number.isFinite(sum) || Math.round(sum) !== Math.round(Number(preview.items_total_kmf))) {
    throw new Error('Sous-total canonique incohérent');
  }
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 46, info: {
      Title: 'Devis estimatif Komerce',
      Author: 'Komerce',
      Subject: 'Simulation de panier sans commande ni facture',
    } });
    const chunks = [];
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.once('error', reject);
    pdf.once('end', () => resolve(Buffer.concat(chunks)));

    const date = new Date(issuedAt).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
    });

    pdf.fillColor('#27332c').font('Helvetica-Bold').fontSize(21).text('KOMERCE');
    pdf.moveDown(0.3).fontSize(17).text('DEVIS ESTIMATIF');
    pdf.moveDown(0.2).fillColor('#4b5563').font('Helvetica').fontSize(9)
      .text('Préparé le ' + date)
      .text('Document informatif — ni commande, ni facture, ni réservation de stock.')
      .text('Les prix et disponibilités seront revérifiés à la commande.');
    pdf.moveDown(1);
    pdf.fillColor('#27332c').font('Helvetica-Bold').fontSize(11)
      .text('Point relais : ' + String(preview.relais_name || 'Non précisé'));
    pdf.font('Helvetica').fontSize(9).fillColor('#6b7280')
      .text('Marché : ' + String(preview.market_code || '—') + '   |   Montants en KMF');
    pdf.moveDown(1);

    const ensureSpace = (min = 70) => {
      if (pdf.y + min > pdf.page.height - 65) pdf.addPage();
    };

    ensureSpace();
    pdf.fillColor('#27332c').font('Helvetica-Bold').fontSize(11).text('Articles');
    pdf.moveDown(0.5);
    preview.items.forEach(item => {
      ensureSpace(75);
      const qty = Number(item.quantity);
      const unit = Number(item.unit_price_kmf);
      const total = Number(item.line_total_kmf);
      if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isFinite(unit) ||
          !Number.isFinite(total) || Math.round(qty * unit) !== Math.round(total)) {
        throw new Error('Ligne canonique du devis invalide');
      }
      const startY = pdf.y;
      const name = String(item.product_name || 'Produit');
      const variant = variantLabel(item.variant_combo);
      pdf.font('Helvetica-Bold').fontSize(10).fillColor('#27332c')
        .text(name, 48, startY, { width: 320 });
      if (variant) pdf.font('Helvetica').fontSize(9).fillColor('#555f59')
        .text(variant, 48, pdf.y + 2, { width: 320 });
      const infoEnd = pdf.y;
      pdf.font('Helvetica').fontSize(9).fillColor('#27332c')
        .text(String(qty) + ' x ' + money(unit), 372, startY, { width: 170, align: 'right' })
        .font('Helvetica-Bold').text(money(total), 372, pdf.y + 3, { width: 170, align: 'right' });
      pdf.y = Math.max(infoEnd, pdf.y) + 11;
      pdf.strokeColor('#e4e7e4').lineWidth(0.5).moveTo(48, pdf.y).lineTo(546, pdf.y).stroke();
      pdf.y += 10;
    });

    ensureSpace(155);
    const summary = [
      ['Articles', preview.items_total_kmf],
      ['Transport vers le relais', preview.transport_price_kmf],
    ];
    if (Number(preview.discount_kmf) > 0) summary.push(['Remise fidélité', -Number(preview.discount_kmf)]);
    summary.forEach(([label, amount]) => {
      const n = Number(amount);
      const y = pdf.y;
      pdf.font('Helvetica').fontSize(10).fillColor('#47534e')
        .text(label, 250, y, { width: 165 });
      pdf.font('Helvetica-Bold').text((n < 0 ? '-' : '') + money(Math.abs(n)),
        415, y, { width: 130, align: 'right' });
      pdf.y = Math.max(y + 18, pdf.y + 4);
    });
    pdf.moveDown(0.5).font('Helvetica-Bold').fontSize(14).fillColor('#1f3025')
      .text('TOTAL ESTIMATIF : ' + money(preview.total_kmf), { align: 'right' });
    pdf.moveDown(1).font('Helvetica').fontSize(9).fillColor('#6b7280')
      .text('Ce document ne vaut pas acceptation, contrat, demande de paiement ou réservation. Aucun débit n\'a été réalisé.');
    pdf.end();
  });
}

module.exports = { renderCartQuotePdf, variantLabel };
