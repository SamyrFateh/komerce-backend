/**
 * @komerce-arch
 * @role          hub-physical-codes
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        scanned_code, purchase_order_id, optional_confirmation
 * @outputs       scanned_reference_identity_not_customer_allocation
 * @depends       db.js
 * @used-by       routes/hub.js
 * @db-read       product_sku_physical_codes, purchase_orders, purchase_lines
 * @db-write      product_sku_physical_codes
 * @db-txn        caller_owned_transaction_for_confirmation
 * @doctrine      code_identifies_sku_not_client; allocation_remains_in_hub_purchase_allocations
 */
'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['EAN_GTIN', 'SUPPLIER_BARCODE', 'KOM_LOT_LABEL']);

class PhysicalCodeError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function normalizeCode(value) {
  if (typeof value !== 'string') throw new PhysicalCodeError(400, 'HUB_PHYSICAL_CODE_REQUIRED');
  const code = value.trim().toUpperCase();
  if (!code || code.length > 128 || /[\x00-\x1f\x7f]/.test(code)) {
    throw new PhysicalCodeError(400, 'HUB_PHYSICAL_CODE_INVALID', 'Code physique invalide');
  }
  return code;
}

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new PhysicalCodeError(400, 'HUB_PHYSICAL_ID_INVALID', field + ' doit être un UUID valide');
  }
  return value;
}

async function loadExpectedPO(q, purchaseOrderId) {
  const id = requireUuid(purchaseOrderId, 'purchase_order_id');
  const { rows: [po] } = await q.query(
    'SELECT id, supplier_id, status FROM purchase_orders WHERE id = $1',
    [id]
  );
  if (!po) throw new PhysicalCodeError(404, 'HUB_PHYSICAL_PO_NOT_FOUND');
  if (po.status === 'draft' || po.status === 'cancelled') {
    throw new PhysicalCodeError(409, 'HUB_PHYSICAL_PO_NOT_RECEIVABLE');
  }
  return po;
}

async function skuExpectedOnPO(q, po, skuId) {
  const { rows } = await q.query(
    'SELECT 1 FROM purchase_lines WHERE purchase_order_id = $1 AND supplier_id = $2 ' +
    'AND product_sku_id = $3 AND cancelled_at IS NULL LIMIT 1',
    [po.id, po.supplier_id, skuId]
  );
  return rows.length > 0;
}

async function codesForSupplier(q, code, supplierId) {
  const { rows } = await q.query(
    'SELECT id, product_sku_id, supplier_id, code, code_type, trust, printed_on_pack ' +
    'FROM product_sku_physical_codes WHERE code = $1 ' +
    'AND (supplier_id = $2 OR supplier_id IS NULL) ' +
    'ORDER BY (supplier_id IS NOT NULL) DESC, id',
    [code, supplierId]
  );
  return rows;
}

// Code-barres = référence, jamais commande ni exemplaire individuel.
// Un code simplement déclaré par le fournisseur ne prouve PAS la réception physique.
async function resolvePhysicalCode(q, { purchaseOrderId, code }) {
  const normalized = normalizeCode(code);
  const po = await loadExpectedPO(q, purchaseOrderId);
  const rows = await codesForSupplier(q, normalized, po.supplier_id);
  if (!rows.length) throw new PhysicalCodeError(404, 'HUB_PHYSICAL_CODE_UNKNOWN');
  const skuIds = new Set(rows.map(row => String(row.product_sku_id)));
  if (skuIds.size !== 1) {
    throw new PhysicalCodeError(409, 'HUB_PHYSICAL_CODE_AMBIGUOUS', 'Code relié à plusieurs variantes');
  }
  const skuId = [...skuIds][0];
  if (!await skuExpectedOnPO(q, po, skuId)) {
    throw new PhysicalCodeError(409, 'HUB_PHYSICAL_SKU_NOT_ON_PO');
  }
  return {
    code: normalized,
    product_sku_id: skuId,
    purchase_order_id: po.id,
    confirmed: rows.some(row => row.trust === 'CONFIRMED'),
    physical_confirmation_required: rows.every(row => row.trust !== 'CONFIRMED'),
  };
}

// Appariement constaté sur un emballage, vérifié contre la PO.
// Le caller doit fournir un client transactionnel (BEGIN/COMMIT) pour l'advisory lock.
async function confirmPhysicalCode(q, { purchaseOrderId, productSkuId, code, codeType, proofRef, actorId }) {
  const normalized = normalizeCode(code);
  const skuId = requireUuid(productSkuId, 'product_sku_id');
  const userId = requireUuid(actorId, 'actor_id');
  const type = String(codeType || '').toUpperCase();
  if (!TYPES.has(type)) throw new PhysicalCodeError(400, 'HUB_PHYSICAL_CODE_TYPE_INVALID');
  const proof = String(proofRef || '').trim();
  if (!proof || proof.length > 500) throw new PhysicalCodeError(400, 'HUB_PHYSICAL_PROOF_REQUIRED');
  const po = await loadExpectedPO(q, purchaseOrderId);
  if (!await skuExpectedOnPO(q, po, skuId)) {
    throw new PhysicalCodeError(409, 'HUB_PHYSICAL_SKU_NOT_ON_PO');
  }
  // Empêche l'apprentissage concurrent du même code pour deux variantes.
  await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [normalized]);
  const matches = await codesForSupplier(q, normalized, po.supplier_id);
  if (matches.some(row => String(row.product_sku_id) !== skuId)) {
    throw new PhysicalCodeError(409, 'HUB_PHYSICAL_CODE_AMBIGUOUS');
  }
  const scopeSupplierId = type === 'EAN_GTIN' ? null : po.supplier_id;
  const sameScope = matches.find(row => String(row.supplier_id || '') === String(scopeSupplierId || ''));
  if (sameScope && sameScope.code_type !== type) {
    throw new PhysicalCodeError(409, 'HUB_PHYSICAL_CODE_TYPE_CONFLICT');
  }
  const result = sameScope
    ? await q.query(
      "UPDATE product_sku_physical_codes SET trust = 'CONFIRMED', printed_on_pack = TRUE, " +
      'confirmed_by = $2, confirmed_at = now(), confirmation_proof_ref = $3 ' +
      'WHERE id = $1 RETURNING id, trust',
      [sameScope.id, userId, proof]
    )
    : await q.query(
      'INSERT INTO product_sku_physical_codes ' +
      '(product_sku_id, supplier_id, code, code_type, trust, printed_on_pack, ' +
      'confirmed_by, confirmed_at, confirmation_proof_ref) ' +
      "VALUES ($1,$2,$3,$4,'CONFIRMED',TRUE,$5,now(),$6) RETURNING id, trust",
      [skuId, scopeSupplierId, normalized, type, userId, proof]
    );
  return { id: result.rows[0].id, code: normalized, product_sku_id: skuId, trust: result.rows[0].trust };
}

module.exports = { PhysicalCodeError, normalizeCode, resolvePhysicalCode, confirmPhysicalCode };
