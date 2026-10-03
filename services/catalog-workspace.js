/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_central_actor, product_ref, category_key, catalog_action_payload
 * @outputs       catalog_work_queue, delegated_catalog_mutations
 * @depends       db, utils/rules.js, services/product-admin-service.js, services/catalog-approval.js, services/catalog-overrides.js, services/boutique-taxonomy-admin.js, services/catalog-commercial-assortment.js
 * @used-by       routes/admin-catalog-workspace.js
 * @db-read       products, sourcing_candidates, boutique_categories, boutique_subcategories, import_runtime_runs, markets, product_market_exposure, product_market_price_drafts
 * @db-write      none
 * @db-write-via  product-admin-service, catalog-approval, catalog-overrides, boutique-taxonomy-admin
 * @db-txn        delegated_to_domain_authority
 * @doctrine      workspace_acts_dashboard_observes, global_catalog_not_market_scoped, commercial_catalog_is_union_of_approved_products_from_closed_kirs, reuse_domain_mutation_authorities, product_ref_is_public_identity, no_paid_ai_api_for_fr_preparation
 * @impact-areas  admin-dashboard, catalog, boutique
 * @version       2026-10
 */

'use strict';

const db = require('../db');
const { getRuleNumber } = require('../utils/rules');
const productAdmin = require('./product-admin-service');
const catalogApproval = require('./catalog-approval');
const catalogOverrides = require('./catalog-overrides');
const taxonomy = require('./boutique-taxonomy-admin');
const commercialAssortment = require('./catalog-commercial-assortment');

const CATALOG_CAP_FALLBACK = 120;
const APPROVAL_CONTENT_SOURCES = Object.freeze(['connector_raw', 'ai_enriched', 'manual']);

class CatalogWorkspaceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CatalogWorkspaceError';
    this.code = code;
    this.status = status;
  }
}

function publicProduct(row) {
  return {
    product_ref: row.product_ref,
    name: row.name,
    description: row.description || null,
    name_source: row.name_source || null,
    description_source: row.description_source || null,
    category: row.category,
    subcategory: row.subcategory || null,
    price_kmf: row.price_kmf == null ? null : Number(row.price_kmf),
    price_aed: row.price_aed == null ? null : Number(row.price_aed),
    stock: row.stock == null ? null : Number(row.stock),
    image_url: row.image_url || null,
    badge: row.badge || null,
    emoji: row.emoji || null,
    promo_pct: row.promo_pct == null ? 0 : Number(row.promo_pct),
    is_active: Boolean(row.is_active),
    is_available: Boolean(row.is_available),
    lifecycle_status: row.lifecycle_status || null,
    content_source: row.content_source || null,
    needs_review: Boolean(row.needs_review),
    enrichment_confidence: row.enrichment_confidence == null ? null : Number(row.enrichment_confidence),
    updated_at: row.updated_at || null,
  };
}

async function querySummary() {
  const { rows: [row] } = await db.query(`
    SELECT
      COUNT(*)::int AS total_products,
      COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_products,
      COUNT(*) FILTER (WHERE is_active = FALSE AND lifecycle_status <> 'rejected')::int AS inactive_products,
      COUNT(*) FILTER (
        WHERE lifecycle_status = 'candidate'
          AND is_active = FALSE
          AND content_source IN ('connector_raw', 'ai_enriched', 'manual')
      )::int AS approval_pending,
      COUNT(*) FILTER (WHERE needs_review = TRUE)::int AS needs_review
    FROM products
  `);
  return {
    total_products: Number(row.total_products) || 0,
    active_products: Number(row.active_products) || 0,
    inactive_products: Number(row.inactive_products) || 0,
    approval_pending: Number(row.approval_pending) || 0,
    needs_review: Number(row.needs_review) || 0,
  };
}

async function queryCatalogCap() {
  const cap = await getRuleNumber('CATALOG_CAP_MVP', CATALOG_CAP_FALLBACK);
  return Number.isFinite(Number(cap)) && Number(cap) > 0 ? Number(cap) : CATALOG_CAP_FALLBACK;
}

function buildCurationState(summary, catalogCap) {
  const published = Number(summary && summary.active_products) || 0;
  const cap = Math.max(1, Number(catalogCap) || CATALOG_CAP_FALLBACK);
  return {
    catalog_cap_mvp: cap,
    published_products: published,
    remaining_slots: Math.max(0, cap - published),
    fill_pct: Math.min(100, Math.round((published / cap) * 100)),
    at_cap: published >= cap,
    first_publication_authority: 'human_approval',
    catalog_scope: 'global',
  };
}

