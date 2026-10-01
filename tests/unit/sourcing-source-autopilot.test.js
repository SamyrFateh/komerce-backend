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
const mockDiscoverSourcePlan = jest.fn();
const mockHandoffImportResult = jest.fn();

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
      discovery_mode: 'static',
      discovery_version: 'cj-catalog-page-v1',
      discovery_ready: true,
      pull_options: { page: 1, size: 20, include_commandable_units: true },
      supports_full_snapshot: true,
    },
  ])),
  discoverSourcePlan: (...args) => mockDiscoverSourcePlan(...args),
  dispatchToConnector: (...args) => mockDispatch(...args),
}));

jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: (...args) => mockImportCatalog(...args),
}));

jest.mock('../../services/sourcing-candidate-actions', () => ({
  handoffImportResult: (...args) => mockHandoffImportResult(...args),
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
    discovery_enabled: true,
    sync_enabled: true,
    import_enabled: true,
    production_enabled: true,
    production_certified_capture_id: 'capture-certified',
    production_certified_at: '2026-09-28T12:00:00Z',
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
  mockHandoffImportResult.mockImplementation(async (result) => result);
  mockDiscoverSourcePlan.mockResolvedValue({
    status: 'READY',
    provider: 'cj',
    strategy: 'provider-static',
    version: 'cj-catalog-page-v1',
    pull_options: { page: 1, size: 20, include_commandable_units: true },
    evidence: { source: 'provider_registry' },
  });
});

afterAll(() => {
  delete process.env.KOMERCE_SOURCE_AUTOPILOT;
});

test('le rafraîchissement ne crée jamais de source : le registre est explicite', async () => {
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

  await expect(autopilot.refreshRegisteredPullSources()).resolves.toEqual([]);

  const statements = mockQuery.mock.calls.map(([sql]) => String(sql));
  expect(statements.some((sql) => /INSERT\s+INTO\s+sourcing_sources/i.test(sql))).toBe(false);
  expect(statements.some((sql) => /UPDATE\s+sourcing_sources/i.test(sql))).toBe(false);
});

test('le rafraîchissement réaligne le contrat des sources déjà enregistrées sans toucher à l’autopilot', async () => {
  mockQuery.mockImplementation(async (sql) => (
    String(sql).includes('SELECT source_id FROM sourcing_sources')
      ? { rows: [{ source_id: 'api:cj' }] }
      : { rows: [], rowCount: 1 }
  ));

  await expect(autopilot.refreshRegisteredPullSources()).resolves.toEqual(['api:cj']);

  const update = mockQuery.mock.calls.map(([sql]) => String(sql)).find((sql) => /UPDATE\s+sourcing_sources/i.test(sql));
  expect(update).toBeDefined();
  expect(update).not.toMatch(/autopilot_enabled|_enabled\s*=|production_certified/);
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT\s+INTO\s+sourcing_sources/i.test(String(sql)))).toBe(false);
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

test('une capacité fournisseur OFF bloque explicitement l\'autopilot avant tout connecteur', async () => {
  mockSourceQueries(sourceRow({ production_enabled: false }));

  await expect(autopilot.runSourceOnce('api:cj'))
    .resolves.toEqual({ status: 'skipped', source_ref: 'api:cj', reason: 'provider_capability_policy_off' });

  expect(mockImportCatalog).not.toHaveBeenCalled();
  expect(mockGetClient).not.toHaveBeenCalled();
});

test('production ON sans preuve runtime reste bloquée avant tout connecteur', async () => {
  mockSourceQueries(sourceRow({ production_certified_capture_id: null, production_certified_at: null }));

  await expect(autopilot.runSourceOnce('api:cj'))
    .resolves.toEqual({ status: 'skipped', source_ref: 'api:cj', reason: 'provider_capability_policy_off' });

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

  expect(mockDiscoverSourcePlan).toHaveBeenCalledWith('cj', {
    page: 1,
    size: 20,
    include_commandable_units: true,
  });
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

test('erreur fournisseur transitoire est retentée puis peut réussir sans casser la source', async () => {
  process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES = '2';
  process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS = '0';
  mockSourceQueries();
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog
    .mockResolvedValueOnce({ status: 400, body: { error: 'HTTP 429 Too Many Requests' } })
    .mockResolvedValueOnce({
      status: 200,
      body: {
        accepted: 2, created: 2, updated: 0, rejected: 0,
        pipeline_status: 'CANONICAL_RESOLVED',
        shadow_ingestion: { status: 'recorded' },
      },
    });

  const result = await autopilot.runSourceOnce('api:cj', { reason: 'test' });

  expect(mockImportCatalog).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ status: 'ok', accepted: 2, transient_retries: 1 });
  delete process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES;
  delete process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS;
});

test('limitation de fréquence AliExpress est reconnue comme transitoire', async () => {
  process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES = '1';
  process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS = '0';
  mockSourceQueries();
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog
    .mockResolvedValueOnce({
      status: 400,
      body: { error: '[AliExpress] aliexpress.ds.product.get échoué (200): Api access frequency exceeds the limit. this ban will last 1 seconds' },
    })
    .mockResolvedValueOnce({
      status: 200,
      body: {
        run_ref: 'KIR-000008',
        accepted: 1, created: 1, updated: 0, rejected: 0,
        pipeline_status: 'CANONICAL_RESOLVED',
        shadow_ingestion: { status: 'recorded' },
      },
    });

  const result = await autopilot.runSourceOnce('api:cj', { reason: 'test' });

  expect(mockImportCatalog).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ status:'ok', run_ref:'KIR-000008', transient_retries:1 });
  delete process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES;
  delete process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS;
});

