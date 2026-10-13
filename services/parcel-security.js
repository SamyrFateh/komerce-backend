/**
 * @komerce-arch
 * @role          logistics-parcel-security
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       utils/logger.js
 * @used-by       routes/hub-dashboard.js, routes/logistics.js, routes/parcels.js, server.js
 * @db-read       parcels
 * @db-write      parcel_events, parcels
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */


'use strict';
/**
 * KOMERCE — Sécurité Logistique v1.0
 *
 * Principes :
 * [S1] Colis banalisés — aucune info sensible visible
 * [S2] Traçabilité interne maximale — parcel_events horodatés
 * [S3] Séparation stricte info visible / info système
 * [S4] Code colis neutre et non parlant
 * [S5] Protection vol, fraude, substitution, perte traçabilité
 *
 * Architecture :
 *   external_code → imprimé sur le colis (neutre, 8 chars)
 *   reference     → interne système (KOM-P-YYYY-NNNNNN)
 *   seal_code     → code scellé (vérification intégrité)
 *   parcel_events → journal complet de tout ce qui arrive au colis
 */

const crypto = require('crypto');
const log = require('../utils/logger').forModule('parcel-security');

// ─── [S4] Code externe neutre ─────────────────────────────────────────────
// Format : 2 lettres + 6 alphanum (ex: "KP-A7K9M2")
// Non séquentiel, non prédictible, non parlant
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O/1/I exclus

function generateExternalCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return `KP-${code}`;
}

// ─── [S5] Code de scellé ──────────────────────────────────────────────────
// Vérifie que le colis n'a pas été ouvert/substitué entre deux points
function generateSealCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
}

// ─── [S3] Séparation info visible / système ───────────────────────────────

/**
 * Info autorisée SUR le colis physique (étiquette)
 * RIEN de sensible : pas de nom, pas de téléphone, pas de produits, pas de valeur
 */
function buildExternalLabel(parcel, relay, destinationIsland) {
  return {
    external_code: parcel.external_code,       // Code neutre imprimé
    destination: destinationIsland || null,     // Île destination (routage)
    relay_name: relay?.name || null,            // Point relais (livraison)
    weight_kg: parcel.weight_kg || null,        // Poids (manutention)
    type: parcel.type || 'standard',            // standard/partial/fragile
    date: new Date().toISOString().split('T')[0],
    // QR code → URL interne (nécessite auth pour voir le contenu)
    qr_url: `https://komerce.km/p/${parcel.external_code}`,
  };
}

/**
 * Info complète UNIQUEMENT dans le système (jamais sur le colis)
 */
function buildInternalRecord(parcel, order, items) {
  return {
    parcel_id: parcel.id,
    reference: parcel.reference,              // Ref interne
    external_code: parcel.external_code,      // Lien avec le physique
    seal_code: parcel.seal_code,              // Vérification intégrité
    order_reference: order?.reference,
    customer_name: order?.full_name,
    customer_phone: order?.phone,
    items: items || [],                       // Produits détaillés
    value_kmf: order?.total_kmf,
    payment_status: order?.payment_status,
    destination_island: order?.destination_island,
    routing_mode: order?.routing_mode,
  };
}

// ─── [S2] Journal traçabilité (parcel_events) ─────────────────────────────

const EVENT_TYPES = [
  'created',           // Colis créé
  'sealed',            // Scellé appliqué
  'weight_recorded',   // Poids enregistré
  'status_changed',    // Changement de statut
  'scanned',           // Scanné (chaque étape)
  'weight_checked',    // Vérification poids (contrôle intégrité)
  'seal_verified',     // Scellé vérifié (ok ou broken)
  'anomaly_detected',  // Anomalie détectée
  'location_changed',  // Changement de lieu
  'collected',         // Remis au destinataire
  'photo_taken',       // Photo prise (preuve)
];

/**
 * Logger un événement colis dans parcel_events
 * @param {object} db - pool pg
 * @param {object} event - { parcel_id, event_type, actor_id, location, weight_kg, notes, metadata }
 */
async function logParcelEvent(db, event) {
  const {
    parcel_id, event_type, actor_id = null,
    location = null, weight_kg = null,
    notes = null, metadata = null,
  } = event;

  if (!parcel_id || !event_type) {
    log.warn({ parcel_id, event_type }, 'logParcelEvent requires parcel_id and event_type');
    return null;
  }

  try {
    const { rows } = await db.query(`
      INSERT INTO parcel_events (parcel_id, event_type, actor_id, location, weight_kg, notes, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at
    `, [parcel_id, event_type, actor_id, location, weight_kg, notes,
        metadata ? JSON.stringify(metadata) : null]);

    return rows[0];
  } catch (err) {
    // Non bloquant — la traçabilité ne doit pas casser le flow
    log.error({ err, parcel_id, event_type }, 'logParcelEvent error');
    return null;
  }
}

// ─── [S5] Détection anomalies ─────────────────────────────────────────────

