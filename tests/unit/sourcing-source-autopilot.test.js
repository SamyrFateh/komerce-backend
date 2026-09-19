'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockGetClient = jest.fn();
const mockDispatch = jest.fn();
const mockImportCatalog = jest.fn();

jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
  getClient: (...args) => mockGetClient(...args),
}));

jest.mock('../../services/sourcing-import-dispatch', () => ({
  sourceAutomationCatalog: jest.fn(() => ([
    {
      adapter: 'cj',
      supplier_name: 'CJdropshipping',
      label: 'CJdropshipping API',
      connector_ready: true,
      reason: null,
      pull_options: { page: 1, size: 20, include_commandable_units: true },
      supports_full_snapshot: true,
    },
  ])),
  dispatchToConnector: (...args) => mockDispatch(...args),
}));

jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: (...args) => mockImportCatalog(...args),
}));

jest.mock('../../services/sourcing-observation-shadow-service', () => ({
  buildSourceDescriptor: ({ supplierId }) => ({ sourceId: `api:${supplierId}` }),
}));

const autopilot = require('../../services/sourcing-source-autopilot');
const oneShotRunner = require('../../scripts/sourcing-source-autopilot');

function sourceRow(overrides = {}) {
  return {
    source_ref: 'api:cj',
    adapter_type: 'cj',
    acquisition: 'pull',
    continuity: 'recurring',
    status: 'active',
    autopilot_enabled: true,
    ...overrides,
  };
}

function mockSourceQueries(row = sourceRow()) {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('INSERT INTO sourcing_sources')) return { rows: [], rowCount: 1 };
    if (text.includes('SELECT source_id AS source_ref') && text.includes('WHERE source_id = $1')) {
      return { rows: row ? [row] : [] };
    }
    if (text.includes('UPDATE sourcing_sources')) return { rows: [], rowCount: 1 };
    if (text.includes('INSERT INTO sourcing_captures')) return { rows: [], rowCount: 1 };
    return { rows: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.KOMERCE_SOURCE_AUTOPILOT = '1';
});

afterAll(() => {
  delete process.env.KOMERCE_SOURCE_AUTOPILOT;
});

test('enregistre les connecteurs automatisables avec autopilot explicitement OFF par défaut', async () => {
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

  await expect(autopilot.ensureRegisteredPullSources()).resolves.toEqual(['api:cj']);

  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain('autopilot_enabled');
  expect(sql).toContain("'pull', 'recurring', 'active', false");
  expect(sql).not.toMatch(/DO UPDATE[\s\S]*autopilot_enabled\s*=/);
});

test('runtime OFF bloque tout passage même si la source est ON en base', async () => {
  process.env.KOMERCE_SOURCE_AUTOPILOT = '0';

  await expect(autopilot.runSourceOnce('api:cj'))
    .resolves.toEqual({ status: 'skipped', source_ref: 'api:cj', reason: 'runtime_disabled' });

  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockImportCatalog).not.toHaveBeenCalled();
});

test('source autopilot OFF ne déclenche jamais le connecteur', async () => {
  mockSourceQueries(sourceRow({ autopilot_enabled: false }));

  await expect(autopilot.runSourceOnce('api:cj'))
    .resolves.toEqual({ status: 'skipped', source_ref: 'api:cj', reason: 'autopilot_off' });

  expect(mockImportCatalog).not.toHaveBeenCalled();
  expect(mockGetClient).not.toHaveBeenCalled();
});

