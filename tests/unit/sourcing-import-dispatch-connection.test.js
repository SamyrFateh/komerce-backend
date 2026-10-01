'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockCjTest = jest.fn();
const mockAliTest = jest.fn();
const mockEbayTest = jest.fn();
const mockAllegroTest = jest.fn();

jest.mock('../../services/suppliers/connectors/csv-connector', () => ({ fetchProducts: jest.fn() }));
jest.mock('../../services/suppliers/connectors/manual-connector', () => ({ fetchProducts: jest.fn() }));
jest.mock('../../services/suppliers/connectors/noon-connector', () => ({ IS_ACTIVE: false, INACTIVE_REASON: 'NOON_API_KEY manquante' }));
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  IS_ACTIVE: true, INACTIVE_REASON: null, fetchProducts: jest.fn(), testConnection: (...a) => mockCjTest(...a),
}));
jest.mock('../../services/suppliers/connectors/aliexpress-connected-connector', () => ({
  IS_ACTIVE: true, INACTIVE_REASON: null, fetchProducts: jest.fn(), discoverAcquisitionPlan: jest.fn(), testConnection: (...a) => mockAliTest(...a),
}));
jest.mock('../../services/suppliers/connectors/allegro-connector', () => ({
  IS_ACTIVE: false, INACTIVE_REASON: 'ALLEGRO_CLIENT_SECRET manquant', fetchProducts: jest.fn(), testConnection: (...a) => mockAllegroTest(...a),
}));
jest.mock('../../services/suppliers/connectors/ebay-connector', () => ({
  IS_ACTIVE: true, INACTIVE_REASON: null, fetchProducts: jest.fn(), testConnection: (...a) => mockEbayTest(...a),
}));

const dispatch = require('../../services/sourcing-import-dispatch');

beforeEach(() => jest.clearAllMocks());

describe('faits opérateur sur les connecteurs', () => {
  const facts = () => Object.fromEntries(dispatch.sourceConnectorFacts().map((fact) => [fact.adapter, fact]));

  test('une entrée par connecteur API du registre, jamais dupliquée côté frontend', () => {
    expect(Object.keys(facts()).sort()).toEqual(['aliexpress', 'allegro', 'cj', 'ebay', 'noon']);
  });

  test('disponible + automatisable : AliExpress (OAuth) et CJ', () => {
    expect(facts().aliexpress).toMatchObject({
      available: true, automatable: true, connection_mode: 'oauth',
      connect_path: '/api/integrations/aliexpress/oauth/start', can_test_connection: true, reason: null,
    });
    expect(facts().cj).toMatchObject({ available: true, automatable: true, connection_mode: 'server_managed', connect_path: null, reason: null });
  });

  test('eBay : connecteur présent mais autopilot non certifié', () => {
    expect(facts().ebay).toMatchObject({ available: true, automatable: false });
    expect(facts().ebay.reason).toMatch(/non certifiée/);
  });

  test('Noon : connecteur présent mais non disponible, sans fuite de la raison technique', () => {
    expect(facts().noon).toMatchObject({ available: false, automatable: false, can_test_connection: false });
    expect(JSON.stringify(dispatch.sourceConnectorFacts())).not.toMatch(/NOON_API_KEY|ALLEGRO_CLIENT_SECRET|manquant/);
  });

  test('Allegro non configuré : indisponible avec une raison métier', () => {
    expect(facts().allegro).toMatchObject({ available: false, automatable: true, reason: 'Connecteur non configuré sur ce serveur' });
  });
});

describe('test de connexion réel', () => {
  test('connexion valide : appelle le test du connecteur, rien d’autre', async () => {
    mockCjTest.mockResolvedValue({ ok: true });
    await expect(dispatch.testConnection('CJ ')).resolves.toEqual({ ok: true, code: 'connection_ok', message: 'Connexion valide' });
    expect(mockCjTest).toHaveBeenCalledTimes(1);
  });

  test('connecteur inconnu : refus fail-closed', async () => {
    await expect(dispatch.testConnection('bigbuy')).resolves.toMatchObject({ ok: false, code: 'connector_unknown' });
    await expect(dispatch.testConnection('')).resolves.toMatchObject({ ok: false, code: 'connector_unknown' });
  });

  test('connecteur non disponible : le test fournisseur n’est jamais tenté', async () => {
    await expect(dispatch.testConnection('allegro')).resolves.toMatchObject({ ok: false, code: 'connector_unavailable' });
    await expect(dispatch.testConnection('noon')).resolves.toMatchObject({ ok: false, code: 'connector_unavailable' });
    expect(mockAllegroTest).not.toHaveBeenCalled();
  });

  test.each([
    ['EBAY_OAUTH_REJECTED_401', 'credentials_rejected'],
    ['[CJdropshipping] HTTP 403 forbidden', 'credentials_rejected'],
    ['ALLEGRO_TRANSPORT_UNAVAILABLE', 'provider_unreachable'],
    ['fetch failed ECONNRESET', 'provider_unreachable'],
    ['[AliExpress OAuth] compte AliExpress non autorisé; ouvrir /api/integrations/aliexpress/oauth/start', 'account_not_connected'],
    ['[AliExpress OAuth] refresh token expiré; nouvelle autorisation AliExpress requise', 'authorization_expired'],
    ['quelque chose d’inattendu', 'connection_failed'],
  ])('échec « %s » → %s', async (raw, code) => {
    mockAliTest.mockRejectedValue(new Error(raw));
    const result = await dispatch.testConnection('aliexpress');
    expect(result).toMatchObject({ ok: false, code });
    expect(result.message).not.toContain(raw);
    expect(result.message).not.toMatch(/oauth\/start|HTTP|ECONN|Error|stack/i);
  });

  test('un message d’erreur contenant un secret n’est jamais renvoyé', async () => {
    mockCjTest.mockRejectedValue(new Error('apiKey=sk_live_SUPERSECRET rejected 401'));
    const result = await dispatch.testConnection('cj');
    expect(JSON.stringify(result)).not.toMatch(/SUPERSECRET|apiKey/);
    expect(result.code).toBe('credentials_rejected');
  });
});
