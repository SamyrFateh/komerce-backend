/**
 * @komerce-arch
 * @role          document-service
 * @domain        documents
 * @layer         service
 * @criticality   medium
 * @inputs        subject (événement confirmé), document_type, metadata
 * @outputs       transaction_documents row + immutable private PDF
 * @depends       db.js, services/documents/pdf-renderer.js
 * @used-by       services/documents/refund-receipt.js, services/documents/wallet-receipt.js, services/documents/pickup-proof.js
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
 *   wallet_movement_confirmed     -> wallet_receipt       (Phase 4)
 *   pickup_collected              -> pickup_proof         (Phase 4)
 *
 * Ce service gère la couche DB et matérialise le PDF privé.
 * Les services spécialisés (refund-receipt.js, etc.) gèrent la logique métier.
 */

const pool = require('../../db');
const log  = require('../../utils/logger').child({ module: 'document-service' });
const { renderPdf } = require('./pdf-renderer');

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
  ownerUserId   = null,
  metadata      = null,
  dbClient,
}) {
  const db = dbClient || pool;

  const { rows } = await db.query(
    `INSERT INTO transaction_documents
       (document_type, subject_type, subject_id,
        order_id, refund_id,
        reference, issued_by, owner_user_id, metadata,
        status, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
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
      ownerUserId,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  if (rows[0]) {
    log.info(
      { document_type: documentType, reference, subject_id: subjectId },
      '[document-service] Document persisté'
    );
    return ensurePdf(rows[0], { dbClient: db });
  }

  // ON CONFLICT → document existait déjà, le retourner
  const existing = await findExistingDocument({ documentType, subjectType, subjectId, dbClient });
  log.info(
    { document_type: documentType, reference: existing?.reference, subject_id: subjectId },
    '[document-service] Document existant retourné (idempotence)'
  );
  return ensurePdf(existing, { dbClient: db });
}

/**
 * Matérialise le PDF une seule fois. Une fois `pdf_content` écrit, aucun appel
 * ultérieur ne le remplace : l'empreinte et le snapshot restent immuables.
 *
 * @param {object} document ligne transaction_documents
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
async function ensurePdf(document, { dbClient } = {}) {
  if (!document) throw new Error('[document-service] document requis');
  if (document.pdf_content && document.status === 'available') return document;

  const db = dbClient || pool;
  try {
    const rendered = await renderPdf({
      documentType: document.document_type,
      document,
    });
    const { rows } = await db.query(
      `UPDATE transaction_documents
          SET pdf_content      = $2,
              pdf_sha256       = $3,
              pdf_filename     = $4,
              pdf_generated_at = NOW(),
              template_version = $5,
              status           = 'available',
              updated_at       = NOW()
        WHERE id = $1
          AND pdf_content IS NULL
        RETURNING *`,
      [document.id, rendered.buffer, rendered.sha256, rendered.filename, rendered.templateVersion]
    );
    if (rows[0]) return rows[0];
    return (await db.query(
      'SELECT * FROM transaction_documents WHERE id = $1 LIMIT 1',
      [document.id]
    )).rows[0];
  } catch (err) {
    await db.query(
      `UPDATE transaction_documents
          SET status = 'error', updated_at = NOW()
        WHERE id = $1 AND pdf_content IS NULL`,
      [document.id]
    ).catch(() => {});
    throw err;
  }
}

module.exports = { findExistingDocument, persistDocument, ensurePdf };