async function queryProducts({ search = null, category = null, status = null, limit = 200 } = {}) {
  const conditions = [];
  const params = [];
  if (search) {
    params.push(`%${String(search).trim()}%`);
    conditions.push(`(p.name ILIKE $${params.length} OR p.product_ref ILIKE $${params.length})`);
  }
  if (category) {
    params.push(String(category));
    conditions.push(`p.category = $${params.length}`);
  }
  if (status === 'active') conditions.push('p.is_active = TRUE');
  if (status === 'inactive') conditions.push('p.is_active = FALSE');
  if (status === 'candidate') conditions.push("p.lifecycle_status = 'candidate'");
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);
  params.push(safeLimit);

  const { rows } = await db.query(`
    SELECT p.product_ref, p.name, p.description, p.category, p.subcategory,
           p.price_kmf, p.price_aed, p.stock, p.image_url, p.badge, p.emoji,
           p.promo_pct, p.is_active, p.is_available, p.lifecycle_status,
           p.content_source, p.needs_review, p.enrichment_confidence, p.updated_at
      FROM products p
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
     LIMIT $${params.length}
  `, params);
  return rows.map(publicProduct);
}

function sourcingDecisionOrderSql(alias = 'sc') {
  return `CASE UPPER(COALESCE(${alias}.scan_result->>'sourcing_decision','UNKNOWN'))
    WHEN 'PRIORITY' THEN 0
    WHEN 'TEST' THEN 1
    WHEN 'WATCH' THEN 2
    WHEN 'AVOID' THEN 3
    WHEN 'LOSS' THEN 4
    ELSE 5
  END`;
}

async function queryApprovalQueue({ limit = 50, offset = 0, productRef = null } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const focusedRef = String(productRef || '').trim() || null;
  const params = [];
  const sqlParam = index => String.fromCharCode(36) + index;
  let focusOrder = '';
  if (focusedRef) {
    params.push(focusedRef);
    focusOrder = 'CASE WHEN p.product_ref = ' + sqlParam(params.length) + ' THEN 0 ELSE 1 END ASC,';
  }
  params.push(safeLimit, safeOffset);
  const limitParam = sqlParam(params.length - 1);
  const offsetParam = sqlParam(params.length);
  const decisionOrder = sourcingDecisionOrderSql('sc');
  const { rows } = await db.query(`
    SELECT p.product_ref, p.name, p.description, p.name_source, p.description_source,
           p.category, p.fragility, p.emoji,
           p.price_kmf, p.stock, p.content_source, p.source_locale, p.needs_review,
           p.enrichment_confidence, p.created_at,
           sc.supplier_name,
           sc.supplier_product_id,
           sc.stock_available AS supplier_stock,
           sc.confidence AS sourcing_confidence,
           UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) AS sourcing_decision,
           COALESCE(sc.scan_result->>'reason','') AS sourcing_reason,
           NULLIF(sc.scan_result->>'economic_test_health_status','') AS economic_health_status,
           NULLIF(sc.scan_result->>'economic_test_margin_pct','')::numeric AS economic_test_margin_pct
      FROM products p
      LEFT JOIN LATERAL (
        SELECT candidate.supplier_name,
               candidate.supplier_product_id,
               candidate.stock_available,
               candidate.confidence,
               candidate.scan_result,
               candidate.updated_at,
               candidate.created_at
          FROM sourcing_candidates candidate
         WHERE candidate.product_id = p.id
           AND candidate.state = 'imported_to_catalog'
         ORDER BY candidate.updated_at DESC NULLS LAST, candidate.created_at DESC
         LIMIT 1
      ) sc ON TRUE
     WHERE p.lifecycle_status = 'candidate'
       AND p.is_active = FALSE
       AND p.content_source IN ('connector_raw', 'ai_enriched', 'manual')
     ORDER BY ${focusOrder}
              p.needs_review ASC,
              ${decisionOrder} ASC,
              CASE LOWER(COALESCE(sc.confidence,'low'))
                WHEN 'high' THEN 0
                WHEN 'medium' THEN 1
                ELSE 2
              END ASC,
              (COALESCE(sc.stock_available, p.stock, 0) > 0) DESC,
              p.enrichment_confidence DESC NULLS LAST,
              p.created_at ASC
     LIMIT ${limitParam} OFFSET ${offsetParam}
  `, params);
  return rows.map(row => ({
    product_ref: row.product_ref,
    name: row.name,
    description: row.description || null,
    name_source: row.name_source || null,
    description_source: row.description_source || null,
    category: row.category,
    fragility: row.fragility || null,
    emoji: row.emoji || null,
    price_kmf: row.price_kmf == null ? null : Number(row.price_kmf),
    stock: row.stock == null ? null : Number(row.stock),
    content_source: row.content_source,
    source_locale: row.source_locale || null,
    needs_review: Boolean(row.needs_review),
    enrichment_confidence: row.enrichment_confidence == null ? null : Number(row.enrichment_confidence),
    supplier_name: row.supplier_name || null,
    supplier_product_id: row.supplier_product_id || null,
    supplier_stock: row.supplier_stock == null ? null : Number(row.supplier_stock),
    sourcing_confidence: row.sourcing_confidence || 'low',
    sourcing_decision: row.sourcing_decision || 'UNKNOWN',
    sourcing_reason: row.sourcing_reason || null,
    economic_health_status: row.economic_health_status || null,
    economic_test_margin_pct: row.economic_test_margin_pct == null ? null : Number(row.economic_test_margin_pct),
    created_at: row.created_at,
  }));
}

