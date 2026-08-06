'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/noon-connector.test.js
 * Couvre services/suppliers/connectors/noon-connector.js
 *
 * Placeholder désactivé — aucun appel HTTP réel. fetchProducts() doit
 * systématiquement lever une erreur explicite (jamais simuler une réponse).
 */

const { NoonConnector, IS_ACTIVE, INACTIVE_REASON } = require('../../services/suppliers/connectors/noon-connector');

describe('exports d\'état', () => {
  it('IS_ACTIVE est false', () => {
    expect(IS_ACTIVE).toBe(false);
  });

  it('INACTIVE_REASON est un message explicite renvoyant vers le fichier source', () => {
    expect(INACTIVE_REASON).toMatch(/Noon/);
    expect(INACTIVE_REASON).toMatch(/noon-connector\.js/);
  });
});

describe('constructeur NoonConnector', () => {
  it('config par défaut → supplier_name "Noon", base_url null, auth_type "none"', () => {
    const connector = new NoonConnector();
    expect(connector.config.supplier_name).toBe('Noon');
    expect(connector.config.base_url).toBeNull();
    expect(connector.config.auth_type).toBe('none');
    expect(connector.config.api_key_env).toBe('NOON_API_KEY');
  });

  it('config personnalisée (base_url, auth_type) → surcharge les valeurs par défaut', () => {
    const connector = new NoonConnector({ base_url: 'https://api.noon.com', auth_type: 'apikey' });
    expect(connector.config.base_url).toBe('https://api.noon.com');
    expect(connector.config.auth_type).toBe('apikey');
  });

  it('api_key_env personnalisé → conservé', () => {
    const connector = new NoonConnector({ api_key_env: 'CUSTOM_NOON_KEY' });
    expect(connector.config.api_key_env).toBe('CUSTOM_NOON_KEY');
  });

  it('hérite bien de ApiConnectorBase', () => {
    const { ApiConnectorBase } = require('../../services/suppliers/connectors/api-connector.base');
    const connector = new NoonConnector();
    expect(connector).toBeInstanceOf(ApiConnectorBase);
  });
});

describe('fetchProducts — non implémenté', () => {
  it('rejette systématiquement avec un message explicite', async () => {
    const connector = new NoonConnector();
    await expect(connector.fetchProducts()).rejects.toThrow('[Noon] Connecteur API non actif.');
  });

  it('le message mentionne les alternatives (import CSV, saisie manuelle)', async () => {
    const connector = new NoonConnector();
    await expect(connector.fetchProducts()).rejects.toThrow(/import CSV ou la saisie manuelle/);
  });

  it('rejette même avec des options fournies (aucune ne permet de contourner)', async () => {
    const connector = new NoonConnector();
    await expect(connector.fetchProducts({ page: 1, force: true })).rejects.toThrow('[Noon] Connecteur API non actif.');
  });

  it('rejette quel que soit le base_url/auth_type configuré (placeholder, pas de vérif ensureConfigured)', async () => {
    const connector = new NoonConnector({ base_url: 'https://api.noon.com', auth_type: 'apikey' });
    await expect(connector.fetchProducts()).rejects.toThrow('[Noon] Connecteur API non actif.');
  });
});