/**
 * Vérifie l'intégrité du poids entre deux checkpoints
 * Tolérance : ±5% ou ±0.2kg (le plus grand des deux)
 * Retourne null si OK, sinon un objet anomalie
 */
function checkWeightIntegrity(previousWeight, currentWeight) {
  if (!previousWeight || !currentWeight) return null;

  const prev = parseFloat(previousWeight);
  const curr = parseFloat(currentWeight);
  if (isNaN(prev) || isNaN(curr)) return null;

  const tolerancePercent = prev * 0.05;
  const toleranceAbs = 0.2; // kg
  const tolerance = Math.max(tolerancePercent, toleranceAbs);
  const diff = Math.abs(curr - prev);

  if (diff > tolerance) {
    return {
      type: 'weight_discrepancy',
      severity: diff > tolerance * 2 ? 'critical' : 'warning',
      expected_kg: prev,
      actual_kg: curr,
      diff_kg: parseFloat(diff.toFixed(2)),
      message: `Écart poids: ${prev}kg → ${curr}kg (±${diff.toFixed(2)}kg)`,
    };
  }
  return null;
}

/**
 * Vérifie le code scellé
 */
function verifySeal(parcelSealCode, providedSealCode) {
  if (!parcelSealCode || !providedSealCode) {
    return { valid: false, reason: 'seal_missing' };
  }
  if (parcelSealCode.toUpperCase() !== providedSealCode.toUpperCase()) {
    return { valid: false, reason: 'seal_mismatch' };
  }
  return { valid: true };
}

// ─── DB Migration ─────────────────────────────────────────────────────────

// LOT R2 — DEBT-05 : le DDL (CREATE TABLE parcel_events + index, ALTER
// parcels ADD COLUMN, index unique external_code) vit désormais dans les
// migrations versionnées migrations/014d_parcel_events_foundation.sql et
// migrations/078_parcels_security_columns.sql (déjà correcte, laissée
// telle quelle — les deux sont idempotentes et redondantes sans risque).
// Cette fonction ne fait plus de DDL au boot : elle VÉRIFIE seulement
// (lecture catalogue) et échoue bruyamment (throw) si le contrat n'est pas
// là — non-fatal pour le process, attribuable via boot-guard.js, cf.
// tests/unit/bootstrap-server-lifecycle.test.js.
async function ensureSecurityTables(db) {
  const { rows } = await db.query(`
    SELECT
      to_regclass('public.parcel_events')       IS NOT NULL AS parcel_events,
      to_regclass('public.idx_parcels_external_code') IS NOT NULL AS idx_parcels_external_code,
      EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parcels' AND column_name = 'external_code') AS external_code,
      EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parcels' AND column_name = 'seal_code') AS seal_code,
      EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parcels' AND column_name = 'last_weight_kg') AS last_weight_kg,
      EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parcels' AND column_name = 'last_weight_at') AS last_weight_at,
      EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parcels' AND column_name = 'last_weight_location') AS last_weight_location
  `);
  const check = rows[0];
  const missing = Object.entries(check).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `[parcel-security] Schéma sécurité colis incomplet — objet(s) manquant(s) : ${missing.join(', ')}. ` +
      `Vérifier que migrations/014d_parcel_events_foundation.sql et 078_parcels_security_columns.sql ` +
      `ont bien tourné (node scripts/migrate.js) avant de servir du trafic colis.`
    );
  }

  log.info('Security tables verified (DDL owned by migrations/014d_parcel_events_foundation.sql + 078)');
}

/**
 * FIX 2026-07-09 : ce backfill tournait auparavant DANS ensureSecurityTables,
 * au boot du serveur public — une boucle SÉQUENTIELLE (1 SELECT + N UPDATE,
 * un aller-retour DB par colis orphelin). Sur une table `parcels` avec ne
 * serait-ce que quelques milliers de lignes sans external_code, ça dépasse
 * largement le timeout boot-guard (15s) et immobilise une connexion du pool
 * pendant toute la durée. Sorti du chemin de boot : à lancer manuellement
 * (scripts/backfill-parcel-external-codes.js), idéalement en heure creuse.
 */
async function backfillParcelExternalCodes(db) {
  try {
    const { rows: orphans } = await db.query(`
      SELECT id FROM parcels WHERE external_code IS NULL
    `);
    for (const p of orphans) {
      const code = generateExternalCode();
      await db.query('UPDATE parcels SET external_code = $1 WHERE id = $2', [code, p.id]);
    }
    if (orphans.length) {
      log.info({ count: orphans.length }, 'Backfilled parcels with external_code');
    }
  } catch (err) {
    log.error({ err }, 'Parcel external_code backfill error');
  }
}

module.exports = {
  generateExternalCode,
  generateSealCode,
  buildExternalLabel,
  buildInternalRecord,
  logParcelEvent,
  checkWeightIntegrity,
  verifySeal,
  ensureSecurityTables,
  backfillParcelExternalCodes,
  EVENT_TYPES,
};