/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : services/suppliers/connectors/api-connector.base (Lot D4)
 *
 * Classe abstraite (interface) instanciée directement pour tester ses
 * helpers concrets : constructor (défauts), ensureConfigured (3 guards),
 * buildHeaders (none/apikey/bearer), fetchProducts (abstract → throw),
 * finalize (délègue à partitionValid, réel — non mocké).
 *
 * Seul tests/unit/noon-connector.test.js touchait indirectement cette
 * classe (via héritage), d'où la faible couverture branches (28.94%) —
 * la sous-classe n'exerce jamais tous les guards de la base.
 *
 * Run : npx jest tests/unit/api-connector-base.test.js
 */

'use strict';

const { ApiConnectorBase } = require('../../services/suppliers/connectors/api-connector.base');

describe('ApiConnectorBase — constructor', () => {
  test('applique tous les défauts si config vide', () => {
    const c = new ApiConnectorBase();
    expect(c.config).toEqual({
      supplier_name: 'Unknown API supplier',
      base_url: null,
      auth_type: 'none',
      api_key_env: null,
      extra_headers: {},
      pagination: null,
      category_mapping: {},
    });
  });

  test('applique tous les défauts si aucun argument (config = {} par défaut)', () => {
    const c = new (class extends ApiConnectorBase {})();
    expect(c.config.supplier_name).toBe('Unknown API supplier');
  });

  test('reprend les valeurs fournies sans les écraser', () => {
    const c = new ApiConnectorBase({
      supplier_name: 'Noon',
      base_url: 'https://api.noon.com',
      auth_type: 'bearer',
      api_key_env: 'NOON_API_KEY',
      extra_headers: { 'X-Custom': '1' },
      pagination: { type: 'page', page_size: 50 },
      category_mapping: { 'noon-1': 'electronics' },
    });
    expect(c.config).toEqual({
      supplier_name: 'Noon',
      base_url: 'https://api.noon.com',
      auth_type: 'bearer',
      api_key_env: 'NOON_API_KEY',
      extra_headers: { 'X-Custom': '1' },
      pagination: { type: 'page', page_size: 50 },
      category_mapping: { 'noon-1': 'electronics' },
    });
  });
});

describe('ApiConnectorBase — ensureConfigured', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
  afterAll(() => { process.env = ORIGINAL_ENV; });

  test('lève si base_url manquant', () => {
    const c = new ApiConnectorBase({ supplier_name: 'Shein' });
    expect(() => c.ensureConfigured()).toThrow(/base_url manquante/);
    expect(() => c.ensureConfigured()).toThrow(/Shein/);
  });

  test('lève si auth_type != none et api_key_env manquant', () => {
    const c = new ApiConnectorBase({ supplier_name: 'Temu', base_url: 'https://api.temu.com', auth_type: 'apikey' });
    expect(() => c.ensureConfigured()).toThrow(/api_key_env manquante/);
  });

  test('lève si api_key_env défini mais variable d\'environnement absente', () => {
    delete process.env.SOME_MISSING_KEY;
    const c = new ApiConnectorBase({
      supplier_name: 'Noon', base_url: 'https://api.noon.com',
      auth_type: 'apikey', api_key_env: 'SOME_MISSING_KEY',
    });
    expect(() => c.ensureConfigured()).toThrow(/SOME_MISSING_KEY.*non définie/);
  });

  test('ne lève rien si auth_type=none et base_url présent (api_key_env non requis)', () => {
    const c = new ApiConnectorBase({ supplier_name: 'Manual', base_url: 'https://x.com' });
    expect(() => c.ensureConfigured()).not.toThrow();
  });

  test('ne lève rien si tout est correctement configuré (apikey + env var présente)', () => {
    process.env.NOON_KEY = 'secret-value';
    const c = new ApiConnectorBase({
      supplier_name: 'Noon', base_url: 'https://api.noon.com',
      auth_type: 'apikey', api_key_env: 'NOON_KEY',
    });
    expect(() => c.ensureConfigured()).not.toThrow();
  });
});