async function queryApprovalBreakdown() {
  const { rows } = await db.query(`
    SELECT UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) AS sourcing_decision,
           COUNT(*)::int AS count
      FROM products p
      LEFT JOIN LATERAL (
        SELECT candidate.scan_result
          FROM sourcing_candidates candidate
         WHERE candidate.product_id = p.id
           AND candidate.state = 'imported_to_catalog'
         ORDER BY candidate.updated_at DESC NULLS LAST, candidate.created_at DESC
         LIMIT 1
      ) sc ON TRUE
     WHERE p.lifecycle_status = 'candidate'
       AND p.is_active = FALSE
       AND p.content_source IN ('connector_raw', 'ai_enriched', 'manual')
     GROUP BY 1
  `);
  const result = { PRIORITY: 0, TEST: 0, WATCH: 0, AVOID: 0, LOSS: 0, UNKNOWN: 0 };
  for (const row of rows) {
    const key = Object.prototype.hasOwnProperty.call(result, row.sourcing_decision)
      ? row.sourcing_decision
      : 'UNKNOWN';
    result[key] += Number(row.count) || 0;
  }
  return result;
}

async function queryFocusedMarketHandoff(productRef) {
  const ref = String(productRef || '').trim();
  if (!ref) return null;

  const { rows } = await db.query(`
    SELECT p.product_ref,
           p.name,
           p.lifecycle_status,
           p.is_active,
           p.is_available,
           m.code AS market_code,
           m.name AS market_name,
           m.currency AS market_currency,
           COALESCE(pme.commercial_exposure, 'DISABLED') AS commercial_exposure,
           (pme.product_id IS NOT NULL) AS exposure_decision_recorded,
           pmpd.status AS price_status,
           pmpd.amount AS local_price_amount,
           pmpd.currency AS local_price_currency
      FROM products p
      JOIN markets m ON m.is_active = TRUE
      LEFT JOIN product_market_exposure pme
        ON pme.product_id = p.id
       AND pme.market_id = m.id
      LEFT JOIN product_market_price_drafts pmpd
        ON pmpd.product_id = p.id
       AND pmpd.market_id = m.id
     WHERE p.product_ref = $1
       AND p.lifecycle_status = 'active'
       AND p.is_active = TRUE
     ORDER BY CASE WHEN m.code = 'KM' THEN 0 ELSE 1 END, m.code
  `, [ref]);

  if (!rows.length) return null;
  const first = rows[0];
  const markets = rows.map(row => ({
    code: row.market_code,
    name: row.market_name || row.market_code,
    currency: row.market_currency || null,
    commercial_exposure: row.commercial_exposure || 'DISABLED',
    exposure_decision_recorded: Boolean(row.exposure_decision_recorded),
    price_status: row.price_status || null,
    local_price_amount: row.local_price_amount == null ? null : Number(row.local_price_amount),
    local_price_currency: row.local_price_currency || null,
    buyer_visible: row.commercial_exposure === 'ENABLED' && row.price_status === 'LOCAL_ACTIVE',
  }));

  return {
    product_ref: first.product_ref,
    name: first.name,
    lifecycle_status: first.lifecycle_status,
    is_active: Boolean(first.is_active),
    is_available: Boolean(first.is_available),
    state: markets.some(row => !row.buyer_visible) ? 'MARKET_DECISION_PENDING' : 'BUYER_VISIBLE',
    markets,
  };
}

