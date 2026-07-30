/**
 * @komerce-arch
 * @role          reference
 * @domain        infrastructure
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       none
 * @db-write      none
 * @db-read      none
 * @used-by       routes/hub-dashboard.js, routes/logistics.js, routes/parcels.js, services/parcel-operations.js, services/parcelOptimizationService.js, utils/parcels.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */


'use strict';
/**
 * KOMERCE — Générateurs de références uniques (sécurisé)
 *
 * Corrections v8.1 :
 *   - generateOrderRef()    → séquence DB (plus de collision)
 *   - generateShipmentRef() → séquence DB (plus de collision)
 *   - generateCashCode()    → crypto.randomInt (non prévisible)
 *   - generateBasketCode()  → crypto.randomBytes (non prévisible)
 *
 * v9.0 — Phase 1 Refonte Parcel-Centric :
 *   - generateParcelRef()   → séquence DB parcel_ref_seq (KOM-P-YYYY-NNNNNN)
 *
 * PRÉREQUIS :
 *   Exécuter migration-round2.sql pour créer les séquences :
 *   CREATE SEQUENCE order_ref_seq START WITH 1 INCREMENT BY 1;
 *   CREATE SEQUENCE shipment_ref_seq START WITH 1 INCREMENT BY 1;
 *   CREATE SEQUENCE parcel_ref_seq START WITH 1 INCREMENT BY 1;  -- migration 010
 */

const crypto = require('crypto');

/**
 * Génère une référence commande unique : KOM-2026-000001
 * Utilise une séquence PostgreSQL pour garantir l'unicité.
 *
 * @param {object} db - Instance pg pool/client
 * @returns {Promise<string>} Référence unique
 */
async function generateOrderRef(db) {
  const { rows } = await db.query(`SELECT nextval('order_ref_seq') AS seq`);
  const year = new Date().getFullYear();
  return `KOM-${year}-${String(rows[0].seq).padStart(6, '0')}`;
}

/**
 * Génère un code cash relais à 6 chiffres (crypto-secure).
 * @returns {string} Code 6 chiffres
 */
function generateCashCode() {
  return String(crypto.randomInt(100000, 999999));
}

/**
 * Génère un code panier partagé : K-XXXX (crypto-secure)
 * @returns {string} Code panier
 */
function generateBasketCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(4);
  let code = 'K-';
  for (let i = 0; i < 4; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Génère une référence expédition unique : EXP-2026-0001
 * Utilise une séquence PostgreSQL pour garantir l'unicité.
 *
 * @param {object} db - Instance pg pool/client
 * @returns {Promise<string>} Référence unique
 */
async function generateShipmentRef(db) {
  const { rows } = await db.query(`SELECT nextval('shipment_ref_seq') AS seq`);
  const year = new Date().getFullYear();
  return `EXP-${year}-${String(rows[0].seq).padStart(4, '0')}`;
}

/**
 * Génère une référence colis unique : KOM-P-2026-000001
 * Utilise une séquence PostgreSQL pour garantir l'unicité.
 *
 * Format : KOM-P-YYYY-NNNNNN
 *   KOM = préfixe Komerce
 *   P   = Parcel
 *   YYYY = année courante
 *   NNNNNN = numéro séquentiel sur 6 chiffres
 *
 * Prérequis : CREATE SEQUENCE parcel_ref_seq (migration 010)
 *
 * @param {object} db - Instance pg pool/client
 * @returns {Promise<string>} Référence unique
 */
async function generateParcelRef(db) {
  const { rows } = await db.query(`SELECT nextval('parcel_ref_seq') AS seq`);
  const year = new Date().getFullYear();
  return `KOM-P-${year}-${String(rows[0].seq).padStart(6, '0')}`;
}

module.exports = {
  generateOrderRef,
  generateCashCode,
  generateBasketCode,
  generateShipmentRef,
  generateParcelRef,
};
