'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcelSync.test.js
 * Couvre utils/parcelSync.js
 *
 * Source de vérité unique pour orders.status après un scan (v3.0 MACHINE).
 * Principes testés : SAFE (jamais de throw via safeSyncScanToParcels),
 * IDEMPOTENT, FORWARD ONLY, LEGACY SAFE (pas de parcels → no-op).
 */

const mockComputeOrderStatus = jest.fn();
jest.mock('../../utils/parcels', () => ({
  computeOrderStatus: (...args) => mockComputeOrderStatus(...args),
  STATUS_WEIGHT: {
    cancelled: -1, draft: 0, preparation: 1, shipped: 2,
    in_transit: 3, arrived: 4, available: 5, collected: 6,
  },
  PARCEL_STATUSES: {
    DRAFT: 'draft', PREPARATION: 'preparation', SHIPPED: 'shipped',
    IN_TRANSIT: 'in_transit', ARRIVED: 'arrived', AVAILABLE: 'available',
    COLLECTED: 'collected', CANCELLED: 'cancelled',
  },
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const {
  syncScanToParcels, safeSyncScanToParcels, STEP_TO_PARCEL, STEP_TO_ORDER_STATUS,
} = require('../../utils/parcelSync');

beforeEach(() => {
  jest.clearAllMocks();
  mockTransitionOrderStatus.mockResolvedValue({ newStatus: 'in_transit' });
  mockComputeOrderStatus.mockReturnValue('in_transit');
});

describe('syncScanToParcels — step inconnu', () => {
  it('step non mappé → no-op, aucune requête DB', async () => {
    const result = await syncScanToParcels({ order_id: 'o1', step: 'unknown_step', scan_id: 's1' });
    expect(result).toEqual({ synced: false, parcelsUpdated: 0, orderStatus: null });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});

describe('syncScanToParcels — legacy safe (pas de parcels)', () => {
  it('commande sans order_item_id et sans parcels → no-op', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const result = await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' });
    expect(result).toEqual({ synced: false, parcelsUpdated: 0, orderStatus: null });
  });

  it('scan article spécifique sans parcel trouvé → no-op', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const result = await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1', order_item_id: 'item-1' });
    expect(result).toEqual({ synced: false, parcelsUpdated: 0, orderStatus: null });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('JOIN parcel_items pi ON pi.parcel_id = p.id');
    expect(params).toEqual(['item-1']);
  });

  it('scan commande entière → SELECT par order_id', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('WHERE order_id = $1 AND status != \'cancelled\'');
    expect(params).toEqual(['o1']);
  });
});

describe('syncScanToParcels — forward only', () => {
  it('nouveau statut moins avancé (poids inférieur) → parcel non mis à jour', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', status: 'in_transit' }] }) // déjà in_transit (poids 3)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE scans (lien scan→parcel, fait même si pas avancé)
      .mockResolvedValueOnce({ rows: [{ status: 'in_transit', type: 'standard' }] }); // allParcels (recompute)

    const result = await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' }); // shipped = poids 2 < 3
    expect(result.parcelsUpdated).toBe(0);
    const updateCall = mockDbQuery.mock.calls.find(([sql]) => sql.includes('UPDATE parcels'));
    expect(updateCall).toBeUndefined();
  });

  it('même statut (poids égal) → pas de mise à jour (idempotent)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', status: 'shipped' }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE scans
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', type: 'standard' }] });

    const result = await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' });
    expect(result.parcelsUpdated).toBe(0);
  });

  it('nouveau statut plus avancé → parcel mis à jour + event tracé', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', status: 'preparation' }] }) // poids 1
      .mockResolvedValueOnce({ rows: [] }) // UPDATE parcels
      .mockResolvedValueOnce({ rows: [] }) // INSERT parcel_events
      .mockResolvedValueOnce({ rows: [] }) // UPDATE scans (lien scan→parcel)
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', type: 'standard' }] }); // allParcels

    const result = await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1', scanned_by: 'u1', notes: 'note test' });
    expect(result.parcelsUpdated).toBe(1);

    const updateCall = mockDbQuery.mock.calls.find(([sql]) => sql.includes('UPDATE parcels'));
    expect(updateCall[0]).toContain('shipped_at');
    expect(updateCall[1]).toEqual(['shipped', 'parcel-1']);

    const eventCall = mockDbQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO parcel_events'));
    expect(eventCall[1]).toEqual(['parcel-1', 'shipped', 'u1', 2, 'note test', JSON.stringify({ step: 'shipped', from: 'preparation', scan_id: 's1' })]);
  });
});

