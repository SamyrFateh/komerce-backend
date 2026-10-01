/**
 * @komerce-arch
 * @role          sourcing-source-registry
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        connector_registry, operator_source_requests, authenticated_operator
 * @outputs       source_connector_catalog, registered_source, connector_required_request, connection_test_result
 * @depends       db.js, services/sourcing-import-dispatch.js, services/sourcing-source-autopilot.js
 * @used-by       services/sourcing-workspace.js
 * @db-read       sourcing_sources, sourcing_source_requests
 * @db-write      sourcing_sources, sourcing_source_requests
 * @db-txn        none
 * @doctrine      operator_owned_source_registry, one_source_per_adapter, fail_closed_source_creation, connection_test_is_not_certification, connector_required_is_never_a_source
 * @impact-areas  sourcing, supplier-import, admin-dashboard
 * @version       2026-10
 */
'use strict';

const db = require('../db');
const importDispatch = require('./sourcing-import-dispatch');
const sourceAutopilot = require('./sourcing-source-autopilot');

class SourceRegistryError extends Error {
  constructor(status, message, code, details = null) {
    super(message);
    this.name = 'SourceRegistryError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const MAX_NAME_LENGTH = 80;
const MAX_REFERENCE_LENGTH = 300;

function squash(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function identityKey(value) {
  return squash(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}

function descriptorFor(adapter) {
  return importDispatch.sourceAutomationDescriptor(adapter);
}

function refFor(descriptor) {
  return sourceAutopilot.descriptorSourceRef(descriptor);
}

async function existingRefs(refs, q = db) {
  if (!refs.length) return new Set();
  const { rows } = await q.query(
    'SELECT source_id FROM sourcing_sources WHERE source_id = ANY($1::text[])',
    [refs]
  );
  return new Set(rows.map((row) => row.source_id));
}

// Catalogue canonique des connecteurs API pour l'assistant. Source unique : le registre
// backend. Aucun détail interne (module, classe, variable d'environnement, trace).
async function getCatalog(q = db) {
  const facts = importDispatch.sourceConnectorFacts();
  const refByAdapter = new Map();
  for (const fact of facts) {
    const descriptor = fact.automatable ? descriptorFor(fact.adapter) : null;
    if (descriptor) refByAdapter.set(fact.adapter, refFor(descriptor));
  }
  const present = await existingRefs([...refByAdapter.values()], q);
  return {
    connectors: facts.map((fact) => {
      const ref = refByAdapter.get(fact.adapter) || null;
      const existing = ref && present.has(ref) ? ref : null;
      return {
        adapter: fact.adapter,
        name: fact.name,
        label: fact.label,
        available: fact.available,
        automatable: fact.automatable,
        connection_mode: fact.connection_mode,
        connect_path: fact.connect_path,
        can_test_connection: fact.can_test_connection,
        can_create: fact.available && fact.automatable && !existing,
        reason: fact.reason,
        existing_source_ref: existing,
      };
    }),
  };
}

// Création canonique : une seule source par adapter, toujours fail-closed
// (autopilot OFF, aucune capacité, aucune certification, aucun import).
async function createSource({ adapter } = {}, q = db) {
  const key = squash(adapter).toLowerCase();
  if (!/^[a-z0-9_-]{2,64}$/.test(key)) {
    throw new SourceRegistryError(400, 'Connecteur de source invalide', 'sourcing_source_adapter_invalid');
  }
  const fact = importDispatch.sourceConnectorFacts().find((item) => item.adapter === key);
  if (!fact) {
    throw new SourceRegistryError(404, 'Ce connecteur n’existe pas dans Komerce', 'sourcing_source_connector_unknown');
  }
  const descriptor = fact.automatable ? descriptorFor(key) : null;
  if (!descriptor) {
    throw new SourceRegistryError(
      409,
      'Ce connecteur ne peut pas encore alimenter Komerce automatiquement',
      'sourcing_source_connector_not_automatable'
    );
  }
  if (!fact.available) {
    throw new SourceRegistryError(409, fact.reason || 'Connecteur non disponible', 'sourcing_source_connector_unavailable');
  }

  const sourceRef = refFor(descriptor);
  const { rows } = await q.query(
    `INSERT INTO sourcing_sources
       (source_id, adapter_type, acquisition, continuity, status,
        autopilot_enabled, discovery_enabled, sync_enabled, import_enabled, production_enabled)
     VALUES ($1, $2, 'pull', 'recurring', 'active', false, false, false, false, false)
     ON CONFLICT (source_id) DO NOTHING
     RETURNING source_id`,
    [sourceRef, descriptor.adapter]
  );
  if (!rows.length) {
    throw new SourceRegistryError(
      409,
      'Cette source existe déjà',
      'sourcing_source_already_exists',
      { existing_source_ref: sourceRef }
    );
  }
  return { source_ref: sourceRef, created: true };
}

function cleanReference(value) {
  const text = squash(value);
  if (!text) return null;
  if (text.length > MAX_REFERENCE_LENGTH) {
    throw new SourceRegistryError(400, 'Référence trop longue', 'sourcing_source_request_reference_invalid');
  }
  return text;
}

function requestRow(row) {
  return {
    request_ref: row.request_id,
    provider_name: row.provider_name,
    requested_label: row.requested_label,
    reference_url: row.reference_url || null,
    status: row.status,
    created_at: row.created_at,
  };
}

// « Autre fournisseur » : enregistre une demande, jamais une source. Aucun autopilot, aucune
// capacité, aucune capture, aucun test de connexion simulé.
async function createConnectorRequest(body = {}, actor = null, q = db) {
  const providerName = squash(body.provider_name);
  const requestedLabel = squash(body.requested_label) || providerName;
  if (providerName.length < 2 || providerName.length > MAX_NAME_LENGTH) {
    throw new SourceRegistryError(400, 'Nom du fournisseur requis (2 à 80 caractères)', 'sourcing_source_request_provider_invalid');
  }
  if (requestedLabel.length < 2 || requestedLabel.length > MAX_NAME_LENGTH) {
    throw new SourceRegistryError(400, 'Nom de la source invalide (2 à 80 caractères)', 'sourcing_source_request_label_invalid');
  }
  const referenceUrl = cleanReference(body.reference_url);

  const wanted = identityKey(providerName);
  const known = importDispatch.sourceConnectorFacts().find((fact) => (
    [fact.adapter, fact.name, fact.label].some((name) => identityKey(name) === wanted)
  ));
  if (known) {
    throw new SourceRegistryError(
      409,
      'Ce fournisseur dispose déjà d’un connecteur : ajoutez-le comme API fournisseur',
      'sourcing_source_request_connector_exists',
      { adapter: known.adapter }
    );
  }

  const { rows } = await q.query(
    `INSERT INTO sourcing_source_requests
       (provider_name, requested_label, reference_url, status, requested_by)
     VALUES ($1, $2, $3, 'connector_required', $4)
     ON CONFLICT (lower(btrim(provider_name))) DO NOTHING
     RETURNING request_id, provider_name, requested_label, reference_url, status, created_at`,
    [providerName, requestedLabel, referenceUrl, actor?.id ? String(actor.id) : null]
  );
  if (!rows.length) {
    throw new SourceRegistryError(
      409,
      'Ce fournisseur est déjà enregistré',
      'sourcing_source_request_already_exists'
    );
  }
  return requestRow(rows[0]);
}

async function listConnectorRequests(q = db) {
  const { rows } = await q.query(
    `SELECT request_id, provider_name, requested_label, reference_url, status, created_at
       FROM sourcing_source_requests
      ORDER BY created_at DESC, request_id`
  );
  return rows.map(requestRow);
}

// Test réel du connecteur pour une source existante. Mémorise le dernier résultat
// (statut + code métier), jamais un secret ni un message fournisseur brut.
// Un test de connexion n'est pas une certification : aucun KIR, aucune capacité modifiée.
async function testSourceConnection(sourceRef, q = db) {
  const source = await sourceAutopilot.requireSource(sourceRef, q);
  const descriptor = sourceAutopilot._automationBySourceRef(source.source_ref);
  if (!descriptor) {
    throw new SourceRegistryError(409, 'Source sans contrat d’autopull', 'sourcing_autopull_unavailable');
  }

  const result = await importDispatch.testConnection(source.adapter_type);
  const { rows } = await q.query(
    `UPDATE sourcing_sources
        SET connection_test_status = $2,
            connection_test_code = $3,
            connection_tested_at = NOW()
      WHERE source_id = $1
      RETURNING connection_tested_at`,
    [source.source_ref, result.ok ? 'ok' : 'failed', result.ok ? null : result.code]
  );
  return {
    source_ref: source.source_ref,
    ok: Boolean(result.ok),
    code: result.code,
    message: result.message,
    tested_at: rows[0]?.connection_tested_at || null,
  };
}

module.exports = {
  SourceRegistryError,
  getCatalog,
  createSource,
  createConnectorRequest,
  listConnectorRequests,
  testSourceConnection,
  _identityKey: identityKey,
};
