'use strict';

const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KOM_IN_RE = /^KOM-IN-([0-9A-F]{32})$/;

function requireUuid(value) {
  const text = String(value || '').trim();
  if (!UUID_RE.test(text)) throw new Error('HUB_INBOUND_PURCHASE_ORDER_UUID_INVALID');
  return text.toLowerCase();
}

function createInboundTag(purchaseOrderId) {
  const uuid = requireUuid(purchaseOrderId);
  return `KOM-IN-${uuid.replace(/-/g, '').toUpperCase()}`;
}

function parseInboundTag(value) {
  const match = KOM_IN_RE.exec(String(value || '').trim().toUpperCase());
  if (!match) return null;
  const h = match[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function generatePhysicalReference(kind) {
  const normalized = String(kind || '').trim().toUpperCase();
  const prefix = normalized === 'HANDLING_UNIT' || normalized === 'ITEM'
    ? 'KOM-ITEM'
    : normalized === 'MARKET_PARCEL' || normalized === 'BOX'
      ? 'KOM-BOX'
      : normalized === 'SUPPLIER_PACKAGE' || normalized === 'RECEIPT'
        ? 'KOM-RCV'
        : null;
  if (!prefix) throw new Error('HUB_PHYSICAL_REFERENCE_KIND_INVALID');
  return `${prefix}-${crypto.randomBytes(9).toString('hex').toUpperCase()}`;
}

function buildSupplierTagRequest(purchaseOrderId) {
  const reference = createInboundTag(purchaseOrderId);
  return Object.freeze({
    version: 1,
    reference,
    printable_text: reference,
    machine_payload: reference,
    preferred_symbologies: ['CODE128', 'QR'],
    apply_to: 'EVERY_SUPPLIER_PACKAGE_FOR_PURCHASE_ORDER',
    optional: true,
  });
}

module.exports = {
  createInboundTag,
  parseInboundTag,
  generatePhysicalReference,
  buildSupplierTagRequest,
};