async function buildWorkspace(query = {}) {
  const approvalLimit = Math.min(Math.max(Number(query.approval_limit) || 50, 1), 100);
  const approvalOffset = Math.max(Number.parseInt(query.approval_offset, 10) || 0, 0);
  const approvalProductRef = String(query.product_ref || '').trim() || null;
  const [summary, catalogCap, categories, products, approval, approvalBreakdown, focusedHandoff] = await Promise.all([
    querySummary(),
    queryCatalogCap(),
    taxonomy.listCategories(),
    commercialAssortment.listCommercialAssortment({
      search: query.search,
      category: query.category,
      limit: query.limit || 200,
    }),
    queryApprovalQueue({ limit: approvalLimit, offset: approvalOffset, productRef: approvalProductRef }),
    queryApprovalBreakdown(),
    queryFocusedMarketHandoff(approvalProductRef),
  ]);
  const approvalTotal = Number(summary.approval_pending) || 0;
  const commercialSummary = {
    approved_products: products.length,
    closed_lots: [...new Set(products.flatMap(row => row.source_lots || []))].length,
    markets: [...new Set(products.flatMap(row => row.approved_markets || []))].length,
  };
  const commercialCurationSummary = { ...summary, active_products: commercialSummary.approved_products };
  return {
    scope: { mode: 'global_commercial_catalog', label: 'Catalogue global commercial' },
    summary: {
      ...summary,
      categories: categories.filter(row => row.is_active).length,
      commercial_approved: commercialSummary.approved_products,
      commercial_closed_lots: commercialSummary.closed_lots,
      commercial_markets: commercialSummary.markets,
    },
    commercial: commercialSummary,
    curation: buildCurationState(commercialCurationSummary, catalogCap),
    categories,
    products,
    approval,
    focused_handoff: focusedHandoff,
    approval_breakdown: approvalBreakdown,
    approval_strategy: {
      authority: 'human_approval',
      ordering: ['PRIORITY', 'TEST', 'WATCH', 'AVOID', 'LOSS', 'UNKNOWN'],
      value_density_used: false,
      note: 'Le signal sourcing priorise la revue ; il ne publie ni ne rejette automatiquement.',
    },
    approval_page: {
      total: approvalTotal,
      limit: approvalLimit,
      offset: approvalOffset,
      has_previous: approvalOffset > 0,
      has_next: approvalOffset + approval.length < approvalTotal,
    },
  };
}

async function resolveProduct(productRef, { candidateOnly = false } = {}) {
  const ref = String(productRef || '').trim();
  if (!ref) throw new CatalogWorkspaceError('product_ref_required', 'Référence produit requise', 400);
  const params = [ref];
  let extra = '';
  if (candidateOnly) extra = " AND lifecycle_status = 'candidate' AND is_active = FALSE";
  const { rows } = await db.query(
    `SELECT id, product_ref, lifecycle_status, is_active FROM products WHERE product_ref = $1${extra} LIMIT 1`,
    params
  );
  if (!rows.length) {
    throw new CatalogWorkspaceError(
      candidateOnly ? 'catalog_candidate_not_found' : 'product_not_found',
      candidateOnly ? 'Candidat introuvable ou déjà décidé' : 'Produit introuvable',
      404
    );
  }
  return rows[0];
}

function sanitizeProductCreate(body = {}) {
  const allowed = ['name','category','subcategory','price_kmf','price_aed','price_eur','stock','weight_kg','description','image_url','images','badge','emoji','promo_pct','is_available','is_active','has_couture','sourcing_source','requires_secure_transport','customs_risk_coeff','unsold_price_kmf','unsold_channel','has_variants','sort_order'];
  return allowed.reduce((out, key) => {
    if (body[key] !== undefined) out[key] = body[key];
    return out;
  }, {});
}

function sanitizeProductUpdate(body = {}) {
  return sanitizeProductCreate(body);
}

async function createProduct(body, actor) {
  const result = await productAdmin.createProduct(db, sanitizeProductCreate(body), actor);
  if (result.status >= 400) throw new CatalogWorkspaceError(result.body.code || 'product_create_rejected', result.body.error || 'Création produit refusée', result.status);
  return publicProduct(result.body);
}

async function updateProduct(productRef, body, actor) {
  const product = await resolveProduct(productRef);
  const result = await productAdmin.updateProduct(db, product.id, sanitizeProductUpdate(body), actor);
  if (result.status >= 400) throw new CatalogWorkspaceError(result.body.code || 'product_update_rejected', result.body.error || 'Modification produit refusée', result.status);
  return publicProduct(result.body);
}

