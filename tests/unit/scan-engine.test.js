'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/scan-engine.test.js
 * Tests unitaires de processScan via mocks DB.
 * Les sous-fonctions (_loadScanContext, _validateAndCatchup, _applyEvent, _finalizeAndLog)
 * sont testées indirectement via processScan (non exportées).
 */

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

// ── Mocks modules externes ──────────────────────────────────────
jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));
jest.mock('../../services/notification-service', () => ({
  notifyParcelScan: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn().mockResolvedValue({ success: true })
}));

const pool = require('../../db');
const { processScan, ScanError } = require('../../services/scan-engine');

// ── Fixtures ────────────────────────────────────────────────────
const PARCEL_ID = 'parcel-uuid-001';
const ORDER_ID  = 'order-uuid-001';

function makeParcel(overrides = {}) {
  return {
    id: PARCEL_ID,
    order_id: ORDER_ID,
    order_ref: 'CMD-001',
    status: 'preparation',
    reference: 'COLIS-001',
    expected_weight_kg: null,
    ...overrides
  };
}

function makeParcelItem(overrides = {}) {
  return {
    id: 'item-uuid-001',
    parcel_id: PARCEL_ID,
    order_item_id: 'oi-001',
    qty_allocated: 2,
    qty_packed: 2,
    qty_shipped: 0,
    qty_received: 0,
    qty_collected: 0,
    ...overrides
  };
}

/** Construit le script mock DB pour un scan nominal (shipped depuis preparation) */
function makeNominalScript({ parcel, items, extraAfterItems = [] } = {}) {
  const p = parcel || makeParcel();
  const it = items || [makeParcelItem()];
  return [
    // 1. load parcel
    { rows: [p] },
    // 2. load parcel_items
    { rows: it },
    // (isStepCompleted pour catchup packed — aucun catchup car CATCHUP_MAP['shipped'] = ['packed'])
    { rows: [{ 1: 1 }] }, // packed already done → skip catchup
    // 6. cascadeQuantities (qty_shipped) — UPDATE
    { rows: [], rowCount: 1 },
    // 7. UPDATE parcels SET status = shipped
    { rows: [], rowCount: 1 },
    // 10. SELECT parcel_items après
    { rows: it },
    // 11. INSERT scan_events RETURNING *
    { rows: [{ id: 'event-001' }] },
    // syncOrderFromParcels: UPDATE order_items
    { rows: [], rowCount: 1 },
    // syncOrderFromParcels: SELECT stats parcels
    { rows: [{ active: '1', collected: '0', available: '0', in_transit: '1', pending: '0' }] },
    // 13. SELECT parcels WHERE id
    { rows: [{ ...p, status: 'shipped' }] },
    ...extraAfterItems
  ];
}

function setupPool(client) {
  pool.connect.mockResolvedValue(client);
  // pool.query utilisé par logScanEventDirect (rejets hors transaction)
  pool.query.mockImplementation(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO scan_events')) return { rows: [{ id: 'rejected-event-001' }] };
    return { rows: [] };
  });
}

// ════════════════════════════════════════════════════════════════
// 1. Scan nominal packed → shipped
// ════════════════════════════════════════════════════════════════
describe('processScan — scan nominal (shipped)', () => {
  it('commit la transaction et retourne success=true avec event_id', async () => {
    const client = makeClient(makeNominalScript());
    setupPool(client);

    const result = await processScan({
      parcel_id: PARCEL_ID,
      event_type: 'shipped',
      scanned_by: 'user-001',
      actor_role: 'hub_agent'
    });

    expect(result.success).toBe(true);
    expect(result.event_id).toBe('event-001');
    expect(result.parcel.status).toBe('shipped');
    expectTransactionCommitted(client);
  });
});

