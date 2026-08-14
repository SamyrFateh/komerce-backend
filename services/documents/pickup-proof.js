/**
 * @komerce-arch
 * @role          pickup-proof
 * @domain        documents
 * @layer         service
 * @criticality   low
 * @inputs        orderId (commande en statut 'collected')
 * @outputs       transaction_documents row (pickup_proof)
 * @depends       services/documents/document-service.js, db.js
 * @used-by       services/verify-qr-collection.js (post-commit),
 *                routes/orders/status.js (post-commit, transition collected)
 * @db-read       orders, recipients, relais, users
 * @db-write      transaction_documents
 * @db-txn        caller_transaction_optional
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  orders
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/documents/pickup-proof.js
 *
 * Émet une preuve de retrait après pickup_collected.
 *
 * Règle doctrine :
 *   available        → pas de document
 *   pickup_collected → preuve de retrait émise ici ✓
 *
 * Idempotent : un seul document par order_id.
 * Format référence : RET-{YYYY}-{seq 6 chiffres}
 *
 * Usage (post-commit, non-bloquant) :
 *   pickupProofService.issue(orderId).catch(err => log.warn(...))
 */

const pool            = require('../../db');
const documentService = require('./document-service');
const log             = require('../../utils/logger').child({ module: 'pickup-proof' });

/**
 * Construit la référence lisible d'une preuve de retrait.
 * Format : RET-{YYYY}-{seq 6 chiffres}
 */
async function _generateReference(db) {
  const { rows } = await db.query("SELECT nextval('pickup_proof_seq') AS seq");
  const year = new Date().getFullYear();
  return `RET-${year}-${String(rows[0].seq).padStart(6, '0')}`;
}

/**
 * Émet la preuve de retrait pour une commande collectée.
 *
 * @param {string} orderId   - UUID de la commande (status doit être 'collected')
 * @param {object} [opts]
 * @param {object} [opts.dbClient]   - client TX actif (optionnel)
 * @param {string} [opts.issuedBy]   - UUID de l'agent (optionnel)
 * @returns {Promise<object>}  document transaction_documents
 */
async function issue(orderId, { dbClient, issuedBy } = {}) {
  if (!orderId) throw new Error('[pickup-proof] orderId requis');

  const db = dbClient || pool;

  // ── Charger la commande ───────────────────────────────────────────────────
  const { rows: [order] } = await db.query(
    `SELECT o.*,
            u.full_name   AS user_name,
            u.phone       AS user_phone,
            u.email       AS user_email,
            rc.full_name  AS recipient_name,
            rc.phone      AS recipient_phone,
            r.name        AS relais_name
     FROM   orders o
     LEFT JOIN users      u  ON u.id  = o.user_id
     LEFT JOIN recipients rc ON rc.id = o.recipient_id
     LEFT JOIN relais     r  ON r.id  = o.relais_id
     WHERE  o.id = $1`,
    [orderId]
  );

  if (!order) {
    throw new Error(`[pickup-proof] Commande ${orderId} introuvable`);
  }

  // ── Assertion : commande collectée ───────────────────────────────────────
  if (order.status !== 'collected') {
    throw new Error(
      `[pickup-proof] Impossible d'émettre une preuve — commande ${orderId} non collectée (status: ${order.status})`
    );
  }

  // ── Idempotence ───────────────────────────────────────────────────────────
  const existing = await documentService.findExistingDocument({
    documentType: 'pickup_proof',
    subjectType:  'order',
    subjectId:    orderId,
    dbClient:     db,
  });
  if (existing) {
    log.info({ order_id: orderId, reference: existing.reference },
      '[pickup-proof] Preuve existante retournée');
    return existing;
  }

  // ── Générer la référence ──────────────────────────────────────────────────
  const reference = await _generateReference(db);

  // ── Snapshot figé ────────────────────────────────────────────────────────
  const metadata = {
    order_id:         orderId,
    order_reference:  order.reference,
    collected_at:     order.collected_at || new Date().toISOString(),
    relais_name:      order.relais_name  || null,
    relais_id:        order.relais_id    || null,
    recipient_name:   order.recipient_name || null,
    recipient_phone:  order.recipient_phone || null,
    user_name:        order.user_name    || null,
    payment_mode:     order.payment_mode || null,
    total_kmf:        order.total_kmf    || null,
  };

  // ── Persister ─────────────────────────────────────────────────────────────
  const doc = await documentService.persistDocument({
    documentType: 'pickup_proof',
    subjectType:  'order',
    subjectId:    orderId,
    orderId,
    reference,
    issuedBy:     issuedBy || null,
    ownerUserId:  order.user_id,
    metadata,
    dbClient:     db,
  });

  log.info(
    {
      reference,
      order_id:        orderId,
      order_reference: order.reference,
      relais:          order.relais_name,
    },
    '[pickup-proof] Preuve de retrait émise'
  );

  return doc;
}

/**
 * Données d'affichage pour une preuve de retrait.
 *
 * @param {object} doc - ligne transaction_documents avec metadata
 * @returns {object}
 */
function buildDisplayData(doc) {
  const meta = typeof doc.metadata === 'string'
    ? JSON.parse(doc.metadata)
    : doc.metadata || {};

  const fmtDate = d => d
    ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  return {
    reference:       doc.reference,
    document_type:   'Preuve de retrait',
    order_reference: meta.order_reference || '—',
    relais_name:     meta.relais_name     || '—',
    recipient_name:  meta.recipient_name  || '—',
    recipient_phone: meta.recipient_phone || null,
    collected_at:    fmtDate(meta.collected_at),
    issued_at:       fmtDate(doc.issued_at),
  };
}

module.exports = { issue, buildDisplayData };
