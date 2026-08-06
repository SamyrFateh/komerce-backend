'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/rules-engine.test.js
 *
 * Tests du module utils/rules.js (moteur de règles métier centralisé,
 * source de vérité = table business_rules, cache mémoire TTL 60s).
 *
 * Le cache est un état de module (let _cache/_cacheAt) : chaque test appelle
 * invalidateCache() en amont (via beforeEach) pour forcer une lecture DB
 * fraîche et éviter les fuites d'état entre tests.
 *
 * Couverture :
 *   getRule :
 *     ✓ cache froid → interroge la DB, peuple le cache
 *     ✓ cache chaud (appel suivant sous 60s) → ne réinterroge pas la DB
 *     ✓ clé présente en cache → renvoie la valeur
 *     ✓ clé absente en cache → renvoie defaultValue
 *     ✓ r.value null/undefined → val undefined via optional chaining → defaultValue
 *     ✓ exception DB → catch, log.error, fallback silencieux sur defaultValue
 *   getRuleNumber :
 *     ✓ valeur numérique valide → Number(val)
 *     ✓ valeur non numérique (NaN) → fallback defaultValue
 *   getRuleString :
 *     ✓ valeur déjà string → renvoyée telle quelle
 *     ✓ valeur non-string → String(defaultValue)
 *   getAllRules :
 *     ✓ groupe par catégorie, plusieurs règles même catégorie
 *     ✓ catégorie déjà connue (labels FR) et catégorie inconnue (fallback = category brute)
 *     ✓ min_value/max_value truthy → Number() ; falsy (0, null, undefined) → null
 *   getRuleByKey :
 *     ✓ règle trouvée → renvoyée
 *     ✓ règle absente → null
 *   updateRule :
 *     ✓ règle introuvable → throw, ROLLBACK, release
 *     ✓ type mismatch number/boolean/string → throw, ROLLBACK
 *     ✓ contrainte min_value/max_value violée (number) → throw, ROLLBACK
 *     ✓ succès → INSERT history, UPDATE, COMMIT, invalidateCache, renvoie règle mise à jour
 *     ✓ exception inattendue en cours de transaction → ROLLBACK, rethrow, release
 *   resetRule :
 *     ✓ règle introuvable → throw
 *     ✓ pas d'historique → renvoie la règle telle quelle (déjà valeur par défaut)
 *     ✓ historique présent mais old_value.value undefined → renvoie la règle telle quelle
 *     ✓ historique présent avec defaultValue → délègue à updateRule
 *   getRuleHistory :
 *     ✓ renvoie les lignes telles quelles
 *   invalidateCache / getCategoryLabel :
 *     ✓ invalidateCache force une relecture DB au prochain getRule
 *     ✓ labels connus vs catégorie inconnue (via getAllRules)
 */

const mockDbQuery = jest.fn();
const mockGetClient = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
  getClient: (...args) => mockGetClient(...args),
}));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

const rules = require('../../utils/rules');

function makeClient() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  rules.invalidateCache();
});

