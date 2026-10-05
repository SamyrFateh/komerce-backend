/**
 * @komerce-arch
 * @role          canonical-supplier-360-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        supplier_uuid
 * @outputs       supplier_360_readonly_projection
 * @depends       db, services/suppliers/provider-authority.js, governance/external-provider-capability-certifications.json
 * @used-by       routes/admin-supplier-360.js
 * @db-read       suppliers, product_suppliers, products, purchase_orders, orders, supplier_execution_orders, supplier_execution_payments
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, supplier_secrets_never_exposed, docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  admin-dashboard, purchasing, catalog, supplier-connectivity
 * @version       2026-10
 */
'use strict';

const db = require('../db');
const providerAuthority = require('./suppliers/provider-authority');
const capabilityCertificationRegistry = require('../governance/external-provider-capability-certifications.json');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeSupplierId(value) {
  const id = String(value || '').trim();
  return UUID.test(id) ? id.toLowerCase() : null;
}

async function resolveSupplier(value, q = db) {
  const id = normalizeSupplierId(value);
  if (!id) return { invalid: true, supplier: null };
  const { rows: [row] } = await q.query(`
    SELECT id, name, platform, contact_name, contact_phone, contact_email,
           auto_order, lead_time_days, is_active, deleted_at, created_at, updated_at,
           (api_key_enc IS NOT NULL AND api_key_enc <> '') AS has_api_key,
           (api_secret_enc IS NOT NULL AND api_secret_enc <> '') AS has_api_secret
      FROM suppliers
     WHERE id = $1
     LIMIT 1
  `, [id]);
  return { invalid: false, supplier: row || null };
}

function projectCapabilityCertifications(platform, registry = capabilityCertificationRegistry) {
  const provider = providerAuthority.normalizeProviderCode(platform);
  const supported = providerAuthority.isSupportedProvider(provider);
  const rawRecords = supported && registry && registry.providers && Array.isArray(registry.providers[provider])
    ? registry.providers[provider]
    : [];

  const records = rawRecords.map(row => Object.freeze({
    capability: row.capability,
    classification: row.classification,
    availability: row.availability,
    highest_proof: row.highest_proof,
    environment: row.environment,
    evidence: Object.freeze(Array.isArray(row.evidence) ? row.evidence.map(String) : []),
    limitations: Object.freeze(Array.isArray(row.limitations) ? row.limitations.map(String) : []),
  }));

  return Object.freeze({
    provider: supported ? provider : null,
    resolution: !supported ? 'UNSUPPORTED_PROVIDER' : (records.length ? 'RECORDED' : 'NO_RECORD'),
    source: 'governance/external-provider-capability-certifications.json',
    authority: 'observational_proof_only',
    records: Object.freeze(records),
  });
}

