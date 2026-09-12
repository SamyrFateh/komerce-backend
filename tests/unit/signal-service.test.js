'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — signal-service.js
 *
 * Invariants couverts :
 *   upsertSignal        : identité active type + market + entity, 16 paramètres
 *   autoResolveSignals  : ne résout que le scope exact global ou Market ID
 *   expireOldSignals    : expiration cross-scope légitime
 *   generateSignals     : generateurs historiques globaux inchangés
 */

let mockQuery;
jest.mock('../../db', () => ({
  get query() { return mockQuery; }
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

beforeEach(() => {
  mockQuery = jest.fn();
  jest.resetModules();
});

function loadService() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
  jest.mock('../../utils/logger', () => ({
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  }));
  return require('../../services/signal-service');
}

describe('upsertSignal', () => {
  test('appelle db.query avec 16 paramètres et garde le scope global explicite', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'sig-1' }] });
    const { upsertSignal } = loadService();
    const result = await upsertSignal({
      signal_type: 'parcel_blocked', severity: 'critical', title: 'Colis bloqué',
      entity_type: 'parcel', entity_id: 'parcel-uuid',
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO signals/);
    expect(sql).toContain('market_id IS NOT DISTINCT FROM $16');
    expect(sql).toContain('ON CONFLICT (signal_type, market_id, entity_type, entity_id)');
    expect(sql).toContain("WHERE status IN ('open','acknowledged','snoozed')");
    expect(sql).toContain("WHEN signals.status = 'snoozed' AND signals.snoozed_until <= NOW() THEN 'open'");
    expect(params).toHaveLength(16);
    expect(params[15]).toBeNull();
    expect(result).toEqual({ id: 'sig-1' });
  });

  test('un market_id résolu serveur participe à l’identité du fait actif', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'sig-market' }] });
    const { upsertSignal } = loadService();
    await upsertSignal({ signal_type: 'best_seller_local_unavailable', title: 'X', market_id: 'market-cm' });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[15]).toBe('market-cm');
  });

  test('les valeurs par défaut sont appliquées', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'sig-2' }] });
    const { upsertSignal } = loadService();
    await upsertSignal({ signal_type: 'test', title: 'T' });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe('warning');
    expect(params[4]).toBe('signal-service');
    expect(params[8]).toBe('admin');
  });
});

describe('autoResolveSignals', () => {
  test('sans entityIds → UPDATE du scope global uniquement', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 3 });
    const { autoResolveSignals } = loadService();
    await autoResolveSignals('parcel_blocked', []);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE signals/);
    expect(sql).toMatch(/status = 'resolved'/);
    expect(sql).toContain('market_id IS NOT DISTINCT FROM $2');
    expect(params).toEqual(['parcel_blocked', null]);
    expect(sql).not.toMatch(/entity_id != ALL/);
  });

  test('avec entityIds → reste dans le scope global par défaut', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 1 });
    const { autoResolveSignals } = loadService();
    await autoResolveSignals('cash_expiring', ['id-1', 'id-2']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/entity_id != ALL/);
    expect(sql).toContain('market_id IS NOT DISTINCT FROM $3');
    expect(params).toEqual(['cash_expiring', ['id-1', 'id-2'], null]);
  });

  test('un auto-resolve market ne peut pas toucher un autre marché', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 1 });
    const { autoResolveSignals } = loadService();
    await autoResolveSignals('best_seller_local_unavailable', ['product-1'], 'market-cm');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('market_id IS NOT DISTINCT FROM $3');
    expect(params).toEqual(['best_seller_local_unavailable', ['product-1'], 'market-cm']);
  });
});

describe('expireOldSignals', () => {
  test('exécute UPDATE signals SET status=expired et retourne rowCount', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 5 });
    const { expireOldSignals } = loadService();
    const n = await expireOldSignals();
    expect(n).toBe(5);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/status = 'expired'/);
    expect(sql).toMatch(/expires_at < NOW/);
  });

  test('retourne 0 si rowCount undefined', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: undefined });
    const { expireOldSignals } = loadService();
    expect(await expireOldSignals()).toBe(0);
  });
});

