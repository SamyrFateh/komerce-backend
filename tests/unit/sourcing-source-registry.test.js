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

const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
  getClient: async () => ({ query: (...args) => mockClientQuery(...args), release: () => mockRelease() }),
}));
jest.mock('../../services/sourcing-import-dispatch', () => ({
  sourceConnectorFacts: (...args) => mockFacts(...args),
  sourceAutomationDescriptor: (...args) => mockDescriptor(...args),
  testConnection: (...args) => mockTestConnection(...args),
}));
const mockCredentialTest = jest.fn();
jest.mock('../../services/provider-credential-service', () => ({
  test: (...args) => mockCredentialTest(...args),
}));
jest.mock('../../services/sourcing-source-autopilot', () => ({
  descriptorSourceRef: (descriptor) => `api:${descriptor.adapter}`,
  requireSource: (...args) => mockRequireSource(...args),
  _automationBySourceRef: (...args) => mockAutomationBySourceRef(...args),
}));

const registry = require('../../services/sourcing-source-registry');

const FACTS = [
  { adapter: 'aliexpress', name: 'AliExpress', label: 'AliExpress Dropshipper API', available: true, automatable: true, onboarding_ready: true,
    onboarding: { status: 'defined', operator_must_obtain: [], setup_steps: ['Autoriser le compte'], prerequisites: ['Compte vendeur'], completion: 'OAuth terminé' },
    connection_mode: 'oauth', connect_path: '/api/integrations/aliexpress/oauth/start', can_test_connection: true, reason: null,
    auth: { mode: 'oauth', scope: 'platform', fields: [] } },
  { adapter: 'cj', name: 'CJdropshipping', label: 'CJdropshipping API', available: true, automatable: true, onboarding_ready: true,
    onboarding: { status: 'defined', operator_must_obtain: [{ key: 'api_key', label: 'Clé API CJdropshipping' }], setup_steps: ['Créer la clé API'], prerequisites: ['Compte CJ'], completion: 'Clé enregistrée' },
    connection_mode: 'server_managed', connect_path: null, can_test_connection: true, reason: null,
    auth: { mode: 'api_key', scope: 'source',
      fields: [{ key: 'api_key', label: 'Clé API CJdropshipping', secret: true }] } },
  { adapter: 'noon', name: 'Noon', label: 'Noon API', available: false, automatable: false, connection_mode: null, connect_path: null, can_test_connection: false, reason: 'Connecteur non configuré sur ce serveur' },
  { adapter: 'ebay', name: 'eBay Sandbox', label: 'eBay Sandbox Browse API', available: true, automatable: false, connection_mode: 'server_managed', connect_path: null, can_test_connection: true, reason: 'Alimentation automatique non certifiée pour ce connecteur' },
  { adapter: 'allegro', name: 'Allegro Sandbox', label: 'Allegro Sandbox', available: false, automatable: true, onboarding_ready: true,
    onboarding: { status: 'defined', operator_must_obtain: [{ key: 'client_id', label: 'Client ID Allegro' }, { key: 'client_secret', label: 'Client Secret Allegro' }], setup_steps: ['Créer l’application'], prerequisites: ['Application Allegro'], completion: 'Identifiants enregistrés' },
    connection_mode: 'server_managed', connect_path: null, can_test_connection: true, reason: 'Connecteur non configuré sur ce serveur',
    auth: { mode: 'client_credentials', scope: 'source',
      fields: [{ key: 'client_id', label: 'Client ID Allegro', secret: false }, { key: 'client_secret', label: 'Client Secret Allegro', secret: true }] } },
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
      auth: { mode: 'oauth', scope: 'platform', fields: [] },
      onboarding_ready: true,
      onboarding: { status: 'defined' },
      reason: null, existing_source_ref: null,
    });
    expect(connectors.find((item) => item.adapter === 'cj')).toMatchObject({
      auth: {
        mode: 'api_key',
        scope: 'source',
        fields: [{ key: 'api_key', label: 'Clé API CJdropshipping', secret: true }],
      },
      onboarding_ready: true,
      onboarding: {
        operator_must_obtain: [{ key: 'api_key', label: 'Clé API CJdropshipping' }],
      },
    });
    expect(connectors.find((item) => item.adapter === 'noon')).toMatchObject({ available: false, can_create: false });
    expect(connectors.find((item) => item.adapter === 'ebay')).toMatchObject({ available: true, automatable: false, can_create: false });
  });

  test('jamais de nom de module, de classe, de variable d’environnement ni de trace', async () => {
    const json = JSON.stringify(await registry.getCatalog());
    expect(json).not.toMatch(/module|Connector\b|ALIEXPRESS_|CJ_|EBAY_|ALLEGRO_|\.js|stack|process\.env|access[_-]?token|refresh[_-]?token/i);
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
  test('un connecteur sans contrat d onboarding ne peut jamais devenir une source', async () => {
    mockFacts.mockReturnValue(FACTS.map((fact) => fact.adapter === 'cj'
      ? { ...fact, onboarding_ready: false, onboarding: { status: 'missing' }, reason: 'Étude API / onboarding fournisseur incomplet' }
      : fact));
    mockQuery.mockResolvedValue({ rows: [{ source_id: 'api:cj' }] });

    await expect(registry.createSource({ adapter: 'cj' })).rejects.toMatchObject({
      status: 409,
      code: 'sourcing_source_onboarding_contract_required',
    });
    expect(sqlCalls().some(({ sql }) => /INSERT INTO sourcing_sources/.test(sql))).toBe(false);
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

  test('connexion valide : déléguée à l’autorité crédentielle (secrets côté serveur seulement)', async () => {
    mockCredentialTest.mockResolvedValue({ source_ref: 'api:cj', ok: true, code: 'connection_ok', message: 'Connexion valide', tested_at: '2026-10-01T01:00:00Z' });

    const result = await registry.testSourceConnection('api:cj');

    expect(result).toEqual({ source_ref: 'api:cj', ok: true, code: 'connection_ok', message: 'Connexion valide', tested_at: '2026-10-01T01:00:00Z' });
    expect(mockCredentialTest).toHaveBeenCalledWith('api:cj', expect.any(Object));
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  test('connexion impossible : raison métier courte, jamais de message brut ni de secret', async () => {
    mockCredentialTest.mockResolvedValue({ source_ref: 'api:cj', ok: false, code: 'credentials_rejected', message: 'Le fournisseur a refusé les identifiants.', tested_at: null, extra: 'x' });

    const result = await registry.testSourceConnection('api:cj');

    expect(result).toEqual({ source_ref: 'api:cj', ok: false, code: 'credentials_rejected', message: 'Le fournisseur a refusé les identifiants.', tested_at: null });
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

describe('cycle de vie : archiver / restaurer (jamais de suppression)', () => {
  const source = (overrides = {}) => ({ source_ref: 'api:cj', status: 'active', autopilot_enabled: true, ...overrides });
  const clientSql = () => mockClientQuery.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));

  beforeEach(() => { mockClientQuery.mockResolvedValue({ rows: [] }); });

  test('archiver : autopilot OFF + statut disabled + trace, dans une transaction', async () => {
    mockRequireSource.mockResolvedValue(source());
    await expect(registry.archiveSource('api:cj', { id: 7 })).resolves.toEqual({ source_ref: 'api:cj', archived: true, changed: true });
    const calls = clientSql();
    expect(calls[0].sql).toBe('BEGIN');
    expect(calls.find((c) => /UPDATE sourcing_sources/.test(c.sql)).params).toEqual(['api:cj', 'disabled']);
    expect(calls.find((c) => /UPDATE sourcing_sources/.test(c.sql)).sql).toMatch(/autopilot_enabled = false/);
    const event = calls.find((c) => /sourcing_provider_control_events/.test(c.sql));
    expect(event.params).toEqual(['api:cj', true, false, '7', 'operator_source_archive']);
    expect(calls[calls.length - 1].sql).toBe('COMMIT');
    expect(mockRelease).toHaveBeenCalled();
  });

  test('aucune suppression : ni DELETE, ni TRUNCATE, ni toucher aux capacités ou à la certification', async () => {
    mockRequireSource.mockResolvedValue(source());
    await registry.archiveSource('api:cj', null);
    const sql = clientSql().map((c) => c.sql).join('\n');
    expect(sql).not.toMatch(/DELETE|TRUNCATE|DROP/i);
    expect(sql).not.toMatch(/discovery_enabled|sync_enabled|import_enabled|production_enabled|production_certified/);
    expect(sql).not.toMatch(/sourcing_captures|sourcing_observations/);
  });

  test('restaurer : statut active, autopilot reste OFF', async () => {
    mockRequireSource.mockResolvedValue(source({ status: 'disabled', autopilot_enabled: false }));
    await expect(registry.restoreSource('api:cj', { id: 7 })).resolves.toEqual({ source_ref: 'api:cj', archived: false, changed: true });
    const update = clientSql().find((c) => /UPDATE sourcing_sources/.test(c.sql));
    expect(update.params).toEqual(['api:cj', 'active']);
    expect(update.sql).toMatch(/autopilot_enabled = false/);
    expect(clientSql().find((c) => /control_events/.test(c.sql)).params.slice(1, 3)).toEqual([false, true]);
  });

  test('idempotent : déjà archivée ou déjà active, aucune écriture', async () => {
    mockRequireSource.mockResolvedValue(source({ status: 'disabled', autopilot_enabled: false }));
    await expect(registry.archiveSource('api:cj')).resolves.toMatchObject({ changed: false, archived: true });
    mockRequireSource.mockResolvedValue(source());
    await expect(registry.restoreSource('api:cj')).resolves.toMatchObject({ changed: false, archived: false });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  test('échec SQL : ROLLBACK, client libéré, erreur propagée', async () => {
    mockRequireSource.mockResolvedValue(source());
    mockClientQuery.mockImplementation(async (sql) => { if (/INSERT INTO sourcing_provider_control_events/.test(sql)) throw new Error('boom'); return { rows: [] }; });
    await expect(registry.archiveSource('api:cj')).rejects.toThrow('boom');
    expect(clientSql().some((c) => c.sql === 'ROLLBACK')).toBe(true);
    expect(mockRelease).toHaveBeenCalled();
  });

  test('source inconnue : l’erreur de requireSource remonte, aucune écriture', async () => {
    mockRequireSource.mockRejectedValue(Object.assign(new Error('introuvable'), { status: 404 }));
    await expect(registry.archiveSource('api:nope')).rejects.toMatchObject({ status: 404 });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  test('le catalogue signale une source archivée (restaurable, non recréable)', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/status <> 'active'/.test(sql)) return { rows: [{ source_id: 'api:cj' }] };
      return { rows: [{ source_id: 'api:cj' }] };
    });
    const { connectors } = await registry.getCatalog();
    expect(connectors.find((c) => c.adapter === 'cj')).toMatchObject({ existing_source_ref: 'api:cj', existing_archived: true, can_create: false });
  });
});

describe('mise à jour : libellé opérateur uniquement', () => {
  beforeEach(() => { mockRequireSource.mockResolvedValue({ source_ref: 'api:cj', status: 'active' }); });

  test('renomme sans toucher au connecteur ni aux états de sécurité', async () => {
    await expect(registry.updateSource('api:cj', { label: '  CJ   principal ' })).resolves.toEqual({ source_ref: 'api:cj', label: 'CJ principal' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['api:cj', 'CJ principal']);
    expect(String(sql)).toMatch(/SET display_name = \$2/);
    expect(String(sql)).not.toMatch(/autopilot|enabled|certified|adapter_type|status/);
  });

  test('libellé vide : retour au libellé du connecteur', async () => {
    await expect(registry.updateSource('api:cj', { label: '   ' })).resolves.toEqual({ source_ref: 'api:cj', label: null });
    expect(mockQuery.mock.calls[0][1]).toEqual(['api:cj', null]);
  });

  test.each([[{}], [{ adapter: 'ebay' }], [{ autopilot_enabled: true }], [{ label: 'x' }], [{ label: 'y'.repeat(81) }]])('refus %j sans écriture', async (body) => {
    await expect(registry.updateSource('api:cj', body)).rejects.toMatchObject({ status: 400 });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('demandes « connecteur requis » : modifier / retirer', () => {
  const row = { request_id: 'r1', provider_name: 'BigBuy', requested_label: 'BigBuy EU', reference_url: null, status: 'connector_required', created_at: 'x' };

  test('modifie le nom et la référence', async () => {
    mockQuery.mockResolvedValue({ rows: [row] });
    const result = await registry.updateConnectorRequest('r1', { requested_label: ' BigBuy  EU ', reference_url: ' https://bigbuy.eu ' });
    expect(result).toMatchObject({ request_ref: 'r1', requested_label: 'BigBuy EU' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['r1', 'BigBuy EU', 'https://bigbuy.eu']);
    expect(String(sql)).not.toMatch(/provider_name\s*=|status\s*=/);
  });

  test('demande inconnue ou identifiant mal formé : 404', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(registry.updateConnectorRequest('r9', { requested_label: 'Ok' })).rejects.toMatchObject({ status: 404 });
    mockQuery.mockRejectedValue(Object.assign(new Error('bad uuid'), { code: '22P02' }));
    await expect(registry.updateConnectorRequest('zzz', { requested_label: 'Ok' })).rejects.toMatchObject({ status: 404 });
  });

  test('modification vide ou nom invalide : 400 sans écriture', async () => {
    await expect(registry.updateConnectorRequest('r1', {})).rejects.toMatchObject({ status: 400 });
    await expect(registry.updateConnectorRequest('r1', { requested_label: 'a' })).rejects.toMatchObject({ status: 400 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('retirer : supprime uniquement la demande, jamais une source', async () => {
    mockQuery.mockResolvedValue({ rows: [{ request_id: 'r1' }] });
    await expect(registry.deleteConnectorRequest('r1')).resolves.toEqual({ request_ref: 'r1', deleted: true });
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/DELETE FROM sourcing_source_requests/);
    expect(String(mockQuery.mock.calls[0][0])).not.toMatch(/sourcing_sources/);
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(registry.deleteConnectorRequest('r2')).rejects.toMatchObject({ status: 404 });
  });
});