test('erreur fournisseur transitoire persistante devient retry_pending et non failed critique', async () => {
  process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES = '2';
  process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS = '0';
  mockSourceQueries();
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog.mockResolvedValue({
    status: 400,
    body: { error: 'gateway timeout from supplier' },
  });

  const result = await autopilot.runSourceOnce('api:cj', { reason: 'test' });

  expect(mockImportCatalog).toHaveBeenCalledTimes(3);
  expect(result).toMatchObject({
    status: 'retry_pending',
    code: 'transient_import_retry_pending',
    transient_retries: 2,
  });
  expect(mockQuery.mock.calls.some(([sql, params]) =>
    String(sql).includes('INSERT INTO sourcing_captures')
      && params[2] === 'partial'
      && String(params[4]).includes('retry_pending')
  )).toBe(true);
  delete process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES;
  delete process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS;
});

test('passage autopilot vide conserve la référence KIR pour le cockpit', async () => {
  mockSourceQueries();
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog.mockResolvedValue({
    status: 400,
    body: { error: 'Aucun produit valide trouvé', invalid: [], run_ref: 'KIR-000099' },
  });

  const result = await autopilot.runSourceOnce('api:cj', { reason: 'test' });

  expect(result).toMatchObject({
    status: 'empty',
    source_ref: 'api:cj',
    run_ref: 'KIR-000099',
  });
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

test('le rail opérateur transmet exactement les ids prouvés par Discovery à l’import', async () => {
  mockSourceQueries(sourceRow({
    autopilot_enabled: false,
    production_enabled: false,
    production_certified_capture_id: null,
    production_certified_at: null,
  }));
  mockDiscoverSourcePlan.mockResolvedValueOnce({
    status:'READY',
    provider:'aliexpress',
    strategy:'feed-category',
    version:'aliexpress-ds-discovery-v1',
    pull_options:{
      product_ids:['100000000001','100000000002'],
      page:1,
      size:20,
      country_code:'AE',
      feed_name:'Hot sale',
    },
    evidence:{ probe_product_count:2 },
  });
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog.mockResolvedValue({
    status:200,
    body:{
      run_ref:'KIR-000011',
      pipeline_status:'CANONICAL_RESOLVED',
      canonical_resolved:true,
      accepted:2, created:2, updated:0, rejected:0,
    },
  });

  await autopilot.runSourceImportNow('api:cj', { actorId:'operator-1' });

  expect(mockImportCatalog).toHaveBeenCalledWith(
    expect.objectContaining({
      product_ids:['100000000001','100000000002'],
      page:1,
      size:20,
      country_code:'AE',
      feed_name:'Hot sale',
    }),
    'operator-1',
    expect.any(Function)
  );
});

test('import opérateur borné peut produire la première certification sans autopilot ni Production ON', async () => {
  mockSourceQueries(sourceRow({
    autopilot_enabled: false,
    production_enabled: false,
    production_certified_capture_id: null,
    production_certified_at: null,
  }));
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
      run_ref: 'KIR-000001',
      pipeline_status: 'CANONICAL_RESOLVED',
      canonical_resolved: true,
      accepted: 20, created: 20, updated: 0, rejected: 0,
    },
  });

  await expect(autopilot.runSourceImportNow('api:cj', {
    actorId: 'operator-1',
    reason: 'operator_import_live',
  })).resolves.toMatchObject({
    status: 'certified',
    source_ref: 'api:cj',
    run_ref: 'KIR-000001',
    pipeline_status: 'CANONICAL_RESOLVED',
    accepted: 20,
    discovery: {
      status: 'READY',
      version: 'cj-catalog-page-v1',
    },
  });
  expect(mockDiscoverSourcePlan).toHaveBeenCalledWith('cj', {
    page: 1,
    size: 20,
    include_commandable_units: true,
  });

  expect(mockImportCatalog).toHaveBeenCalledWith(
    expect.objectContaining({
      source_type: 'api',
      supplier_id: 'cj',
      supplier_name: 'CJdropshipping',
      page: 1,
      size: 20,
      is_full_snapshot: false,
    }),
    'operator-1',
    expect.any(Function)
  );
});

