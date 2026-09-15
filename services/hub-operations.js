/**
 * @komerce-arch
 * @role          hub-operations
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, operator_command_payload
 * @outputs       physical_unit_result, custody_side_effects
 * @depends       db, services/hub-physical-identity.js
 * @used-by       routes/hub.js, routes/scans.js
 * @db-read       business_rules, hub_physical_units, parcel_items, parcels, products, scan_events
 * @db-write      products, scan_events
 * @db-write-via:hub-physical-identity hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, hub_custody_events, incidents, outbox_events
 * @db-txn        operator_command_atomic
 * @doctrine      HUB-001 Physical Identity, Allocation & Custody; HUB-002 Operator Execution Cutover; DOCTRINE_DENSITE_VALEUR
 * @impact-areas  logistics, purchasing, incident-management
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const {
  HubPhysicalError,
  createPhysicalUnit,
  receiveSupplierPackage: receiveSupplierPackageCore,
  revalidateQuarantinedInbound,
  transitionPhysicalUnit,
  moveAllocationQuantity,
  recordPhysicalUnitOutcome,
} = require('./hub-physical-identity');

const REPACK_MIN_GAIN_FALLBACK_CM3 = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATOR_CONTAINER_TYPES = new Set(['HANDLING_UNIT', 'MARKET_PARCEL']);
const OPERATOR_MOVES = new Set(['SPLIT', 'MERGE', 'REPACK']);
const NEXT_OPERATOR_STATE = Object.freeze({
  RECEIVED: 'IDENTIFIED',
  IDENTIFIED: 'QUALITY_CHECKED',
  QUALITY_CHECKED: 'LOCATED',
  LOCATED: 'ALLOCATED',
  ALLOCATED: 'PICKED',
  PICKED: 'PACKED',
  PACKED: 'DISPATCHED',
});

function badRequest(message, code = 'HUB_OPERATOR_BAD_REQUEST') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireUuid(value, name) {
  if (!value || !UUID_RE.test(String(value))) {
    throw badRequest(`${name} doit être un UUID valide`, 'HUB_OPERATOR_UUID_INVALID');
  }
  return String(value);
}

function requireText(value, name, max = 200) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw badRequest(`${name} est requis`, 'HUB_OPERATOR_TEXT_INVALID');
  return text;
}

function hubErrorResponse(error) {
  const code = error && error.code;
  if (code === '22P02' || String(code || '').startsWith('HUB_OPERATOR_')) {
    return { status: 400, body: { error: error.message, code } };
  }
  if (code === 'HUB_PHYSICAL_UNIT_NOT_FOUND' || code === 'INCIDENT_NOT_FOUND') {
    return { status: 404, body: { error: error.message, code } };
  }
  if (error instanceof HubPhysicalError || String(code || '').startsWith('HUB_')) {
    return { status: 409, body: { error: error.message, code } };
  }
  throw error;
}

async function withOperatorTransaction(work) {
  return db.withTransaction(async (client) => work(client));
}

async function loadPhysicalUnit(client, unitId) {
  const { rows: [unit] } = await client.query(
    'SELECT * FROM hub_physical_units WHERE id = $1 FOR UPDATE',
    [unitId]
  );
  if (!unit) {
    const error = new HubPhysicalError('HUB_PHYSICAL_UNIT_NOT_FOUND', 'Unité physique introuvable');
    throw error;
  }
  return unit;
}

async function transitionOperatorUnit(client, { unitId, toState, actorId, locationRef = null, details = {} }) {
  const unit = await loadPhysicalUnit(client, unitId);
  const expected = NEXT_OPERATOR_STATE[unit.state];
  if (!expected || expected !== toState) {
    throw new HubPhysicalError(
      'HUB_OPERATOR_TRANSITION_FORBIDDEN',
      `Transition opérateur interdite : ${unit.state} → ${toState}`
    );
  }
  if (['PACKED', 'DISPATCHED'].includes(toState) && unit.unit_type !== 'MARKET_PARCEL') {
    throw new HubPhysicalError(
      'HUB_OPERATOR_OUTBOUND_TYPE_REQUIRED',
      `${toState} exige une unité MARKET_PARCEL`
    );
  }
  return transitionPhysicalUnit(client, {
    unitId,
    toState,
    actorId,
    locationRef,
    details,
  });
}

/**
 * L'ancien scan parcel_ref → safeSyncScanToParcels(order_id) est fermé.
 * La réception fournisseur canonique passe par receiveSupplierPackageCommand().
 */