describe('ApiConnectorBase — buildHeaders', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
  afterAll(() => { process.env = ORIGINAL_ENV; });

  test('auth_type=none → seulement Accept + extra_headers', () => {
    const c = new ApiConnectorBase({ extra_headers: { 'X-Foo': 'bar' } });
    expect(c.buildHeaders()).toEqual({ Accept: 'application/json', 'X-Foo': 'bar' });
  });

  test('auth_type=apikey → ajoute X-API-Key depuis process.env', () => {
    process.env.SUPPLIER_KEY = 'abc123';
    const c = new ApiConnectorBase({ auth_type: 'apikey', api_key_env: 'SUPPLIER_KEY' });
    expect(c.buildHeaders()).toEqual({ Accept: 'application/json', 'X-API-Key': 'abc123' });
  });

  test('auth_type=apikey sans api_key_env → pas de header ajouté (garde combinée)', () => {
    const c = new ApiConnectorBase({ auth_type: 'apikey', api_key_env: null });
    expect(c.buildHeaders()).toEqual({ Accept: 'application/json' });
  });

  test('auth_type=bearer → ajoute Authorization "Bearer <valeur>"', () => {
    process.env.SUPPLIER_TOKEN = 'tok_xyz';
    const c = new ApiConnectorBase({ auth_type: 'bearer', api_key_env: 'SUPPLIER_TOKEN' });
    expect(c.buildHeaders()).toEqual({ Accept: 'application/json', Authorization: 'Bearer tok_xyz' });
  });

  test('auth_type=bearer sans api_key_env → pas de header Authorization', () => {
    const c = new ApiConnectorBase({ auth_type: 'bearer', api_key_env: null });
    expect(c.buildHeaders()).toEqual({ Accept: 'application/json' });
  });

  test('auth_type=oauth (ou inconnu) → aucun header spécifique (à implémenter en sous-classe)', () => {
    const c = new ApiConnectorBase({ auth_type: 'oauth', api_key_env: 'X' });
    expect(c.buildHeaders()).toEqual({ Accept: 'application/json' });
  });
});

describe('ApiConnectorBase — fetchProducts (abstract)', () => {
  test('lève une erreur explicite "non implémenté"', async () => {
    const c = new ApiConnectorBase({ supplier_name: 'Shein' });
    await expect(c.fetchProducts()).rejects.toThrow(/fetchProducts\(\) non implémenté/);
    await expect(c.fetchProducts()).rejects.toThrow(/Shein/);
  });

  test('accepte des options sans les utiliser (signature respectée)', async () => {
    const c = new ApiConnectorBase();
    await expect(c.fetchProducts({ page: 2 })).rejects.toThrow();
  });
});

describe('ApiConnectorBase — finalize (délègue à partitionValid, réel)', () => {
  test('sépare produits valides et invalides, calcule total', () => {
    const c = new ApiConnectorBase();
    const products = [
      { product_name: 'T-shirt', supplier_name: 'Noon', purchase_price: 10, currency: 'EUR', raw_payload: { name: 'T-shirt' } },
      { product_name: '', supplier_name: 'Noon', currency: 'EUR', raw_payload: {} }, // invalide : product_name vide
      { product_name: 'Sac', supplier_name: 'Noon', currency: 'XXX', raw_payload: {} }, // invalide : currency
    ];
    const result = c.finalize(products);
    expect(result.total).toBe(3);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].product_name).toBe('T-shirt');
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid[0].errors).toContain('product_name requis');
  });

  test('liste vide → products/invalid vides, total 0', () => {
    const c = new ApiConnectorBase();
    expect(c.finalize([])).toEqual({ products: [], invalid: [], total: 0 });
  });

  test('undefined → traité comme liste vide (garde "products || []")', () => {
    const c = new ApiConnectorBase();
    expect(c.finalize(undefined)).toEqual({ products: [], invalid: [], total: 0 });
  });
});
