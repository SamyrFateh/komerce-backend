/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const { getMarketsSupervision } = require('../../services/dashboard-pilotage-markets');

describe('dashboard-pilotage-markets', () => {
  beforeEach(() => db.query.mockReset());

  test('marché sans commande : zéro calculé (pas absent) ; marché avec incidents seuls conservé ; aucune troncature', async () => {
    const rows = [
      { market_code: 'CM', market_name: 'Cameroun', orders_active: '12', cash_to_confirm: '3', open_incidents: '2' },
      { market_code: 'KM', market_name: 'Comores', orders_active: '0', cash_to_confirm: '0', open_incidents: '1' },
      ...Array.from({ length: 9 }, (_, i) => ({ market_code: `Z${i}`, market_name: `Z${i}`, orders_active: '0', cash_to_confirm: '0', open_incidents: '0' })),
    ];
    db.query.mockResolvedValueOnce({ rows });
    const out = await getMarketsSupervision({});
    expect(out).toHaveLength(11);
    expect(out[0]).toEqual({ market_code: 'CM', market_name: 'Cameroun', orders_active: 12, cash_to_confirm: 3, open_incidents: 2 });
    expect(out[1]).toMatchObject({ market_code: 'KM', orders_active: 0, open_incidents: 1 });
    expect(out[2]).toMatchObject({ orders_active: 0, cash_to_confirm: 0, open_incidents: 0 });
    expect(String(db.query.mock.calls[0][0])).not.toMatch(/\bLIMIT\b/);
    expect(String(db.query.mock.calls[0][0])).toMatch(/FROM markets m\s+LEFT JOIN orders o/);
  });

  test('filtres de période du Pilotage appliqués à la jointure des commandes', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await getMarketsSupervision({ from: '2026-09-21T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' });
    const [sql, params] = db.query.mock.calls[0];
    expect(String(sql)).toMatch(/LEFT JOIN orders o ON o\.market_id = m\.id AND [^]*created_at >= \$1[^]*created_at <= \$2/);
    expect(params.slice(0, 2)).toEqual(['2026-09-21T00:00:00.000Z', '2026-10-21T00:00:00.000Z']);
  });

  test('séparation réel / RCT1 : réel par défaut, RCT1 seul si demandé ; market_id client ignoré', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await getMarketsSupervision({ market_id: 'client-supplied' });
    expect(String(db.query.mock.calls[0][0])).toContain('simulation_scope IS NULL');
    expect(db.query.mock.calls[0][1]).not.toContain('client-supplied');
    db.query.mockClear();
    await getMarketsSupervision({ simulation_scope: 'RCT1' });
    expect(db.query.mock.calls[0][1]).toContain('RCT1');
    expect(String(db.query.mock.calls[0][0])).not.toContain('simulation_scope IS NULL');
  });

  test('seuls les marchés actifs et de cycle ACTIVE sont éligibles', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await getMarketsSupervision({});
    expect(String(db.query.mock.calls[0][0])).toMatch(/m\.is_active = TRUE AND COALESCE\(m\.lifecycle_status, 'ACTIVE'\) = 'ACTIVE'/);
  });
});