describe('generateSignals', () => {
  test('expire d’abord les signaux puis appelle chaque generator', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { generateSignals } = loadService();
    const result = await generateSignals(['parcel_blocked']);
    expect(result.expired).toBe(2);
    expect(result.generators).toHaveProperty('parcel_blocked');
  });

  test('un type inconnu retourne une erreur descriptive', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const { generateSignals } = loadService();
    const result = await generateSignals(['nonexistent_type']);
    expect(result.generators.nonexistent_type).toMatchObject({ error: expect.stringContaining('Unknown generator') });
  });

  test('sans argument, lance tous les generators connus', async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const { generateSignals, GENERATORS } = loadService();
    const knownTypes = Object.keys(GENERATORS);
    expect(knownTypes.length).toBeGreaterThan(0);
    const result = await generateSignals();
    knownTypes.forEach(t => expect(result.generators).toHaveProperty(t));
  });

  test('une erreur dans un generator est non-fatale', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockRejectedValueOnce(new Error('DB down'))
      .mockResolvedValue({ rowCount: 0, rows: [] });
    const { generateSignals } = loadService();
    const result = await generateSignals(['parcel_blocked']);
    expect(result.generators.parcel_blocked).toMatchObject({ generated: 0 });
  });
});

describe('GENERATORS.parcel_blocked', () => {
  test('aucune ligne → generated:0 et autoResolve global', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.parcel_blocked();
    expect(result).toEqual({ generated: 0, resolved: 0 });
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).not.toMatch(/entity_id != ALL/);
    expect(params).toEqual(['parcel_blocked', null]);
  });

  test('severity critical si days_stuck > 7, recommandation escalade, résumé avec référence', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'p1', tracking_number: 'TRK1', status: 'in_transit', days_stuck: 9, reference: 'CMD-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.parcel_blocked();
    expect(result.generated).toBe(1);
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('critical');
    expect(params[2]).toMatch(/Colis bloqué — TRK1/);
    expect(params[3]).toMatch(/CMD-1/);
    expect(params[11]).toMatch(/escalader/);
    expect(params[15]).toBeNull();
  });

  test('severity warning si 5 < days_stuck <= 7', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'p1', tracking_number: null, status: 'available', days_stuck: 6 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.parcel_blocked();
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('warning');
    expect(params[2]).toBe('Colis bloqué');
    expect(params[3]).not.toMatch(/cmd/);
  });

  test('severity info si days_stuck <= 5', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'p1', tracking_number: 'TRK2', status: 'available', days_stuck: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.parcel_blocked();
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('info');
    expect(params[11]).toMatch(/Vérifier le suivi/);
  });

  test('erreur DB → catch non-fatal', async () => {
    mockQuery = jest.fn().mockRejectedValueOnce(new Error('db down'));
    const { GENERATORS } = loadService();
    expect(await GENERATORS.parcel_blocked()).toEqual({ generated: 0, error: 'db down' });
  });
});

describe('GENERATORS.cash_expiring', () => {
  test('aucune ligne → generated:0', async () => {
    mockQuery = jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    expect(await GENERATORS.cash_expiring()).toEqual({ generated: 0 });
  });

  test('severity critical si days_pending > 10, titre avec montant formaté, résumé avec référence', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'cc1', order_id: 'o1', amount: 150000, relay_id: 'r1', days_pending: 12, reference: 'CMD-2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.cash_expiring();
    expect(result.generated).toBe(1);
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('critical');
    expect(params[2]).toContain(`${(150000).toLocaleString('fr-FR')} KMF`);
    expect(params[3]).toMatch(/CMD-2/);
  });

  test('severity warning si days_pending <= 10', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'cc1', order_id: 'o1', amount: null, relay_id: 'r1', days_pending: 6 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.cash_expiring();
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('warning');
    expect(params[2]).toMatch(/0 KMF/);
    expect(params[3]).not.toMatch(/cmd/);
  });

  test('erreur DB → catch non-fatal', async () => {
    mockQuery = jest.fn().mockRejectedValueOnce(new Error('db down'));
    const { GENERATORS } = loadService();
    expect(await GENERATORS.cash_expiring()).toEqual({ generated: 0, error: 'db down' });
  });
});