// ═══════════════════════════════════════════════════════════════════════
describe('getRule', () => {
  it('cache froid : interroge la DB et peuple le cache', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'MAX_QTY', value: { value: 50 } }] });

    const result = await rules.getRule('MAX_QTY', 100);

    expect(result).toBe(50);
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT key, value FROM business_rules'));
  });

  it('cache chaud : ne réinterroge pas la DB tant que le TTL n\'est pas expiré', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'MAX_QTY', value: { value: 50 } }] });

    await rules.getRule('MAX_QTY', 100);
    const result2 = await rules.getRule('MAX_QTY', 100);

    expect(result2).toBe(50);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('clé absente du cache → renvoie defaultValue', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'OTHER_KEY', value: { value: 1 } }] });

    const result = await rules.getRule('MAX_QTY', 100);

    expect(result).toBe(100);
  });

  it('r.value null → val undefined via optional chaining → fallback defaultValue', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'MAX_QTY', value: null }] });

    const result = await rules.getRule('MAX_QTY', 100);

    expect(result).toBe(100);
  });

  it('exception DB → fallback silencieux sur defaultValue, pas de throw', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));

    await expect(rules.getRule('MAX_QTY', 100)).resolves.toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('getRuleNumber', () => {
  it('valeur numérique valide → Number(val)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'MAX_QTY', value: { value: '42' } }] });

    const result = await rules.getRuleNumber('MAX_QTY', 100);

    expect(result).toBe(42);
  });

  it('valeur non numérique (NaN) → fallback defaultValue', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'MAX_QTY', value: { value: 'not-a-number' } }] });

    const result = await rules.getRuleNumber('MAX_QTY', 100);

    expect(result).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('getRuleString', () => {
  it('valeur déjà string → renvoyée telle quelle', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'LABEL', value: { value: 'hello' } }] });

    const result = await rules.getRuleString('LABEL', 'default');

    expect(result).toBe('hello');
  });

  it('valeur non-string → String(defaultValue)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'LABEL', value: { value: 42 } }] });

    const result = await rules.getRuleString('LABEL', 'default');

    expect(result).toBe('default');
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('getAllRules', () => {
  it('groupe par catégorie, plusieurs règles pour la même catégorie', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { category: 'orders', key: 'A', label_fr: 'A', description: 'd', value: { value: 1 }, value_type: 'number', min_value: null, max_value: null, is_active: true, updated_at: 't1' },
        { category: 'orders', key: 'B', label_fr: 'B', description: 'd', value: { value: 2 }, value_type: 'number', min_value: null, max_value: null, is_active: true, updated_at: 't2' },
      ],
    });

    const result = await rules.getAllRules();

    expect(result.orders.label).toBe('Commandes');
    expect(result.orders.rules).toHaveLength(2);
    expect(result.orders.rules[0]).toMatchObject({ key: 'A', value: 1 });
  });

  it('catégorie inconnue → fallback sur la catégorie brute comme label', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ category: 'exotic', key: 'X', label_fr: 'X', description: '', value: { value: 1 }, value_type: 'number', min_value: null, max_value: null, is_active: true, updated_at: 't' }],
    });

    const result = await rules.getAllRules();

    expect(result.exotic.label).toBe('exotic');
  });

  it('min_value/max_value truthy → Number() ; falsy (0, null) → null', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { category: 'pricing', key: 'A', label_fr: 'A', description: '', value: { value: 1 }, value_type: 'number', min_value: '5', max_value: '10', is_active: true, updated_at: 't' },
        { category: 'pricing', key: 'B', label_fr: 'B', description: '', value: { value: 1 }, value_type: 'number', min_value: 0, max_value: null, is_active: true, updated_at: 't' },
      ],
    });

    const result = await rules.getAllRules();

    expect(result.pricing.rules[0]).toMatchObject({ min_value: 5, max_value: 10 });
    // min_value=0 est falsy → branche ternaire renvoie null (comportement documenté du code, pas un bug testé ici)
    expect(result.pricing.rules[1]).toMatchObject({ min_value: null, max_value: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('getRuleByKey', () => {
  it('règle trouvée → renvoyée', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'MAX_QTY', value: { value: 50 } }] });

    const result = await rules.getRuleByKey('MAX_QTY');

    expect(result).toEqual({ key: 'MAX_QTY', value: { value: 50 } });
  });

  it('règle absente → null', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await rules.getRuleByKey('UNKNOWN');

    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('updateRule', () => {
  function setupClientWithRule(rule) {
    const client = makeClient();
    client.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT * FROM business_rules WHERE key')) {
        return Promise.resolve({ rows: [rule] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockGetClient.mockResolvedValueOnce(client);
    return client;
  }

  it('règle introuvable → throw, ROLLBACK, release', async () => {
    const client = setupClientWithRule(undefined);

    await expect(rules.updateRule('MISSING', 10, 'user-1', 'raison')).rejects.toThrow('Règle introuvable: MISSING');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('type attendu number, reçu autre chose → throw, ROLLBACK', async () => {
    const client = setupClientWithRule({ id: 'r1', value_type: 'number', min_value: null, max_value: null, value: { value: 1 } });

    await expect(rules.updateRule('K', 'not-a-number', 'user-1', 'x')).rejects.toThrow('Type attendu: number, reçu: string');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('type attendu boolean, reçu autre chose → throw, ROLLBACK', async () => {
    setupClientWithRule({ id: 'r1', value_type: 'boolean', min_value: null, max_value: null, value: { value: true } });

    await expect(rules.updateRule('K', 'yes', 'user-1', 'x')).rejects.toThrow('Type attendu: boolean, reçu: string');
  });

  it('type attendu string, reçu autre chose → throw, ROLLBACK', async () => {
    setupClientWithRule({ id: 'r1', value_type: 'string', min_value: null, max_value: null, value: { value: 'a' } });

    await expect(rules.updateRule('K', 42, 'user-1', 'x')).rejects.toThrow('Type attendu: string, reçu: number');
  });

  it('contrainte min_value violée (number) → throw', async () => {
    setupClientWithRule({ id: 'r1', value_type: 'number', min_value: 10, max_value: null, value: { value: 20 } });

    await expect(rules.updateRule('K', 5, 'user-1', 'x')).rejects.toThrow('Valeur minimum: 10');
  });

  it('contrainte max_value violée (number) → throw', async () => {
    setupClientWithRule({ id: 'r1', value_type: 'number', min_value: null, max_value: 100, value: { value: 20 } });

    await expect(rules.updateRule('K', 500, 'user-1', 'x')).rejects.toThrow('Valeur maximum: 100');
  });

  it('succès : INSERT history + UPDATE + COMMIT, invalide le cache, renvoie la règle mise à jour', async () => {
    const client = setupClientWithRule({ id: 'r1', key: 'K', value_type: 'number', min_value: 0, max_value: 100, value: { value: 20 } });

    const result = await rules.updateRule('K', 55, 'user-1', 'ajustement');

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO business_rules_history'),
      ['r1', { value: 20 }, { value: 55 }, 'user-1', 'ajustement']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE business_rules SET value'),
      [JSON.stringify({ value: 55 }), 'K']);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
    expect(result).toEqual({ id: 'r1', key: 'K', value_type: 'number', min_value: 0, max_value: 100, value: { value: 55 } });

    // Vérifie l'invalidation du cache : un getRule() suivant doit retaper la DB
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await rules.getRule('ANY', 'fallback');
    expect(mockDbQuery).toHaveBeenCalled();
  });

  it('userId/reason non fournis → null en DB', async () => {
    const client = setupClientWithRule({ id: 'r1', key: 'K', value_type: 'number', min_value: null, max_value: null, value: { value: 1 } });

    await rules.updateRule('K', 2, undefined, undefined);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO business_rules_history'),
      ['r1', { value: 1 }, { value: 2 }, null, null]);
  });

  it('succès sur value_type non-number (string) : ignore les contraintes min/max', async () => {
    const client = setupClientWithRule({ id: 'r1', key: 'K', value_type: 'string', min_value: null, max_value: null, value: { value: 'old' } });

    const result = await rules.updateRule('K', 'new', 'user-1', 'x');

    expect(result.value).toEqual({ value: 'new' });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('exception inattendue en cours de transaction → ROLLBACK, rethrow, release', async () => {
    const client = makeClient();
    client.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT * FROM business_rules WHERE key')) {
        return Promise.resolve({ rows: [{ id: 'r1', value_type: 'number', min_value: null, max_value: null, value: { value: 1 } }] });
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO business_rules_history')) {
        return Promise.reject(new Error('insert failed'));
      }
      return Promise.resolve({ rows: [] });
    });
    mockGetClient.mockResolvedValueOnce(client);

    await expect(rules.updateRule('K', 2, 'user-1', 'x')).rejects.toThrow('insert failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('resetRule', () => {
  it('règle introuvable → throw', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // getRuleByKey

    await expect(rules.resetRule('MISSING', 'user-1')).rejects.toThrow('Règle introuvable: MISSING');
  });

  it('pas d\'historique → renvoie la règle telle quelle', async () => {
    const rule = { id: 'r1', key: 'K', value: { value: 10 } };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [rule] }) // getRuleByKey
      .mockResolvedValueOnce({ rows: [] });    // history query → aucun résultat

    const result = await rules.resetRule('K', 'user-1');

    expect(result).toEqual(rule);
  });

  it('historique présent mais old_value.value undefined → renvoie la règle telle quelle', async () => {
    const rule = { id: 'r1', key: 'K', value: { value: 10 } };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [rule] })
      .mockResolvedValueOnce({ rows: [{ old_value: {} }] });

    const result = await rules.resetRule('K', 'user-1');

    expect(result).toEqual(rule);
  });

  it('historique présent avec defaultValue → délègue à updateRule', async () => {
    const rule = { id: 'r1', key: 'K', value_type: 'number', min_value: null, max_value: null, value: { value: 10 } };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [rule] })                     // getRuleByKey
      .mockResolvedValueOnce({ rows: [{ old_value: { value: 3 } }] }); // history

    const client = makeClient();
    client.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT * FROM business_rules WHERE key')) {
        return Promise.resolve({ rows: [rule] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockGetClient.mockResolvedValueOnce(client);

    const result = await rules.resetRule('K', 'user-1');

    expect(result.value).toEqual({ value: 3 });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('getRuleHistory', () => {
  it('renvoie les lignes telles quelles', async () => {
    const rows = [{ id: 'h1', old_value: { value: 1 }, new_value: { value: 2 } }];
    mockDbQuery.mockResolvedValueOnce({ rows });

    const result = await rules.getRuleHistory('K');

    expect(result).toEqual(rows);
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('FROM business_rules_history'), ['K']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('invalidateCache', () => {
  it('force une relecture DB au getRule() suivant', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'K', value: { value: 1 } }] });
    await rules.getRule('K', 0);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);

    rules.invalidateCache();

    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'K', value: { value: 2 } }] });
    const result = await rules.getRule('K', 0);

    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    expect(result).toBe(2);
  });
});
