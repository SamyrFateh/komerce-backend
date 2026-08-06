/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : shared-cart-internals (P0 shared-cart)
 *
 * Couvre les helpers internes partagés par creation/reads/contributions/lifecycle :
 * génération de token Base58, arrondi numérique, wrapper transactionnel
 * (commit/rollback), et insertion d'event d'audit.
 *
 * Run : npx jest tests/unit/shared-cart-internals.test.js
 */

'use strict';

const mockGetClient = jest.fn();
jest.mock('../../db', () => ({
  getClient: (...args) => mockGetClient(...args),
  // P5-N3 : primitive partagée, calquée sur l'implémentation réelle (db.js)
  // pour que les assertions BEGIN/COMMIT/ROLLBACK existantes restent valides.
  withTransaction: async (callback) => {
    const client = await mockGetClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
}));

const { CONFIG, generateToken, r, withTransaction, addEvent } = require('../../services/shared-cart-internals');

describe('CONFIG', () => {
  test('expose les constantes métier attendues', () => {
    expect(CONFIG.TOKEN_LENGTH).toBe(16);
    expect(CONFIG.MAX_ACTIVE_CARTS_PER_USER).toBe(5);
  });
});

describe('generateToken', () => {
  test('génère un token de la longueur configurée', () => {
    const token = generateToken();
    expect(token).toHaveLength(CONFIG.TOKEN_LENGTH);
  });

  test('ne contient que des caractères Base58 (sans 0/O/I/l)', () => {
    const token = generateToken();
    expect(token).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  test('génère des tokens différents à chaque appel', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateToken()));
    expect(tokens.size).toBeGreaterThan(1);
  });
});

describe('r (arrondi numérique sûr)', () => {
  test('arrondit un nombre décimal', () => {
    expect(r(12.6)).toBe(13);
    expect(r(12.4)).toBe(12);
  });

  test('convertit une chaîne numérique', () => {
    expect(r('42.9')).toBe(43);
  });

  test('retourne 0 pour les valeurs non numériques', () => {
    expect(r(undefined)).toBe(0);
    expect(r(null)).toBe(0);
    expect(r('abc')).toBe(0);
  });
});

describe('withTransaction', () => {
  test('commit si le callback réussit et release le client', async () => {
    const mockClient = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    mockGetClient.mockResolvedValueOnce(mockClient);

    const result = await withTransaction(async (client) => {
      expect(client).toBe(mockClient);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('rollback et propage l\'erreur si le callback échoue, puis release', async () => {
    const mockClient = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    mockGetClient.mockResolvedValueOnce(mockClient);

    await expect(
      withTransaction(async () => {
        throw new Error('callback failed');
      })
    ).rejects.toThrow('callback failed');

    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('release le client même si COMMIT échoue', async () => {
    const mockClient = {
      query: jest.fn()
        .mockResolvedValueOnce({})  // BEGIN
        .mockRejectedValueOnce(new Error('commit failed')) // COMMIT throws
        .mockResolvedValueOnce({}), // ROLLBACK in catch
      release: jest.fn(),
    };
    mockGetClient.mockResolvedValueOnce(mockClient);

    await expect(withTransaction(async () => 'value')).rejects.toThrow('commit failed');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});

describe('addEvent', () => {
  test('insère un event d\'audit avec actor et payload', async () => {
    const mockClient = { query: jest.fn().mockResolvedValue({}) };

    await addEvent(mockClient, 'cart-1', 'created', { type: 'user', id: 'u1' }, { amount: 100 });

    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockClient.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO shared_cart_events/);
    expect(params).toEqual(['cart-1', 'created', 'user', 'u1', { amount: 100 }]);
  });

  test('tolère un actor absent (null/null) et un payload vide ({})', async () => {
    const mockClient = { query: jest.fn().mockResolvedValue({}) };

    await addEvent(mockClient, 'cart-2', 'expired', null, null);

    const [, params] = mockClient.query.mock.calls[0];
    expect(params).toEqual(['cart-2', 'expired', null, null, {}]);
  });
});