describe('LOT 4H truth generators', () => {
  test('les trois pseudo-vérités historiques ne sont plus des generators actifs', () => {
    const { GENERATORS } = loadService();
    expect(GENERATORS).not.toHaveProperty('stock_rupture');
    expect(GENERATORS).not.toHaveProperty('margin_drift');
    expect(GENERATORS).not.toHaveProperty('dispute_sensitive');
  });

  test('retire les anciens signaux actifs sans toucher la donnée métier', async () => {
    mockQuery = jest.fn().mockResolvedValueOnce({ rowCount: 3 });
    const { retireObsoleteSignalTypes } = loadService();
    expect(await retireObsoleteSignalTypes()).toBe(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE signals/);
    expect(sql).toContain("status IN ('open','acknowledged','snoozed')");
    expect(params[0]).toEqual(['stock_rupture', 'margin_drift', 'dispute_sensitive']);
  });

  test('ordered_without_purchase_order utilise ordered + PO active + fenêtre 15 min', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-PO', minutes_waiting: 37 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.ordered_without_purchase_order();
    expect(result.generated).toBe(1);
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain("o.status = 'ordered'");
    expect(selectSql).toContain("INTERVAL '15 minutes'");
    expect(selectSql).toContain('FROM purchase_orders po');
    const [, params] = mockQuery.mock.calls[1];
    expect(params[0]).toBe('ordered_without_purchase_order');
    expect(params[9]).toBe('order');
    expect(params[10]).toBe('o1');
  });

  test('purchase_order_overreceived compare received_qty à la vraie colonne qty', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o2', reference: 'CMD-OVER', po_count: 2, excess_qty: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's2' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.purchase_order_overreceived();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('po.received_qty > po.qty');
    expect(selectSql).not.toContain('po.quantity');
    const [, params] = mockQuery.mock.calls[1];
    expect(params[0]).toBe('purchase_order_overreceived');
    expect(params[1]).toBe('critical');
  });

  test('purchase_order_receipt_stuck exige toutes les PO complètes et horodatées', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o3', reference: 'CMD-STUCK', po_count: 2, minutes_stuck: 31 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's3' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.purchase_order_receipt_stuck();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain("o.status = 'ordered'");
    expect(selectSql).toContain('BOOL_AND(po.received_qty >= po.qty AND po.hub_received_at IS NOT NULL)');
    expect(selectSql).toContain("INTERVAL '15 minutes'");
  });

  test('pickup_overdue utilise available_at, pas updated_at', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o4', reference: 'CMD-PICK', days_waiting: 9 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's4' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.pickup_overdue();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('o.available_at');
    expect(selectSql).toContain("INTERVAL '7 days'");
    expect(selectSql).not.toContain('o.updated_at');
  });

  test('preparation_stuck utilise preparation_at, pas updated_at', async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o5', reference: 'CMD-PREP', days_stuck: 6 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's5' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.preparation_stuck();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('o.preparation_at');
    expect(selectSql).toContain("INTERVAL '4 days'");
    expect(selectSql).not.toContain('o.updated_at');
  });

  test('chaque nouveau generator auto-résout le signal global quand sa condition disparaît', async () => {
    const names = ['ordered_without_purchase_order', 'purchase_order_overreceived', 'purchase_order_receipt_stuck', 'pickup_overdue', 'preparation_stuck'];
    for (const name of names) {
      mockQuery = jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rowCount: 1 });
      const { GENERATORS } = loadService();
      const result = await GENERATORS[name]();
      expect(result.generated).toBe(0);
      const [resolveSql, params] = mockQuery.mock.calls[1];
      expect(resolveSql).toContain("status = 'resolved'");
      expect(params).toEqual([name, null]);
    }
  });
});
