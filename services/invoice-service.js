/**
 * @komerce-arch
 * @role          invoice-service
 * @domain        documents
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       immutable invoice snapshot, private PDF
 * @depends       db, services/documents/pdf-renderer.js, utils/documents/logo-base64.js
 * @used-by       routes/invoices.js, routes/documents.js, payment confirmation flows
 * @db-read       invoices, order_items, orders, parcels, products, recipients, relais
 * @db-write      invoices
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */


'use strict';
/**
 * Invoice Service — Komerce v1.1
 * Generates mini-invoices for client payments
 * 
 * v1.1: Suppression ligne "Livraison" — tout inclus dans le prix
 *
 * Supports:
 * - HTML generation (A5 + thermal modes)
 * - Invoice number sequencing
 * - Snapshot immutable (data captured at creation time)
 */

const pool = require('../db');
const log = require('../utils/logger').child({ module: 'invoice-service' });
const { renderPdf } = require('./documents/pdf-renderer');
const { LOGO_KOMERCE_DATA_URI } = require('../utils/documents/logo-base64');

class InvoiceService {

  /**
   * Get or create invoice for an order
   * Returns existing invoice if already generated
   */
  async getOrCreateInvoice(orderId, { dbClient } = {}) {
    const db = dbClient || pool;
    // Check if invoice already exists
    const existing = await db.query(
      `SELECT i.*, o.reference AS order_reference
         FROM invoices i
         JOIN orders o ON o.id = i.order_id
        WHERE i.order_id = $1
        ORDER BY i.created_at DESC LIMIT 1`,
      [orderId]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    // Load order + items + relay + recipient
    const orderRes = await db.query(`
      SELECT 
        o.id, o.reference, o.total_kmf, o.total_eur, o.cost_transport_kmf, 
        o.payment_mode, o.payment_status,
        o.relais_id, o.recipient_id, o.user_id,
        r.full_name AS client_name, r.phone AS client_phone,
        rel.name AS relay_name
      FROM orders o
      LEFT JOIN recipients r ON r.id = o.recipient_id
      LEFT JOIN relais rel ON rel.id = o.relais_id
      WHERE o.id = $1
    `, [orderId]);

    if (orderRes.rows.length === 0) {
      throw new Error(`Commande ${orderId} introuvable`);
    }

    const order = orderRes.rows[0];

    // Verify payment
    if (order.payment_status !== 'paid') {
      throw new Error(`Commande ${order.reference} non payée (status: ${order.payment_status})`);
    }

    // Load items with product names
    const itemsRes = await db.query(`
      SELECT 
        oi.quantity, oi.price_kmf,
        p.name AS product_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at
    `, [orderId]);

    const items = itemsRes.rows.map(i => ({
      name: i.product_name || 'Article',
      qty: i.quantity,
      unit_price: Math.round(i.price_kmf),
      total: Math.round(i.price_kmf * i.quantity)
    }));

    // Get parcel reference if exists
    const parcelRes = await db.query(
      'SELECT id, reference FROM parcels WHERE order_id = $1 LIMIT 1',
      [orderId]
    );
    const parcel = parcelRes.rows[0] || null;

    // Generate invoice number
    const seqRes = await db.query("SELECT nextval('invoice_seq') AS seq");
    const seq = seqRes.rows[0].seq;
    const year = new Date().getFullYear();
    const invoiceNumber = `KOM-INV-${year}-${String(seq).padStart(6, '0')}`;

    const subtotal = items.reduce((sum, i) => sum + i.total, 0);
    // Livraison incluse dans le prix — pas de frais supplémentaires
    const total = order.total_kmf;

    // Insert invoice (immutable snapshot)
    const insertRes = await db.query(`
      INSERT INTO invoices (
        invoice_number, order_id, parcel_id,
        client_name, client_phone, relay_name,
        items_snapshot, subtotal_kmf, shipping_kmf, total_kmf,
        payment_mode, payment_status, owner_user_id, total_eur
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (order_id) DO UPDATE SET order_id = EXCLUDED.order_id
      RETURNING *
    `, [
      invoiceNumber,
      orderId,
      parcel ? parcel.id : null,
      order.client_name || 'Client',
      order.client_phone || '',
      order.relay_name || 'Relais',
      JSON.stringify(items),
      subtotal,
      0,  // shipping_kmf = 0 (livraison incluse dans le prix)
      total,
      order.payment_mode,
      order.payment_status,
      order.user_id,
      order.total_eur != null ? Number(order.total_eur) : null,
    ]);

    const invoice = insertRes.rows[0];
    invoice._parcel_reference = parcel ? parcel.reference : null;
    invoice._order_reference = order.reference;
    return invoice;
  }

  async ensurePdf(invoice, { dbClient } = {}) {
    if (!invoice) throw new Error('[invoice-service] facture requise');
    if (invoice.pdf_content) return invoice;
    const db = dbClient || pool;
    // Le HTML est la source canonique du contenu et de l'identité visuelle de
    // la facture. Le renderer PDF en extrait le snapshot encodé par le template
    // et le logo embarqué.
    const html = this.generateHTML(invoice);
    const rendered = await renderPdf({ documentType: 'invoice', document: invoice, html });
    const { rows } = await db.query(
      `UPDATE invoices
          SET pdf_content = $2,
              pdf_sha256 = $3,
              pdf_filename = $4,
              pdf_generated_at = NOW(),
              template_version = $5
        WHERE id = $1 AND pdf_content IS NULL
        RETURNING *`,
      [invoice.id, rendered.buffer, rendered.sha256, rendered.filename, rendered.templateVersion]
    );
    if (rows[0]) return { ...invoice, ...rows[0] };
    return (await db.query('SELECT * FROM invoices WHERE id = $1 LIMIT 1', [invoice.id])).rows[0];
  }

  /** Génère et conserve la facture PDF. Aucun message ni lien public n'est émis. */
  async issueInvoice(orderId, { dbClient } = {}) {
    const invoice = await this.getOrCreateInvoice(orderId, { dbClient });
    const ready = await this.ensurePdf(invoice, { dbClient });
    log.info({ order_id: orderId, invoice_number: ready.invoice_number }, '[invoice-service] Private PDF available');
    return ready;
  }

  /**
   * Get existing invoice by ID
   */
  async getInvoice(invoiceId) {
    const res = await pool.query(`
      SELECT i.*, o.reference AS order_reference, p.reference AS parcel_reference
      FROM invoices i
      LEFT JOIN orders o ON o.id = i.order_id
      LEFT JOIN parcels p ON p.id = i.parcel_id
      WHERE i.id = $1
    `, [invoiceId]);
    return res.rows[0] || null;
  }

  /**
   * List invoices (for admin)
   */
  async listInvoices({ limit = 50, offset = 0 } = {}) {
    const res = await pool.query(`
      SELECT i.*, o.reference AS order_reference, p.reference AS parcel_reference
      FROM invoices i
      LEFT JOIN orders o ON o.id = i.order_id
      LEFT JOIN parcels p ON p.id = i.parcel_id
      ORDER BY i.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return res.rows;
  }

  /**
   * Generate printable HTML for an invoice
   * @param {Object} invoice - invoice row from DB
   * @param {Object} opts - { mode: 'a5'|'thermal', orderRef, parcelRef }
   */
  generateHTML(invoice, opts = {}) {
    const mode = opts.mode || 'a5';
    const thermalClass = mode === 'thermal' ? ' thermal' : '';
    const items = typeof invoice.items_snapshot === 'string' 
      ? JSON.parse(invoice.items_snapshot) 
      : invoice.items_snapshot;

    const orderRef = opts.orderRef || invoice.order_reference || invoice._order_reference || '—';
    const parcelRef = opts.parcelRef || invoice.parcel_reference || invoice._parcel_reference || '—';

    const payIcon = invoice.payment_mode === 'cash_relais' ? '&#x1F4B5;' : '&#x1F4B3;';
    const payLabel = invoice.payment_mode === 'cash_relais' ? 'Paiement Cash' : 'Paiement en ligne';
    const statusLabel = invoice.payment_status === 'paid'
      ? 'PAYÉ'
      : String(invoice.payment_status || 'INCONNU').toUpperCase();
    const statusClass = invoice.payment_status === 'paid' ? 'badge badge-paid' : 'badge';

    // P4 (freeze 22-08-2026) — Payment Boundary : la facture affiche ce qui
    // a été RÉELLEMENT payé, jamais 'KMF' codé en dur. cash_relais paie en
    // KMF ; stripe_eur/paypal_eur paient en EUR (orders.total_eur, déjà
    // calculé à la création de commande — jamais recalculé ici). Ne touche
    // ni currency_parities (P1) ni display_total_amount (P3) — c'est une
    // correction de la Payment Boundary elle-même (finance_config), pas de
    // la Currency Boundary.
    const isEurPayment = invoice.payment_mode === 'stripe_eur' || invoice.payment_mode === 'paypal_eur';
    const totalAmount = isEurPayment ? Number(invoice.total_eur || 0) : Number(invoice.total_kmf || 0);
    const totalCurrencyLabel = isEurPayment ? '€' : 'KMF';
    const totalFormatted = isEurPayment
      ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalAmount)
      : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(totalAmount);

    const date = new Date(invoice.created_at).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });

    const fmt = (n) => Number(n).toLocaleString('fr-FR');

    // Snapshot machine-readable contenu DANS le HTML canonique. Le PDFKit
    // renderer le consomme sans navigateur/Chromium et reste ainsi déployable
    // sur Railway avec les dépendances actuelles.
    const pdfPayload = Buffer.from(JSON.stringify({
      invoice_number: invoice.invoice_number,
      order_reference: orderRef,
      parcel_reference: parcelRef,
      client_name: invoice.client_name || '',
      relay_name: invoice.relay_name || '',
      payment_mode: invoice.payment_mode || '',
      payment_status: invoice.payment_status || '',
      total_kmf: Number(invoice.total_kmf || 0),
      total_amount: totalAmount,
      total_currency_label: totalCurrencyLabel,
      created_at: invoice.created_at || null,
      items,
    }), 'utf8').toString('base64');

    const itemRows = items.map(i => `
      <tr>
        <td>${escapeHtml(i.name)}</td>
        <td>${i.qty}</td>
        <td>${fmt(i.unit_price)}</td>
        <td>${fmt(i.total)}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="komerce-invoice-payload" content="${pdfPayload}">
<title>Facture ${invoice.invoice_number}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.4;color:#000;background:#fff}
.invoice{width:148mm;max-width:100%;margin:0 auto;padding:8mm}
.invoice.thermal{width:72mm;padding:3mm;font-size:10px}
.header{text-align:center;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:8px}
.brand-logo{display:block;width:140px;max-width:72%;height:auto;margin:0 auto}
.thermal .brand-logo{width:104px}
.tagline{font-size:9px;letter-spacing:1px;margin-top:2px}
.meta{display:flex;justify-content:space-between;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:8px}
.thermal .meta{flex-direction:column;gap:2px}
.meta-label{font-weight:bold;font-size:10px;text-transform:uppercase}
.meta-value{font-size:11px}
.info-block{border:1px solid #000;padding:5px 7px;margin-bottom:8px}
.info-row{display:flex;justify-content:space-between;gap:8px}
.thermal .info-row{flex-direction:column;gap:1px}
.info-label{font-weight:bold;font-size:10px;min-width:70px}
.items-table{width:100%;border-collapse:collapse;margin-bottom:8px}
.items-table th{border-top:2px solid #000;border-bottom:1px solid #000;padding:4px 3px;text-align:left;font-size:10px;text-transform:uppercase}
.items-table th:nth-child(2),.items-table td:nth-child(2){text-align:center;width:40px}
.items-table th:nth-child(3),.items-table td:nth-child(3),.items-table th:nth-child(4),.items-table td:nth-child(4){text-align:right;width:70px}
.thermal .items-table th:nth-child(3),.thermal .items-table td:nth-child(3),.thermal .items-table th:nth-child(4),.thermal .items-table td:nth-child(4){width:55px}
.items-table td{padding:3px;border-bottom:1px dotted #999;font-size:11px}
.items-table tr:last-child td{border-bottom:1px solid #000}
.totals{margin-bottom:8px}
.total-row{display:flex;justify-content:space-between;padding:2px 3px;font-size:11px}
.total-row.grand{border-top:2px solid #000;border-bottom:2px solid #000;font-size:14px;font-weight:bold;padding:5px 3px;margin-top:2px}
.thermal .total-row.grand{font-size:12px}
.payment-block{border:2px solid #000;padding:6px 8px;text-align:center;margin-bottom:8px}
.payment-method{font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:1px}
.payment-status{font-size:10px;margin-top:2px}
.badge{display:inline-block;border:1px solid #000;padding:1px 6px;font-weight:bold;font-size:10px}
.badge-paid{background:#000;color:#fff}
.refs{font-size:9px;border-top:1px dashed #000;padding-top:4px;margin-bottom:8px}
.refs span{margin-right:12px}
.footer{text-align:center;border-top:1px dashed #000;padding-top:6px;font-size:9px}
.footer .thanks{font-size:12px;font-weight:bold;margin-bottom:3px}
@media print{body{margin:0}.invoice{padding:5mm}@page{size:A5 portrait;margin:0}}
</style>
</head>
<body>
<div class="invoice${thermalClass}">
  <div class="header">
    <img class="brand-logo" src="${LOGO_KOMERCE_DATA_URI}" alt="Komerce">
    <div class="tagline">Votre marketplace des Comores</div>
  </div>
  <div class="meta">
    <div><span class="meta-label">Facture N° </span><span class="meta-value">${escapeHtml(invoice.invoice_number)}</span></div>
    <div><span class="meta-label">Date : </span><span class="meta-value">${date}</span></div>
  </div>
  <div class="info-block">
    <div class="info-row">
      <div><span class="info-label">Client :</span> <span>${escapeHtml(invoice.client_name)}</span></div>
      <div><span class="info-label">Tél :</span> <span>${escapeHtml(invoice.client_phone)}</span></div>
    </div>
    <div class="info-row" style="margin-top:3px">
      <div><span class="info-label">Relais :</span> <span>${escapeHtml(invoice.relay_name)}</span></div>
    </div>
  </div>
  <table class="items-table">
    <thead><tr><th>Article</th><th>Qté</th><th>P.U.</th><th>Total</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="totals">
    <div class="total-row grand"><span>TOTAL</span><span>${totalFormatted} ${totalCurrencyLabel}</span></div>
  </div>
  <div class="totals-note" style="font-size:9px;text-align:center;margin-bottom:8px;color:#555">
    <em>Livraison incluse — pas de frais supplémentaires</em>
  </div>
  <div class="payment-block">
    <div class="payment-method">${payIcon} ${payLabel}</div>
    <div class="payment-status">Statut : <span class="${statusClass}">${statusLabel}</span></div>
  </div>
  <div class="refs">
    <span><strong>Commande :</strong> ${escapeHtml(orderRef)}</span>
    <span><strong>Colis :</strong> ${escapeHtml(parcelRef)}</span>
  </div>
  <div class="footer">
    <div class="thanks">Merci pour votre achat ! &#x1F64F;</div>
    <div>KOMERCE SARL &mdash; Moroni, Comores</div>
    <div>contact@komerce.km &mdash; www.komerce.km</div>
  </div>
</div>
</body>
</html>`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = new InvoiceService();
