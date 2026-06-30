'use strict';

/**
 * Tests unitaires — signal-service.js
 *
 * Invariants couverts :
 *   upsertSignal        : appelle db.query avec les 15 paramètres attendus,
 *                         retourne la ligne insérée
 *   autoResolveSignals  : sans entityIds → UPDATE global ; avec entityIds → WHERE … != ALL($2)
 *   expireOldSignals    : appelle UPDATE signals SET status='expired' et retourne rowCount
 *   generateSignals     : expire d'abord, puis appelle les generators demandés ;
 *                         un générateur inconnu renvoie { error: '...' }
 *
 * DB mockée — aucune connexion Postgres.
 * log.warn / log.info mockés — aucune sortie console.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────
let mockQuery;
jest.mock('../../db', () => ({
  get query() { return mockQuery; }
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// ─── Reset ───────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockQuery = jest.fn();
  jest.resetModules();
});

function loadService() {
  jest.resetModules();
  // Ré-injecter le mock après reset
  jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
  jest.mock('../../utils/logger', () => ({
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  }));
  return require('../../services/signal-service');
}

// ─── upsertSignal ─────────────────────────────────────────────────────────────
describe("upsertSignal", () => {
  test("appelle db.query avec 15 paramètres et retourne la ligne", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'sig-1' }] });
    const { upsertSignal } = loadService();

    const sig = {
      signal_type: 'parcel_blocked',
      severity: 'critical',
      title: 'Colis bloqué',
      entity_type: 'parcel',
      entity_id: 'parcel-uuid',
    };

    const result = await upsertSignal(sig);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO signals/);
    expect(sql).toMatch(/ON CONFLICT/);
    expect(params).toHaveLength(15);
    expect(result).toEqual({ id: 'sig-1' });
  });

  test("les valeurs par défaut sont appliquées", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'sig-2' }] });
    const { upsertSignal } = loadService();

    await upsertSignal({ signal_type: 'test', title: 'T' });
    const [, params] = mockQuery.mock.calls[0];

    // severity par défaut = 'warning' (index 1)
    expect(params[1]).toBe('warning');
    // source_module par défaut = 'signal-service' (index 4)
    expect(params[4]).toBe('signal-service');
    // owner_role par défaut = 'admin' (index 8)
    expect(params[8]).toBe('admin');
  });
});

// ─── autoResolveSignals ───────────────────────────────────────────────────────
describe("autoResolveSignals", () => {
  test("sans entityIds → UPDATE global (pas de WHERE entity_id)", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 3 });
    const { autoResolveSignals } = loadService();

    await autoResolveSignals('parcel_blocked', []);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE signals/);
    expect(sql).toMatch(/status = 'resolved'/);
    expect(params).toEqual(['parcel_blocked']);
    expect(sql).not.toMatch(/entity_id != ALL/);
  });

  test("avec entityIds → WHERE entity_id != ALL($2)", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 1 });
    const { autoResolveSignals } = loadService();

    await autoResolveSignals('cash_expiring', ['id-1', 'id-2']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/entity_id != ALL/);
    expect(params[0]).toBe('cash_expiring');
    expect(params[1]).toEqual(['id-1', 'id-2']);
  });
});

// ─── expireOldSignals ─────────────────────────────────────────────────────────
describe("expireOldSignals", () => {
  test("exécute UPDATE signals SET status=expired et retourne rowCount", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 5 });
    const { expireOldSignals } = loadService();

    const n = await expireOldSignals();
    expect(n).toBe(5);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/status = 'expired'/);
    expect(sql).toMatch(/expires_at < NOW/);
  });

  test("retourne 0 si rowCount undefined", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: undefined });
    const { expireOldSignals } = loadService();
    const n = await expireOldSignals();
    expect(n).toBe(0);
  });
});

// ─── generateSignals ──────────────────────────────────────────────────────────
describe("generateSignals", () => {
  test("expire d'abord les signaux puis appelle chaque generator", async () => {
    // Premier appel = expireOldSignals
    // Appels suivants = requêtes des generators (parcels, cash, etc.)
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rowCount: 2 })      // expireOldSignals
      .mockResolvedValue({ rows: [], rowCount: 0 }); // generators

    const { generateSignals } = loadService();
    const result = await generateSignals(['parcel_blocked']);
    expect(result.expired).toBe(2);
    expect(result.generators).toHaveProperty('parcel_blocked');
  });

  test("un type inconnu retourne { error: \"Unknown generator...\" }", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const { generateSignals } = loadService();
    const result = await generateSignals(['nonexistent_type']);
    expect(result.generators.nonexistent_type).toMatchObject({ error: expect.stringContaining('Unknown generator') });
  });

  test("sans argument, lance tous les generators connus", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const { generateSignals, GENERATORS } = loadService();
    const knownTypes = Object.keys(GENERATORS);
    expect(knownTypes.length).toBeGreaterThan(0);

    const result = await generateSignals();
    knownTypes.forEach(t => {
      expect(result.generators).toHaveProperty(t);
    });
  });

  test("une erreur dans un generator est attrapée (non-fatal)", async () => {
    // expireOldSignals → ok, ensuite parcel_blocked → première requête lance
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rowCount: 0 })          // expire
      .mockRejectedValueOnce(new Error('DB down'))     // parcel_blocked select
      .mockResolvedValue({ rowCount: 0, rows: [] });

    const { generateSignals } = loadService();
    const result = await generateSignals(['parcel_blocked']);
    // Le generator doit retourner { generated: 0, error: '...' } sans planter
    expect(result.generators.parcel_blocked).toMatchObject({ generated: 0 });
  });
});
