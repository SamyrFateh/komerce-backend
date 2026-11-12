/**
 * @komerce-arch
 * @role          pickup-proof
 * @domain        documents
 * @layer         service
 * @criticality   low
 * @inputs        orderId (commande en statut 'collected')
 * @outputs       transaction_documents row (pickup_proof)
 * @depends       services/documents/document-service.js, db.js
 * @used-by       services/pickup-collection-service.js, services/pickup-exceptional-collection-service.js (post-commit, par scan),
 *                services/verify-qr-collection.js (post-commit),
 *                routes/orders/status.js (post-commit, transition collected)
 * @db-read       orders, recipients, relais, users, scans, parcels, parcel_items, order_items
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

// ── Preuve par geste réel de remise (#3927 trou 2, décision A5) ─────────────
// Ancrée sur scans.id : un colis remis = un geste = une preuve, y compris collecte partielle et retry.
// Idempotence : (document_type, subject_type, subject_id) = ('pickup_proof', 'pickup_handoff', scans.id).
const HANDOFF_SUBJECT = 'pickup_handoff';
const HANDOFF_MODES = Object.freeze({ PICKUP_CODE: 'code', AUTHORIZED_NAME_ID_CHECK: 'exceptional' });

async function issueForHandoff(scanId, { dbClient, issuedBy } = {}) {
  if (!scanId) throw new Error('[pickup-proof] scanId requis');
  const db = dbClient || pool;

  const existing = await documentService.findExistingDocument({
    documentType: 'pickup_proof', subjectType: HANDOFF_SUBJECT, subjectId: scanId, dbClient: db,
  });
  if (existing) return existing;

  const { rows: [scan] } = await db.query(
    `SELECT s.id, s.order_id, s.step, s.parcel_id, s.pickup_method, s.scanned_by, s.created_at,
            o.reference AS order_reference, o.user_id AS owner_user_id, o.relais_id AS order_relais_id,
            p.reference AS parcel_reference,
            r.name AS relais_name,
            a.full_name AS agent_name,
            rc.full_name AS recipient_name
     FROM   scans s
     JOIN   orders o ON o.id = s.order_id
     LEFT JOIN parcels p ON p.id = s.parcel_id
     LEFT JOIN relais r ON r.id = COALESCE(s.pickup_relais_id, o.relais_id)
     LEFT JOIN users a ON a.id = s.scanned_by
     LEFT JOIN recipients rc ON rc.id = o.recipient_id
     WHERE  s.id = $1`,
    [scanId]
  );
  if (!scan) throw new Error(`[pickup-proof] Scan ${scanId} introuvable`);
  if (scan.step !== 'collected') {
    throw new Error(`[pickup-proof] Le scan ${scanId} n'est pas une remise (step: ${scan.step})`);
  }

  // Articles réellement remis : parcel_items du colis du scan ; commande historique sans colis : lignes de la commande.
  const { rows: items } = scan.parcel_id
    ? await db.query(
      `SELECT pi.order_item_id, oi.product_id, oi.sku_id, oi.variant_combo, pi.quantity
       FROM parcel_items pi JOIN order_items oi ON oi.id = pi.order_item_id
       WHERE pi.parcel_id = $1 ORDER BY pi.created_at, pi.id`,
      [scan.parcel_id]
    )
    : await db.query(
      `SELECT oi.id AS order_item_id, oi.product_id, oi.sku_id, oi.variant_combo, oi.quantity
       FROM order_items oi WHERE oi.order_id = $1 ORDER BY oi.created_at, oi.id`,
      [scan.order_id]
    );

  const reference = await _generateReference(db);
  const metadata = {
    scan_id:          scan.id,
    order_id:         scan.order_id,
    order_reference:  scan.order_reference,
    parcel_id:        scan.parcel_id || null,
    parcel_reference: scan.parcel_reference || null,
    items: items.map(i => ({
      order_item_id: i.order_item_id, product_id: i.product_id, sku_id: i.sku_id || null,
      variant_combo: i.variant_combo || null, quantity: i.quantity,
    })),
    relais_id:        scan.order_relais_id || null,
    relais_name:      scan.relais_name || null,
    agent_id:         scan.scanned_by || null,
    agent_name:       scan.agent_name || null,
    mode:             HANDOFF_MODES[scan.pickup_method] || 'legacy',
    recipient_name:   scan.recipient_name || null,
    collected_at:     scan.created_at instanceof Date ? scan.created_at.toISOString() : scan.created_at,
  };

  const doc = await documentService.persistDocument({
    documentType: 'pickup_proof',
    subjectType:  HANDOFF_SUBJECT,
    subjectId:    scan.id,
    orderId:      scan.order_id,
    reference,
    issuedBy:     issuedBy || scan.scanned_by || null,
    ownerUserId:  scan.owner_user_id,
    metadata,
    dbClient:     db,
  });
  log.info({ reference, scan_id: scan.id, order_id: scan.order_id }, '[pickup-proof] Preuve de remise émise');
  return doc;
}

// Anciens chemins (QR, transition manuelle collected) : même ancrage, sur le dernier scan de remise de la commande.
async function issueForLatestHandoff(orderId, { dbClient, issuedBy } = {}) {
  if (!orderId) throw new Error('[pickup-proof] orderId requis');
  const db = dbClient || pool;
  const { rows: [scan] } = await db.query(
    "SELECT id FROM scans WHERE order_id = $1 AND step = 'collected' ORDER BY created_at DESC, id DESC LIMIT 1",
    [orderId]
  );
  if (!scan) throw new Error(`[pickup-proof] Aucun scan de remise pour la commande ${orderId}`);
  return issueForHandoff(scan.id, { dbClient, issuedBy });
}

module.exports = { issue, issueForHandoff, issueForLatestHandoff, buildDisplayData };