test('import opérateur/certification retente un throttle fournisseur transitoire', async () => {
  process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES = '1';
  process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS = '0';
  mockSourceQueries(sourceRow({
    autopilot_enabled: false,
    production_enabled: false,
    production_certified_capture_id: null,
    production_certified_at: null,
  }));
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog
    .mockResolvedValueOnce({
      status: 400,
      body: { error: '[AliExpress] aliexpress.ds.product.get échoué (200): Api access frequency exceeds the limit. this ban will last 1 seconds' },
    })
    .mockResolvedValueOnce({
      status: 200,
      body: {
        run_ref: 'KIR-000010',
        pipeline_status: 'CANONICAL_RESOLVED',
        canonical_resolved: true,
        accepted: 1, created: 1, updated: 0, rejected: 0,
      },
    });

  const result = await autopilot.runSourceImportNow('api:cj', { actorId:'operator-1' });

  expect(mockImportCatalog).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({
    status:'certified',
    run_ref:'KIR-000010',
    transient_retries:1,
  });
  delete process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES;
  delete process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS;
});

test('import opérateur distingue une source fournisseur vide', async () => {
  mockSourceQueries(sourceRow({
    autopilot_enabled: false,
    production_enabled: false,
    production_certified_capture_id: null,
    production_certified_at: null,
  }));
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog.mockResolvedValue({
    status: 400,
    body: { error: 'Aucun produit valide trouvé', invalid: [], run_ref: 'KIR-000002' },
  });

  await expect(autopilot.runSourceImportNow('api:cj', { actorId: 'operator-1' }))
    .rejects.toMatchObject({
      status: 400,
      code: 'SUPPLIER_SOURCE_EMPTY',
      details: { run_ref: 'KIR-000002', connector_total: 0, rejected: 0 },
    });
});

