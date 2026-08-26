/**
 * @komerce-arch
 * @role          canonical-sourcing-workspace-service
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        business_references, sourcing_action_payloads, authenticated_actor
 * @outputs       global_sourcing_projection, sourcing_mutation_result
 * @depends       db.js, services/sourcing-analysis.js, services/sourcing-mutations.js, services/sourcing-candidate-actions.js, services/sourcing-import-dispatch.js, services/suppliers/catalog-import-orchestrator.js, services/partner-admin-service.js
 * @used-by       routes/admin-sourcing-workspace.js
 * @db-read       products, sourcing_candidates, supplier_catalog_imports, partners, suppliers_stats
 * @db-write-via:sourcing-mutations products
 * @db-write-via:sourcing-candidate-actions sourcing_candidates, sourcing_candidate_events, products, catalog_media, product_variants, product_skus, product_sku_media
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates
 * @db-write-via:partner-admin-service partners
 * @db-txn        delegated_to_domain_authorities
 * @doctrine      global_sourcing_authority, browser_business_refs_only, sourcing_partners_only, workspace_orchestrates_not_reimplements
 * @impact-areas  sourcing, catalog, partners, admin-dashboard
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const sourcingAnalysis = require('./sourcing-analysis');
const sourcingMutations = require('./sourcing-mutations');
const candidateActions = require('./sourcing-candidate-actions');
const importDispatch = require('./sourcing-import-dispatch');
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
    if (key === 'id' || key.endsWith('_id')) continue;
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

function buildSummary({ portfolio, candidates, imports, suppliers }) {
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
  };
}

async function buildWorkspace() {
  const [portfolio, imports, candidates, suppliers] = await Promise.all([
    listPortfolio(),
    listImports(),
    listCandidates(),
    listSourcingSuppliers(),
  ]);
  return {
    scope: { mode: 'global_sourcing' },
    summary: buildSummary({ portfolio, candidates, imports, suppliers }),
    portfolio,
    imports,
    candidates,
    suppliers,
    connectors: importDispatch.connectorCatalog(),
  };
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
  const result = await catalogImport.importCatalog(body || {}, actor?.id || null, importDispatch.dispatchToConnector);
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
  SourcingWorkspaceError,
  stripInternalIds,
  resolveProductRef,
  resolveCandidateRef,
  resolvePartnerRef,
  buildWorkspace,
  updatePortfolioProduct,
  importCatalog,
  updateCandidate,
  scanCandidate,
  watchlistCandidate,
  rejectCandidate,
  promoteCandidate,
  createSupplier,
  updateSupplier,
  setSupplierActive,
};
