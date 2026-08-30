'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../../db');
const {
  PROVIDERS,
  PHYSICAL_OFFERS,
  SERVICES,
  DISCOVERY_CANDIDATES,
  shouldSeedDiscoveryStaging,
  seedDiscoveryStaging,
} = require('../../scripts/seed-discovery-staging');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.KOMERCE_ENV;
  delete process.env.NODE_ENV;
  delete process.env.DISCOVERY_STAGING_SEED_ENABLED;
});

afterAll(() => { process.env = ORIGINAL_ENV; });

test('seed impossible en production même avec le flag explicite', async () => {
  process.env.KOMERCE_ENV = 'production';
  process.env.DISCOVERY_STAGING_SEED_ENABLED = 'true';

  expect(shouldSeedDiscoveryStaging()).toBe(false);
  await expect(seedDiscoveryStaging()).resolves.toEqual({
    seeded: false,
    reason: 'staging-only-opt-in',
  });
  expect(db.query).not.toHaveBeenCalled();
  expect(db.withTransaction).not.toHaveBeenCalled();
});

test('staging reste sans écriture tant que le flag seed est absent', async () => {
  process.env.KOMERCE_ENV = 'staging';

  expect(shouldSeedDiscoveryStaging()).toBe(false);
  await seedDiscoveryStaging();
  expect(db.query).not.toHaveBeenCalled();
});

test('staging opt-in écrit le jeu déterministe dans une seule transaction', async () => {
  process.env.KOMERCE_ENV = 'staging';
  process.env.DISCOVERY_STAGING_SEED_ENABLED = 'yes';
  db.query.mockResolvedValue({ rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] });

  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  db.withTransaction.mockImplementation(async callback => callback(client));

  const result = await seedDiscoveryStaging();

  expect(result.seeded).toBe(true);
  expect(result.market).toBe('KM');
  expect(result.providers).toBe(5);
  expect(result.physicalOffers).toBe(4);
  expect(result.services).toBe(6);
  expect(result.candidates.split(',')).toHaveLength(10);
  expect(db.withTransaction).toHaveBeenCalledTimes(1);
  expect(client.query).toHaveBeenCalledTimes(
    PROVIDERS.length + PHYSICAL_OFFERS.length + SERVICES.length
  );

  const sql = client.query.mock.calls.map(call => call[0]).join('\n');
  expect(sql).toMatch(/INSERT INTO providers/);
  expect(sql).toMatch(/INSERT INTO physical_offers/);
  expect(sql).toMatch(/INSERT INTO services/);
  expect(sql).toMatch(/commercial_exposure = 'ENABLED'/);
});

test('les UUID et l’ordre éditorial sont stables et compatibles Discovery', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i;
  const allIds = [
    ...PROVIDERS.map(x => x.id),
    ...PHYSICAL_OFFERS.map(x => x.id),
    ...SERVICES.map(x => x.id),
  ];

  expect(new Set(allIds).size).toBe(allIds.length);
  expect(allIds.every(id => uuid.test(id))).toBe(true);
  expect(DISCOVERY_CANDIDATES).toEqual([
    `physical_offer:${PHYSICAL_OFFERS[0].id}`,
    `service:${SERVICES[1].id}`,
    `physical_offer:${PHYSICAL_OFFERS[2].id}`,
    `service:${SERVICES[0].id}`,
    `service:${SERVICES[2].id}`,
    `physical_offer:${PHYSICAL_OFFERS[1].id}`,
    `service:${SERVICES[3].id}`,
    `physical_offer:${PHYSICAL_OFFERS[3].id}`,
    `service:${SERVICES[4].id}`,
    `service:${SERVICES[5].id}`,
  ]);
});
