/**
 * @komerce-arch
 * @role          sourcing-catalog-change-observation
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        validated_catalog_change_envelope, registered_source_ref
 * @outputs       immutable_source_capture_and_exact_unit_stock_observation
 * @depends       db.js, node:crypto, services/catalog-change-intake.js, services/sourcing-observation-shadow-service.js
 * @used-by       routes/admin-sourcing-workspace.js
 * @db-read       sourcing_sources, sourcing_captures
 * @db-write      sourcing_source_provides, sourcing_captures, sourcing_observations
 * @db-txn        owned (advisory lock per registered source)
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const crypto = require('node:crypto');
const db = require('../db');
const { normalizeCatalogChangeEnvelope } = require('./catalog-change-intake');
const { buildSourceDescriptor } = require('./sourcing-observation-shadow-service');

class CatalogChangeObservationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'CatalogChangeObservationError';
    this.status = status;
    this.code = code;
  }
}

const reject = (status, code, message) => {
  throw new CatalogChangeObservationError(status, code, message);
};

// Deliberately narrow initial vertical slice: one exact supplier unit and one
// observed/unknown stock fact. Other fields must not be silently dropped.
function validateUnitStockChange(sourceRef, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    reject(400, 'catalog_change_invalid', 'Enveloppe de changement invalide');
  }
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 16384) {
    reject(413, 'catalog_change_too_large', 'Changement de catalogue trop volumineux');
  }
  let envelope;
  try {
    envelope = normalizeCatalogChangeEnvelope(input);
  } catch {
    reject(400, 'catalog_change_invalid', 'Contrat de changement de catalogue invalide');
  }
  if (!envelope.event_id || envelope.event_id.length > 180 ||
      envelope.source.account_scope.length > 128 ||
      envelope.source.source_ref.length > 180 ||
      !envelope.subject.product_ref || !envelope.subject.unit_ref ||
      envelope.subject.product_ref.length > 180 || envelope.subject.unit_ref.length > 180) {
    reject(422, 'catalog_change_exact_identity_required',
      'Identité produit, unité, compte et événement exacts obligatoires');
  }
  if (Object.keys(envelope.facts).length !== 1 || !envelope.facts.stock_available) {
    reject(422, 'catalog_change_stock_only',
      'Ce premier raccordement accepte exclusivement le stock exact d’une unité');
  }
  if (envelope.facts.stock_available.status === 'REMOVAL_CONFIRMED') {
    reject(422, 'catalog_change_invalid_stock_status', 'Le retrait d’offre n’est pas une observation de stock');
  }
  if (envelope.method === 'FILE' || envelope.method === 'MANUAL') {
    reject(422, 'catalog_change_api_source_only',
      'Ce raccordement exige une source API enregistrée');
  }
  const expectedSource = buildSourceDescriptor({
    sourceType: 'api', supplierName: envelope.source.provider,
    supplierId: envelope.source.provider,
    sourceInstanceKey: envelope.source.account_scope === 'default'
      ? null : envelope.source.account_scope,
  }).sourceId;
  if (sourceRef !== expectedSource) {
    reject(409, 'catalog_change_source_mismatch',
      'La source ne correspond pas au fournisseur et au périmètre de compte déclarés');
  }
  return envelope;
}

function fingerprint(envelope) {
  return crypto.createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
}

// Caller owns BEGIN/COMMIT and must not call this outside a transaction.
// No resolver, product/SKU mutation, provider API or publication here.
async function persistUnitStockChange(client, { sourceRef, envelope }) {
  const change = validateUnitStockChange(sourceRef, envelope);
  const digest = fingerprint(change);
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('komerce:catalog-change'),hashtext($1))",
    [sourceRef]
  );
  const { rows: [source] } = await client.query(
    'SELECT source_id, adapter_type, status FROM sourcing_sources WHERE source_id = $1 FOR SHARE',
    [sourceRef]
  );
  if (!source || source.adapter_type !== change.source.provider || source.status !== 'active') {
    reject(409, 'catalog_change_source_unavailable',
      'Source API absente, inactive ou fournisseur incohérent');
  }
  const { rows: [prior] } = await client.query(
    "SELECT capture_id, stats->>'fingerprint' AS fingerprint FROM sourcing_captures " +
    "WHERE source_id = $1 AND stats->>'change_kind' = 'UNIT_STOCK_DELTA' " +
    "AND stats->>'event_id' = $2 LIMIT 1",
    [sourceRef, change.event_id]
  );
  if (prior) {
    if (prior.fingerprint !== digest) {
      reject(409, 'catalog_change_event_collision',
        'Identifiant événement déjà reçu avec un contenu différent');
    }
    return { status: 'already_recorded', capture_id: prior.capture_id, observations: 1,
      application_status: 'NOT_EVALUATED' };
  }

  const captureId = crypto.randomUUID();
  const observationId = crypto.randomUUID();
  const fact = change.facts.stock_available;
  const provenance = {
    stock_available: {
      status: fact.status, provider: change.source.provider,
      account_scope: change.source.account_scope, method: change.method,
      event_id: change.event_id, observed_at: change.observed_at,
    },
  };
  const normalized = { observation_kind: 'CATALOG_CHANGE_DELTA',
    product_ref: change.subject.product_ref, unit_ref: change.subject.unit_ref };
  if (fact.status === 'OBSERVED') normalized.stock_available = fact.value;

  await client.query(
    "INSERT INTO sourcing_source_provides (source_id,layer) VALUES ($1,'units') " +
    'ON CONFLICT (source_id,layer) DO NOTHING',
    [sourceRef]
  );
  await client.query(
    "INSERT INTO sourcing_captures (capture_id,source_id,status,started_at,completed_at,stats,raw_artifact_ref) " +
    "VALUES ($1,$2,'complete',$3,$3,$4::jsonb,$5)",
    [captureId, sourceRef, change.observed_at, JSON.stringify({
      change_kind: 'UNIT_STOCK_DELTA', event_id: change.event_id,
      fingerprint: digest, observations: { product: 0, offer: 0, unit: 1, total: 1 },
      application_status: 'NOT_EVALUATED',
    }), change.raw_ref]
  );
  await client.query(
    "INSERT INTO sourcing_observations " +
    "(observation_id,capture_id,grain,source_ref,principal_ref,parent_observation_id,observed_at,normalized,field_provenance,raw_fragment) " +
    "VALUES ($1,$2,'unit',$3,NULL,NULL,$4,$5::jsonb,$6::jsonb,$7::jsonb)",
    [observationId, captureId, change.subject.unit_ref, change.observed_at,
      JSON.stringify(normalized), JSON.stringify(provenance),
      JSON.stringify({ source_ref: change.source.source_ref, product_ref: change.subject.product_ref,
        unit_ref: change.subject.unit_ref, fact })]
  );
  return { status: 'recorded', capture_id: captureId, observation_id: observationId,
    observations: 1, application_status: 'NOT_EVALUATED' };
}

async function recordUnitStockChange(input) {
  const sourceRef = input?.sourceRef;
  const envelope = validateUnitStockChange(sourceRef, input?.envelope);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await persistUnitStockChange(client, { sourceRef, envelope });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  CatalogChangeObservationError,
  validateUnitStockChange,
  persistUnitStockChange,
  recordUnitStockChange,
};
