/**
 * @komerce-arch
 * @role          invoices
 * @domain        unknown
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * Invoice Routes — Komerce
 * 
 * GET  /api/invoices/:orderId          → Generate/get invoice HTML (add ?mode=thermal for receipt)
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
    const mode = req.query.mode || 'a5'; // 'a5' or 'thermal'
    
    // Get order and parcel references for display
    const orderRef = invoice.order_reference || invoice._order_reference;
    const parcelRef = invoice.parcel_reference || invoice._parcel_reference;
    
    const html = invoiceService.generateHTML(invoice, { 
      mode, 
      orderRef, 
      parcelRef 
    });
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
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

