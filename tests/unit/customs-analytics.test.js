'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/customs-analytics.test.js
 * Couvre services/customs-analytics.js
 */
const { getShipmentAnalytics, listShipmentsAnalytics, getTrendAnalytics } = require('../../services/customs-analytics');

function makePool(rows) {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

function rawRow(overrides = {}) {
  return {
    shipment_id: 's1', reference: 'CS-1', shipment_date: '2026-01-01',
    transitaire_name: 'DHL', transport_mode: 'air', status: 'declared', declared_at: '2026-01-02',
    actual_customs_kmf: 100000, actual_rate_pct: 15,
    declared_cif_kmf: 666666,
    expected_customs_kmf: 90000,
    declared_avg_rate_pct: 13.5,
    classified_cif_kmf: 600000,
    total_items_cif_kmf: 600000,
    total_items: 10,
    unclassified_items: 0,
    defaulted_items: 0,
    parcel_count: 3,
    ...overrides,
  };
}

describe('getShipmentAnalytics', () => {
  it('expedition introuvable → retourne null', async () => {
    const pool = makePool([]);
    const result = await getShipmentAnalytics(pool, 's-x');
    expect(result).toBeNull();
  });

  it('nominal → calcule ecart_kmf, ecart_pct, ecart_direction, confidence', async () => {
    const pool = makePool([rawRow()]);
    const result = await getShipmentAnalytics(pool, 's1');
    expect(result.shipment_id).toBe('s1');
    expect(result.ecart_kmf).toBe(10000); // 100000 - 90000
    expect(result.ecart_pct).toBeCloseTo(11.11, 1);
    expect(result.ecart_direction).toBe('agent_above_declared');
    expect(result.confidence).toBe('high'); // 100% classifie (unclassified=0)
  });

  it('expected_customs_kmf null (aucun item classifie) → ecart null, direction unknown', async () => {
    const pool = makePool([rawRow({ expected_customs_kmf: null, unclassified_items: 10 })]);
    const result = await getShipmentAnalytics(pool, 's1');
    expect(result.expected_customs_kmf).toBeNull();
    expect(result.ecart_kmf).toBeNull();
    expect(result.ecart_pct).toBeNull();
    expect(result.ecart_direction).toBe('unknown');
    expect(result.confidence).toBe('low'); // 0% classifie
  });

  it('actual == expected → ecart_direction on_target', async () => {
    const pool = makePool([rawRow({ actual_customs_kmf: 90000, expected_customs_kmf: 90000 })]);
    const result = await getShipmentAnalytics(pool, 's1');
    expect(result.ecart_kmf).toBe(0);
    expect(result.ecart_direction).toBe('on_target');
  });

  it('actual < expected → agent_below_declared', async () => {
    const pool = makePool([rawRow({ actual_customs_kmf: 50000, expected_customs_kmf: 90000 })]);
    const result = await getShipmentAnalytics(pool, 's1');
    expect(result.ecart_direction).toBe('agent_below_declared');
  });

  it('coverage 50-89% → confidence medium', async () => {
    const pool = makePool([rawRow({ total_items: 10, unclassified_items: 4 })]); // 60% classifie
    const result = await getShipmentAnalytics(pool, 's1');
    expect(result.confidence).toBe('medium');
  });

  it('total_items = 0 → coverage_pct = 0 sans division par zero', async () => {
    const pool = makePool([rawRow({ total_items: 0, unclassified_items: 0 })]);
    const result = await getShipmentAnalytics(pool, 's1');
    expect(result.coverage.pct).toBe(0);
    expect(result.confidence).toBe('low');
  });
});

describe('listShipmentsAnalytics', () => {
  it('aucun filtre → pas de clause WHERE additionnelle', async () => {
    const pool = makePool([]);
    await listShipmentsAnalytics(pool, {});
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/AND cs\.shipment_date/);
    expect(params).toEqual([]);
  });

  it('filtres from/to/transitaire → construit le WHERE et les params correctement', async () => {
    const pool = makePool([]);
    await listShipmentsAnalytics(pool, { from: '2026-01-01', to: '2026-02-01', transitaire: 'DHL' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('cs.shipment_date >= $1');
    expect(sql).toContain('cs.shipment_date <= $2');
    expect(sql).toContain('cs.transitaire_name ILIKE $3');
    expect(params).toEqual(['2026-01-01', '2026-02-01', '%DHL%']);
  });

  it('aucune expedition → tableau vide (pas de crash)', async () => {
    const pool = makePool([]);
    const result = await listShipmentsAnalytics(pool);
    expect(result).toEqual([]);
  });

  it('plusieurs expeditions → chacune enrichie', async () => {
    const pool = makePool([rawRow({ shipment_id: 's1' }), rawRow({ shipment_id: 's2' })]);
    const result = await listShipmentsAnalytics(pool, {});
    expect(result).toHaveLength(2);
    expect(result.map(r => r.shipment_id)).toEqual(['s1', 's2']);
  });
});

describe('getTrendAnalytics', () => {
  it('aucune donnee → tableau vide', async () => {
    const pool = makePool([]);
    const result = await getTrendAnalytics(pool, {});
    expect(result).toEqual([]);
  });

  it('months par defaut = 12 quand non fourni', async () => {
    const pool = makePool([]);
    await getTrendAnalytics(pool);
    const [, params] = pool.query.mock.calls[0];
    expect(params).toEqual([12]);
  });

  it('months personnalise → transmis a la requete', async () => {
    const pool = makePool([]);
    await getTrendAnalytics(pool, { months: 6 });
    const [, params] = pool.query.mock.calls[0];
    expect(params).toEqual([6]);
  });

  it('nominal → renvoie les lignes telles que retournees par la requete agregee', async () => {
    const rows = [{ month: '2026-01', shipments: 5, avg_actual_rate_pct: 15.2 }];
    const pool = makePool(rows);
    const result = await getTrendAnalytics(pool, { months: 3 });
    expect(result).toEqual(rows);
  });
});
