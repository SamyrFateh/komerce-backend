/**
 * @komerce-arch
 * @role          invoices
 * @domain        orders
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, invoices
 * @db-write      invoices
 * @db-txn        resolve_before_behavior_change
 * @doctrine      facture_apres_paiement_confirme, lien_facture_whatsapp_token_public
 * @impact-areas  orders, checkout, whatsapp
 * @version       2026-06
 */

/**
 * Invoice Routes — Komerce
 * 
 * GET  /api/invoices/public/:token     → Public paid invoice HTML for WhatsApp
 * GET  /api/invoices/:orderId          → Generate/get invoice HTML (authenticated)
 * GET  /api/invoices/:orderId/json     → Get invoice data as JSON
 * GET  /api/invoices/:orderId/download → Download as standalone HTML file
 * POST /api/invoices/:orderId/deliver  → Mark invoice as delivered (body: {via: 'print'|'email'|'whatsapp'})
 * GET  /api/invoices                   → List all invoices (admin)
 */

const express = require('express');
const router = express.Router();
const invoiceService = require('../services/invoice-service');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'invoices' });

// ── Middleware: authenticate (extracts JWT → req.user) + check ──
const guard = [authenticate, (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  next();
}];

async function requireInvoiceOrderAccess(req, res, next) {
  try {
    const orderId = req.params.orderId;
    const role = req.user?.role;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId requis' });
    }

    if (['admin', 'agent_hub', 'agent_relais'].includes(role)) {
      return next();
    }

    const { rows } = await db.query(
      'SELECT user_id FROM orders WHERE id = $1 LIMIT 1',
      [orderId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    if (String(rows[0].user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Accès refusé à cette facture' });
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

function renderInvoice(res, invoice, mode = 'a5') {
  const html = invoiceService.generateHTML(invoice, {
    mode,
    orderRef: invoice.order_reference || invoice._order_reference,
    parcelRef: invoice.parcel_reference || invoice._parcel_reference,
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

// ── GET /api/invoices/public/:token — Public WhatsApp invoice link ──
router.get('/public/:token', async (req, res) => {
  try {
    const { rows: [invoice] } = await db.query(`
      SELECT i.*, o.reference AS order_reference, p.reference AS parcel_reference
      FROM invoices i
      LEFT JOIN orders o ON o.id = i.order_id
      LEFT JOIN parcels p ON p.id = i.parcel_id
      WHERE i.public_token = $1
        AND i.payment_status = 'paid'
      LIMIT 1
    `, [req.params.token]);

    if (!invoice) {
      return res.status(404).json({ error: 'Facture introuvable ou non disponible' });
    }

    return renderInvoice(res, invoice, req.query.mode || 'a5');
  } catch (err) {
    log.error({ err }, '[INVOICE] Public generate error:');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/invoices — List all invoices (admin) ──
router.get('/', ...guard, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const invoices = await invoiceService.listInvoices({ limit, offset });
    res.json({ ok: true, invoices, count: invoices.length });
  } catch (err) {
    log.error({ err }, '[INVOICE] List error:');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/invoices/:orderId — Generate and display invoice HTML ──
router.get('/:orderId', ...guard, requireInvoiceOrderAccess, async (req, res) => {
  try {
    const invoice = await invoiceService.getOrCreateInvoice(req.params.orderId);
    return renderInvoice(res, invoice, req.query.mode || 'a5');
  } catch (err) {
    log.error({ err }, '[INVOICE] Generate error:');
    if (err.message.includes('introuvable')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('non payée')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/invoices/:orderId/json — Invoice data as JSON ──
router.get('/:orderId/json', ...guard, requireInvoiceOrderAccess, async (req, res) => {
  try {
    const invoice = await invoiceService.getOrCreateInvoice(req.params.orderId);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error({ err }, '[INVOICE] JSON error:');
    res.status(err.message.includes('introuvable') ? 404 : 500).json({ error: err.message });
  }
});

// ── GET /api/invoices/:orderId/download — Download standalone HTML ──
router.get('/:orderId/download', ...guard, requireInvoiceOrderAccess, async (req, res) => {
  try {
    const invoice = await invoiceService.getOrCreateInvoice(req.params.orderId);
    const mode = req.query.mode || 'a5';
    const html = invoiceService.generateHTML(invoice, { mode });
    
    const filename = `${invoice.invoice_number}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  } catch (err) {
    log.error({ err }, '[INVOICE] Download error:');
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/invoices/:orderId/deliver — Mark as delivered ──
router.post('/:orderId/deliver', ...guard, requireInvoiceOrderAccess, async (req, res) => {
  try {
    const { via } = req.body; // 'print', 'email', 'whatsapp'
    if (!via || !['print', 'email', 'whatsapp'].includes(via)) {
      return res.status(400).json({ error: 'via requis: print, email, ou whatsapp' });
    }
    
    const invoice = await invoiceService.getOrCreateInvoice(req.params.orderId);
    await invoiceService.markDelivered(invoice.id, via);
    
    res.json({ ok: true, message: `Facture ${invoice.invoice_number} marquée comme délivrée via ${via}` });
  } catch (err) {
    log.error({ err }, '[INVOICE] Deliver error:');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