test('import opérateur distingue un lot fournisseur entièrement rejeté', async () => {
  mockSourceQueries(sourceRow({
    autopilot_enabled: false,
    production_enabled: false,
    production_certified_capture_id: null,
    production_certified_at: null,
  }));
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  mockImportCatalog.mockResolvedValue({
    status: 400,
    body: {
      error: 'Aucun produit valide trouvé',
      invalid: [{ errors: ['product_name requis'] }, { errors: ['currency requise'] }],
      run_ref: 'KIR-000003',
    },
  });

  await expect(autopilot.runSourceImportNow('api:cj'))
    .rejects.toMatchObject({
      status: 400,
      code: 'NO_VALID_SUPPLIER_PRODUCT',
      details: { run_ref: 'KIR-000003', connector_total: 2, rejected: 2 },
    });
});

test('import opérateur n’atteint jamais l’orchestrateur si Discovery ne produit pas un plan READY', async () => {
  mockSourceQueries(sourceRow({
    autopilot_enabled: false,
    production_enabled: false,
    production_certified_capture_id: null,
    production_certified_at: null,
  }));
  const lockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
    release: jest.fn(),
  };
  mockGetClient.mockResolvedValue(lockClient);
  const error = new Error('aucune surface fournisseur');
  error.code = 'SOURCE_DISCOVERY_EMPTY';
  mockDiscoverSourcePlan.mockRejectedValue(error);

  await expect(autopilot.runSourceImportNow('api:cj'))
    .rejects.toMatchObject({
      status: 502,
      code: 'SOURCE_DISCOVERY_EMPTY',
    });

  expect(mockImportCatalog).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls.some(([sql, params]) =>
    String(sql).includes('INSERT INTO sourcing_captures')
      && params[2] === 'failed'
      && String(params[4]).includes('discovery_plan')
  )).toBe(true);
});

test('import opérateur reste fail-closed si Discovery/Sync/Import ne sont pas autorisés', async () => {
  mockSourceQueries(sourceRow({
    autopilot_enabled: false,
    import_enabled: false,
    production_enabled: false,
    production_certified_capture_id: null,
    production_certified_at: null,
  }));

  await expect(autopilot.runSourceImportNow('api:cj'))
    .rejects.toMatchObject({ status: 409, code: 'provider_preproduction_capability_policy_off' });

  expect(mockImportCatalog).not.toHaveBeenCalled();
  expect(mockGetClient).not.toHaveBeenCalled();
});

test('activation modifie uniquement autopilot_enabled et peut rester sans premier run en test', async () => {
  mockSourceQueries();

  const result = await autopilot.setSourceActive('api:cj', true, { runNow: false });

  expect(result).toEqual({ source_ref: 'api:cj', autopilot_enabled: true });
  const update = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE sourcing_sources'));
  expect(update[0]).toContain('autopilot_enabled = $2');
  expect(update[1]).toEqual(['api:cj', true]);
});

test('activation refuse fail-closed si une capacité fournisseur est OFF', async () => {
  mockSourceQueries(sourceRow({ import_enabled: false }));

  await expect(autopilot.setSourceActive('api:cj', true, { runNow: false }))
    .rejects.toMatchObject({ status: 409, code: 'provider_capability_policy_off' });

  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE sourcing_sources'))).toBe(false);
});

test('activation refuse fail-closed si le runtime global est OFF', async () => {
  process.env.KOMERCE_SOURCE_AUTOPILOT = '0';
  mockSourceQueries();

  await expect(autopilot.setSourceActive('api:cj', true, { runNow: false }))
    .rejects.toMatchObject({ status: 409, code: 'sourcing_autopilot_runtime_disabled' });

  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE sourcing_sources'))).toBe(false);
});


test('activation impossible avant certification, même avec Discovery/Sync/Import/Production ON', async () => {
  mockSourceQueries(sourceRow({ production_certified_capture_id: null, production_certified_at: null }));

  await expect(autopilot.setSourceActive('api:cj', true, { runNow: false }))
    .rejects.toMatchObject({ status: 409, code: 'provider_capability_policy_off' });

  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE sourcing_sources'))).toBe(false);
});

