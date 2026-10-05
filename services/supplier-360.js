/**
 * @komerce-arch
 * @role          purchasing-supplier-360-reader
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        supplier_id, provider_authority, provider_certification_ledger
 * @outputs       safe_supplier_identity, non_secret_configuration, provider_capabilities, certification_evidence, purchase_summary
 * @depends       db, services/suppliers/provider-authority.js, governance/external-provider-capability-certifications.json
 * @used-by       routes/purchasing.js
 * @db-read       suppliers, product_suppliers, products, purchase_orders
 * @db-write      none
 * @db-txn        none
 * @doctrine      supplier_360_observes_admin_commands_stay_separate, provider_certification_is_evidence_driven, secrets_never_projected
 * @impact-areas  purchasing, supplier-connectivity, admin-dashboard
 * @version       2026-10
 */
'use strict';

const db = require('../db');
const providerAuthority = require('./suppliers/provider-authority');
const certificationLedger = require('../governance/external-provider-capability-certifications.json');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function requireSupplierId(value) {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) throw fail(400, 'INVALID_SUPPLIER_ID', 'Identifiant fournisseur invalide');
  return id;
}

function projectCertifications(provider, ledger = certificationLedger) {
  const rows = ledger && ledger.providers && Array.isArray(ledger.providers[provider])
    ? ledger.providers[provider]
    : [];
  return rows.map(row => Object.freeze({
    capability: row.capability,
    classification: row.classification,
    availability: row.availability,
    highest_proof: row.highest_proof,
    environment: row.environment,
    evidence: Object.freeze(Array.isArray(row.evidence) ? [...row.evidence] : []),
    limitations: Object.freeze(Array.isArray(row.limitations) ? [...row.limitations] : []),
  }));
}

async function getSupplier360(supplierId, {
  q = db,
  authority = providerAuthority,
  ledger = certificationLedger,
} = {}) {
  const id = requireSupplierId(supplierId);

  const { rows: [supplier] } = await q.query(`
    SELECT
      id, name, platform,
      contact_name, contact_phone, contact_email,
      account_id, auto_order, is_active, lead_time_days,
      orders_count, avg_delay_days::text AS avg_delay_days,
      reliability_pct::text AS reliability_pct,
      requires_secure_transport,
      secure_transport_fee_pct::text AS secure_transport_fee_pct,
      secure_transport_contact,
      (api_key_enc IS NOT NULL) AS has_api_key,
      (api_secret_enc IS NOT NULL) AS has_api_secret,
      created_at, updated_at
    FROM suppliers
    WHERE id = $1 AND deleted_at IS NULL
  `, [id]);

  if (!supplier) throw fail(404, 'SUPPLIER_NOT_FOUND', 'Fournisseur introuvable');

  const [mappingsResult, statusesResult] = await Promise.all([
    q.query(`
      SELECT
        p.product_ref,
        p.name AS product_name,
        ps.supplier_sku,
        ps.min_order_qty,
        ps.priority,
        ps.is_active,
        ps.created_at,
        ps.updated_at
      FROM product_suppliers ps
      JOIN products p ON p.id = ps.product_id
      WHERE ps.supplier_id = $1
        AND ps.deleted_at IS NULL
      ORDER BY ps.priority ASC, p.name ASC, p.product_ref ASC
      LIMIT 100
    `, [id]),
    q.query(`
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM purchase_orders
      WHERE supplier_id = $1
      GROUP BY status
      ORDER BY status
    `, [id]),
  ]);

  const provider = authority.normalizeProviderCode(supplier.platform);
  const mappings = mappingsResult.rows.map(row => Object.freeze({
    product_ref: row.product_ref,
    product_name: row.product_name,
    supplier_sku: row.supplier_sku,
    min_order_qty: Number(row.min_order_qty) || 0,
    priority: Number(row.priority) || 0,
    is_active: row.is_active === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const purchaseOrdersByStatus = statusesResult.rows.map(row => Object.freeze({
    status: row.status,
    count: Number(row.count) || 0,
  }));
  const purchaseOrdersTotal = purchaseOrdersByStatus.reduce((sum, row) => sum + row.count, 0);

  return Object.freeze({
    supplier: Object.freeze({
      name: supplier.name,
      platform: provider,
      is_active: supplier.is_active === true,
      contact: Object.freeze({
        name: supplier.contact_name || null,
        phone: supplier.contact_phone || null,
        email: supplier.contact_email || null,
      }),
      configuration: Object.freeze({
        account_id: supplier.account_id || null,
        auto_order: supplier.auto_order === true,
        lead_time_days: Number(supplier.lead_time_days) || 0,
        requires_secure_transport: supplier.requires_secure_transport === true,
        secure_transport_fee_pct: supplier.secure_transport_fee_pct,
        secure_transport_contact: supplier.secure_transport_contact || null,
      }),
      credentials: Object.freeze({
        has_api_key: supplier.has_api_key === true,
        has_api_secret: supplier.has_api_secret === true,
      }),
      observed_stats: Object.freeze({
        orders_count: Number(supplier.orders_count) || 0,
        avg_delay_days: supplier.avg_delay_days,
        reliability_pct: supplier.reliability_pct,
      }),
      created_at: supplier.created_at,
      updated_at: supplier.updated_at,
    }),
    summary: Object.freeze({
      products_mapped: mappings.length,
      purchase_orders_total: purchaseOrdersTotal,
    }),
    mappings: Object.freeze(mappings),
    purchase_orders_by_status: Object.freeze(purchaseOrdersByStatus),
    provider_authority: Object.freeze({
      supported: authority.isSupportedProvider(provider),
      remote_preflight_requirement: authority.remotePreflightRequirement(provider),
      reconciliation_requirement: authority.reconciliationRequirement(provider),
    }),
    certifications: Object.freeze(projectCertifications(provider, ledger)),
    data_quality: Object.freeze({
      generated_at: new Date().toISOString(),
      certification_source: 'governance/external-provider-capability-certifications.json',
      supplier_configuration_is_not_certification: true,
      secrets_exposed: false,
      mappings_limit: 100,
      source_tables: Object.freeze(['suppliers', 'product_suppliers', 'products', 'purchase_orders']),
    }),
  });
}

module.exports = {
  UUID_RE,
  requireSupplierId,
  projectCertifications,
  getSupplier360,
};
