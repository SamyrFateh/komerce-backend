/**
 * @komerce-arch
 * @role          customer-handoff-reconciliation
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        customer order id
 * @outputs       canonical handoff verdict from parcel progression + authorized collection proof
 * @depends       orders, parcels, scans
 * @used-by       future Control Tower / Order 360 / financial closure
 * @db-read       orders, parcels, scans
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/chantier/CUSTOMER_TO_CUSTOMER_CLOSURE.md
 * @impact-areas  logistics, orders
 */
'use strict';

const VERDICT = Object.freeze({
  MATCHED: 'HANDOFF_MATCHED',
  MISMATCH: 'HANDOFF_MISMATCH',
  PENDING: 'HANDOFF_PENDING',
});

const TERMINAL_PARCEL_STATUS = 'collected';
const ACTIVE_PARCEL_STATUSES = Object.freeze([
  'preparation',
  'shipped',
  'in_transit',
  'arrived',
  'available',
  'collected',
]);

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

function classifyProof(scan) {
  if (!scan) return { valid: false, method: null, reason: 'COLLECTION_PROOF_MISSING' };

  const method = text(scan.pickup_method);
  if (method === 'PICKUP_CODE') {
    return { valid: true, method: 'PICKUP_CODE', reason: null };
  }

  if (method === 'AUTHORIZED_NAME_ID_CHECK') {
    const version = Number(scan.authorization_version);
    if (!Number.isInteger(version) || version <= 0 || scan.document_checked !== true) {
      return {
        valid: false,
        method: 'AUTHORIZED_NAME_ID_CHECK',
        reason: 'AUTHORIZED_COLLECTION_PROOF_INCOMPLETE',
      };
    }
    return { valid: true, method: 'AUTHORIZED_NAME_ID_CHECK', reason: null };
  }

  const scanCode = text(scan.scan_code);
  const notes = text(scan.notes) || '';
  if (!method && scanCode && scanCode.startsWith('QR-') && /QR Code.*token valid/i.test(notes)) {
    return { valid: true, method: 'QR_TOKEN', reason: null };
  }

  return { valid: false, method: method || null, reason: 'COLLECTION_PROOF_UNSUPPORTED' };
}

function freezeProof(scan, classified) {
  return Object.freeze({
    scan_id: scan.id,
    parcel_id: scan.parcel_id || null,
    method: classified.method,
    scanned_by: scan.scanned_by || null,
    pickup_relais_id: scan.pickup_relais_id || null,
    authorization_version: scan.authorization_version == null ? null : Number(scan.authorization_version),
    document_checked: scan.document_checked === true,
    created_at: scan.created_at || null,
  });
}

async function loadOrder(client, orderId) {
  const id = text(orderId);
  if (!id) throw new Error('CUSTOMER_HANDOFF_ORDER_ID_REQUIRED');

  const { rows } = await client.query(`
    SELECT id, reference, status, relais_id
      FROM orders
     WHERE id = $1
  `, [id]);
  if (!rows[0]) throw new Error('CUSTOMER_HANDOFF_ORDER_NOT_FOUND');
  return rows[0];
}

async function loadParcels(client, orderId) {
  const { rows } = await client.query(`
    SELECT id, reference, status::text AS status,
           shipped_at, in_transit_at, arrived_at, available_at, collected_at
      FROM parcels
     WHERE order_id = $1
       AND status::text <> 'cancelled'
     ORDER BY created_at, id
  `, [orderId]);
  return rows;
}

async function loadCollectionScans(client, orderId) {
  const { rows } = await client.query(`
    SELECT id, order_id, parcel_id, step, scan_code, scanned_by, notes,
           pickup_method, authorization_version, document_checked,
           pickup_relais_id, created_at
      FROM scans
     WHERE order_id = $1
       AND step = 'collected'
     ORDER BY created_at, id
  `, [orderId]);
  return rows;
}