async function receiveParcel() {
  return {
    status: 410,
    body: {
      error: 'Flux Hub legacy désactivé : utiliser POST /api/scans/hub/receive avec le manifeste Purchase Order exact.',
      code: 'HUB_LEGACY_PARCEL_SCAN_DISABLED',
    },
  };
}

async function receiveSupplierPackageCommand(payload, userId) {
  try {
    const reference = requireText(payload && payload.reference, 'reference', 200);
    const contents = payload && payload.contents;
    if (!Array.isArray(contents) || contents.length === 0) {
      throw badRequest('contents doit contenir au moins une allocation Purchase Order');
    }
    const normalizedContents = contents.map((item) => ({
      purchase_order_id: requireUuid(item && item.purchase_order_id, 'purchase_order_id'),
      quantity: Number(item && item.quantity),
    }));
    if (normalizedContents.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) {
      throw badRequest('quantity doit être un entier strictement positif');
    }

    const result = await withOperatorTransaction((client) => receiveSupplierPackageCore(client, {
      reference,
      externalRef: payload.external_ref ? String(payload.external_ref).trim() : null,
      actorId: userId || null,
      locationRef: payload.location_ref ? String(payload.location_ref).trim() : null,
      contents: normalizedContents,
    }));

    return {
      status: result.quarantined ? 202 : 201,
      body: result,
    };
  } catch (error) {
    return hubErrorResponse(error);
  }
}

async function createOperatorUnitCommand(payload, userId) {
  try {
    const reference = requireText(payload && payload.reference, 'reference', 200);
    const unitType = String(payload && payload.unit_type || '').trim().toUpperCase();
    if (!OPERATOR_CONTAINER_TYPES.has(unitType)) {
      throw badRequest('unit_type doit être HANDLING_UNIT ou MARKET_PARCEL');
    }
    const unit = await withOperatorTransaction((client) => createPhysicalUnit(client, {
      reference,
      unitType,
      externalRef: payload.external_ref ? String(payload.external_ref).trim() : null,
      actorId: userId || null,
      locationRef: payload.location_ref ? String(payload.location_ref).trim() : null,
      initialState: 'RECEIVED',
      details: { operator_created: true },
    }));
    return { status: 201, body: { physical_unit: unit } };
  } catch (error) {
    return hubErrorResponse(error);
  }
}

async function transitionOperatorUnitCommand(payload, userId) {
  try {
    const unitId = requireUuid(payload && payload.unit_id, 'unit_id');
    const toState = String(payload && payload.to_state || '').trim().toUpperCase();
    const result = await withOperatorTransaction((client) => transitionOperatorUnit(client, {
      unitId,
      toState,
      actorId: userId || null,
      locationRef: payload.location_ref ? String(payload.location_ref).trim() : null,
      details: payload.details && typeof payload.details === 'object' ? payload.details : {},
    }));
    return { status: 200, body: result };
  } catch (error) {
    return hubErrorResponse(error);
  }
}

async function moveAllocationCommand(payload, userId) {
  try {
    const fromUnitId = requireUuid(payload && payload.from_unit_id, 'from_unit_id');
    const toUnitId = requireUuid(payload && payload.to_unit_id, 'to_unit_id');
    const allocationId = requireUuid(payload && payload.allocation_id, 'allocation_id');
    const quantity = Number(payload && payload.quantity);
    const operationType = String(payload && payload.operation_type || '').trim().toUpperCase();
    if (!Number.isInteger(quantity) || quantity <= 0) throw badRequest('quantity doit être un entier strictement positif');
    if (!OPERATOR_MOVES.has(operationType)) throw badRequest('operation_type doit être SPLIT, MERGE ou REPACK');

    const result = await withOperatorTransaction((client) => moveAllocationQuantity(client, {
      fromUnitId,
      toUnitId,
      allocationId,
      quantity,
      operationType,
      actorId: userId || null,
      locationRef: payload.location_ref ? String(payload.location_ref).trim() : null,
    }));
    return { status: 200, body: result };
  } catch (error) {
    return hubErrorResponse(error);
  }
}

