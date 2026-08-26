/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_central_actor, product_ref, category_key, catalog_action_payload
 * @outputs       catalog_work_queue, delegated_catalog_mutations
 * @depends       db, services/product-admin-service.js, services/catalog-approval.js, services/boutique-taxonomy-admin.js
 * @used-by       routes/admin-catalog-workspace.js
 * @db-read       products, boutique_categories, boutique_subcategories
 * @db-write      none
 * @db-write-via  product-admin-service, catalog-approval, boutique-taxonomy-admin
 * @db-txn        delegated_to_domain_authority
 * @doctrine      workspace_acts_dashboard_observes, global_catalog_not_market_scoped, reuse_domain_mutation_authorities, product_ref_is_public_identity
 * @impact-areas  admin-dashboard, catalog, boutique
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const productAdmin = require('./product-admin-service');
const catalogApproval = require('./catalog-approval');
const taxonomy = require('./boutique-taxonomy-admin');

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
    category: row.category,
    subcategory: row.subcategory || null,
    price_kmf: Number(row.price_kmf) || 0,
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
          AND content_source IN ('connector_raw', 'ai_enriched')
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

async function queryProducts({ search = null, category = null, status = null, limit = 100 } = {}) {
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
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
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

async function queryApprovalQueue(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const { rows } = await db.query(`
    SELECT product_ref, name, description, category, fragility, emoji,
           price_kmf, stock, content_source, needs_review,
           enrichment_confidence, created_at
      FROM products
     WHERE lifecycle_status = 'candidate'
       AND is_active = FALSE
       AND content_source IN ('connector_raw', 'ai_enriched')
     ORDER BY needs_review DESC, enrichment_confidence ASC NULLS FIRST
     LIMIT $1
  `, [safeLimit]);
  return rows.map(row => ({
    product_ref: row.product_ref,
    name: row.name,
    description: row.description || null,
    category: row.category,
    fragility: row.fragility || null,
    emoji: row.emoji || null,
    price_kmf: Number(row.price_kmf) || 0,
    stock: row.stock == null ? null : Number(row.stock),
    content_source: row.content_source,
    needs_review: Boolean(row.needs_review),
    enrichment_confidence: row.enrichment_confidence == null ? null : Number(row.enrichment_confidence),
    created_at: row.created_at,
  }));
}

async function buildWorkspace(query = {}) {
  const [summary, categories, products, approval] = await Promise.all([
    querySummary(),
    taxonomy.listCategories(),
    queryProducts(query),
    queryApprovalQueue(query.approval_limit),
  ]);
  return {
    scope: { mode: 'global_catalog', label: 'Catalogue commun Komerce' },
    summary: { ...summary, categories: categories.filter(row => row.is_active).length },
    categories,
    products,
    approval,
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

async function approveCandidate(productRef, actor) {
  const product = await resolveProduct(productRef, { candidateOnly: true });
  const result = await catalogApproval.approveProduct(db, product.id, actor);
  if (result.status >= 400) throw new CatalogWorkspaceError(result.body.code || 'catalog_approve_rejected', result.body.error || 'Approbation refusée', result.status);
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
  if (result.status >= 400) throw new CatalogWorkspaceError(result.body.code || 'catalog_override_rejected', result.body.error || 'Correction refusée', result.status);
  return { ...publicProduct(result.body), overridden: result.body.overridden || [] };
}

module.exports = {
  CatalogWorkspaceError,
  buildWorkspace,
  createProduct,
  updateProduct,
  deactivateProduct,
  approveCandidate,
  rejectCandidate,
  overrideCandidate,
  createCategory: (body) => taxonomy.createCategory(body),
  updateCategory: (key, body) => taxonomy.updateCategory(key, body),
  deactivateCategory: (key) => taxonomy.deactivateCategory(key),
  createSubcategory: (key, body) => taxonomy.createSubcategory(key, body),
  updateSubcategory: (key, subKey, body) => taxonomy.updateSubcategory(key, subKey, body),
  deactivateSubcategory: (key, subKey) => taxonomy.deactivateSubcategory(key, subKey),
  _test: { publicProduct, queryProducts, queryApprovalQueue, resolveProduct, sanitizeProductCreate, sanitizeProductUpdate },
};
