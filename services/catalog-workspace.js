/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_central_actor, product_ref, category_key, catalog_action_payload
 * @outputs       catalog_work_queue, delegated_catalog_mutations
 * @depends       db, utils/rules.js, services/product-admin-service.js, services/catalog-approval.js, services/catalog-overrides.js, services/boutique-taxonomy-admin.js, services/catalog-commercial-assortment.js, services/pricing-parameters-status.js
 * @used-by       routes/admin-catalog-workspace.js
 * @db-read       products, sourcing_candidates, boutique_categories, boutique_subcategories, import_runtime_runs, markets, product_market_exposure, product_market_price_drafts, catalog_media, product_skus, product_variants, finance_config, currency_parities, exchange_rates, cost_components
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
const { certifyCatalogProduct } = require('./catalog-certification');
const catalogOverrides = require('./catalog-overrides');
const taxonomy = require('./boutique-taxonomy-admin');
const commercialAssortment = require('./catalog-commercial-assortment');
const catalogRegistry = require('./catalog-registry');
const catalogUnifiedRegistry = require('./catalog-unified-registry');
const catalogMediaRecovery = require('./catalog-media-recovery');
const refineryWorklist = require('./refinery-worklist');
const catalogProductMutation = require('./catalog-product-mutation-service');
const { getPricingParameterStatus } = require('./pricing-parameters-status');

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

