'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockFacts = jest.fn();
const mockDescriptor = jest.fn();
const mockTestConnection = jest.fn();
const mockRequireSource = jest.fn();
const mockAutomationBySourceRef = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/sourcing-import-dispatch', () => ({
  sourceConnectorFacts: (...args) => mockFacts(...args),
  sourceAutomationDescriptor: (...args) => mockDescriptor(...args),
  testConnection: (...args) => mockTestConnection(...args),
}));
jest.mock('../../services/sourcing-source-autopilot', () => ({
  descriptorSourceRef: (descriptor) => `api:${descriptor.adapter}`,
  requireSource: (...args) => mockRequireSource(...args),
  _automationBySourceRef: (...args) => mockAutomationBySourceRef(...args),
}));

const registry = require('../../services/sourcing-source-registry');

const FACTS = [
  { adapter: 'aliexpress', name: 'AliExpress', label: 'AliExpress Dropshipper API', available: true, automatable: true, connection_mode: 'oauth', connect_path: '/api/integrations/aliexpress/oauth/start', can_test_connection: true, reason: null },
  { adapter: 'cj', name: 'CJdropshipping', label: 'CJdropshipping API', available: true, automatable: true, connection_mode: 'server_managed', connect_path: null, can_test_connection: true, reason: null },
  { adapter: 'noon', name: 'Noon', label: 'Noon API', available: false, automatable: false, connection_mode: null, connect_path: null, can_test_connection: false, reason: 'Connecteur non configuré sur ce serveur' },
  { adapter: 'ebay', name: 'eBay Sandbox', label: 'eBay Sandbox Browse API', available: true, automatable: false, connection_mode: 'server_managed', connect_path: null, can_test_connection: true, reason: 'Alimentation automatique non certifiée pour ce connecteur' },
  { adapter: 'allegro', name: 'Allegro Sandbox', label: 'Allegro Sandbox', available: false, automatable: true, connection_mode: 'server_managed', connect_path: null, can_test_connection: true, reason: 'Connecteur non configuré sur ce serveur' },
];

function descriptorFor(adapter) {
  const fact = FACTS.find((item) => item.adapter === adapter);
  return fact && fact.automatable ? { adapter, supplier_name: fact.name, connector_ready: fact.available } : null;
}

