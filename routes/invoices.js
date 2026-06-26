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


'use strict';
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
const { verifyInvoicePublicToken } = require('../services/invoice-public-token');
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

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orderId)) {
      return res.status(400).json({ error: 'orderId invalide — UUID attendu' });
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
router.get('/public/:token', async (req, res, next) => {
  try {
    const orderId = verifyInvoicePublicToken(req.params.token);
    if (!orderId) {
      return res.status(404).json({ error: 'Facture introuvable ou non disponible' });
    }

    const invoice = await invoiceService.getOrCreateInvoice(orderId);
    return renderInvoice(res, invoice, req.query.mode || 'a5');
  } catch (err) {
    log.error({ err }, '[INVOICE] Public generate error:');
    if (err.message.includes('introuvable')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('non payée')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ── GET /api/invoices — List all invoices (admin) ──
router.get('/', ...guard, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const invoices = await invoiceService.listInvoices({ limit, offset });
    res.json({ ok: true, invoices, count: invoices.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/invoices/:orderId — Generate and display invoice HTML ──
router.get('/:orderId', ...guard, requireInvoiceOrderAccess, async (req, res, next) => {
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
    next(err);
  }
});

// ── GET /api/invoices/:orderId/json — Invoice data as JSON ──
router.get('/:orderId/json', ...guard, requireInvoiceOrderAccess, async (req, res, next) => {
  try {
    const invoice = await invoiceService.getOrCreateInvoice(req.params.orderId);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error({ err }, '[INVOICE] JSON error:');
    res.status(err.message.includes('introuvable') ? 404 : 500).json({ error: err.message });
  }
});

// ── GET /api/invoices/:orderId/download — Download standalone HTML ──
router.get('/:orderId/download', ...guard, requireInvoiceOrderAccess, async (req, res, next) => {
  try {
    const invoice = await invoiceService.getOrCreateInvoice(req.params.orderId);
    const mode = req.query.mode || 'a5';
    const html = invoiceService.generateHTML(invoice, { mode });
    
    const filename = `${invoice.invoice_number}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/invoices/:orderId/deliver — Mark as delivered ──
router.post('/:orderId/deliver', ...guard, requireInvoiceOrderAccess, async (req, res, next) => {
  try {
    const { via } = req.body; // 'print', 'email', 'whatsapp'
    if (!via || !['print', 'email', 'whatsapp'].includes(via)) {
      return res.status(400).json({ error: 'via requis: print, email, ou whatsapp' });
    }
    
    const invoice = await invoiceService.getOrCreateInvoice(req.params.orderId);
    await invoiceService.markDelivered(invoice.id, via);
    
    res.json({ ok: true, message: `Facture ${invoice.invoice_number} marquée comme délivrée via ${via}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
