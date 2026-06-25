/**
 * @komerce-arch
 * @role          customs-invoice
 * @domain        documents
 * @layer         service
 * @criticality   high
 * @inputs        parcelId, shipmentId, issuedBy
 * @outputs       transaction_documents row (customs_invoice)
 * @depends       services/documents/document-service.js, db.js
 * @used-by       services/customs-shipment-service.js (post-declaration)
 * @db-read       customs_shipments, customs_shipment_parcels, order_items, orders, parcel_items, parcels, products, users
 * @db-write      transaction_documents
 * @db-txn        caller_transaction_optional
 * @doctrine      douane_declaration_pivot
 * @impact-areas  douane, orders
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/documents/customs-invoice.js
 *
 * Émet la facture classifiée par colis au moment de la déclaration douanière.
 *
 * Doctrine DOUANE_DECLARATION_PIVOT :
 *   Le colis est l'unité de déclaration. La facture porte :
 *   - la classification figée de chaque article (sh_code, douane_pct)
 *     depuis order_items (Lot A — I-DOUANE-1)
 *   - la valeur CIF du colis
 *   - le transitaire et la date d'expédition
 *
 *   Ce document est ce que l'agent douanier lit.
 *   Il reflète la déclaration honnête de Komerce — jamais ajustée.
 *
 * Idempotent : un seul document par (customs_invoice, parcel, parcel_id).
 * Format référence : DOC-{YYYY}-{seq 6 chiffres}
 *
 * Usage (post-commit de declareCustomsPayment, non-bloquant) :
 *   customsInvoiceService.issue(parcelId, shipmentId, { issuedBy })
 *     .catch(err => log.warn('[customs-invoice]', err.message))
 */

const pool            = require('../../db');
const documentService = require('./document-service');
const log             = require('../../utils/logger').child({ module: 'customs-invoice' });

/**
 * Génère la référence lisible d'une facture douane.
 * Format : DOC-{YYYY}-{seq 6 chiffres}
 */
async function _generateReference(db) {
  const { rows } = await db.query("SELECT nextval('customs_invoice_seq') AS seq");
  const year = new Date().getFullYear();
  return `DOC-${year}-${String(rows[0].seq).padStart(6, '0')}`;
}

/**
 * Construit le contenu figé de la facture — lignes classifiées par colis.
 * Lit les order_items avec leur classification douane gelée (Lot A).
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} parcelId
 * @param {string} shipmentId
 */
async function _buildInvoiceLines(db, parcelId, shipmentId) {
  // Lignes : order_items figés via parcel_items → classification douane
  const { rows: lines } = await db.query(
    `SELECT
       pi.quantity,
       pi.product_name                           AS product_name,
       oi.price_kmf                              AS unit_price_kmf,
       (pi.quantity * oi.price_kmf)              AS line_total_kmf,
       oi.customs_category_key,
       oi.sh_code,
       oi.douane_pct,
       oi.tva_pct,
       oi.taxe_add_pct,
       oi.classification_defaulted,
       p.name                                    AS product_name_live
     FROM parcel_items pi
     JOIN order_items  oi ON oi.id = pi.order_item_id
     JOIN products     p  ON p.id  = pi.product_id
     WHERE pi.parcel_id = $1
     ORDER BY p.name`,
    [parcelId]
  );

  // Valeur CIF du colis depuis customs_shipment_parcels
  const { rows: [csp] } = await db.query(
    `SELECT parcel_cif_kmf, customs_share_kmf, allocation_basis
       FROM customs_shipment_parcels
      WHERE parcel_id = $1 AND shipment_id = $2`,
    [parcelId, shipmentId]
  );

  return {
    lines: lines.map(l => ({
      product_name:            l.product_name || l.product_name_live,
      quantity:                l.quantity,
      unit_price_kmf:          l.unit_price_kmf,
      line_total_kmf:          l.line_total_kmf,
      customs_category_key:    l.customs_category_key,
      sh_code:                 l.sh_code,
      douane_pct:              l.douane_pct,
      tva_pct:                 l.tva_pct,
      taxe_add_pct:            l.taxe_add_pct,
      classification_defaulted: l.classification_defaulted,
    })),
    cif_kmf:          csp?.parcel_cif_kmf   ?? null,
    customs_share_kmf: csp?.customs_share_kmf ?? null,
    allocation_basis: csp?.allocation_basis  ?? null,
    has_defaulted_lines: lines.some(l => l.classification_defaulted),
  };
}