function sqlCalls() {
  return mockQuery.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFacts.mockReturnValue(FACTS);
  mockDescriptor.mockImplementation(descriptorFor);
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('catalogue canonique des connecteurs', () => {
  test('expose uniquement des faits métier issus du registre backend', async () => {
    const { connectors } = await registry.getCatalog();
    expect(connectors.map((item) => item.adapter)).toEqual(['aliexpress', 'cj', 'noon', 'ebay', 'allegro']);
    const aliexpress = connectors.find((item) => item.adapter === 'aliexpress');
    expect(aliexpress).toMatchObject({
      available: true, automatable: true, can_create: true,
      connection_mode: 'oauth', connect_path: '/api/integrations/aliexpress/oauth/start',
      reason: null, existing_source_ref: null,
    });
    expect(connectors.find((item) => item.adapter === 'noon')).toMatchObject({ available: false, can_create: false });
    expect(connectors.find((item) => item.adapter === 'ebay')).toMatchObject({ available: true, automatable: false, can_create: false });
  });

  test('jamais de nom de module, de classe, de variable d’environnement ni de trace', async () => {
    const json = JSON.stringify(await registry.getCatalog());
    expect(json).not.toMatch(/module|Connector\b|ALIEXPRESS_|CJ_|EBAY_|ALLEGRO_|\.js|stack|secret|token/i);
  });

  test('signale la source existante au lieu de proposer une recréation', async () => {
    mockQuery.mockResolvedValue({ rows: [{ source_id: 'api:aliexpress' }] });
    const { connectors } = await registry.getCatalog();
    expect(connectors.find((item) => item.adapter === 'aliexpress'))
      .toMatchObject({ existing_source_ref: 'api:aliexpress', can_create: false });
    expect(connectors.find((item) => item.adapter === 'cj')).toMatchObject({ existing_source_ref: null, can_create: true });
  });
});

describe('création de source', () => {
  test('connecteur supporté : insertion fail-closed, autopilot OFF et aucune capacité', async () => {
    mockQuery.mockResolvedValue({ rows: [{ source_id: 'api:cj' }] });

    await expect(registry.createSource({ adapter: 'cj' })).resolves.toEqual({ source_ref: 'api:cj', created: true });

    const [insert] = sqlCalls();
    expect(insert.sql).toMatch(/INSERT INTO sourcing_sources/);
    expect(insert.sql).toContain("'pull', 'recurring', 'active', false, false, false, false, false");
    expect(insert.sql).toContain('ON CONFLICT (source_id) DO NOTHING');
    expect(insert.params).toEqual(['api:cj', 'cj']);
    expect(insert.sql).not.toMatch(/production_certified|credential_ref/);
  });

  test('une création ne déclenche ni import, ni capture, ni test de connexion', async () => {
    mockQuery.mockResolvedValue({ rows: [{ source_id: 'api:cj' }] });
    await registry.createSource({ adapter: 'cj' });
    expect(sqlCalls().some(({ sql }) => /sourcing_captures|sourcing_provider_control_events/.test(sql))).toBe(false);
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  test('doublon refusé : 409 et référence de la source existante', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(registry.createSource({ adapter: 'aliexpress' })).rejects.toMatchObject({
      status: 409,
      code: 'sourcing_source_already_exists',
      details: { existing_source_ref: 'api:aliexpress' },
    });
  });

  test('connecteur inconnu : fail closed, aucune écriture', async () => {
    await expect(registry.createSource({ adapter: 'bigbuy' })).rejects.toMatchObject({ status: 404, code: 'sourcing_source_connector_unknown' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test.each([undefined, '', '  ', '../etc', 'a', 'x'.repeat(65), 'Bad Adapter'])('adapter invalide %p refusé sans écriture', async (adapter) => {
    await expect(registry.createSource({ adapter })).rejects.toMatchObject({ status: 400, code: 'sourcing_source_adapter_invalid' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('connecteur indisponible : refusé, aucune écriture', async () => {
    await expect(registry.createSource({ adapter: 'allegro' })).rejects.toMatchObject({ status: 409, code: 'sourcing_source_connector_unavailable' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('connecteur sans autopilot certifié (eBay, Noon) : jamais une source', async () => {
    await expect(registry.createSource({ adapter: 'ebay' })).rejects.toMatchObject({ status: 409, code: 'sourcing_source_connector_not_automatable' });
    await expect(registry.createSource({ adapter: 'noon' })).rejects.toMatchObject({ status: 409, code: 'sourcing_source_connector_not_automatable' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('autre fournisseur : connecteur requis', () => {
  test('enregistre une demande, jamais une source', async () => {
    mockQuery.mockResolvedValue({ rows: [{ request_id: 'req-1', provider_name: 'BigBuy', requested_label: 'BigBuy Europe', reference_url: 'https://bigbuy.eu', status: 'connector_required', created_at: '2026-10-01T00:00:00Z' }] });

    const result = await registry.createConnectorRequest(
      { provider_name: '  BigBuy ', requested_label: 'BigBuy Europe', reference_url: 'https://bigbuy.eu' },
      { id: 42 }
    );

    expect(result).toMatchObject({ request_ref: 'req-1', provider_name: 'BigBuy', status: 'connector_required' });
    const statements = sqlCalls();
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toMatch(/INSERT INTO sourcing_source_requests/);
    expect(statements.some(({ sql }) => /sourcing_sources|autopilot|sourcing_captures/.test(sql))).toBe(false);
    expect(statements[0].params).toEqual(['BigBuy', 'BigBuy Europe', 'https://bigbuy.eu', '42']);
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  test('le nom de la source par défaut est celui du fournisseur', async () => {
    mockQuery.mockResolvedValue({ rows: [{ request_id: 'req-2', provider_name: 'BigBuy', requested_label: 'BigBuy', reference_url: null, status: 'connector_required', created_at: 'x' }] });
    await registry.createConnectorRequest({ provider_name: 'BigBuy' });
    expect(sqlCalls()[0].params.slice(0, 3)).toEqual(['BigBuy', 'BigBuy', null]);
  });

  test('fournisseur déjà couvert par un connecteur : refusé (pas de contournement par « Autre »)', async () => {
    await expect(registry.createConnectorRequest({ provider_name: 'ali express' })).rejects.toMatchObject({
      status: 409, code: 'sourcing_source_request_connector_exists', details: { adapter: 'aliexpress' },
    });
    await expect(registry.createConnectorRequest({ provider_name: 'CJdropshipping API' })).rejects.toMatchObject({ code: 'sourcing_source_request_connector_exists' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('demande en doublon refusée', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(registry.createConnectorRequest({ provider_name: 'BigBuy' })).rejects.toMatchObject({ status: 409, code: 'sourcing_source_request_already_exists' });
  });

  test.each([
    [{ provider_name: '' }, 'sourcing_source_request_provider_invalid'],
    [{ provider_name: 'x' }, 'sourcing_source_request_provider_invalid'],
    [{ provider_name: 'y'.repeat(81) }, 'sourcing_source_request_provider_invalid'],
    [{ provider_name: 'BigBuy', requested_label: 'z'.repeat(81) }, 'sourcing_source_request_label_invalid'],
    [{ provider_name: 'BigBuy', reference_url: 'u'.repeat(301) }, 'sourcing_source_request_reference_invalid'],
  ])('validation stricte %j', async (body, code) => {
    await expect(registry.createConnectorRequest(body)).rejects.toMatchObject({ status: 400, code });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('test de connexion', () => {
  beforeEach(() => {
    mockRequireSource.mockResolvedValue({ source_ref: 'api:cj', adapter_type: 'cj' });
    mockAutomationBySourceRef.mockReturnValue({ adapter: 'cj', connector_ready: true });
    mockQuery.mockResolvedValue({ rows: [{ connection_tested_at: '2026-10-01T01:00:00Z' }] });
  });

  test('connexion valide : mémorisée, sans KIR ni capacité ni certification', async () => {
    mockTestConnection.mockResolvedValue({ ok: true, code: 'connection_ok', message: 'Connexion valide' });

    const result = await registry.testSourceConnection('api:cj');

    expect(result).toEqual({ source_ref: 'api:cj', ok: true, code: 'connection_ok', message: 'Connexion valide', tested_at: '2026-10-01T01:00:00Z' });
    expect(mockTestConnection).toHaveBeenCalledWith('cj');
    const [update] = sqlCalls();
    expect(update.params).toEqual(['api:cj', 'ok', null]);
    expect(update.sql).not.toMatch(/production_certified|_enabled|autopilot|sourcing_captures/);
  });

  test('connexion impossible : raison métier courte, jamais de message brut ni de secret', async () => {
    mockTestConnection.mockResolvedValue({ ok: false, code: 'credentials_rejected', message: 'Le fournisseur a refusé les identifiants.' });

    const result = await registry.testSourceConnection('api:cj');

    expect(result).toMatchObject({ ok: false, code: 'credentials_rejected', message: 'Le fournisseur a refusé les identifiants.' });
    expect(sqlCalls()[0].params).toEqual(['api:cj', 'failed', 'credentials_rejected']);
    expect(JSON.stringify(result)).not.toMatch(/stack|Error:|apiKey|token/i);
  });

  test('source sans contrat d’autopull : refus, aucun appel fournisseur', async () => {
    mockAutomationBySourceRef.mockReturnValue(null);
    await expect(registry.testSourceConnection('api:cj')).rejects.toMatchObject({ status: 409, code: 'sourcing_autopull_unavailable' });
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  test('source inconnue : l’erreur de requireSource remonte', async () => {
    mockRequireSource.mockRejectedValue(Object.assign(new Error('Source sourcing introuvable'), { status: 404 }));
    await expect(registry.testSourceConnection('api:ghost')).rejects.toMatchObject({ status: 404 });
    expect(mockTestConnection).not.toHaveBeenCalled();
  });
});