describe('syncScanToParcels — plusieurs parcels', () => {
  it('met à jour seulement les parcels en retard, lie le scan au premier parcel', async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'parcel-1', status: 'preparation' }, // poids 1 → sera mis à jour
          { id: 'parcel-2', status: 'shipped' },     // poids 2 = poids cible → skip
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE parcel-1
      .mockResolvedValueOnce({ rows: [] }) // INSERT event parcel-1
      .mockResolvedValueOnce({ rows: [] }) // UPDATE scans → lien au firstParcelId (parcel-1)
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', type: 'standard' }, { status: 'shipped', type: 'standard' }] });

    const result = await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' });
    expect(result.parcelsUpdated).toBe(1);

    const scanLinkCall = mockDbQuery.mock.calls.find(([sql]) => sql.includes('UPDATE scans SET parcel_id'));
    expect(scanLinkCall[1]).toEqual(['parcel-1', 's1']);
  });

  it('scan_id absent → pas de lien scan→parcel', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', type: 'standard' }] });

    await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: null });
    const scanLinkCall = mockDbQuery.mock.calls.find(([sql]) => sql.includes('UPDATE scans SET parcel_id'));
    expect(scanLinkCall).toBeUndefined();
  });
});

describe('syncScanToParcels — recompute + transition machine', () => {
  it('appelle computeOrderStatus avec tous les parcels de la commande', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', type: 'standard' }] });
    mockComputeOrderStatus.mockReturnValue('shipped');
    mockTransitionOrderStatus.mockResolvedValue({ newStatus: 'shipped' });

    const result = await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1', scanned_by: 'u1' });
    expect(mockComputeOrderStatus).toHaveBeenCalledWith([{ status: 'shipped', type: 'standard' }]);
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith({
      orderId: 'o1',
      newStatus: 'shipped',
      actor: { id: 'u1', role: 'system' },
      source: 'scan',
      scanId: 's1',
      note: `[scan] step=shipped`,
      dbClient: expect.anything(),
    });
    expect(result.orderStatus).toBe('shipped');
  });

  it('notes fournies → utilisées comme note de transition au lieu du fallback', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', type: 'standard' }] });

    await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1', notes: 'note perso' });
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ note: 'note perso' }));
  });

  it('résultat final utilise transition.newStatus si fourni (peut différer du recompute)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', type: 'standard' }] });
    mockComputeOrderStatus.mockReturnValue('shipped');
    mockTransitionOrderStatus.mockResolvedValue({ newStatus: null }); // machine noop sans newStatus

    const result = await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' });
    // fallback sur orderStatus calculé si machine ne renvoie pas newStatus
    expect(result.orderStatus).toBe('shipped');
  });

  it('utilise dbClient fourni pour toutes les requêtes au lieu du pool', async () => {
    const dbClient = { query: jest.fn() };
    dbClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', type: 'standard' }] });

    await syncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' }, dbClient);
    expect(dbClient.query).toHaveBeenCalled();
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ dbClient }));
  });
});

describe('safeSyncScanToParcels — wrapper SAFE', () => {
  it('délègue à syncScanToParcels et retourne son résultat en cas de succès', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }); // pas de parcels → no-op
    const result = await safeSyncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' });
    expect(result).toEqual({ synced: false, parcelsUpdated: 0, orderStatus: null });
  });

  it('erreur dans syncScanToParcels → catch, retourne un résultat neutre, jamais de throw', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db cassee'));
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT alerts (fire-and-forget)
    const result = await safeSyncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' });
    expect(result).toEqual({ synced: false, parcelsUpdated: 0, orderStatus: null });
  });

  it('erreur → insère une alerte elevated (fire-and-forget) avec le détail', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db cassee'));
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT alerts
    await safeSyncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' });
    const alertCall = mockDbQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO alerts'));
    expect(alertCall).toBeDefined();
    expect(alertCall[1]).toEqual([
      'parcel_sync_failed',
      'order',
      'o1',
      'medium',
      'safeSyncScanToParcels failed — order o1 step shipped',
      'scan_id=s1 error=db cassee',
    ]);
  });

  it("l'échec de l'INSERT alerte lui-même ne fait jamais throw", async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db cassee'));
    mockDbQuery.mockRejectedValueOnce(new Error('alerts table down'));
    await expect(safeSyncScanToParcels({ order_id: 'o1', step: 'shipped', scan_id: 's1' })).resolves.toEqual({
      synced: false, parcelsUpdated: 0, orderStatus: null,
    });
  });
});

describe('exports — STEP_TO_PARCEL / STEP_TO_ORDER_STATUS', () => {
  it('STEP_TO_PARCEL couvre les 6 steps connus avec status + tsCol', () => {
    expect(Object.keys(STEP_TO_PARCEL).sort()).toEqual(
      ['collected', 'hub_preparation', 'in_transit', 'preparation', 'relais_received', 'shipped'].sort()
    );
    expect(STEP_TO_PARCEL.shipped).toEqual({ status: 'shipped', tsCol: 'shipped_at', orderTsCol: 'shipped_at' });
    expect(STEP_TO_PARCEL.preparation.orderTsCol).toBeNull();
  });

  it('STEP_TO_ORDER_STATUS mappe preparation/hub_preparation vers "preparation"', () => {
    expect(STEP_TO_ORDER_STATUS.preparation).toBe('preparation');
    expect(STEP_TO_ORDER_STATUS.hub_preparation).toBe('preparation');
    expect(STEP_TO_ORDER_STATUS.relais_received).toBe('available');
  });
});
