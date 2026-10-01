/**
 * @komerce-arch
 * @role          canonical-sourcing-workspace-service
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        business_references, sourcing_action_payloads, authenticated_actor
 * @outputs       global_sourcing_projection, sourcing_mutation_result
 * @depends       db.js, services/sourcing-analysis.js, services/sourcing-mutations.js, services/sourcing-candidate-actions.js, services/sourcing-import-dispatch.js, services/sourcing-source-autopilot.js, services/sourcing-source-registry.js, services/sourcing-provider-control-policy.js, services/suppliers/catalog-import-orchestrator.js, services/partner-admin-service.js
 * @used-by       routes/admin-sourcing-workspace.js
 * @db-read       products, sourcing_candidates, supplier_catalog_imports, partners, suppliers_stats, sourcing_sources, sourcing_captures
 * @db-write-via:sourcing-mutations products
 * @db-write-via:sourcing-candidate-actions sourcing_candidates, sourcing_candidate_events, products, catalog_media, product_variants, product_skus, product_sku_media
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates
 * @db-write-via:sourcing-source-autopilot sourcing_sources, sourcing_captures
 * @db-write-via:sourcing-provider-control-policy sourcing_sources, sourcing_provider_control_events
 * @db-write-via:partner-admin-service partners
 * @db-txn        delegated_to_domain_authorities
 * @doctrine      global_sourcing_authority, browser_business_refs_only, sourcing_partners_only, source_autopilot_authority_delegated, workspace_orchestrates_not_reimplements
 * @impact-areas  sourcing, catalog, partners, admin-dashboard
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const sourcingAnalysis = require('./sourcing-analysis');
const sourcingMutations = require('./sourcing-mutations');
const candidateActions = require('./sourcing-candidate-actions');
const importDispatch = require('./sourcing-import-dispatch');
const credentialService = require('./provider-credential-service');
const sourceAutopilot = require('./sourcing-source-autopilot');
const sourceRegistry = require('./sourcing-source-registry');
const providerPolicy = require('./sourcing-provider-control-policy');
const catalogImport = require('./suppliers/catalog-import-orchestrator');
const partnerAdmin = require('./partner-admin-service');

class SourcingWorkspaceError extends Error {
  constructor(status, message, code = null, details = null) {
    super(message);
    this.name = 'SourcingWorkspaceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function stripInternalIds(value) {
  if (Array.isArray(value)) return value.map(stripInternalIds);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const lowerKey = String(key).toLowerCase();
    if (lowerKey === 'id' || lowerKey === 'ids' || lowerKey.endsWith('_id') || lowerKey.endsWith('_ids') || /Ids?$/.test(key)) continue;
    out[key] = stripInternalIds(child);
  }
  return out;
}

async function resolveProductRef(productRef, q = db) {
  const { rows: [row] } = await q.query(
    'SELECT id, product_ref FROM products WHERE product_ref = $1',
    [productRef]
  );
  if (!row) throw new SourcingWorkspaceError(404, 'Produit introuvable', 'product_not_found');
  return row;
}

async function resolveCandidateRef(candidateRef, q = db) {
  const { rows: [row] } = await q.query(
    'SELECT id, candidate_ref FROM sourcing_candidates WHERE candidate_ref = $1',
    [candidateRef]
  );
  if (!row) throw new SourcingWorkspaceError(404, 'Candidat introuvable', 'candidate_not_found');
  return row;
}

async function resolvePartnerRef(partnerRef, q = db) {
  const { rows: [row] } = await q.query(
    `SELECT id, partner_ref
       FROM partners
      WHERE partner_ref = $1
        AND partner_type = 'sourcing'`,
    [partnerRef]
  );
  if (!row) throw new SourcingWorkspaceError(404, 'Fournisseur sourcing introuvable', 'sourcing_partner_not_found');
  return row;
}

async function listPortfolio() {
  const [synthesis, analysis] = await Promise.all([
    sourcingAnalysis.getSynthesis(),
    sourcingAnalysis.getAnalysis(),
  ]);
  const products = Array.isArray(analysis?.products) ? analysis.products : [];
  const ids = products.map(p => p.id).filter(Boolean);
  const refById = new Map();
  if (ids.length) {
    const { rows } = await db.query(
      'SELECT id, product_ref FROM products WHERE id = ANY($1::uuid[])',
      [ids]
    );
    rows.forEach(row => refById.set(String(row.id), row.product_ref));
  }

  return {
    synthesis: stripInternalIds(synthesis || {}),
    products: products.map(product => ({
      ...stripInternalIds(product),
      product_ref: refById.get(String(product.id)) || product.product_ref || null,
    })),
  };
}

async function listImports() {
  const { rows } = await db.query(
    `SELECT i.import_ref,
            i.supplier_name,
            i.source_type,
            i.source_filename,
            i.notes,
            i.total_items,
            i.status,
            i.ready_count,
            i.quarantined_count,
            i.rejected_count,
            i.imported_at,
            i.finished_at,
            COUNT(sc.id)::int AS candidates_count,
            COUNT(sc.id) FILTER (WHERE sc.state = 'imported_to_catalog')::int AS imported_count
       FROM supplier_catalog_imports i
       LEFT JOIN sourcing_candidates sc ON sc.import_id = i.id
      GROUP BY i.id
      ORDER BY i.imported_at DESC
      LIMIT 100`
  );
  return rows;
}

async function listCandidates() {
  const { rows } = await db.query(
    `SELECT sc.candidate_ref,
            si.import_ref,
            p.product_ref,
            sc.supplier_name,
            sc.supplier_product_id,
            sc.product_name,
            sc.supplier_category,
            sc.purchase_price,
            sc.currency,
            sc.image_url,
            sc.product_url,
            sc.description,
            sc.stock_available,
            sc.min_order_qty,
            sc.supplier_delay_days,
            sc.weight_kg,
            sc.komerce_category,
            sc.estimated_weight_kg,
            sc.estimated_volume_m3,
            sc.purchase_price_kmf,
            sc.target_margin_pct,
            sc.scan_result,
            sc.scan_at,
            sc.confidence,
            sc.state,
            sc.promotion_status,
            sc.promotion_reasons,
            sc.findings,
            sc.notes,
            sc.rejected_reason,
            sc.created_at,
            sc.updated_at
       FROM sourcing_candidates sc
       LEFT JOIN supplier_catalog_imports si ON si.id = sc.import_id
       LEFT JOIN products p ON p.id = sc.product_id
      ORDER BY sc.updated_at DESC
      LIMIT 250`
  );
  return rows;
}

function sanitizePartner(row) {
  if (!row) return row;
  const { id, partner_type, ...rest } = row;
  return { ...rest, partner_type: 'sourcing' };
}

async function listSourcingSuppliers() {
  const [partners, stats] = await Promise.all([
    partnerAdmin.listPartners({ type: 'sourcing' }),
    partnerAdmin.getStats(),
  ]);
  const refById = new Map(partners.map(row => [String(row.id), row.partner_ref]));
  const statsByRef = new Map();
  for (const stat of stats) {
    const partnerRef = refById.get(String(stat.partner_id));
    if (partnerRef) statsByRef.set(partnerRef, stripInternalIds(stat));
  }
  return partners.map(row => ({
    ...sanitizePartner(row),
    stats: statsByRef.get(row.partner_ref) || null,
  }));
}

function buildSummary({ portfolio, candidates, imports, suppliers, sources }) {
  const states = {};
  candidates.forEach(candidate => { states[candidate.state] = (states[candidate.state] || 0) + 1; });
  return {
    portfolio_products: portfolio.products.length,
    candidates_total: candidates.length,
    candidates_scanned: states.scanned || 0,
    candidates_watchlist: states.watchlist || 0,
    candidates_rejected: states.rejected || 0,
    candidates_promoted: states.imported_to_catalog || 0,
    imports: imports.length,
    sourcing_suppliers: suppliers.length,
    sourcing_sources: sources.length,
    sourcing_sources_autopilot_on: sources.filter(source => source.autopilot_enabled).length,
  };
}

async function buildWorkspace() {
  const [portfolio, imports, candidates, suppliers, sources] = await Promise.all([
    listPortfolio(),
    listImports(),
    listCandidates(),
    listSourcingSuppliers(),
    sourceAutopilot.listSources(),
  ]);
  return {
    scope: { mode: 'global_sourcing' },
    summary: buildSummary({ portfolio, candidates, imports, suppliers, sources }),
    portfolio,
    imports,
    candidates,
    suppliers,
    sources,
    connectors: importDispatch.connectorCatalog(),
  };
}

function projectSourceControl(source) {
  const capabilities = {
    discovery: Boolean(source.discovery_enabled),
    sync: Boolean(source.sync_enabled),
    import: Boolean(source.import_enabled),
    production: Boolean(source.production_enabled),
  };
  const hardBlockers = [];
  if (!source.runtime_enabled) hardBlockers.push('Runtime autopilot désactivé');
  if (source.status !== 'active') hardBlockers.push('Source inactive');
  if (!source.connector_ready) hardBlockers.push(source.connector_reason || 'Connecteur non prêt');
  if (!source.discovery_ready) hardBlockers.push('Discovery non prête');
  // Fail-closed : l'état crédentiel est décidé par le backend (coffre / session / repli serveur).
  const credentialStatus = source.credential_status || 'missing';
  if (credentialStatus === 'missing') hardBlockers.push('Identifiants à configurer');
  if (credentialStatus === 'invalid') hardBlockers.push('Identifiants refusés ou expirés');

  const preparationRequired = [];
  if (credentialStatus === 'untested') preparationRequired.push('Test de connexion');
  if (!capabilities.discovery) preparationRequired.push('Discovery');
  if (!capabilities.sync) preparationRequired.push('Sync');
  if (!capabilities.import) preparationRequired.push('Import');
  if (!source.production_runtime_certified) preparationRequired.push('Certification runtime');
  if (!capabilities.production) preparationRequired.push('Production');

  const autopilotReady = hardBlockers.length === 0 && preparationRequired.length === 0;
  // Un import réellement certifié prouve aussi la connexion : une source déjà certifiée n'est
  // jamais « à tester ». Le test de connexion reste informatif et distinct de la certification.
  const connectionVerified = source.connection_test_status === 'ok' || Boolean(source.production_runtime_certified);
  const captureFailed = /fail|error/i.test(String(source.last_capture_status || ''));
  const enabled = Boolean(source.autopilot_enabled);
  let state;
  if (source.status !== 'active') state = 'archived';
  else if (enabled && autopilotReady) state = 'active';
  else if (!source.connector_ready || credentialStatus === 'missing') state = 'to_configure';
  else if (hardBlockers.length > 0 || enabled) state = 'blocked';
  else if (captureFailed) state = 'error';
  else if (!connectionVerified) state = 'connection_to_test';
  else if (preparationRequired.length > 0) state = 'to_certify';
  else state = 'ready';

  return {
    source_ref: source.source_ref,
    label: source.label || source.adapter_type || source.source_ref,
    supplier_name: source.supplier_name || null,
    autopilot_enabled: Boolean(source.autopilot_enabled),
    autopilot_ready: autopilotReady,
    activation_ready: hardBlockers.length === 0,
    blocker: hardBlockers[0] || (autopilotReady ? null : 'Préparation automatique requise'),
    hard_blockers: hardBlockers,
    preparation_required: preparationRequired,
    runtime_enabled: Boolean(source.runtime_enabled),
    connector_ready: Boolean(source.connector_ready),
    production_runtime_certified: Boolean(source.production_runtime_certified),
    state,
    archived: source.status !== 'active',
    connector_label: source.connector_label || null,
    connection: {
      connector_ready: Boolean(source.connector_ready),
      verified: connectionVerified,
      test_status: source.connection_test_status || null,
      test_code: source.connection_test_code || null,
      tested_at: source.connection_tested_at || null,
    },
    credential_status: credentialStatus,
    credential_in_vault: Boolean(source.credential_in_vault),
    auth: source.auth || { mode: 'none', scope: null, fields: [] },
    capabilities,
    last_capture_status: source.last_capture_status || null,
    last_capture_at: source.last_capture_at || null,
  };
}

async function listSourceControls() {
  const sources = await sourceAutopilot.listSources();
  return sources.map(projectSourceControl);
}

async function updatePortfolioProduct(productRef, body, actor) {
  const product = await resolveProductRef(productRef);
  const result = await sourcingMutations.updateProduct(product.id, body || {});
  if (result.status >= 400) {
    throw new SourcingWorkspaceError(result.status, result.body?.error || 'Mutation sourcing refusée', 'sourcing_product_update_failed');
  }
  return {
    success: true,
    product: {
      ...stripInternalIds(result.body?.product || {}),
      product_ref: productRef,
    },
    actor: actor?.id ? { role: actor.role } : null,
  };
}

async function importCatalog(body, actor) {
  let result = await catalogImport.importCatalog(body || {}, actor?.id || null, importDispatch.dispatchToConnector);
  if (result.status < 400) result = await candidateActions.handoffImportResult(result, actor?.id || null);
  if (result.status >= 400) {
    throw new SourcingWorkspaceError(result.status, result.body?.error || 'Import refusé', 'sourcing_import_failed', stripInternalIds(result.body || {}));
  }
  let importRef = null;
  if (result.body?.import_id) {
    const { rows: [row] } = await db.query('SELECT import_ref FROM supplier_catalog_imports WHERE id = $1', [result.body.import_id]);
    importRef = row?.import_ref || null;
  }
  return {
    ...stripInternalIds(result.body || {}),
    import_ref: importRef,
  };
}

async function replayImport(body, actor) {
  return importCatalog({ ...(body || {}), mode: 'replay' }, actor);
}

async function updateCandidate(candidateRef, body, actor) {
  const candidate = await resolveCandidateRef(candidateRef);
  const row = await candidateActions.updateCandidate(candidate.id, body || {}, actor?.id || null);
  return { ...stripInternalIds(row), candidate_ref: candidateRef };
}

async function scanCandidate(candidateRef, actor) {
  const candidate = await resolveCandidateRef(candidateRef);
  const row = await candidateActions.scanCandidate(candidate.id, actor?.id || null);
  return { ...stripInternalIds(row), candidate_ref: candidateRef };
}

async function watchlistCandidate(candidateRef, actor) {
  const candidate = await resolveCandidateRef(candidateRef);
  return candidateActions.watchlistCandidate(candidate.id, actor?.id || null);
}

async function rejectCandidate(candidateRef, reason, actor) {
  const candidate = await resolveCandidateRef(candidateRef);
  return candidateActions.rejectCandidate(candidate.id, reason, actor?.id || null);
}

async function promoteCandidate(candidateRef, body, actor) {
  const candidate = await resolveCandidateRef(candidateRef);
  const result = await candidateActions.promoteCandidate(candidate.id, body || {}, actor?.id || null);
  let productRef = null;
  if (result.product_id) {
    const { rows: [product] } = await db.query('SELECT product_ref FROM products WHERE id = $1', [result.product_id]);
    productRef = product?.product_ref || null;
  }
  return {
    ...stripInternalIds(result),
    candidate_ref: candidateRef,
    product_ref: productRef,
  };
}

async function runSourceImportNow(sourceRef, actor) {
  return sourceAutopilot.runSourceImportNow(sourceRef, {
    actorId: actor?.id || null,
    reason: 'operator_import_live',
  });
}

// Préparation = tout ce qui précède l'interrupteur : capacités autorisées, premier passage
// borné réel, certification runtime, Production. Elle n'active JAMAIS l'autopilot.
async function prepareSource(sourceRef, actor, { requireConnectionTest = false } = {}) {
  const sources = await sourceAutopilot.listSources();
  const source = sources.find(row => row.source_ref === sourceRef);
  if (!source) throw new SourcingWorkspaceError(404, 'Source sourcing introuvable', 'sourcing_source_not_found');

  const projected = projectSourceControl(source);
  if (!projected.activation_ready) {
    throw new SourcingWorkspaceError(
      409,
      projected.hard_blockers[0] || 'Source non activable',
      'sourcing_source_activation_blocked',
      { blockers: projected.hard_blockers }
    );
  }
  if (requireConnectionTest && !projected.connection.verified) {
    throw new SourcingWorkspaceError(
      409,
      'Testez la connexion avant de préparer la source',
      'sourcing_source_connection_untested'
    );
  }

  const reason = 'cockpit_autopilot_activation';
  const enabledDuringPreparation = [];
  for (const capability of ['discovery', 'sync', 'import']) {
    if (projected.capabilities[capability]) continue;
    await providerPolicy.setCapability(sourceRef, capability, true, actor, reason);
    enabledDuringPreparation.push(capability);
  }

  let current = await sourceAutopilot.requireSource(sourceRef);
  let certificationRun = null;
  if (!providerPolicy.hasRuntimeCertification(current)) {
    certificationRun = await sourceAutopilot.runSourceImportNow(sourceRef, {
      actorId: actor?.id || null,
      reason: 'autopilot_activation_certification',
    });
    if (certificationRun.status !== 'certified') {
      throw new SourcingWorkspaceError(
        409,
        'Le premier import n’a pas produit une certification runtime exploitable',
        'sourcing_source_certification_incomplete',
        certificationRun
      );
    }
    current = await sourceAutopilot.requireSource(sourceRef);
  }

  if (!current.production_enabled) {
    await providerPolicy.setCapability(sourceRef, 'production', true, actor, reason);
    enabledDuringPreparation.push('production');
  }

  return {
    source_ref: sourceRef,
    prepared: enabledDuringPreparation.length > 0 || certificationRun != null,
    enabled_capabilities: enabledDuringPreparation,
    certification_run: certificationRun,
  };
}

async function prepareSourceForCertification(sourceRef, actor) {
  const prepared = await prepareSource(sourceRef, actor, { requireConnectionTest: true });
  return { ...prepared, autopilot_enabled: false };
}

async function activateSourceAutopilot(sourceRef, actor) {
  const prepared = await prepareSource(sourceRef, actor);
  const state = await sourceAutopilot.setSourceActive(sourceRef, true, {
    runNow: prepared.certification_run == null,
  });

  return {
    ...state,
    prepared: prepared.prepared,
    enabled_capabilities: prepared.enabled_capabilities,
    certification_run: prepared.certification_run,
  };
}

async function sourceControlFor(sourceRef) {
  const controls = await listSourceControls();
  return controls.find(row => row.source_ref === sourceRef) || null;
}

function registryError(err) {
  if (err instanceof sourceRegistry.SourceRegistryError || err instanceof credentialService.ProviderCredentialError) {
    return new SourcingWorkspaceError(err.status, err.message, err.code, err.details);
  }
  return err;
}

async function getSourceCatalog() {
  return sourceRegistry.getCatalog();
}

async function createSource(body, actor) {
  try {
    const created = await sourceRegistry.createSource(body || {});
    return { ...created, source: await sourceControlFor(created.source_ref), actor: actor?.id ? { role: actor.role } : null };
  } catch (err) { throw registryError(err); }
}

async function createSourceRequest(body, actor) {
  try { return await sourceRegistry.createConnectorRequest(body || {}, actor); }
  catch (err) { throw registryError(err); }
}

async function archiveSource(sourceRef, actor) {
  try {
    const result = await sourceRegistry.archiveSource(sourceRef, actor);
    return { ...result, source: await sourceControlFor(sourceRef) };
  } catch (err) { throw registryError(err); }
}

async function restoreSource(sourceRef, actor) {
  try {
    const result = await sourceRegistry.restoreSource(sourceRef, actor);
    return { ...result, source: await sourceControlFor(sourceRef) };
  } catch (err) { throw registryError(err); }
}

async function updateSource(sourceRef, body) {
  try {
    const result = await sourceRegistry.updateSource(sourceRef, body || {});
    return { ...result, source: await sourceControlFor(sourceRef) };
  } catch (err) { throw registryError(err); }
}

async function updateSourceRequest(requestRef, body) {
  try { return await sourceRegistry.updateConnectorRequest(requestRef, body || {}); }
  catch (err) { throw registryError(err); }
}

async function deleteSourceRequest(requestRef) {
  try { return await sourceRegistry.deleteConnectorRequest(requestRef); }
  catch (err) { throw registryError(err); }
}

async function listSourceRequests() {
  return sourceRegistry.listConnectorRequests();
}

async function testSourceConnection(sourceRef) {
  try {
    const result = await sourceRegistry.testSourceConnection(sourceRef);
    return { ...result, source: await sourceControlFor(sourceRef) };
  } catch (err) { throw registryError(err); }
}

// Identifiants fournisseur : le navigateur envoie un secret, il ne le relit jamais. Toutes les
// réponses ne portent que l'état (credential_status, dates, expiration) et la carte source.
async function credentialStatus(sourceRef) {
  try { return await credentialService.status(sourceRef); } catch (err) { throw registryError(err); }
}

async function configureCredentials(sourceRef, credentials, actor) {
  try {
    const result = await credentialService.configure(sourceRef, credentials, actor);
    return { ...result, source: await sourceControlFor(sourceRef) };
  } catch (err) { throw registryError(err); }
}

async function rotateCredentials(sourceRef, credentials, actor) {
  try {
    const result = await credentialService.rotate(sourceRef, credentials, actor);
    return { ...result, status: await credentialService.status(sourceRef), source: await sourceControlFor(sourceRef) };
  } catch (err) { throw registryError(err); }
}

async function revokeCredentials(sourceRef, actor) {
  try {
    const result = await credentialService.revoke(sourceRef, actor);
    return { ...result, source: await sourceControlFor(sourceRef) };
  } catch (err) { throw registryError(err); }
}

async function setSourceAutopilot(sourceRef, enabled) {
  return sourceAutopilot.setSourceActive(sourceRef, Boolean(enabled), { runNow: Boolean(enabled) });
}

async function createSupplier(body) {
  if (!body?.name) throw new SourcingWorkspaceError(400, 'name obligatoire', 'sourcing_partner_name_required');
  if (body.partner_type && body.partner_type !== 'sourcing') {
    throw new SourcingWorkspaceError(400, 'Le Workspace Sourcing ne gère que les fournisseurs sourcing', 'sourcing_partner_type_forbidden');
  }
  return sanitizePartner(await partnerAdmin.createPartner({ ...body, partner_type: 'sourcing' }));
}

async function updateSupplier(partnerRef, body) {
  if (body?.partner_type && body.partner_type !== 'sourcing') {
    throw new SourcingWorkspaceError(400, 'Le type partenaire ne peut pas sortir de sourcing', 'sourcing_partner_type_forbidden');
  }
  const partner = await resolvePartnerRef(partnerRef);
  return sanitizePartner(await partnerAdmin.updatePartner(partner.id, { ...body, partner_type: 'sourcing' }));
}

async function setSupplierActive(partnerRef, isActive) {
  const partner = await resolvePartnerRef(partnerRef);
  return sanitizePartner(await partnerAdmin.updatePartner(partner.id, { is_active: Boolean(isActive), partner_type: 'sourcing' }));
}

module.exports = {
  credentialStatus,
  configureCredentials,
  rotateCredentials,
  revokeCredentials,
  SourcingWorkspaceError,
  stripInternalIds,
  resolveProductRef,
  resolveCandidateRef,
  resolvePartnerRef,
  buildWorkspace,
  projectSourceControl,
  listSourceControls,
  updatePortfolioProduct,
  importCatalog,
  replayImport,
  updateCandidate,
  scanCandidate,
  watchlistCandidate,
  rejectCandidate,
  promoteCandidate,
  runSourceImportNow,
  prepareSourceForCertification,
  activateSourceAutopilot,
  setSourceAutopilot,
  getSourceCatalog,
  createSource,
  createSourceRequest,
  archiveSource,
  restoreSource,
  updateSource,
  updateSourceRequest,
  deleteSourceRequest,
  listSourceRequests,
  testSourceConnection,
  createSupplier,
  updateSupplier,
  setSupplierActive,
};