test('activation possible dès que les quatre capacités et la certification runtime sont réunies', async () => {
  mockSourceQueries(sourceRow({ autopilot_enabled: false }));

  await expect(autopilot.setSourceActive('api:cj', true, { runNow: false }))
    .resolves.toEqual({ source_ref: 'api:cj', autopilot_enabled: true });
});

test('désactiver une source préserve tout son historique et sa certification', async () => {
  mockSourceQueries();

  await expect(autopilot.setSourceActive('api:cj', false, { runNow: false }))
    .resolves.toEqual({ source_ref: 'api:cj', autopilot_enabled: false });

  const statements = mockQuery.mock.calls.map(([sql]) => String(sql));
  expect(statements.some((sql) => /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i.test(sql))).toBe(false);
  const mutations = statements.filter((sql) => /^\s*(UPDATE|INSERT|DELETE)\b/i.test(sql));
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toMatch(/UPDATE\s+sourcing_sources\s+SET\s+autopilot_enabled = \$2, updated_at = NOW\(\)/);
  expect(mutations[0]).not.toMatch(/sourcing_captures|production_certified|discovery_enabled|import_enabled/);
});

test('runActiveSources ne voit que les sources ON, complètes et certifiées', async () => {
  mockQuery.mockImplementation(async (sql) => (
    String(sql).includes('autopilot_enabled = true') ? { rows: [{ source_ref: 'api:cj' }] } : { rows: [] }
  ));
  const select = (await autopilot.runActiveSources({ limit: 5 }).catch(() => null));
  const sql = mockQuery.mock.calls.map(([text]) => String(text)).find((text) => text.includes('autopilot_enabled = true'));
  expect(sql).toContain('discovery_enabled = true AND sync_enabled = true AND import_enabled = true AND production_enabled = true');
  expect(sql).toContain('production_certified_capture_id IS NOT NULL');
  expect(sql).toContain('production_certified_at IS NOT NULL');
  expect(select === null || select.status === 'ok').toBe(true);
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

  test('route uniquement la sonde de qualité FR multi-source sans mutation', async () => {
    const env = { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: 'refinery-fr-cross-supplier-audit' };
    const refineryFrAudit = { run: jest.fn().mockResolvedValue({ writes: false, ai_call_invoked: false }) };
    const outcome = await oneShotRunner.runTask(env, { refineryFrAudit });
    expect(refineryFrAudit.run).toHaveBeenCalledWith({ env });
    expect(outcome.result).toMatchObject({ writes: false, ai_call_invoked: false });
  });

  test('route la sonde commerciale AliExpress exacte sans import ni promotion', async () => {
    const env = { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: 'aliexpress-golden-commercial-audit' };
    const aliexpressCommercialAudit = { run: jest.fn().mockResolvedValue({ writes: false }) };

    await oneShotRunner.runTask(env, { aliexpressCommercialAudit });

    expect(aliexpressCommercialAudit.run).toHaveBeenCalledWith({ env });
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

  test('route un slot Sandbox Allegro explicite et borné', async () => {
    const env = { KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT: 'allegro-golden-prebuyer:12000:2' };
    const allegroGolden = { run: jest.fn().mockResolvedValue({ status: 'PASS' }) };

    await oneShotRunner.runTask(env, { allegroGolden });

    expect(allegroGolden.run).toHaveBeenCalledWith(['--price-kmf=12000', '--seed-slot=2'], { env });
  });

  test.each([
    'aliexpress-golden-import:not-an-id',
    'aliexpress-golden-import:1234',
    'allegro-golden-prebuyer:0',
    'allegro-golden-prebuyer:-1',
    'allegro-golden-prebuyer:12000:0',
    'allegro-golden-prebuyer:12000:4',
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
