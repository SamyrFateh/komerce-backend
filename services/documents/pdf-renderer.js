/**
 * @komerce-arch
 * @role          private-document-pdf-renderer
 * @domain        documents
 * @layer         service
 * @criticality   high
 * @inputs        document_type, immutable_snapshot
 * @outputs       pdf_buffer, sha256, filename
 * @depends       pdfkit, crypto
 * @used-by       services/documents/document-service.js, services/invoice-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  documents, account
 * @version       2026-08
 */

'use strict';

const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const TYPE_LABELS = {
  invoice: 'Facture',
  refund_receipt: 'Reçu de remboursement',
  wallet_receipt: 'Reçu wallet',
  pickup_proof: 'Preuve de retrait',
  customs_invoice: 'Facture douane',
};

function safeFilename(reference) {
  return String(reference || 'document')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'document';
}

function formatAmount(value) {
  if (value == null || value === '') return null;
  return `${Number(value).toLocaleString('fr-FR')} KMF`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function metadataOf(document) {
  if (!document.metadata) return {};
  if (typeof document.metadata === 'string') {
    try { return JSON.parse(document.metadata); } catch (_) { return {}; }
  }
  return document.metadata;
}

function invoiceFromHtml(html) {
  if (!html) return null;
  const match = String(html).match(/<meta\s+name="komerce-invoice-payload"\s+content="([A-Za-z0-9+/=]+)"\s*>/i);
  if (!match) throw new Error('[pdf-renderer] payload facture absent du HTML canonique');
  try {
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } catch (_) {
    throw new Error('[pdf-renderer] payload facture HTML invalide');
  }
}

function logoFromHtml(html) {
  if (!html) return null;
  const match = String(html).match(/<img[^>]+class="brand-logo"[^>]+src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/i);
  return match ? Buffer.from(match[1], 'base64') : null;
}

function renderLines(pdf, documentType, document) {
  const meta = metadataOf(document);
  const rows = [];

  if (documentType === 'invoice') {
    rows.push(['Commande', document.order_reference || document._order_reference || '—']);
    rows.push(['Client', document.client_name || '—']);
    rows.push(['Relais', document.relay_name || '—']);
    rows.push(['Paiement', document.payment_mode || '—']);
    const items = typeof document.items_snapshot === 'string'
      ? JSON.parse(document.items_snapshot || '[]')
      : (document.items_snapshot || []);
    pdf.moveDown(0.5).font('Helvetica-Bold').text('Articles');
    items.forEach((item) => {
      pdf.font('Helvetica').fontSize(10)
        .text(`${item.qty} × ${item.name} — ${formatAmount(item.total)}`);
    });
    rows.push(['Total payé', formatAmount(document.total_kmf)]);
  } else {
    rows.push(['Commande', meta.order_reference || '—']);
    if (documentType === 'refund_receipt') {
      rows.push(['Montant remboursé', formatAmount(meta.amount_kmf)]);
      rows.push(['Mode', meta.refund_method || '—']);
      rows.push(['Confirmé le', formatDate(meta.confirmed_at)]);
    } else if (documentType === 'wallet_receipt') {
      rows.push(['Mouvement', meta.direction || '—']);
      rows.push(['Montant', formatAmount(meta.amount_kmf)]);
      rows.push(['Motif', meta.reason || '—']);
    } else if (documentType === 'pickup_proof') {
      rows.push(['Retiré le', formatDate(meta.collected_at)]);
      rows.push(['Relais', meta.relais_name || '—']);
      rows.push(['Bénéficiaire', meta.recipient_name || meta.user_name || '—']);
    } else {
      rows.push(['Émis le', formatDate(document.issued_at)]);
    }
  }

  pdf.moveDown();
  rows.filter(([, value]) => value != null).forEach(([label, value]) => {
    pdf.font('Helvetica-Bold').fontSize(10).text(`${label} :`, { continued: true });
    pdf.font('Helvetica').text(` ${value}`);
  });
}

async function renderPdf({ documentType, document, html = null }) {
  const invoiceSnapshot = documentType === 'invoice' && html ? invoiceFromHtml(html) : null;
  const source = invoiceSnapshot || document;
  const reference = source.invoice_number || source.reference;
  const pdf = new PDFDocument({ size: 'A4', margin: 56, info: {
    Title: `${TYPE_LABELS[documentType] || 'Document'} ${reference}`,
    Author: 'Komerce',
  } });
  const chunks = [];
  pdf.on('data', chunk => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => {
    pdf.once('end', resolve);
    pdf.once('error', reject);
  });

  const logo = documentType === 'invoice' ? logoFromHtml(html) : null;
  if (documentType === 'invoice' && html && !logo) {
    throw new Error('[pdf-renderer] logo Komerce absent du HTML canonique');
  }
  if (logo) {
    pdf.image(logo, 56, pdf.y, { width: 140 });
    pdf.y += 50;
  } else {
    pdf.font('Helvetica-Bold').fontSize(22).fillColor('#176B52').text('KOMERCE');
  }
  pdf.moveDown(0.3).fontSize(17).fillColor('#1E2A25')
    .text(TYPE_LABELS[documentType] || 'Document transactionnel');
  pdf.moveDown(0.2).font('Helvetica').fontSize(10).fillColor('#66736D')
    .text(`Référence : ${reference || '—'}`)
    .text(`Émis le : ${formatDate(source.created_at || source.issued_at)}`);
  pdf.moveDown().strokeColor('#D9E2DE').moveTo(56, pdf.y).lineTo(539, pdf.y).stroke();
  pdf.fillColor('#1E2A25');
  renderLines(pdf, documentType, source);
  pdf.moveDown(2).fontSize(8).fillColor('#66736D')
    .text('Document généré automatiquement à partir d’un événement confirmé. Téléchargement réservé au compte propriétaire.');
  pdf.end();
  await completed;

  const buffer = Buffer.concat(chunks);
  return {
    buffer,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    filename: `${safeFilename(reference)}.pdf`,
    templateVersion: documentType === 'invoice' && html ? '2026-08-html-logo-v2' : '2026-08-v1',
  };
}

module.exports = { renderPdf, safeFilename, invoiceFromHtml, logoFromHtml };
