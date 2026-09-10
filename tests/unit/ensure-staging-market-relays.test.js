'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../../middleware/require-non-production', () => ({
  resolveRuntimeEnvironment: jest.fn(() => ({ env: 'staging', source: 'KOMERCE_ENV' })),
}));

const db = require('../../db');
const { resolveRuntimeEnvironment } = require('../../middleware/require-non-production');
const {
  PROFILES,
  assertNonProduction,
  ensureCanonicalRelay,
} = require('../../scripts/ensure-staging-market-relays');

beforeEach(() => {
  jest.clearAllMocks();
  resolveRuntimeEnvironment.mockReturnValue({ env: 'staging', source: 'KOMERCE_ENV' });
});

test('CM et CG portent une ville locale explicite, jamais une île KM', () => {
  expect(PROFILES.CM).toMatchObject({ city: 'Yaoundé', name: 'Relais Komerce Yaoundé Centre' });
  expect(PROFILES.CG).toMatchObject({ city: 'Brazzaville', name: 'Relais Komerce Brazzaville Centre' });
});

test('refuse le runtime métier production même si le script est appelé directement', () => {
  resolveRuntimeEnvironment.mockReturnValueOnce({ env: 'production', source: 'KOMERCE_ENV' });
  expect(() => assertNonProduction()).toThrow(/Refusé en production/);
});

test('recycle une fixture SEEDTEST du même Market ID et la transforme en relais Yaoundé', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ id: 'market-cm', code: 'CM', name: 'Cameroun' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'relay-seed', name: 'SEEDTEST CM relais' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await ensureCanonicalRelay(PROFILES.CM);

  expect(result).toMatchObject({ market: 'CM', relayId: 'relay-seed', city: 'Yaoundé' });

  const [updateSql, updateParams] = db.query.mock.calls[2];
  expect(updateSql).toMatch(/zone = \$5/);
  expect(updateSql).toMatch(/island = \$5/);
  expect(updateParams).toEqual([
    'relay-seed',
    'Relais Komerce Yaoundé Centre',
    '+237600000001',
    'Yaoundé Centre, Cameroun',
    'Yaoundé',
    'market-cm',
  ]);

  const [deactivateSql, deactivateParams] = db.query.mock.calls[3];
  expect(deactivateSql).toMatch(/name ILIKE 'SEEDTEST%'/);
  expect(deactivateParams).toEqual(['market-cm', 'relay-seed']);
});

test('crée Brazzaville si aucune fixture exploitable n existe', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ id: 'market-cg', code: 'CG', name: 'Congo' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'relay-cg' }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await ensureCanonicalRelay(PROFILES.CG);

  expect(result).toMatchObject({ market: 'CG', relayId: 'relay-cg', city: 'Brazzaville' });
  const [insertSql, insertParams] = db.query.mock.calls[2];
  expect(insertSql).toMatch(/INSERT INTO relais/);
  expect(insertSql).toMatch(/zone, island/);
  expect(insertParams).toEqual([
    'Relais Komerce Brazzaville Centre',
    '+242060000001',
    'Brazzaville Centre, Congo',
    'Brazzaville',
    'market-cg',
  ]);
});