async function loadSupplier360(supplier, q = db) {
  if (!supplier || !supplier.id) throw new Error('supplier_360_resolved_supplier_required');

  const capabilityCertifications = projectCapabilityCertifications(supplier.platform);

  const [mappingsResult, posResult, executionResult, paymentResult] = await Promise.all([
    q.query(`
      SELECT p.product_ref, p.name AS product_name,
             ps.supplier_sku, ps.supplier_price_aed::text AS supplier_price_aed,
             ps.min_order_qty, ps.priority, ps.is_active, ps.last_checked_at
        FROM product_suppliers ps
        LEFT JOIN products p ON p.id = ps.product_id
       WHERE ps.supplier_id = $1 AND ps.deleted_at IS NULL
       ORDER BY ps.is_active DESC, ps.priority ASC, p.product_ref ASC NULLS LAST
    `, [supplier.id]),
    q.query(`
      SELECT po.id, po.order_id, o.reference AS order_reference,
             po.status::text AS status, po.procurement_hub_ref,
             po.supplier_order_id, po.supplier_currency,
             po.created_at, po.updated_at
        FROM purchase_orders po
        LEFT JOIN orders o ON o.id = po.order_id
       WHERE po.supplier_id = $1
       ORDER BY po.created_at DESC
       LIMIT 100
    `, [supplier.id]),
    q.query(`
      SELECT seo.provider, seo.provider_status, COUNT(*)::int AS count
        FROM supplier_execution_orders seo
        JOIN purchase_orders po ON po.id = seo.purchase_order_id
       WHERE po.supplier_id = $1
       GROUP BY seo.provider, seo.provider_status
       ORDER BY seo.provider, seo.provider_status
    `, [supplier.id]),
    q.query(`
      SELECT sep.provider, sep.status, sep.reconciliation_status, sep.currency,
             COUNT(*)::int AS count,
             COUNT(*) FILTER (WHERE sep.real_debit_verified = TRUE)::int AS real_debit_verified_count
        FROM supplier_execution_payments sep
        JOIN purchase_orders po ON po.id = sep.purchase_order_id
       WHERE po.supplier_id = $1
       GROUP BY sep.provider, sep.status, sep.reconciliation_status, sep.currency
       ORDER BY sep.provider, sep.status, sep.reconciliation_status, sep.currency
    `, [supplier.id]),
  ]);

  const mappings = mappingsResult.rows.map(row => Object.freeze({
    product_ref: row.product_ref || null,
    product_name: row.product_name || null,
    supplier_sku: row.supplier_sku || null,
    supplier_price_aed: row.supplier_price_aed == null ? null : String(row.supplier_price_aed),
    min_order_qty: row.min_order_qty == null ? null : Number(row.min_order_qty),
    priority: row.priority == null ? null : Number(row.priority),
    is_active: Boolean(row.is_active),
    last_checked_at: row.last_checked_at || null,
  }));
  const purchaseOrders = posResult.rows.map(row => Object.freeze({
    id: row.id,
    order_id: row.order_id || null,
    order_reference: row.order_reference || null,
    status: row.status,
    procurement_hub_ref: row.procurement_hub_ref || null,
    supplier_order_id: row.supplier_order_id || null,
    supplier_currency: row.supplier_currency || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const execution = executionResult.rows.map(row => Object.freeze({
    provider: row.provider,
    provider_status: row.provider_status || null,
    count: Number(row.count) || 0,
  }));
  const payments = paymentResult.rows.map(row => Object.freeze({
    provider: row.provider,
    status: row.status,
    reconciliation_status: row.reconciliation_status,
    currency: row.currency,
    count: Number(row.count) || 0,
    real_debit_verified_count: Number(row.real_debit_verified_count) || 0,
  }));

  return Object.freeze({
    supplier: Object.freeze({
      id: supplier.id,
      name: supplier.name,
      platform: supplier.platform || null,
      contact_name: supplier.contact_name || null,
      contact_phone: supplier.contact_phone || null,
      contact_email: supplier.contact_email || null,
      auto_order: Boolean(supplier.auto_order),
      lead_time_days: supplier.lead_time_days == null ? null : Number(supplier.lead_time_days),
      is_active: Boolean(supplier.is_active),
      deleted_at: supplier.deleted_at || null,
      has_api_key: Boolean(supplier.has_api_key),
      has_api_secret: Boolean(supplier.has_api_secret),
      capability_certifications: capabilityCertifications,
      created_at: supplier.created_at,
      updated_at: supplier.updated_at,
    }),
    mappings: Object.freeze(mappings),
    purchase_orders: Object.freeze(purchaseOrders),
    execution: Object.freeze(execution),
    payments: Object.freeze(payments),
    data_quality: Object.freeze({
      generated_at: new Date().toISOString(),
      purchase_orders_limit: 100,
      credentials_projection: 'presence_flags_only',
      capability_status: 'certification_ledger_projected_readonly',
      certification_status: capabilityCertifications.resolution,
      source_tables: Object.freeze([
        'suppliers', 'product_suppliers', 'products', 'purchase_orders', 'orders',
        'supplier_execution_orders', 'supplier_execution_payments',
      ]),
    }),
  });
}

module.exports = { UUID, normalizeSupplierId, projectCapabilityCertifications, resolveSupplier, loadSupplier360 };