async function revalidateQuarantineCommand(payload, userId) {
  try {
    const unitId = requireUuid(payload && payload.unit_id, 'unit_id');
    const incidentId = requireUuid(payload && payload.incident_id, 'incident_id');
    const result = await withOperatorTransaction((client) => revalidateQuarantinedInbound(client, {
      unitId,
      incidentId,
      actorId: userId || null,
      locationRef: payload.location_ref ? String(payload.location_ref).trim() : null,
      notes: payload.notes ? String(payload.notes).trim() : null,
    }));
    return {
      status: result.resolved ? 200 : 409,
      body: result,
    };
  } catch (error) {
    return hubErrorResponse(error);
  }
}

async function recordPhysicalOutcomeCommand(payload, userId) {
  try {
    const unitId = requireUuid(payload && payload.unit_id, 'unit_id');
    const outcomeType = String(payload && payload.outcome_type || '').trim().toUpperCase();
    const result = await withOperatorTransaction((client) => recordPhysicalUnitOutcome(client, {
      unitId,
      outcomeType,
      actorId: userId || null,
      locationRef: payload.location_ref ? String(payload.location_ref).trim() : null,
      details: payload.details && typeof payload.details === 'object' ? payload.details : {},
    }));
    return { status: 200, body: result };
  } catch (error) {
    return hubErrorResponse(error);
  }
}

async function packParcel(unitId, userId, boxLabel, notes) {
  try {
    const id = requireUuid(unitId, 'parcel_id');
    const result = await withOperatorTransaction((client) => transitionOperatorUnit(client, {
      unitId: id,
      toState: 'PACKED',
      actorId: userId || null,
      details: {
        box_label: boxLabel || null,
        notes: notes || null,
        operator_action: 'pack',
      },
    }));
    return {
      status: 200,
      body: { message: `Unité ${id} emballée`, physical_unit: result.unit },
    };
  } catch (error) {
    return hubErrorResponse(error);
  }
}

async function sealParcel(unitId, userId, notes) {
  try {
    const id = requireUuid(unitId, 'parcel_id');
    const result = await withOperatorTransaction((client) => transitionOperatorUnit(client, {
      unitId: id,
      toState: 'DISPATCHED',
      actorId: userId || null,
      details: { notes: notes || null, operator_action: 'seal_dispatch' },
    }));
    return {
      status: 200,
      body: { message: `Unité ${id} scellée et dispatchée`, physical_unit: result.unit },
    };
  } catch (error) {
    return hubErrorResponse(error);
  }
}

