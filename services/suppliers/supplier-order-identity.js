/**
 * @komerce-arch
 * @role          supplier-order-identity
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        NormalizedSupplierProduct V2 sellable_unit
 * @outputs       canonical_supplier_unit_resolution
 * @depends       none
 * @used-by       supplier purchasing adapters, purchasing preflight
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  catalog, purchasing, supplier-integration
 * @version       2026-09-v1
 */
'use strict';

const ALLOWED_CURRENCIES = new Set(['AED', 'EUR', 'USD', 'KMF']);

function positiveInt(value, name = 'quantity') {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} doit être un entier >= 1`);
  return n;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeIdentity(identity, supplierUnitRef) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('supplier_order_identity requis pour une unité commandable');
  }
  const provider = String(identity.provider || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(provider)) {
    throw new Error(`supplier_order_identity.provider invalide: ${provider || 'absent'}`);
  }
  const version = Number(identity.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('supplier_order_identity.version doit être un entier >= 1');
  }
  if (!supplierUnitRef) {
    throw new Error('supplier_unit_ref requis quand supplier_order_identity est présent');
  }
  const payload = identity.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length === 0) {
    throw new Error('supplier_order_identity.payload doit être un objet non vide');
  }
  return { provider, version, payload: clone(payload) };
}

/**
 * Résolution universelle d'une unité fournisseur.
 *
 * Cette fonction ne connaît aucun fournisseur. Elle garantit seulement que
 * Komerce a exactement une unité V2, un stock/prix explicites et, lorsqu'on
 * s'apprête à commander, une Supplier Order Identity opaque et versionnée.
 * Le connecteur fournisseur reste seul propriétaire de l'interprétation du
 * payload opaque.
 */
function resolveSupplierUnit(contract, supplierSku, quantity = 1, options = {}) {
  const qty = positiveInt(quantity);
  const sku = String(supplierSku || '').trim();
  if (!sku) throw new Error('supplier_sku requis');
  if (!contract || String(contract.schema_version) !== '2') {
    throw new Error('NormalizedSupplierProduct V2 requis');
  }

  const matches = (contract.sellable_units || [])
    .filter((candidate) => String(candidate?.supplier_sku || '').trim() === sku);
  if (matches.length !== 1) {
    throw new Error(`supplier_sku doit résoudre exactement une unité fournisseur: ${sku} (${matches.length} trouvée(s))`);
  }

  const unit = matches[0];
  if (unit.is_active === false) throw new Error(`supplier_sku inactif: ${sku}`);
  if (unit.stock_available == null) throw new Error(`stock fournisseur inconnu pour ${sku}`);
  if (Number(unit.stock_available) < qty) {
    throw new Error(`stock fournisseur insuffisant pour ${sku}: ${unit.stock_available} < ${qty}`);
  }
  if (!(Number(unit.purchase_price) > 0)) throw new Error(`prix fournisseur invalide pour ${sku}`);

  const currency = String(unit.currency || contract.currency || '').toUpperCase();
  if (!ALLOWED_CURRENCIES.has(currency)) {
    throw new Error(`devise fournisseur invalide: ${currency || 'absente'}`);
  }

  const supplierUnitRef = String(unit.supplier_unit_ref || '').trim() || null;
  const requireOrderIdentity = options.requireOrderIdentity !== false;
  const supplierOrderIdentity = requireOrderIdentity
    ? normalizeIdentity(unit.supplier_order_identity, supplierUnitRef)
    : (unit.supplier_order_identity ? normalizeIdentity(unit.supplier_order_identity, supplierUnitRef) : null);

  return {
    supplier_product_ref: String(contract.supplier_product_id || '').trim() || null,
    supplier_sku: sku,
    supplier_unit_ref: supplierUnitRef,
    supplier_order_identity: supplierOrderIdentity,
    option_values: clone(unit.option_values || {}),
    quantity: qty,
    stock_available: Number(unit.stock_available),
    unit_price: Number(unit.purchase_price),
    currency,
  };
}

module.exports = {
  positiveInt,
  normalizeIdentity,
  resolveSupplierUnit,
};