/**
 * Émet la facture classifiée pour un colis.
 *
 * @param {string} parcelId    - UUID du colis (unité de déclaration)
 * @param {string} shipmentId  - UUID de l'expédition customs_shipments
 * @param {object} [opts]
 * @param {object} [opts.dbClient]   - client PG dans une transaction active
 * @param {string} [opts.issuedBy]   - UUID admin ayant déclaré
 * @returns {Promise<object>}  document transaction_documents
 */
async function issue(parcelId, shipmentId, { dbClient, issuedBy } = {}) {
  if (!parcelId || !shipmentId) {
    throw new Error('[customs-invoice] parcelId et shipmentId requis');
  }

  const db = dbClient || pool;

  // ── Idempotence ───────────────────────────────────────────────────────────
  const existing = await documentService.findExistingDocument({
    documentType: 'customs_invoice',
    subjectType:  'parcel',
    subjectId:    parcelId,
    dbClient:     db,
  });
  if (existing) {
    log.info({ parcel_id: parcelId, reference: existing.reference },
      '[customs-invoice] Facture existante retournée');
    return existing;
  }

  // ── Charger le colis et l'expédition ─────────────────────────────────────
  const { rows: [parcel] } = await db.query(
    `SELECT p.*, o.reference AS order_reference, o.id AS order_id,
            r.name AS relais_name, r.island AS relais_island
       FROM parcels p
       LEFT JOIN orders o ON o.id = p.order_id
       LEFT JOIN relais r ON r.id = o.relais_id
      WHERE p.id = $1`,
    [parcelId]
  );
  if (!parcel) {
    throw new Error(`[customs-invoice] Colis ${parcelId} introuvable`);
  }

  const { rows: [shipment] } = await db.query(
    `SELECT reference, shipment_date, transitaire_name, transport_mode,
            customs_paid_kmf, declared_at
       FROM customs_shipments WHERE id = $1`,
    [shipmentId]
  );
  if (!shipment) {
    throw new Error(`[customs-invoice] Expédition ${shipmentId} introuvable`);
  }

  // ── Construire les lignes classifiées ─────────────────────────────────────
  const { lines, cif_kmf, customs_share_kmf, allocation_basis, has_defaulted_lines }
    = await _buildInvoiceLines(db, parcelId, shipmentId);

  // ── Générer la référence ──────────────────────────────────────────────────
  const reference = await _generateReference(db);

  // ── Snapshot figé — c'est ce que Komerce déclare ─────────────────────────
  const metadata = {
    // Identification
    parcel_id:          parcelId,
    parcel_reference:   parcel.reference,
    shipment_id:        shipmentId,
    shipment_reference: shipment.reference,
    order_id:           parcel.order_id,
    order_reference:    parcel.order_reference,

    // Expédition
    shipment_date:      shipment.shipment_date,
    transitaire_name:   shipment.transitaire_name,
    transport_mode:     shipment.transport_mode,
    declared_at:        shipment.declared_at,

    // Destination
    relais_name:        parcel.relais_name,
    relais_island:      parcel.relais_island,

    // Valeurs douane
    cif_kmf,
    customs_share_kmf,
    allocation_basis,

    // Lignes classifiées (le cœur de la facture)
    lines,

    // Avertissement si certains articles sont en catégorie de repli
    has_defaulted_lines,

    issued_at: new Date().toISOString(),
  };

  // ── Persister ─────────────────────────────────────────────────────────────
  const doc = await documentService.persistDocument({
    documentType: 'customs_invoice',
    subjectType:  'parcel',
    subjectId:    parcelId,
    orderId:      parcel.order_id || null,
    reference,
    issuedBy:     issuedBy || null,
    metadata,
    dbClient:     db,
  });

  log.info(
    {
      reference,
      parcel_id: parcelId,
      shipment_reference: shipment.reference,
      lines_count: lines.length,
      has_defaulted_lines,
      cif_kmf,
    },
    '[customs-invoice] Facture douane émise'
  );

  return doc;
}

/**
 * Émet une facture pour chaque colis d'une expédition.
 * Appelé par declareCustomsPayment — non bloquant si un colis échoue.
 *
 * @param {string[]} parcelIds
 * @param {string}   shipmentId
 * @param {string}   [issuedBy]
 */
async function issueForShipment(parcelIds, shipmentId, issuedBy) {
  const results = [];
  for (const parcelId of parcelIds) {
    try {
      const doc = await issue(parcelId, shipmentId, { issuedBy });
      results.push({ parcel_id: parcelId, reference: doc.reference, ok: true });
    } catch (err) {
      log.warn(
        { parcel_id: parcelId, shipment_id: shipmentId, err: err.message },
        '[customs-invoice] Échec émission pour ce colis — ignoré'
      );
      results.push({ parcel_id: parcelId, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { issue, issueForShipment };