// ════════════════════════════════════════════════════════════════
// 2. Colis cancelled → ScanError PARCEL_CANCELLED, event rejected
// ════════════════════════════════════════════════════════════════
describe('processScan — colis cancelled', () => {
  it('rollback + journalise le rejet via pool.query direct', async () => {
    const client = makeClient([
      { rows: [makeParcel({ status: 'cancelled' })] },
      { rows: [makeParcelItem()] }
    ]);
    setupPool(client);

    const result = await processScan({
      parcel_id: PARCEL_ID,
      event_type: 'shipped'
    });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('PARCEL_CANCELLED');
    expect(result.event_id).toBe('rejected-event-001');
    expectTransactionRolledBack(client);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. Séquence critique : customer_collected depuis preparation
// ════════════════════════════════════════════════════════════════
describe('processScan — séquence critique (I-03)', () => {
  it('rejette le scan avec severity=critical, commit sans success', async () => {
    const client = makeClient([
      // load parcel
      { rows: [makeParcel({ status: 'preparation' })] },
      // load items
      { rows: [makeParcelItem()] },
      // createIncident
      { rows: [{ id: 'incident-001' }] },
      // logScanEvent (rejected)
      { rows: [{ id: 'event-rejected-001' }] },
      // 13. SELECT parcel (non atteint — return early)
    ]);
    setupPool(client);

    const result = await processScan({
      parcel_id: PARCEL_ID,
      event_type: 'customer_collected'
    });

    expect(result.success).toBe(false);
    expect(result.event_id).toBe('event-rejected-001');
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].id).toBe('incident-001');
    expectTransactionCommitted(client); // COMMIT même sur rejet séquence
  });
});

// ════════════════════════════════════════════════════════════════
// 4. Smart-catchup déclenché : shipped sans packed préalable
// ════════════════════════════════════════════════════════════════
describe('processScan — smart-catchup (shipped sans packed)', () => {
  it('catchup packed + incident low + scan principal appliqué', async () => {
    const item = makeParcelItem();
    const client = makeClient([
      // load parcel
      { rows: [makeParcel()] },
      // load items
      { rows: [item] },
      // isStepCompleted('packed') → NOT done
      { rows: [] },
      // cascadeQuantities (qty_packed) UPDATE
      { rows: [], rowCount: 1 },
      // SELECT parcel_items après catchup
      { rows: [{ ...item, qty_packed: 2 }] },
      // logScanEvent catchup
      { rows: [{ id: 'catchup-event-001' }] },
      // createIncident catchup (low)
      { rows: [{ id: 'catchup-incident-001' }] },
      // 6. cascadeQuantities (qty_shipped) — event principal
      { rows: [], rowCount: 1 },
      // 7. UPDATE parcels SET status = shipped
      { rows: [], rowCount: 1 },
      // 10. SELECT parcel_items après
      { rows: [{ ...item, qty_packed: 2, qty_shipped: 2 }] },
      // 11. INSERT scan_events
      { rows: [{ id: 'event-main-001' }] },
      // syncOrderFromParcels UPDATE order_items
      { rows: [], rowCount: 1 },
      // syncOrderFromParcels SELECT stats
      { rows: [{ active: '1', collected: '0', available: '0', in_transit: '1', pending: '0' }] },
      // 13. SELECT parcel final
      { rows: [{ ...makeParcel(), status: 'shipped' }] }
    ]);
    setupPool(client);

    const result = await processScan({
      parcel_id: PARCEL_ID,
      event_type: 'shipped'
    });

    expect(result.success).toBe(true);
    expect(result.catchup_events).toHaveLength(1);
    expect(result.catchup_events[0].type).toBe('packed');
    expect(result.catchup_events[0].auto).toBe(true);
    expect(result.incidents.some(i => i.id === 'catchup-incident-001')).toBe(true);
    expectTransactionCommitted(client);
  });
});

// ════════════════════════════════════════════════════════════════
// 5. weight_check avec écart > tolérance → incident weight_mismatch
// ════════════════════════════════════════════════════════════════
describe('processScan — weight_check écart > tolérance', () => {
  it('crée un incident weight_mismatch', async () => {
    const item = makeParcelItem();
    const parcel = makeParcel({ expected_weight_kg: 10.0 });
    const client = makeClient([
      { rows: [parcel] },
      { rows: [item] },
      // weight_check n'a pas de catchup ni de qty_field, pas de cascadeQuantities
      // UPDATE parcels SET actual_weight_kg
      { rows: [], rowCount: 1 },
      // createIncident weight_mismatch
      { rows: [{ id: 'incident-weight-001' }] },
      // SELECT parcel_items après
      { rows: [item] },
      // INSERT scan_events
      { rows: [{ id: 'event-weight-001' }] },
      // syncOrderFromParcels UPDATE
      { rows: [], rowCount: 1 },
      // syncOrderFromParcels SELECT stats
      { rows: [{ active: '1', collected: '0', available: '0', in_transit: '0', pending: '1' }] },
      // SELECT parcel final
      { rows: [parcel] }
    ]);
    setupPool(client);

    const result = await processScan({
      parcel_id: PARCEL_ID,
      event_type: 'weight_check',
      actual_weight_kg: 13.5 // +35% vs 10kg → > 15% tolérance
    });

    expect(result.success).toBe(true);
    expect(result.incidents.some(i => i.id === 'incident-weight-001')).toBe(true);
    expectTransactionCommitted(client);
  });
});

// ════════════════════════════════════════════════════════════════
// 6. Scan idempotent : isStepCompleted retourne true → catchup sauté
// ════════════════════════════════════════════════════════════════
describe('processScan — idempotence catchup (isStepCompleted)', () => {
  it('ne rejoue pas packed si déjà applied en base', async () => {
    const item = makeParcelItem({ qty_packed: 2 });
    const client = makeClient([
      { rows: [makeParcel()] },
      { rows: [item] },
      // isStepCompleted('packed') → ALREADY DONE
      { rows: [{ 1: 1 }] },
      // 6. cascadeQuantities qty_shipped
      { rows: [], rowCount: 1 },
      // 7. UPDATE parcels
      { rows: [], rowCount: 1 },
      // 10. SELECT parcel_items
      { rows: [item] },
      // 11. INSERT scan_events
      { rows: [{ id: 'event-idem-001' }] },
      // syncOrderFromParcels UPDATE
      { rows: [], rowCount: 1 },
      // syncOrderFromParcels SELECT stats
      { rows: [{ active: '1', collected: '0', available: '0', in_transit: '1', pending: '0' }] },
      // SELECT parcel final
      { rows: [makeParcel({ status: 'shipped' })] }
    ]);
    setupPool(client);

    const result = await processScan({
      parcel_id: PARCEL_ID,
      event_type: 'shipped'
    });

    expect(result.success).toBe(true);
    expect(result.catchup_events).toHaveLength(0); // packed sauté car déjà fait
    expectTransactionCommitted(client);
  });
});

// ════════════════════════════════════════════════════════════════
// 7. syncOrderFromParcels : transitionOrderStatus appelée
// ════════════════════════════════════════════════════════════════
describe('processScan — syncOrderFromParcels → transitionOrderStatus', () => {
  it('appelle transitionOrderStatus avec le bon newStatus', async () => {
    const { transitionOrderStatus } = require('../../services/order-status-machine');
    transitionOrderStatus.mockClear();

    const item = makeParcelItem({ qty_packed: 2 });
    const client = makeClient([
      { rows: [makeParcel()] },
      { rows: [item] },
      { rows: [{ 1: 1 }] }, // packed already done
      { rows: [], rowCount: 1 }, // cascadeQuantities
      { rows: [], rowCount: 1 }, // UPDATE parcels status
      { rows: [item] },
      { rows: [{ id: 'event-sync-001' }] },
      { rows: [], rowCount: 1 }, // UPDATE order_items
      { rows: [{ active: '1', collected: '0', available: '0', in_transit: '1', pending: '0' }] },
      { rows: [makeParcel({ status: 'shipped' })] }
    ]);
    setupPool(client);

    await processScan({ parcel_id: PARCEL_ID, event_type: 'shipped' });

    expect(transitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        newStatus: 'in_transit',
        source: 'scan_engine_sync'
      })
    );
  });
});