async function batchScan() {
  return {
    status: 410,
    body: {
      error: 'Batch scan legacy désactivé : chaque colis fournisseur doit être reçu avec son manifeste Purchase Order exact.',
      code: 'HUB_LEGACY_BATCH_SCAN_DISABLED',
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// V-4 DOCTRINE_DENSITE_VALEUR — mesure produit. Ce rail n'altère pas
// l'identité/custody HUB-001 et reste volontairement indépendant.
// ══════════════════════════════════════════════════════════════════════════

async function computeVolumeTasks(parcelId) {
  const empty = { next_action: null, tasks: [] };
  try {
    const { rows: items } = await db.query(
      `SELECT pi.product_id,
              COALESCE(pi.product_name, pr.name) AS name,
              pi.quantity,
              pr.volume_cm3, pr.repack_volume_cm3, pr.repack_exempt
       FROM parcel_items pi
       JOIN products pr ON pr.id = pi.product_id
       WHERE pi.parcel_id = $1`,
      [parcelId]
    );
    if (!items.length) return empty;

    let minGain = REPACK_MIN_GAIN_FALLBACK_CM3;
    try {
      const { rows } = await db.query(
        `SELECT value FROM business_rules WHERE key = 'REPACK_MIN_GAIN_CM3' AND is_active = TRUE LIMIT 1`
      );
      if (rows[0]) {
        const v = rows[0].value && rows[0].value.value != null ? Number(rows[0].value.value) : Number(rows[0].value);
        if (!isNaN(v)) minGain = v;
      }
    } catch (_) {}

    const tasks = [];
    for (const it of items) {
      if (it.repack_exempt) continue;
      const vol = it.volume_cm3 != null ? Number(it.volume_cm3) : null;
      const repack = it.repack_volume_cm3 != null ? Number(it.repack_volume_cm3) : null;
      if (vol == null) {
        tasks.push({ task: 'measure', product_id: it.product_id, name: it.name, quantity: it.quantity,
          instruction: 'Mesurer L×l×h (cm) du produit emballé et saisir le volume' });
      } else if (repack != null && (vol - repack) >= minGain) {
        tasks.push({ task: 'repack', product_id: it.product_id, name: it.name, quantity: it.quantity,
          gain_cm3: Math.round(vol - repack),
          instruction: `Repacker en emballage optimisé (gain ${Math.round((vol - repack) / 1000)} dm³/unité)` });
      }
    }
    const next_action = tasks.some((t) => t.task === 'repack') ? 'repack'
      : tasks.some((t) => t.task === 'measure') ? 'measure_volume' : null;
    return { next_action, tasks };
  } catch (_) {
    return empty;
  }
}

async function recordVolume(productId, userId, payload) {
  const { volume_cm3, repack_volume_cm3 } = payload || {};
  if (volume_cm3 == null && repack_volume_cm3 == null) {
    return { status: 400, body: { error: 'Fournir volume_cm3 et/ou repack_volume_cm3' } };
  }
  const sets = [];
  const params = [];
  let i = 1;
  if (volume_cm3 != null) { sets.push(`volume_cm3 = $${i++}`); params.push(volume_cm3); }
  if (repack_volume_cm3 != null) { sets.push(`repack_volume_cm3 = $${i++}`); params.push(repack_volume_cm3); }
  params.push(productId);
  const { rows } = await db.query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING id, name, volume_cm3, repack_volume_cm3, repack_exempt`,
    params
  );
  if (!rows.length) return { status: 404, body: { error: 'Produit introuvable' } };
  const p = rows[0];
  const gain = (p.volume_cm3 != null && p.repack_volume_cm3 != null)
    ? Math.round(Number(p.volume_cm3) - Number(p.repack_volume_cm3)) : null;
  return { status: 200, body: { message: `Volume enregistré pour ${p.name}`, product: p, repack_gain_cm3: gain, recorded_by: userId } };
}

async function recordSealPhoto(parcelId, userId, photoUrl, notes = null) {
  const { rows: parcels } = await db.query('SELECT id, reference FROM parcels WHERE id = $1', [parcelId]);
  if (!parcels.length) return { status: 404, body: { error: 'Colis introuvable' } };
  const { rows } = await db.query(
    `INSERT INTO scan_events
       (parcel_id, event_type, scanned_by, actor_role, photo_urls, notes)
     VALUES ($1, 'seal_photo', $2, 'hub_agent', ARRAY[$3]::text[], $4)
     RETURNING id, created_at`,
    [parcelId, userId, photoUrl, notes]
  );
  const { rows: countRows } = await db.query(
    `SELECT COALESCE(SUM(cardinality(photo_urls)), 0) AS photo_count
       FROM scan_events WHERE parcel_id = $1 AND event_type = 'seal_photo'`,
    [parcelId]
  );
  return {
    status: 201,
    body: {
      message: `Photo de scellé enregistrée pour ${parcels[0].reference}`,
      event_id: rows[0].id,
      photo_url: photoUrl,
      photo_count: Number(countRows[0].photo_count),
      recorded_at: rows[0].created_at,
    },
  };
}

module.exports = {
  receiveParcel,
  receiveSupplierPackageCommand,
  createOperatorUnitCommand,
  transitionOperatorUnitCommand,
  moveAllocationCommand,
  revalidateQuarantineCommand,
  recordPhysicalOutcomeCommand,
  packParcel,
  sealParcel,
  batchScan,
  recordVolume,
  computeVolumeTasks,
  recordSealPhoto,
};
