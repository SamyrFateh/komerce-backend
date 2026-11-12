/**
 * @komerce-arch
 * @role          document-reconciliation
 * @domain        documents
 * @layer         service
 * @criticality   medium
 * @inputs        limit, dryRun, issuedBy
 * @outputs       reconciliation_report, transaction_documents (via services d'émission existants)
 * @depends       db.js, services/invoice-service.js, services/documents/pickup-proof.js, services/documents/refund-receipt.js
 * @used-by       routes/admin/documents.js
 * @db-read       orders, invoices, refunds, transaction_documents
 * @db-write      none
 * @db-write-via:invoice-service invoices
 * @db-write-via:pickup-proof transaction_documents
 * @db-write-via:refund-receipt transaction_documents
 * @db-txn        none
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md, un document ne prouve jamais une intention
 * @doctrine-note Aucun second writer : détecte les événements CONFIRMÉS dont le document manque
 *                (facture/PDF, preuve de retrait, reçu de remboursement) et rappelle le service
 *                d'émission existant, déjà idempotent. L'échec est journalisé (niveau error) et
 *                rapporté ; aucun envoi ni message n'est déclenché ici. L'ancrage de la preuve de
 *                retrait par scan (pickup_handoff) relève de pickup-proof ; ce service ne fait
 *                qu'en rappeler l'émission.
 * @impact-areas  documents, orders, refunds
 * @version       2026-11
 */

'use strict';

const pool = require('../../db');
const invoiceService = require('../invoice-service');
const pickupProof = require('./pickup-proof');
const refundReceipt = require('./refund-receipt');
const log = require('../../utils/logger').child({ module: 'document-reconciliation' });

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const DETECTORS = {
  // Paiement confirmé sans facture, ou facture sans PDF conservé.
  invoice: {
    sql: `SELECT o.id AS subject_id, o.id AS order_id
            FROM orders o
            LEFT JOIN invoices i ON i.order_id = o.id
           WHERE o.payment_status = 'paid'
             AND (i.id IS NULL OR i.pdf_content IS NULL)
           ORDER BY o.created_at
           LIMIT $1`,
    issue: (row) => invoiceService.issueInvoice(row.order_id),
  },
  // Commande remise (collected) sans preuve de retrait.
  pickup_proof: {
    sql: `SELECT o.id AS subject_id, o.id AS order_id
            FROM orders o
           WHERE o.status = 'collected'
             AND NOT EXISTS (SELECT 1 FROM transaction_documents td
                              WHERE td.order_id = o.id AND td.document_type = 'pickup_proof')
           ORDER BY o.created_at
           LIMIT $1`,
    issue: (row, opts) => pickupProof.issue(row.order_id, { issuedBy: opts.issuedBy }),
  },
  // Remboursement confirmé (dont ligne) sans reçu.
  refund_receipt: {
    sql: `SELECT r.id AS subject_id, r.order_id
            FROM refunds r
           WHERE r.status = 'completed'
             AND NOT EXISTS (SELECT 1 FROM transaction_documents td
                              WHERE td.document_type = 'refund_receipt'
                                AND td.subject_type = 'refund' AND td.subject_id = r.id)
           ORDER BY r.completed_at
           LIMIT $1`,
    issue: (row, opts) => refundReceipt.issue(row.subject_id, { issuedBy: opts.issuedBy }),
  },
};

/**
 * @param {object} [opts]
 * @param {number} [opts.limit]   borne par famille (défaut 50, max 200)
 * @param {boolean} [opts.dryRun] détecte sans émettre
 * @param {string} [opts.issuedBy]
 * @param {object} [opts.db]
 * @returns {Promise<{dry_run:boolean, families:object, failed:number, issued:number}>}
 */
async function reconcileDocuments({ limit = DEFAULT_LIMIT, dryRun = false, issuedBy = null, db = pool } = {}) {
  const bound = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const families = {};
  let issued = 0;
  let failed = 0;

  for (const [family, detector] of Object.entries(DETECTORS)) {
    const { rows } = await db.query(detector.sql, [bound]);
    const report = { missing: rows.length, issued: 0, failed: [] };
    families[family] = report;
    if (dryRun) continue;
    for (const row of rows) {
      try {
        await detector.issue(row, { issuedBy });
        report.issued += 1;
        issued += 1;
      } catch (err) {
        failed += 1;
        report.failed.push({ subject_id: row.subject_id, order_id: row.order_id, error: String(err.message || err).slice(0, 300) });
        log.error({ err, family, subject_id: row.subject_id, order_id: row.order_id, code: 'DOCUMENT_RECONCILIATION_FAILED' },
          '[document-reconciliation] Réémission échouée — document toujours absent, aucun envoi simulé');
      }
    }
  }
  return { dry_run: !!dryRun, families, issued, failed };
}

module.exports = { reconcileDocuments, DETECTORS };
