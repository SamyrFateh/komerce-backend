/**
 * @komerce-arch
 * @role          authenticated-client-documents
 * @domain        documents
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, optional order reference, document id
 * @outputs       private document list, PDF attachment
 * @depends       db.js, middleware/auth.js, services/invoice-service.js, services/documents/document-service.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-komerce.js, public/boutique/js/b-tracking.js
 * @db-read       invoices, orders, transaction_documents
 * @db-write      invoices, transaction_documents
 * @db-txn        none
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  documents, account, order-tracking
 * @version       2026-08
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const invoiceService = require('../services/invoice-service');
const documentService = require('../services/documents/document-service');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_REFERENCE_RX = /^[A-Za-z0-9_-]{1,80}$/;

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const orderReference = String(req.query.order_reference || '').trim() || null;
    if (orderReference && !ORDER_REFERENCE_RX.test(orderReference)) {
      return res.status(400).json({ error: 'Référence de commande invalide' });
    }
    const { rows } = await db.query(
      `SELECT d.id, d.document_type, d.reference, d.order_reference,
              d.amount_kmf, d.issued_at, d.status
         FROM (
           SELECT i.id,
                  'invoice'::text AS document_type,
                  i.invoice_number AS reference,
                  o.reference AS order_reference,
                  i.total_kmf::numeric AS amount_kmf,
                  i.created_at AS issued_at,
                  CASE WHEN i.pdf_content IS NULL THEN 'pending' ELSE 'available' END AS status
             FROM invoices i
             JOIN orders o ON o.id = i.order_id
            WHERE COALESCE(i.owner_user_id, o.user_id) = $1
              AND ($2::text IS NULL OR o.reference = $2)
           UNION ALL
           SELECT td.id,
                  td.document_type,
                  td.reference,
                  o.reference AS order_reference,
                  CASE WHEN (td.metadata->>'amount_kmf') ~ '^-?[0-9]+([.][0-9]+)?$'
                       THEN (td.metadata->>'amount_kmf')::numeric ELSE NULL END AS amount_kmf,
                  td.issued_at,
                  CASE WHEN td.status = 'available' AND td.pdf_content IS NOT NULL
                       THEN 'available' ELSE 'pending' END AS status
             FROM transaction_documents td
             JOIN orders o ON o.id = td.order_id
            WHERE COALESCE(td.owner_user_id, o.user_id) = $1
              AND td.document_type = 'refund_receipt'
              AND ($2::text IS NULL OR o.reference = $2)
         ) d
        ORDER BY d.issued_at DESC
        LIMIT $3 OFFSET $4`,
      [req.user.id, orderReference, limit, offset]
    );

    const documents = rows.map(row => ({
      ...row,
      amount_kmf: row.amount_kmf == null ? null : Number(row.amount_kmf),
      download_url: row.status === 'available'
        ? `/api/auth/me/documents/${row.id}/download`
        : null,
    }));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ documents, count: documents.length, limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/download', async (req, res, next) => {
  try {
    if (!UUID_RX.test(req.params.id)) {
      return res.status(404).json({ error: 'Document introuvable' });
    }

    const { rows: invoiceRows } = await db.query(
      `SELECT i.*, o.reference AS order_reference
         FROM invoices i
         JOIN orders o ON o.id = i.order_id
        WHERE i.id = $1
          AND COALESCE(i.owner_user_id, o.user_id) = $2
        LIMIT 1`,
      [req.params.id, req.user.id]
    );

    let document;
    if (invoiceRows[0]) {
      document = await invoiceService.ensurePdf(invoiceRows[0]);
    } else {
      const { rows } = await db.query(
        `SELECT td.*
           FROM transaction_documents td
           LEFT JOIN orders o ON o.id = td.order_id
          WHERE td.id = $1
            AND COALESCE(td.owner_user_id, o.user_id) = $2
            AND td.document_type = 'refund_receipt'
          LIMIT 1`,
        [req.params.id, req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Document introuvable' });
      document = await documentService.ensurePdf(rows[0]);
    }

    if (!document?.pdf_content) {
      return res.status(503).json({ error: 'Document temporairement indisponible' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${document.pdf_filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(document.pdf_content);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
