'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/scan-engine-extras.test.js
 * Tests de caractérisation complémentaires — services/scan-engine.js (Lot C6)
 *
 * L'essentiel de processScan est couvert dans scan-engine.test.js (7 tests).
 * Ce fichier couvre :
 *   _getStatusOrder    — ordre des statuts (fonction pure @test-only)
 *   _checkSequence     — séquence scan vs statut colis (fonction pure @test-only)
 *   _buildQtySnapshot  — snapshot quantités (fonction pure @test-only)
 *   correctScanEvent   — correction d'événement (transaction DB)
 *   getParcelTrace     — lecture traçabilité complète (pool.query direct)
 */

jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../services/notification-service', () => ({
  notifyParcelScan: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn().mockResolvedValue({ success: true }),
}));

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } =
  require('../integration/test-harness/mock-db');

const pool = require('../../db');
const {
  _getStatusOrder,
  _checkSequence,
  _buildQtySnapshot,
  correctScanEvent,
  getParcelTrace,
  ScanError,
} = require('../../services/scan-engine');

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════
// 1. _getStatusOrder
// ════════════════════════════════════════════════════════════════

describe('_getStatusOrder', () => {
  it('ordonne les statuts logistiques correctement', () => {
    expect(_getStatusOrder('draft')).toBeLessThan(_getStatusOrder('preparation'));
    expect(_getStatusOrder('preparation')).toBeLessThan(_getStatusOrder('shipped'));
    expect(_getStatusOrder('shipped')).toBeLessThan(_getStatusOrder('arrived'));
    expect(_getStatusOrder('arrived')).toBeLessThanOrEqual(_getStatusOrder('available'));
    expect(_getStatusOrder('available')).toBeLessThan(_getStatusOrder('collected'));
  });

  it('cancelled a une valeur négative (hors séquence)', () => {
    expect(_getStatusOrder('cancelled')).toBe(-1);
  });

  it('statut inconnu retourne 0 (fallback draft)', () => {
    expect(_getStatusOrder('inconnu_xyz')).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 2. _checkSequence
// ════════════════════════════════════════════════════════════════

describe('_checkSequence', () => {
  it('retourne null pour une transition valide (preparation → shipped)', () => {
    expect(_checkSequence('preparation', 'shipped')).toBeNull();
  });

  it('retourne severity=critical pour customer_collected depuis preparation', () => {
    const r = _checkSequence('preparation', 'customer_collected');
    expect(r).not.toBeNull();
    expect(r.severity).toBe('critical');
  });

  it('retourne severity=critical pour customer_collected depuis draft', () => {
    const r = _checkSequence('draft', 'customer_collected');
    expect(r.severity).toBe('critical');
  });

  it('retourne severity=critical pour scan rétrograde depuis statut terminal (collected)', () => {
    // collected (getStatusOrder=6) avec SCAN_FLOW['packed'].order=3 → backward + terminal → critical
    const r = _checkSequence('collected', 'packed');
    expect(r).not.toBeNull();
    expect(r.severity).toBe('critical');
  });

  it('retourne severity=high pour scan rétrograde non-terminal (arrived → packed)', () => {
    // arrived (getStatusOrder=5) avec SCAN_FLOW['packed'].order=3 → backward + non-terminal → high
    const r = _checkSequence('arrived', 'packed');
    expect(r).not.toBeNull();
    expect(r.severity).toBe('high');
  });

  it('retourne null pour event_type inconnu (pas dans SCAN_FLOW)', () => {
    expect(_checkSequence('preparation', 'event_inexistant')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
// 3. _buildQtySnapshot
// ════════════════════════════════════════════════════════════════

describe('_buildQtySnapshot', () => {
  it('construit un snapshot par item_id', () => {
    const items = [
      { id: 'i1', qty_allocated: 3, qty_packed: 3, qty_shipped: 2, qty_received: 1, qty_collected: 0 },
      { id: 'i2', qty_allocated: 1, qty_packed: 0, qty_shipped: 0, qty_received: 0, qty_collected: 0 },
    ];
    const snap = _buildQtySnapshot(items);
    expect(snap['i1'].allocated).toBe(3);
    expect(snap['i1'].shipped).toBe(2);
    expect(snap['i2'].packed).toBe(0);
  });

  it('valeurs manquantes tombent à 0', () => {
    const snap = _buildQtySnapshot([{ id: 'x' }]);
    expect(snap['x'].allocated).toBe(0);
    expect(snap['x'].collected).toBe(0);
  });

  it('liste vide → objet vide', () => {
    expect(_buildQtySnapshot([])).toEqual({});
  });
});

// ════════════════════════════════════════════════════════════════
// 4. correctScanEvent
// ════════════════════════════════════════════════════════════════

describe('correctScanEvent', () => {
  it('marque l\'original reversed et crée un événement correctif', async () => {
    const originalEvent = {
      id: 'event-orig-001',
      parcel_id: 'parcel-001',
      order_id: 'order-001',
      event_type: 'shipped',
      qty_before: { i1: { shipped: 0 } },
      qty_after: { i1: { shipped: 2 } },
    };

    const client = makeClient([
      // SELECT scan_events
      { rows: [originalEvent] },
      // UPDATE scan_events SET status = 'reversed'
      { rows: [], rowCount: 1 },
      // INSERT scan_events (logScanEvent) RETURNING *
      { rows: [{ id: 'event-corr-001', event_type: 'correction', status: 'applied' }] },
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await correctScanEvent('event-orig-001', {
      corrected_by: 'admin-001',
      actor_role: 'admin',
      reason: 'Erreur de scan au hub',
    });

    expect(result.id).toBe('event-corr-001');
    expect(result.event_type).toBe('correction');
    expectTransactionCommitted(client);
  });

  it('lève ScanError EVENT_NOT_FOUND si l\'événement original introuvable', async () => {
    const client = makeClient([
      { rows: [] }, // SELECT → vide
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(
      correctScanEvent('event-inexistant', { corrected_by: 'admin' })
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });

    expectTransactionRolledBack(client);
  });
});

// ════════════════════════════════════════════════════════════════
// 5. getParcelTrace
// ════════════════════════════════════════════════════════════════

describe('getParcelTrace', () => {
  const PARCEL_ID = 'parcel-001';

  it('retourne null si colis introuvable', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getParcelTrace(PARCEL_ID);
    expect(result).toBeNull();
  });

  it('retourne la trace complète avec items, timeline, incidents', async () => {
    const parcel = { id: PARCEL_ID, order_id: 'order-001', status: 'shipped', reference: 'COLIS-001' };
    pool.query
      .mockResolvedValueOnce({ rows: [parcel] })           // parcel + order + relais
      .mockResolvedValueOnce({ rows: [{ id: 'item-001' }] }) // parcel_items
      .mockResolvedValueOnce({ rows: [                     // scan_events timeline
        { id: 'e1', event_type: 'packed', status: 'applied' },
        { id: 'e2', event_type: 'shipped', status: 'applied' },
      ]})
      .mockResolvedValueOnce({ rows: [] });                // incidents (aucun)

    const result = await getParcelTrace(PARCEL_ID);

    expect(result.parcel.id).toBe(PARCEL_ID);
    expect(result.items).toHaveLength(1);
    expect(result.timeline).toHaveLength(2);
    expect(result.timeline[0].event_type).toBe('packed');
    expect(result.incidents).toHaveLength(0);
  });
});
