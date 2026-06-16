/**
 * @komerce-arch
 * @role          document-service
 * @domain        documents
 * @layer         service
 * @criticality   medium
 * @inputs        subject (événement confirmé), document_type, metadata
 * @outputs       transaction_documents row (stable, idempotent)
 * @depends       db.js
 * @used-by       services/documents/refund-receipt.js, services/documents/contribution-receipt.js
 * @db-read       transaction_documents
 * @db-write      transaction_documents
 * @db-txn        caller_transaction_optional
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  orders, refunds, shared-cart, wallet
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/documents/document-service.js
 *
 * Service documentaire générique (Phase 1 — Socle).
 *
 * Principe :
 *   - Un document ne prouve qu'un événement confirmé.
 *   - Idempotent : si le document existe, retourner l'existant.
 *   - Jamais deux documents pour le même événement.
 *
 * Carte :
 *   refund_confirmed              -> refund_receipt      (refund-receipt.js)
 *   shared_contribution_confirmed -> contribution_receipt (Phase 3)
 *   wallet_movement_confirmed     -> wallet_receipt       (Phase 4)
 *   pickup_collected              -> pickup_proof         (Phase 4)
 *
 * Ce service gère la couche DB.
 * Les services spécialisés (refund-receipt.js, etc.) gèrent la logique métier.
 */

const pool = require('../../db');
const log  = require('../../utils/logger').child({ module: 'document-service' });

/**
 * Chercher un document existant par (document_type, subject_type, subject_id).
 *
 * @param {object} opts
 * @param {string} opts.documentType  - ex. 'refund_receipt'
 * @param {string} opts.subjectType   - ex. 'refund'
 * @param {string} opts.subjectId     - UUID de l'objet source
 * @param {object} [opts.dbClient]    - client TX optionnel
 * @returns {Promise<object|null>}
 */
async function findExistingDocument({ documentType, subjectType, subjectId, dbClient }) {
  const db = dbClient || pool;
  const { rows } = await db.query(
    `SELECT * FROM transaction_documents
     WHERE document_type = $1
       AND subject_type  = $2
       AND subject_id    = $3
     LIMIT 1`,
    [documentType, subjectType, subjectId]
  );
  return rows[0] || null;
}

/**
 * Persister un document transactionnel (idempotent via ON CONFLICT DO NOTHING).
 *
 * @param {object} opts
 * @param {string}  opts.documentType
 * @param {string}  opts.subjectType
 * @param {string}  opts.subjectId
 * @param {string}  [opts.orderId]
 * @param {string}  [opts.refundId]
 * @param {string}  opts.reference       - référence lisible (ex. "REM-2026-000042")
 * @param {string}  [opts.issuedBy]      - UUID user initiateur (optionnel)
 * @param {object}  [opts.metadata]      - snapshot figé des données métier
 * @param {object}  [opts.dbClient]      - client TX optionnel
 * @returns {Promise<object>}  document persisté (nouveau ou existant)
 */
async function persistDocument({
  documentType,
  subjectType,
  subjectId,
  orderId       = null,
  refundId      = null,
  reference,
  issuedBy      = null,
  metadata      = null,
  dbClient,
}) {
  const db = dbClient || pool;

  const { rows } = await db.query(
    `INSERT INTO transaction_documents
       (document_type, subject_type, subject_id,
        order_id, refund_id,
        reference, issued_by, metadata,
        status, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'generated', NOW())
     ON CONFLICT (document_type, subject_type, subject_id)
       DO NOTHING
     RETURNING *`,
    [
      documentType,
      subjectType,
      subjectId,
      orderId,
      refundId,
      reference,
      issuedBy,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  if (rows[0]) {
    log.info(
      { document_type: documentType, reference, subject_id: subjectId },
      '[document-service] Document persisté'
    );
    return rows[0];
  }

  // ON CONFLICT → document existait déjà, le retourner
  const existing = await findExistingDocument({ documentType, subjectType, subjectId, dbClient });
  log.info(
    { document_type: documentType, reference: existing?.reference, subject_id: subjectId },
    '[document-service] Document existant retourné (idempotence)'
  );
  return existing;
}

/**
 * Marquer un document comme délivré.
 *
 * @param {string} documentId
 * @param {string} via  - 'whatsapp' | 'print' | 'email'
 * @param {object} [dbClient]
 */
async function markDelivered(documentId, via, dbClient) {
  const db = dbClient || pool;
  await db.query(
    `UPDATE transaction_documents
        SET status     = 'delivered',
            metadata   = jsonb_set(
                           COALESCE(metadata, '{}'),
                           '{delivered_via}',
                           to_jsonb($2::text)
                         ),
            updated_at = NOW()
      WHERE id = $1`,
    [documentId, via]
  );
}

module.exports = { findExistingDocument, persistDocument, markDelivered };