// C4 — un repli technique vers « autre » n'est pas une classification validée.
// Sans migration : le verdict se déduit de la catégorie portée par le candidat
// sourcing (absente = repli de createDraftProductFromSourcingCandidate).
function classificationStatus(row = {}) {
  const supplierCategory = row.supplier_category || null;
  if (row.has_candidate === false) return { status: 'not_from_sourcing', supplier_category: supplierCategory };
  const candidateCategory = String(row.candidate_komerce_category || '').trim();
  const category = String(row.category || '').trim().toLowerCase();
  if (!candidateCategory && category === 'autre') {
    return { status: 'fallback_unresolved', supplier_category: supplierCategory };
  }
  return { status: 'classified', supplier_category: supplierCategory };
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
    SELECT p.id AS product_id, p.product_ref, p.name, p.description, p.name_source, p.description_source,
           p.category, p.fragility, p.emoji,
           p.price_kmf, p.cost_kmf, p.stock, p.content_source, p.source_locale, p.needs_review,
           p.enrichment_confidence, p.created_at,
           sc.supplier_name,
           sc.supplier_product_id,
           sc.candidate_id,
           sc.candidate_komerce_category,
           sc.supplier_category,
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
               candidate.created_at,
               candidate.id AS candidate_id,
               candidate.komerce_category AS candidate_komerce_category,
               candidate.supplier_category AS supplier_category
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
    product_id: row.product_id,
    product_ref: row.product_ref,
    name: row.name,
    description: row.description || null,
    name_source: row.name_source || null,
    description_source: row.description_source || null,
    category: row.category,
    fragility: row.fragility || null,
    classification: classificationStatus({ ...row, has_candidate: Boolean(row.candidate_id) }),
    emoji: row.emoji || null,
    price_kmf: row.price_kmf == null ? null : Number(row.price_kmf),
    cost_kmf: row.cost_kmf == null ? null : Number(row.cost_kmf),
    stock: row.stock == null ? null : Number(row.stock),
    content_source: row.content_source,
    source_locale: row.source_locale || null,
    needs_review: Boolean(row.needs_review),
    enrichment_confidence: row.enrichment_confidence == null ? null : Number(row.enrichment_confidence),
    supplier_name: row.supplier_name || null,
    supplier_product_id: row.supplier_product_id || null,
    supplier_source_linked: Boolean(row.candidate_id),
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
  const isRefinery = query.refinery_view === '1';
  const approvalLimit = Math.min(Math.max(Number(query.approval_limit) || 50, 1), 100);
  const approvalOffset = Math.max(Number.parseInt(query.approval_offset, 10) || 0, 0);
  const approvalProductRef = String(query.product_ref || '').trim() || null;
  const [summary, catalogCap, categories, registry, commercialProducts, approval, approvalBreakdown, focusedHandoff, pricingParameters] = await Promise.all([
    querySummary(),
    isRefinery ? Promise.resolve(CATALOG_CAP_FALLBACK) : queryCatalogCap(),
    isRefinery ? Promise.resolve([]) : taxonomy.listCategories(),
    isRefinery ? Promise.resolve({ products: [], page: { total: 0, limit: 0, offset: 0 } }) : (query.unified === '1' ? catalogUnifiedRegistry.listUnified : catalogRegistry.listRegistry)({
      ...((query.unified === '1') ? {} : { finalized_only: true }),
      search: query.search,
      supplier: query.supplier,
      category: query.category,
      subcategory: query.subcategory,
      status: query.status,
      limit: query.catalog_limit || 50,
      offset: query.catalog_offset || 0,
    }),
    isRefinery ? Promise.resolve([]) : commercialAssortment.listCommercialAssortment({ limit: 200 }),
    queryApprovalQueue({ limit: approvalLimit, offset: approvalOffset, productRef: approvalProductRef }),
    queryApprovalBreakdown(),
    isRefinery ? Promise.resolve(null) : queryFocusedMarketHandoff(approvalProductRef),
    isRefinery ? Promise.resolve({ items: [], unavailable: false }) : getPricingParameterStatus(db).catch(() => ({ items: [], has_unvalidated: false, unavailable: true })),
  ]);
  // La projection Raffinerie expose le vrai verdict du moteur de certification,
  // sans déclencher de validation, publication ni mutation.
  const approvalWithReadiness = query.include_readiness === '1'
    ? await Promise.all(approval.map(async row => {
        const facts = await certifyCatalogProduct(db, row.product_id);
        const { product_id, ...publicRow } = row;
        return {
          ...publicRow,
          certification: facts?.certification || null,
        };
      }))
    : approval.map(({ product_id, ...row }) => row);
  const refinery = isRefinery ? await refineryWorklist.buildRefineryWorklist(query) : null;
  const approvalTotal = Number(summary.approval_pending) || 0;
  const commercialSummary = {
    approved_products: commercialProducts.length,
    closed_lots: [...new Set(commercialProducts.flatMap(row => row.source_lots || []))].length,
    markets: [...new Set(commercialProducts.flatMap(row => row.approved_markets || []))].length,
  };
  const commercialCurationSummary = { ...summary, active_products: commercialSummary.approved_products };
  return {
    scope: isRefinery
      ? { mode: 'refinery_preparation', label: 'Raffinerie produits' }
      : { mode: 'global_catalog_registry', label: 'Catalogue global Komerce' },
    summary: {
      ...summary,
      registry_total: registry.page.total,
      ...(query.unified === '1' ? { operator_groups: registry.groups } : {}),
      categories: categories.filter(row => row.is_active).length,
      commercial_approved: commercialSummary.approved_products,
      commercial_closed_lots: commercialSummary.closed_lots,
      commercial_markets: commercialSummary.markets,
    },
    commercial: commercialSummary,
    curation: buildCurationState(commercialCurationSummary, catalogCap),
    categories,
    products: registry.products,
    registry_page: registry.page,
    commercial_products: commercialProducts,
    approval: approvalWithReadiness,
    ...(isRefinery ? { refinery } : {}),
    focused_handoff: focusedHandoff,
    pricing_parameters: pricingParameters,
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


/**
 * Contrôle complet à la demande : ne valide, ne publie ni ne modifie rien.
 * La certification du candidat est calculée par l'autorité Catalogue existante.
 * Une fiche déjà approuvée est hors du gate candidat : pas de faux "bloqué".
 */
async function getRegistryReadiness(productRef) {
  const product = await resolveProduct(productRef);
  if (product.is_active === true) {
    return {
      product_ref: product.product_ref,
      phase: 'market_decisions',
      certification: null,
      note: 'Produit Catalogue actif : vérifier séparément la visibilité et le prix local sur chaque marché.',
    };
  }
  const facts = await certifyCatalogProduct(db, product.id);
  if (product.lifecycle_status !== 'candidate') {
    // Ne jamais certifier une fiche hors du gate candidat. Les vérifications
    // communes restent utiles pour orienter son réexamen, sans GO publication.
    const stateSpecific = reason => reason === 'not_inactive_candidate' ||
      reason === 'market_exposure_enabled' || reason.startsWith('publication_guard:');
    return {
      product_ref: product.product_ref,
      phase: 'product_review',
      certification: null,
      findings: (facts?.certification?.reasons || []).filter(reason => !stateSpecific(reason)),
      note: 'Fiche inactive hors file candidat : points techniques indicatifs, aucune certification de publication.',
    };
  }
  return {
    product_ref: product.product_ref,
    phase: 'catalog_approval',
    certification: facts?.certification || null,
    note: 'Contrôle technique de validation Catalogue ; la revue visuelle FR et les prix locaux relèvent de leurs validations propres.',
  };
}

// Read-only dossier from the SAME certification authority used for approval.
// It does not grant publication, decide local prices or mutate source records.
function publicProductDossier(facts, product, marketHandoff = null, details = {}) {
  const row = facts?.row || {};
  const candidate = product.lifecycle_status === 'candidate' && product.is_active !== true;
  const positive = value => {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const count = value => value == null || String(value).trim() === ''
    ? null : (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null);
  return {
    product_ref: product.product_ref,
    identity: {
      title_fr: row.name || null,
      description_fr: row.description || null,
      content_source: row.content_source || null,
      locale: row.source_locale || null,
      needs_review: row.needs_review === true,
      customs_category: row.category || null,
      boutique_category_key: row.boutique_category_key || null,
      boutique_subcategory_key: row.boutique_subcategory_key || null,
      taxonomy_active: row.taxonomy_active === true,
    },
    supplier: {
      name: row.supplier_name || null,
      reference: row.supplier_product_id || null,
      source_contract_v2: row.has_sourcing_candidate === false ? null
        : String(row.normalized_source_contract?.schema_version || '') === '2',
      sourcing_decision: row.sourcing_decision || null,
    },
    availability: {
      lifecycle_status: row.lifecycle_status || product.lifecycle_status,
      is_active: product.is_active === true,
      is_available: row.is_available === true,
      inventory_model: row.inventory_model || null,
      stock: row.stock == null || String(row.stock).trim() === ''
        ? null : (Number.isFinite(Number(row.stock)) ? Number(row.stock) : null),
      has_variants: row.has_variants === true,
      weight_kg: positive(row.weight_kg),
      dimensions_cm: row.dimensions_cm || null,
      fragility: row.fragility || null,
      requires_secure_transport: row.requires_secure_transport === true,
      // products.stock is not the sellable stock authority in SKU mode.
      stock_is_authoritative: row.inventory_model !== 'SKU',
    },
    purchasing: {
      active_supplier_skus: count(row.active_supplier_skus),
      complete_supplier_skus: count(row.complete_supplier_skus),
      supplier_identity_complete: row.has_sourcing_candidate === false ? null
        : (Number(row.active_supplier_skus) > 0 &&
          Number(row.active_supplier_skus) === Number(row.complete_supplier_skus)),
    },
    media: {
      active_canonical: count(row.active_media),
      gallery: (Array.isArray(details.media) ? details.media : [])
        .filter(item => typeof item.url === 'string' && /^https:\/\//i.test(item.url))
        .slice(0, 24).map(item => ({
          url: item.url,
          alt: item.alt || null,
          role: item.role || 'PRODUCT',
          source_media_id: item.source_media_id || null,
        })),
      gallery_truncated: (details.media || []).length > 24,
    },
    variants: {
      inventory_model: row.inventory_model || 'LEGACY_VARIANTS',
      rows: (Array.isArray(details.variants) ? details.variants : [])
        .slice(0, 50).map(item => ({
          sku: item.sku || null,
          supplier_sku: row.inventory_model === 'SKU' ? (item.supplier_sku || null) : null,
          supplier_unit_ref: row.inventory_model === 'SKU' ? (item.supplier_unit_ref || null) : null,
          variant_type: row.inventory_model === 'SKU' ? null : (item.variant_type || null),
          variant_value: row.inventory_model === 'SKU' ? null : (item.variant_value || null),
          variant_combo: row.inventory_model === 'SKU' ? (item.variant_combo || null) : null,
          stock: item.stock == null ? null : Number(item.stock),
          is_active: row.inventory_model === 'SKU' ? item.is_active === true : null,
        })),
      truncated: (details.variants || []).length > 50,
      stock_semantics: row.inventory_model === 'SKU' ? 'sellable_sku'
        : 'legacy_variant_axes_not_combinatorial',
    },
    catalogue_gate: {
      phase: candidate ? 'catalog_approval' : 'other_lifecycle',
      technically_certified: candidate ? facts?.certification?.certified === true : null,
      reasons: candidate && Array.isArray(facts?.certification?.reasons)
        ? facts.certification.reasons : [],
      note: candidate
        ? 'Contrôle technique de fiche candidate, distinct de la publication marché.'
        : 'Une fiche active ne repasse pas automatiquement en validation Catalogue.',
    },
    markets: Array.isArray(marketHandoff?.markets)
      ? marketHandoff.markets.map(market => ({
          code: market.code,
          name: market.name,
          currency: market.currency,
          commercial_exposure: market.commercial_exposure,
          exposure_decision_recorded: market.exposure_decision_recorded,
          price_status: market.price_status,
          // No inference that payment, stock and checkout gates have passed.
          buyer_visible_according_to_market_thread: market.buyer_visible,
        }))
      : [],
    market_data_scope: product.is_active === true
      ? 'active_catalogue_product' : 'not_queried_before_approval',
  };
}

async function getProductDossier(productRef) {
  const product = await resolveProduct(productRef);
  const [facts, handoff] = await Promise.all([
    certifyCatalogProduct(db, product.id),
    product.is_active === true ? queryFocusedMarketHandoff(product.product_ref) : Promise.resolve(null),
  ]);
  if (!facts?.row) throw new CatalogWorkspaceError(
    'catalog_facts_unavailable', 'Fiche canonique indisponible', 503
  );
  const skuStockAuthority = facts.row.inventory_model === 'SKU';
  const [mediaResult, variantResult] = await Promise.all([
    db.query(`SELECT url, alt, role, source_media_id, display_order
       FROM catalog_media WHERE product_id=$1 AND is_active=TRUE
       ORDER BY display_order ASC NULLS LAST, created_at ASC LIMIT 25`, [product.id]),
    skuStockAuthority
      ? db.query(`SELECT sku, supplier_sku, supplier_unit_ref, variant_combo,
                  stock, is_active FROM product_skus
                   WHERE product_id=$1 ORDER BY is_active DESC, created_at ASC LIMIT 51`, [product.id])
      : db.query(`SELECT sku, variant_type, variant_value, stock
                   FROM product_variants WHERE product_id=$1
                   ORDER BY display_order ASC, variant_type ASC, variant_value ASC LIMIT 51`, [product.id]),
  ]);
  return publicProductDossier(facts, product, handoff, {
    media: mediaResult.rows,
    variants: variantResult.rows,
  });
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

// Classification boutique du produit remis : l'autorité Catalog valide la paire.
// Cette action n'approuve pas le produit, ne le publie pas et ne modifie
// jamais sa catégorie économique/douanière.
async function classifyProduct(productRef, body = {}) {
  const product = await resolveProduct(productRef);
  if (product.lifecycle_status === 'rejected') {
    throw new CatalogWorkspaceError('catalog_product_rejected', 'Produit écarté : réactivation requise avant correction', 409);
  }
  const { rows } = await db.query(
    "SELECT 1 FROM sourcing_candidates WHERE product_id=$1 AND state='imported_to_catalog' LIMIT 1",
    [product.id]
  );
  if (!rows.length) throw new CatalogWorkspaceError(
    'catalog_handoff_required', 'Produit non remis par la Raffinerie', 409
  );
  const result = await catalogProductMutation.assignBoutiqueTaxonomy(
    db, product.id, body.category, body.subcategory
  );
  if (!result) throw new CatalogWorkspaceError('product_not_found', 'Produit introuvable', 404);
  return {
    product_ref: result.product_ref,
    boutique_category_key: result.boutique_category_key,
    boutique_subcategory_key: result.boutique_subcategory_key,
    approved: false,
    market_exposure_changed: false,
  };
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

  let result;
  try {
    result = await catalogOverrides.upsertOverrides(
      db,
      product.id,
      { name, description },
      {
        reason: body.reason || 'Préparation FR manuelle/assistée hors runtime — zéro API IA payante',
        setBy: actor?.id || null,
      }
    );
  } catch (error) {
    if (error.code === 'FRENCH_NOT_DETECTED') {
      throw new CatalogWorkspaceError('catalog_fr_language_check_failed', error.message, 422);
    }
    throw error;
  }

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
  let result;
  try {
    result = await catalogApproval.approveProduct(db, product.id, actor);
  } catch (error) {
    // Migration 259 allowed NULL global price for drafts only, contradicting
    // the certified source-linked approval path. Fail intelligibly if an
    // environment has not yet applied migration 352; do not force any price.
    if (error.code === '23514' &&
        error.constraint === 'chk_products_unpriced_draft_only') {
      throw new CatalogWorkspaceError(
        'catalog_unpriced_approval_schema_outdated',
        'Validation impossible : la base utilise encore une ancienne contrainte de prix global. ' +
          'Appliquer la migration Catalogue 352, puis relancer la vérification. ' +
          'Ne saisissez pas de prix fictif et ne publiez aucun marché.',
        409
      );
    }
    throw error;
  }
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
  getRegistryReadiness,
  getProductDossier,
  createProduct,
  updateProduct,
  classifyProduct,
  recoverProductSourceMedia: catalogMediaRecovery.recoverSourceMedia,
  deactivateProduct,
  prepareCandidateFrench,
  approveCandidate,
  rejectCandidate,
  overrideCandidate,
  createCategory: (body, actor) => taxonomy.createCategory(body, undefined, { ...actor, source_surface: 'canonical_catalog_workspace' }),
  updateCategory: (key, body, actor) => taxonomy.updateCategory(key, body, undefined, { ...actor, source_surface: 'canonical_catalog_workspace' }),
  deactivateCategory: (key, actor) => taxonomy.deactivateCategory(key, undefined, { ...actor, source_surface: 'canonical_catalog_workspace' }),
  createSubcategory: (key, body, actor) => taxonomy.createSubcategory(key, body, undefined, { ...actor, source_surface: 'canonical_catalog_workspace' }),
  updateSubcategory: (key, subKey, body, actor) => taxonomy.updateSubcategory(key, subKey, body, undefined, { ...actor, source_surface: 'canonical_catalog_workspace' }),
  deactivateSubcategory: (key, subKey, actor) => taxonomy.deactivateSubcategory(key, subKey, {}, undefined, { ...actor, source_surface: 'canonical_catalog_workspace' }),
  _test: {
    publicProduct,
    publicProductDossier,
    queryProducts,
    queryApprovalQueue,
    queryApprovalBreakdown,
    classificationStatus,
    queryFocusedMarketHandoff,
    sourcingDecisionOrderSql,
    queryCatalogCap,
    buildCurationState,
    resolveProduct,
    sanitizeProductCreate,
    sanitizeProductUpdate,
    APPROVAL_CONTENT_SOURCES,
  },
};