test('source ON exécute le pull borné via le registry sans branche fournisseur dans le runner', async () => {
  mockSourceQueries();
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog.mockResolvedValue({
    status: 200,
    body: {
      accepted: 3,
      created: 2,
      updated: 1,
      rejected: 0,
      shadow_ingestion: { status: 'recorded' },
    },
  });

  const result = await autopilot.runSourceOnce('api:cj', { reason: 'test' });

  expect(result).toMatchObject({ status: 'ok', source_ref: 'api:cj', accepted: 3, created: 2, updated: 1 });
  expect(mockImportCatalog).toHaveBeenCalledWith(
    expect.objectContaining({
      source_type: 'api',
      supplier_id: 'cj',
      supplier_name: 'CJdropshipping',
      page: 1,
      size: 20,
      include_commandable_units: true,
      is_full_snapshot: false,
    }),
    null,
    expect.any(Function)
  );
  expect(lockClient.query.mock.calls[0][0]).toContain('pg_try_advisory_lock');
  expect(lockClient.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
  expect(lockClient.release).toHaveBeenCalledTimes(1);
});

test('shadow incomplet ne peut jamais etre annonce comme un autopilot ok', async () => {
  mockSourceQueries();
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog.mockResolvedValue({
    status: 200,
    body: {
      accepted: 1, created: 1, updated: 0, rejected: 0,
      pipeline_status: 'PARTIAL_BLOCKED',
      shadow_ingestion: { status: 'failed', code: 'SHADOW_OBSERVATION_FAILED' },
    },
  });

  const result = await autopilot.runSourceOnce('api:cj', { reason: 'test' });

  expect(result).toMatchObject({
    status: 'partial', source_ref: 'api:cj', accepted: 1,
    pipeline_status: 'PARTIAL_BLOCKED',
  });
  expect(mockQuery.mock.calls.some(([sql, params]) =>
    String(sql).includes('INSERT INTO sourcing_captures') && params[2] === 'partial'
  )).toBe(true);
});

test('activation modifie uniquement autopilot_enabled et peut rester sans premier run en test', async () => {
  mockSourceQueries();

  const result = await autopilot.setSourceActive('api:cj', true, { runNow: false });

  expect(result).toEqual({ source_ref: 'api:cj', autopilot_enabled: true });
  const update = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE sourcing_sources'));
  expect(update[0]).toContain('autopilot_enabled = $2');
  expect(update[1]).toEqual(['api:cj', true]);
});

test('activation refuse fail-closed si le runtime global est OFF', async () => {
  process.env.KOMERCE_SOURCE_AUTOPILOT = '0';
  mockSourceQueries();

  await expect(autopilot.setSourceActive('api:cj', true, { runNow: false }))
    .rejects.toMatchObject({ status: 409, code: 'sourcing_autopilot_runtime_disabled' });

  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE sourcing_sources'))).toBe(false);
});


describe('sourcing source autopilot one-shot router', () => {
  test('sans one-shot conserve le passage autopilot canonique et borné', async () => {
    const runActiveSources = jest.fn().mockResolvedValue({ status: 'ok', results: [] });

    await expect(oneShotRunner.runTask(
      { KOMERCE_SOURCE_AUTOPILOT_BATCH_LIMIT: '75' },
      { autopilot: { runActiveSources } }
    )).resolves.toEqual({
      task: { kind: 'autopilot' },
      result: { status: 'ok', results: [] },
    });

    expect(runActiveSources).toHaveBeenCalledWith({
      limit: 50,
      reason: 'railway_cron',
    });
  });

  test('route uniquement le dry-run AliExpress allowlisté', async () => {
    const env = { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: 'aliexpress-golden-dry-run' };
    const aliexpressGolden = { main: jest.fn().mockResolvedValue({ status: 'ok' }) };

    await oneShotRunner.runTask(env, { aliexpressGolden });

    expect(aliexpressGolden.main).toHaveBeenCalledWith(['--dry-run'], env);
  });

  test('route un import AliExpress vers un identifiant numérique exact', async () => {
    const env = { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: 'aliexpress-golden-import:1005010358671233' };
    const aliexpressGolden = { main: jest.fn().mockResolvedValue({ imported: true }) };

    await oneShotRunner.runTask(env, { aliexpressGolden });

    expect(aliexpressGolden.main).toHaveBeenCalledWith([
      '--execute-import',
      '--supplier-product-id=1005010358671233',
    ], env);
  });

  test('route la preuve Allegro avec un prix positif explicite', async () => {
    const env = { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: 'allegro-golden-prebuyer:12000' };
    const allegroGolden = { run: jest.fn().mockResolvedValue({ status: 'PASS' }) };

    await oneShotRunner.runTask(env, { allegroGolden });

    expect(allegroGolden.run).toHaveBeenCalledWith(['--price-kmf=12000'], { env });
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

    await expect(oneShotRunner.runTask(
      { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: value },
      { aliexpressGolden, allegroGolden }
    )).rejects.toMatchObject({
      code: 'source_autopilot_one_shot_not_allowlisted',
    });

    expect(aliexpressGolden.main).not.toHaveBeenCalled();
    expect(allegroGolden.run).not.toHaveBeenCalled();
  });
});
