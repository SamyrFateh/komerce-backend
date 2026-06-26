/**
 * @komerce-arch
 * @role          logistics-parcel-security
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
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

async function ensureSecurityTables(db) {
  try {
    // Table parcel_events — journal traçabilité complet
    await db.query(`
      CREATE TABLE IF NOT EXISTS parcel_events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parcel_id   UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
        event_type  TEXT NOT NULL,
        actor_id    UUID REFERENCES users(id),
        location    TEXT,
        weight_kg   NUMERIC(6,2),
        notes       TEXT,
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Index pour requêtes fréquentes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_parcel_events_parcel_id ON parcel_events(parcel_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_parcel_events_type ON parcel_events(event_type);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_parcel_events_created ON parcel_events(created_at);
    `);

    // Colonnes sécurité sur parcels
    const cols = [
      { name: 'external_code', type: 'TEXT', unique: true },
      { name: 'seal_code', type: 'TEXT' },
      { name: 'last_weight_kg', type: 'NUMERIC(6,2)' },
      { name: 'last_weight_at', type: 'TIMESTAMPTZ' },
      { name: 'last_weight_location', type: 'TEXT' },
    ];

    // DDL de bootstrap uniquement — idempotent via IF NOT EXISTS (FRESH-020)
    // AUD-07: col.name and col.type come from the hardcoded cols array above — no user input
    const ALLOWED_COL_NAMES = cols.map(c => c.name); // derived from literal array, not user input
    for (const col of cols) {
      if (!ALLOWED_COL_NAMES.includes(col.name)) throw new Error(`Colonne non autorisée: ${col.name}`); // AUD-07 safety net
      await db.query(`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
      log.debug({ column: col.name }, 'parcels security column ensured');
    }

    // Unique index on external_code (ignore nulls)
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_parcels_external_code
      ON parcels(external_code) WHERE external_code IS NOT NULL
    `);

    // Backfill existing parcels without external_code
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

    log.info('Security tables ready');
  } catch (err) {
    log.error({ err }, 'Security migration error');
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
  EVENT_TYPES,
};