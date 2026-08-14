/**
 * @komerce-arch
 * @role          wallet-receipt
 * @domain        documents
 * @layer         service
 * @criticality   low
 * @inputs        walletTransactionId
 * @outputs       transaction_documents row (wallet_receipt)
 * @depends       services/documents/document-service.js, db.js
 * @used-by       services/wallet-service.js (post-commit),
 *                routes/wallet.js (admin credit/reverse-lot, post-commit)
 * @db-read       users, wallets, wallet_transactions
 * @db-write      transaction_documents
 * @db-txn        caller_transaction_optional
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  wallet
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/documents/wallet-receipt.js
 *
 * Émet un reçu wallet après mouvement confirmé.
 *
 * Déclencheurs doctrine :
 *   wallet_credit_confirmed   → credit, order_credit
 *   wallet_reversal_confirmed → reversal
 *
 * Idempotent : un seul document par wallet_transaction.id.
 * Format référence : WAL-{YYYY}-{seq 6 chiffres}
 *
 * Usage (post-commit, non-bloquant) :
 *   walletReceiptService.issue(txId, { issuedBy }).catch(err => log.warn(...))
 */

const pool            = require('../../db');
const documentService = require('./document-service');
const log             = require('../../utils/logger').child({ module: 'wallet-receipt' });

/** Raisons de mouvement wallet éligibles à un reçu */
const RECEIPT_ELIGIBLE_REASONS = new Set([
  'order_cancel',
  'admin_gift',
  'refund',
  'loyalty',
  'reversal',
  'order_credit',
]);

/**
 * Génère la référence lisible d'un reçu wallet.
 * Format : WAL-{YYYY}-{seq 6 chiffres}
 */
async function _generateReference(db) {
  const { rows } = await db.query("SELECT nextval('wallet_receipt_seq') AS seq");
  const year = new Date().getFullYear();
  return `WAL-${year}-${String(rows[0].seq).padStart(6, '0')}`;
}

/**
 * Émet un reçu wallet pour une transaction confirmée.
 *
 * @param {string} walletTransactionId  - UUID wallet_transactions.id
 * @param {object} [opts]
 * @param {object} [opts.dbClient]      - client TX actif (optionnel)
 * @param {string} [opts.issuedBy]      - UUID admin (optionnel)
 * @returns {Promise<object|null>}  document transaction_documents, ou null si non éligible
 */
async function issue(walletTransactionId, { dbClient, issuedBy } = {}) {
  if (!walletTransactionId) throw new Error('[wallet-receipt] walletTransactionId requis');

  const db = dbClient || pool;

  // ── Charger la transaction wallet ────────────────────────────────────────
  const { rows: [tx] } = await db.query(
    `SELECT wt.*,
            w.user_id,
            u.full_name AS user_name,
            u.phone     AS user_phone
     FROM   wallet_transactions wt
     JOIN   wallets w ON w.id = wt.wallet_id
     LEFT JOIN users u ON u.id = w.user_id
     WHERE  wt.id = $1`,
    [walletTransactionId]
  );

  if (!tx) {
    throw new Error(`[wallet-receipt] Transaction wallet ${walletTransactionId} introuvable`);
  }

  // ── Éligibilité (mouvements significatifs uniquement) ────────────────────
  if (!RECEIPT_ELIGIBLE_REASONS.has(tx.reason)) {
    log.debug({ tx_id: walletTransactionId, reason: tx.reason },
      '[wallet-receipt] Mouvement non éligible — pas de reçu');
    return null;
  }

  // ── Idempotence ───────────────────────────────────────────────────────────
  const existing = await documentService.findExistingDocument({
    documentType: 'wallet_receipt',
    subjectType:  'wallet_tx',
    subjectId:    walletTransactionId,
    dbClient:     db,
  });
  if (existing) {
    log.info({ tx_id: walletTransactionId, reference: existing.reference },
      '[wallet-receipt] Reçu existant retourné');
    return existing;
  }

  // ── Générer la référence ──────────────────────────────────────────────────
  const reference = await _generateReference(db);

  // ── Snapshot figé ────────────────────────────────────────────────────────
  const metadata = {
    wallet_transaction_id: walletTransactionId,
    user_id:               tx.user_id,
    user_name:             tx.user_name   || null,
    user_phone:            tx.user_phone  || null,
    amount_kmf:            tx.amount_kmf,
    direction:             tx.type,
    reason:                tx.reason,
    note:                  tx.note        || null,
    order_id:              tx.reference_id || null,
    lot_id:                null,
    issued_at:             new Date().toISOString(),
  };

  // ── Persister ─────────────────────────────────────────────────────────────
  const doc = await documentService.persistDocument({
    documentType: 'wallet_receipt',
    subjectType:  'wallet_tx',
    subjectId:    walletTransactionId,
    orderId:      null,
    reference,
    issuedBy:     issuedBy || null,
    ownerUserId:  tx.user_id,
    metadata,
    dbClient:     db,
  });

  log.info(
    { reference, tx_id: walletTransactionId, reason: tx.reason, amount_kmf: tx.amount_kmf },
    '[wallet-receipt] Reçu wallet émis'
  );

  return doc;
}

module.exports = { issue };