function result({
  verdict,
  reason,
  order,
  parcels,
  proofs = [],
  invalidProofs = [],
} = {}) {
  const statusCounts = {};
  for (const parcel of parcels) {
    statusCounts[parcel.status] = (statusCounts[parcel.status] || 0) + 1;
  }

  return Object.freeze({
    scope: 'CUSTOMER_HANDOFF',
    verdict,
    reason,
    order_id: order.id,
    order_reference: order.reference,
    order_status: order.status,
    relay_id: order.relais_id || null,
    parcel_count: parcels.length,
    collected_parcel_count: parcels.filter(p => p.status === TERMINAL_PARCEL_STATUS).length,
    parcel_status_counts: Object.freeze(statusCounts),
    parcel_refs: Object.freeze(parcels.map(p => p.reference).filter(Boolean)),
    proofs: Object.freeze(proofs),
    invalid_proofs: Object.freeze(invalidProofs),
  });
}

async function reconcileCustomerHandoff(client, { orderId } = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('CUSTOMER_HANDOFF_DB_CLIENT_REQUIRED');
  }

  const order = await loadOrder(client, orderId);
  const parcels = await loadParcels(client, order.id);
  const scans = await loadCollectionScans(client, order.id);

  const validProofByParcel = new Map();
  const legacyValidProofs = [];
  const invalidProofs = [];

  for (const scan of scans) {
    const classified = classifyProof(scan);
    if (!classified.valid) {
      invalidProofs.push(Object.freeze({
        scan_id: scan.id,
        parcel_id: scan.parcel_id || null,
        reason: classified.reason,
        method: classified.method,
      }));
      continue;
    }

    const proof = freezeProof(scan, classified);
    if (scan.parcel_id) validProofByParcel.set(String(scan.parcel_id), proof);
    else legacyValidProofs.push(proof);
  }

  if (!parcels.length) {
    if (order.status === 'collected' && legacyValidProofs.length > 0) {
      return result({
        verdict: VERDICT.MATCHED,
        reason: null,
        order,
        parcels,
        proofs: legacyValidProofs,
        invalidProofs,
      });
    }

    return result({
      verdict: VERDICT.PENDING,
      reason: 'CUSTOMER_HANDOFF_NO_ACTIVE_PARCELS',
      order,
      parcels,
      proofs: legacyValidProofs,
      invalidProofs,
    });
  }

  const unsupported = parcels.filter(p => !ACTIVE_PARCEL_STATUSES.includes(p.status));
  if (unsupported.length) {
    return result({
      verdict: VERDICT.MISMATCH,
      reason: 'CUSTOMER_HANDOFF_PARCEL_STATUS_UNSUPPORTED',
      order,
      parcels,
      proofs: [...validProofByParcel.values()],
      invalidProofs,
    });
  }

  const collected = parcels.filter(p => p.status === TERMINAL_PARCEL_STATUS);
  const collectedWithoutProof = collected.filter(p => !validProofByParcel.has(String(p.id)));

  if (collectedWithoutProof.length > 0) {
    return result({
      verdict: VERDICT.MISMATCH,
      reason: 'CUSTOMER_HANDOFF_COLLECTED_WITHOUT_PROOF',
      order,
      parcels,
      proofs: [...validProofByParcel.values()],
      invalidProofs,
    });
  }

  if (invalidProofs.length > 0 && collected.length > 0) {
    return result({
      verdict: VERDICT.MISMATCH,
      reason: 'CUSTOMER_HANDOFF_INVALID_COLLECTION_PROOF',
      order,
      parcels,
      proofs: [...validProofByParcel.values()],
      invalidProofs,
    });
  }

  if (collected.length < parcels.length) {
    return result({
      verdict: VERDICT.PENDING,
      reason: collected.length > 0
        ? 'CUSTOMER_HANDOFF_PARTIAL_COLLECTION'
        : 'CUSTOMER_HANDOFF_NOT_COLLECTED',
      order,
      parcels,
      proofs: [...validProofByParcel.values()],
      invalidProofs,
    });
  }

  if (order.status !== 'collected') {
    return result({
      verdict: VERDICT.MISMATCH,
      reason: 'CUSTOMER_HANDOFF_ORDER_STATUS_INCONSISTENT',
      order,
      parcels,
      proofs: [...validProofByParcel.values()],
      invalidProofs,
    });
  }

  return result({
    verdict: VERDICT.MATCHED,
    reason: null,
    order,
    parcels,
    proofs: parcels.map(p => validProofByParcel.get(String(p.id))),
    invalidProofs,
  });
}

module.exports = {
  VERDICT,
  classifyProof,
  reconcileCustomerHandoff,
};
