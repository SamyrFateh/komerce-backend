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

  test('projette actives / cash / incidents par marché, incidents absents = 0 réel, sans fabriquer de ligne', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        { market_code: 'CM', market_name: 'Cameroun', orders_active: '12', cash_to_confirm: '3' },
        { market_code: 'CG', market_name: 'Congo', orders_active: '5', cash_to_confirm: '0' },
      ] })
      .mockResolvedValueOnce({ rows: [{ market_code: 'CM', open_incidents: '2' }] });
    const out = await getMarketsSupervision({});
    expect(out).toEqual([
      { market_code: 'CM', market_name: 'Cameroun', orders_active: 12, cash_to_confirm: 3, open_incidents: 2 },
      { market_code: 'CG', market_name: 'Congo', orders_active: 5, cash_to_confirm: 0, open_incidents: 0 },
    ]);
  });

  test('sépare le réel de la recette : réel par défaut, RCT1 seulement si demandé', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await getMarketsSupervision({});
    expect(String(db.query.mock.calls[0][0])).toContain('simulation_scope IS NULL');
    db.query.mockClear();
    await getMarketsSupervision({ simulation_scope: 'RCT1' });
    expect(db.query.mock.calls[0][1]).toContain('RCT1');
  });
});
