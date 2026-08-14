/**
 * @komerce-arch
 * @role          refund-receipt
 * @domain        documents
 * @layer         service
 * @criticality   medium
 * @inputs        refundId (remboursement confirmé)
 * @outputs       transaction_documents row (refund_receipt)
 * @depends       services/documents/document-service.js, db.js
 * @used-by       routes/orders/cancel.js (post-commit), services/refund-service.js (post-commit)
 * @db-read       invoices, orders, refunds
 * @db-write      transaction_documents
 * @db-txn        caller_transaction_optional
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  orders, refunds
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/documents/refund-receipt.js
 *
 * Émet un reçu de remboursement après refund_confirmed.
 *
 * Règle doctrine :
 *   refund_requested  → pas de document
 *   refund_processing → pas de document
 *   refund_confirmed  → reçu émis ici ✓
 *   refund_failed     → pas de document
 *
 * Idempotent : si le reçu existe déjà pour ce refund_id, retourne l'existant.
 * Résiste aux webhooks Stripe rejoués, double-clics admin, retries réseau.
 *
 * Usage (post-commit, non-bloquant) :
 *   refundReceiptService.issue(refundId).catch(err => log.warn(...))
 *
 * Usage dans une transaction existante :
 *   const doc = await refundReceiptService.issue(refundId, { dbClient: client });
 */

const pool            = require('../../db');
const documentService = require('./document-service');
const log             = require('../../utils/logger').child({ module: 'refund-receipt' });

/**
 * Construit la référence lisible d'un reçu de remboursement.
 * Format : REM-{YYYY}-{seq 6 chiffres}
 *
 * @param {object} db - pool ou dbClient
 * @returns {Promise<string>}
 */
async function _generateReference(db) {
  const { rows } = await db.query("SELECT nextval('refund_receipt_seq') AS seq");
  const year = new Date().getFullYear();
  return `REM-${year}-${String(rows[0].seq).padStart(6, '0')}`;
}

/**
 * Émet le reçu de remboursement pour un remboursement confirmé.
 *
 * @param {string} refundId  - UUID de la ligne refunds (status doit être 'completed')
 * @param {object} [opts]
 * @param {object} [opts.dbClient]   - client TX actif (optionnel)
 * @param {string} [opts.issuedBy]   - UUID de l'initiateur (optionnel)
 * @returns {Promise<object>}  document transaction_documents
 */
async function issue(refundId, { dbClient, issuedBy } = {}) {
  if (!refundId) throw new Error('[refund-receipt] refundId requis');

  const db = dbClient || pool;

  // ── Charger le remboursement ──────────────────────────────────────────────
  const { rows: [refund] } = await db.query(
    `SELECT r.*,
            o.reference       AS order_reference,
            o.payment_mode    AS order_payment_mode,
            o.user_id,
            i.invoice_number  AS invoice_number,
            i.id              AS invoice_id
     FROM   refunds r
     JOIN   orders  o ON o.id = r.order_id
     LEFT JOIN invoices i ON i.order_id = r.order_id
     WHERE  r.id = $1`,
    [refundId]
  );

  if (!refund) {
    throw new Error(`[refund-receipt] Remboursement ${refundId} introuvable`);
  }

  // ── Assertion : événement confirmé ───────────────────────────────────────
  // Doctrine : un document ne prouve jamais une intention.
  if (refund.status !== 'completed') {
    throw new Error(
      `[refund-receipt] Impossible d'émettre un reçu — remboursement ${refundId} non confirmé (status: ${refund.status})`
    );
  }

  // ── Idempotence : retourner l'existant si déjà émis ──────────────────────
  const existing = await documentService.findExistingDocument({
    documentType: 'refund_receipt',
    subjectType:  'refund',
    subjectId:    refundId,
    dbClient:     db,
  });
  if (existing) {
    log.info({ refund_id: refundId, reference: existing.reference }, '[refund-receipt] Reçu existant retourné');
    return existing;
  }

  // ── Générer la référence ──────────────────────────────────────────────────
  const reference = await _generateReference(db);

  // ── Construire le snapshot figé (données au moment de l'émission) ─────────
  const metadata = {
    order_reference:    refund.order_reference,
    invoice_number:     refund.invoice_number || null,
    invoice_id:         refund.invoice_id     || null,
    refund_id:          refund.id,
    amount_kmf:         refund.amount_kmf,
    amount_eur:         refund.amount_eur,
    refund_method:      refund.refund_method,     // stripe | wallet_credit | cash
    refund_type:        refund.refund_type,        // full | partial | parcel
    stripe_refund_id:   refund.stripe_refund_id || null,
    reason:             refund.reason || null,
    confirmed_at:       refund.completed_at,
    order_payment_mode: refund.order_payment_mode,
    // Panier partagé (Phase 3) : shared_cart_id, contribution_id à ajouter ici
  };

  // ── Persister le document (idempotent via ON CONFLICT DO NOTHING) ─────────
  const doc = await documentService.persistDocument({
    documentType: 'refund_receipt',
    subjectType:  'refund',
    subjectId:    refundId,
    orderId:      refund.order_id,
    refundId:     refundId,
    reference,
    issuedBy:     issuedBy || null,
    ownerUserId:  refund.user_id,
    metadata,
    dbClient:     db,
  });

  log.info(
    {
      reference,
      refund_id:       refundId,
      order_reference: refund.order_reference,
      amount_kmf:      refund.amount_kmf,
      method:          refund.refund_method,
    },
    '[refund-receipt] Reçu de remboursement émis'
  );

  return doc;
}

/**
 * Construire un objet de données pour affichage HTML du reçu.
 * (Prépare le futur generateHTML ou lien WhatsApp.)
 *
 * @param {object} doc - ligne transaction_documents avec metadata
 * @returns {object}
 */
function buildDisplayData(doc) {
  const meta = typeof doc.metadata === 'string'
    ? JSON.parse(doc.metadata)
    : doc.metadata || {};

  const methodLabel = {
    stripe:        'Stripe (virement EUR)',
    wallet_credit: 'Avoir Komerce (wallet)',
    cash:          'Espèces',
    paypal:        'PayPal',
  }[meta.refund_method] || meta.refund_method || '—';

  const fmtKMF = n => n != null
    ? new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' KMF'
    : '—';

  const fmtDate = d => d
    ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  return {
    reference:       doc.reference,
    document_type:   'Reçu de remboursement',
    order_reference: meta.order_reference || '—',
    invoice_number:  meta.invoice_number  || null,
    amount_kmf:      fmtKMF(meta.amount_kmf),
    amount_eur:      meta.amount_eur != null ? `${Number(meta.amount_eur).toFixed(2)} EUR` : null,
    method:          methodLabel,
    refund_type:     meta.refund_type || '—',
    reason:          meta.reason      || null,
    confirmed_at:    fmtDate(meta.confirmed_at),
    issued_at:       fmtDate(doc.issued_at),
    stripe_refund_id: meta.stripe_refund_id || null,
  };
}

module.exports = { issue, buildDisplayData };
