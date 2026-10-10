'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));

const { countRelayParcels } = require('../../services/operations-relay-projection');

beforeEach(() => mockQuery.mockReset());

test('LIVE-06 — une seule requête colis, global sans filtre', async () => {
  mockQuery.mockResolvedValue({ rows: [{ available: '6', in_transit: '2' }] });
  await expect(countRelayParcels()).resolves.toEqual({ available: 6, in_transit: 2 });
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain("p.status NOT IN ('cancelled', 'collected')");
  expect(sql).toContain("COUNT(*) FILTER (WHERE p.status = 'available')");
  expect(params).toEqual([null, null]);
});

test('scope marché exact et scope relais passent en paramètres', async () => {
  mockQuery.mockResolvedValue({ rows: [{ available: 0, in_transit: 0 }] });
  await countRelayParcels({ marketIds: ['m1'], relaisId: 'r1' });
  expect(mockQuery.mock.calls[0][1]).toEqual([['m1'], 'r1']);
  await countRelayParcels({ marketIds: [] });
  expect(mockQuery.mock.calls[1][1]).toEqual([[], null]);
});

test('le workspace Opérations et les Live importent la même fonction', () => {
  const fs = require('fs');
  for (const f of ['operations-workspace', 'hub-dashboard-queries', 'relay-dashboard-queries']) {
    expect(fs.readFileSync(`${__dirname}/../../services/${f}.js`, 'utf8')).toContain("require('./operations-relay-projection')");
  }
});
