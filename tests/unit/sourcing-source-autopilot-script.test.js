'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockRunActiveSources = jest.fn();

jest.mock('../../db', () => ({
  pool: { end: jest.fn() },
}));

jest.mock('../../services/sourcing-source-autopilot', () => ({
  runActiveSources: (...args) => mockRunActiveSources(...args),
}));

const runner = require('../../scripts/sourcing-source-autopilot');

beforeEach(() => {
  jest.clearAllMocks();
});

test('sans one-shot conserve le passage autopilot canonique et borné', async () => {
  mockRunActiveSources.mockResolvedValue({ status: 'ok', results: [] });

  await expect(runner.runTask({
    KOMERCE_SOURCE_AUTOPILOT_BATCH_LIMIT: '75',
  })).resolves.toEqual({
    task: { kind: 'autopilot' },
    result: { status: 'ok', results: [] },
  });

  expect(mockRunActiveSources).toHaveBeenCalledWith({
    limit: 50,
    reason: 'railway_cron',
  });
});

test('route uniquement le dry-run AliExpress allowlisté', async () => {
  const env = { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: 'aliexpress-golden-dry-run' };
  const aliexpressGolden = { main: jest.fn().mockResolvedValue({ status: 'ok' }) };

  await runner.runTask(env, { aliexpressGolden });

  expect(aliexpressGolden.main).toHaveBeenCalledWith(['--dry-run'], env);
  expect(mockRunActiveSources).not.toHaveBeenCalled();
});

test('route un import AliExpress vers un identifiant numérique exact', async () => {
  const env = { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: 'aliexpress-golden-import:1005010358671233' };
  const aliexpressGolden = { main: jest.fn().mockResolvedValue({ imported: true }) };

  await runner.runTask(env, { aliexpressGolden });

  expect(aliexpressGolden.main).toHaveBeenCalledWith([
    '--execute-import',
    '--supplier-product-id=1005010358671233',
  ], env);
  expect(mockRunActiveSources).not.toHaveBeenCalled();
});

test('route la preuve Allegro avec un prix positif explicite', async () => {
  const env = { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: 'allegro-golden-prebuyer:12000' };
  const allegroGolden = { run: jest.fn().mockResolvedValue({ status: 'PASS' }) };

  await runner.runTask(env, { allegroGolden });

  expect(allegroGolden.run).toHaveBeenCalledWith(['--price-kmf=12000'], { env });
  expect(mockRunActiveSources).not.toHaveBeenCalled();
});

test.each([
  'aliexpress-golden-import:not-an-id',
  'aliexpress-golden-import:1234',
  'allegro-golden-prebuyer:0',
  'allegro-golden-prebuyer:-1',
  'node scripts/anything.js',
])('échoue fermé avant tout appel pour %s', async (value) => {
  const aliexpressGolden = { main: jest.fn() };
  const allegroGolden = { run: jest.fn() };

  await expect(runner.runTask(
    { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: value },
    { aliexpressGolden, allegroGolden }
  )).rejects.toMatchObject({
    code: 'source_autopilot_one_shot_not_allowlisted',
  });

  expect(mockRunActiveSources).not.toHaveBeenCalled();
  expect(aliexpressGolden.main).not.toHaveBeenCalled();
  expect(allegroGolden.run).not.toHaveBeenCalled();
});
