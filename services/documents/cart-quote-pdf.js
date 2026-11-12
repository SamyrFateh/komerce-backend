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
const { LOGO_KOMERCE_BASE64 } = require('../../utils/documents/logo-base64');

const money = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Montant du devis invalide');
  return Math.round(n).toLocaleString('fr-FR') + ' KMF';
};

function variantLabel(combo) {
  if (!combo || typeof combo !== 'object' || Array.isArray(combo)) return '';
  const labels = { cj_color: 'Couleur', color: 'Couleur', couleur: 'Couleur', cj_size: 'Taille', size: 'Taille', taille: 'Taille' };
  return Object.entries(combo).map(([axis, value]) =>
    (labels[String(axis).toLowerCase()] || String(axis)) + ' : ' + String(value)
  ).join(' / ');
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
  if (!Number.isFinite(Number(preview.total_kmf)) || preview.total_kmf == null ||
      Number(preview.transport_price_kmf) !== 0) {
    throw new Error('Total canonique ou transport maritime incohérent');
  }
  const sum = preview.items.reduce((acc, item) => acc + Number(item.line_total_kmf), 0);
  if (!Number.isFinite(sum) || Math.round(sum) !== Math.round(Number(preview.items_total_kmf))) {
    throw new Error('Sous-total canonique incohérent');
  }
  const discount = Number(preview.discount_kmf || 0);
  if (!Number.isFinite(discount) || discount < 0 ||
      Math.round(Number(preview.items_total_kmf) - discount) !== Math.round(Number(preview.total_kmf))) {
    throw new Error('Total estimatif du devis incohérent');
  }

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 46, info: {
      Title: 'Devis estimatif Komerce',
      Author: 'Komerce',
      Subject: 'Panier informatif sans commande ni facture',
    } });
    const chunks = [];
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.once('error', reject);
    pdf.once('end', () => resolve(Buffer.concat(chunks)));

    const left = 46;
    const width = pdf.page.width - left * 2;
    const date = new Date(issuedAt).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
    });

    // La facture Komerce utilise exactement la même ressource embarquée.
    pdf.image(Buffer.from(LOGO_KOMERCE_BASE64, 'base64'), left, 36, { fit: [145, 48] });
    pdf.fillColor('#0d3f30').font('Helvetica-Bold').fontSize(19)
      .text('DEVIS ESTIMATIF', 249, 42, { width: 300, align: 'right' });
    pdf.fillColor('#64746a').font('Helvetica').fontSize(9)
      .text('Ton panier, sans passer commande', 249, 68, { width: 300, align: 'right' });
    pdf.strokeColor('#f5c723').lineWidth(3)
      .moveTo(left, 97).lineTo(left + width, 97).stroke();

    pdf.roundedRect(left, 114, width, 54, 9).fill('#0b4a36');
    pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15)
      .text('DEVIS ESTIMATIF', left + 18, 125, { width: width - 36 });
    pdf.fillColor('#e3f2e9').font('Helvetica').fontSize(9)
      .text('Document informatif — ni commande, ni facture', left + 18, 147, { width: width - 36 });

    pdf.fillColor('#526458').font('Helvetica').fontSize(10)
      .text('Marché : ' + String(preview.market_code || '—'), left, 187, { width: 220 })
      .text('Émis le ' + date, left + 230, 187, { width: width - 230, align: 'right' });

    let y = 221;
    function tableHeader() {
      pdf.rect(left, y, width, 28).fill('#f1f5f1');
      pdf.fillColor('#244536').font('Helvetica-Bold').fontSize(8.5);
      pdf.text('ARTICLE ET VARIANTES', left + 11, y + 9, { width: 240 });
      pdf.text('QTÉ', left + 261, y + 9, { width: 35, align: 'center' });
      pdf.text('PRIX U.', left + 303, y + 9, { width: 87, align: 'right' });
      pdf.text('TOTAL', left + 395, y + 9, { width: width - 407, align: 'right' });
      y += 28;
    }
    tableHeader();

    for (const item of preview.items) {
      const qty = Number(item.quantity);
      const unit = Number(item.unit_price_kmf);
      const total = Number(item.line_total_kmf);
      if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isFinite(unit) ||
          !Number.isFinite(total) || Math.round(qty * unit) !== Math.round(total)) {
        throw new Error('Ligne canonique du devis invalide');
      }
      const name = String(item.product_name || 'Produit');
      const variant = variantLabel(item.variant_combo);
      pdf.font('Helvetica-Bold').fontSize(9.5);
      const nameHeight = pdf.heightOfString(name, { width: 243 });
      pdf.font('Helvetica').fontSize(8.5);
      const variantHeight = variant ? pdf.heightOfString(variant, { width: 243 }) : 0;
      const rowHeight = Math.max(49, nameHeight + variantHeight + 22);

      if (y + rowHeight > pdf.page.height - 145) {
        pdf.addPage();
        y = 54;
        tableHeader();
      }
      pdf.fillColor('#19382a').font('Helvetica-Bold').fontSize(9.5)
        .text(name, left + 11, y + 11, { width: 243 });
      if (variant) {
        pdf.fillColor('#5a6c60').font('Helvetica').fontSize(8.5)
          .text(variant, left + 11, y + 13 + nameHeight, { width: 243 });
      }
      pdf.fillColor('#334e40').font('Helvetica').fontSize(9)
        .text(String(qty), left + 261, y + 14, { width: 35, align: 'center' })
        .text(money(unit), left + 303, y + 14, { width: 87, align: 'right' });
      pdf.fillColor('#153f2d').font('Helvetica-Bold').fontSize(9)
        .text(money(total), left + 395, y + 14, { width: width - 407, align: 'right' });
      y += rowHeight;
      pdf.strokeColor('#e3eae3').lineWidth(0.7)
        .moveTo(left, y).lineTo(left + width, y).stroke();
    }

    if (y + 165 > pdf.page.height - 46) {
      pdf.addPage();
      y = 60;
    }
    y += 20;
    if (discount > 0) {
      pdf.fillColor('#526458').font('Helvetica').fontSize(9)
        .text('Remise', left + 240, y, { width: 120 })
        .text('-' + money(discount), left + 365, y, { width: width - 365, align: 'right' });
      y += 25;
    }

    pdf.roundedRect(left, y, width, 65, 11).fill('#fff0b9');
    pdf.fillColor('#19372b').font('Helvetica-Bold').fontSize(13)
      .text('TOTAL ESTIMATIF', left + 17, y + 24, { width: 210 });
    pdf.roundedRect(left + 260, y + 9, width - 269, 47, 8).fill('#0b4a36');
    pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17)
      .text(money(preview.total_kmf), left + 273, y + 22,
        { width: width - 295, align: 'right' });
    y += 82;

    pdf.roundedRect(left, y, width, 33, 8).fill('#e9f4e9');
    pdf.fillColor('#12583a').font('Helvetica-Bold').fontSize(10)
      .text('Livraison maritime incluse', left + 14, y + 11, { width: width - 28 });
    y += 49;

    pdf.fillColor('#607064').font('Helvetica').fontSize(8.5)
      .text('Les prix et disponibilités seront revérifiés à la confirmation.', left, y,
        { width })
      .text('Ce devis ne vaut ni acceptation, ni réservation, ni demande de paiement.', left, y + 16,
        { width });
    pdf.end();
  });
}

module.exports = { renderCartQuotePdf, variantLabel };