async function deactivateProduct(productRef) {
  const product = await resolveProduct(productRef);
  const result = await productAdmin.deleteProduct(db, product.id);
  if (result.status >= 400) throw new CatalogWorkspaceError(result.body.code || 'product_deactivate_rejected', result.body.error || 'Désactivation produit refusée', result.status);
  return { product_ref: product.product_ref, deactivated: true };
}

async function prepareCandidateFrench(productRef, body = {}, actor) {
  const product = await resolveProduct(productRef, { candidateOnly: true });
  const name = String(body.name || body.name_fr || '').trim();
  const description = String(body.description || body.description_fr || '').trim();

  if (!name || !description) {
    throw new CatalogWorkspaceError(
      'catalog_fr_manual_fields_required',
      'Titre et description français requis — la préparation FR canonique n’appelle aucune API IA payante',
      422
    );
  }

  const result = await catalogOverrides.upsertOverrides(
    db,
    product.id,
    { name, description },
    {
      reason: body.reason || 'Préparation FR manuelle/assistée hors runtime — zéro API IA payante',
      setBy: actor?.id || null,
    }
  );

  if (!result.product || result.product.content_source !== 'manual' || result.product.needs_review === true) {
    throw new CatalogWorkspaceError(
      'catalog_fr_manual_preparation_incomplete',
      'Préparation française manuelle incomplète',
      422
    );
  }

  return {
    product_ref: product.product_ref,
    status: 'manual_ready',
    content_source: 'manual',
    needs_review: false,
    api_calls: 0,
    paid_ai_dependency: false,
    before: {
      name: result.product.name_source || null,
      description: result.product.description_source || null,
      locale: result.product.source_locale || null,
    },
    after: {
      name: result.product.name || null,
      description: result.product.description || null,
    },
    prepared_by: actor?.id || null,
  };
}

async function approveCandidate(productRef, actor) {
  const product = await resolveProduct(productRef, { candidateOnly: true });
  const result = await catalogApproval.approveProduct(db, product.id, actor);
  if (result.status >= 400) {
    const error = new CatalogWorkspaceError(
      result.body.code || 'catalog_approve_rejected',
      result.body.error || 'Approbation refusée',
      result.status
    );
    error.reasons = Array.isArray(result.body.reasons) ? result.body.reasons : [];
    error.certification_version = result.body.certification_version || null;
    throw error;
  }
  return publicProduct(result.body);
}

async function rejectCandidate(productRef, reason, actor) {
  const product = await resolveProduct(productRef, { candidateOnly: true });
  const result = await catalogApproval.rejectProduct(db, product.id, { reason }, actor);
  if (result.status >= 400) throw new CatalogWorkspaceError(result.body.code || 'catalog_reject_rejected', result.body.error || 'Rejet refusé', result.status);
  return { product_ref: product.product_ref, lifecycle_status: result.body.lifecycle_status, rejected: true };
}

async function overrideCandidate(productRef, body, actor) {
  const product = await resolveProduct(productRef, { candidateOnly: true });
  const result = await catalogApproval.overrideAndApprove(db, product.id, {
    fields: body && body.fields,
    reason: body && body.reason,
  }, actor);
  if (result.status >= 400) {
    const error = new CatalogWorkspaceError(
      result.body.code || 'catalog_override_rejected',
      result.body.error || 'Correction refusée',
      result.status
    );
    error.reasons = Array.isArray(result.body.reasons) ? result.body.reasons : [];
    error.certification_version = result.body.certification_version || null;
    throw error;
  }
  return { ...publicProduct(result.body), overridden: result.body.overridden || [] };
}

module.exports = {
  CatalogWorkspaceError,
  buildWorkspace,
  createProduct,
  updateProduct,
  deactivateProduct,
  prepareCandidateFrench,
  approveCandidate,
  rejectCandidate,
  overrideCandidate,
  createCategory: (body) => taxonomy.createCategory(body),
  updateCategory: (key, body) => taxonomy.updateCategory(key, body),
  deactivateCategory: (key) => taxonomy.deactivateCategory(key),
  createSubcategory: (key, body) => taxonomy.createSubcategory(key, body),
  updateSubcategory: (key, subKey, body) => taxonomy.updateSubcategory(key, subKey, body),
  deactivateSubcategory: (key, subKey) => taxonomy.deactivateSubcategory(key, subKey),
  _test: {
    publicProduct,
    queryProducts,
    queryApprovalQueue,
    queryApprovalBreakdown,
    sourcingDecisionOrderSql,
    queryCatalogCap,
    buildCurationState,
    resolveProduct,
    sanitizeProductCreate,
    sanitizeProductUpdate,
    APPROVAL_CONTENT_SOURCES,
  },
};