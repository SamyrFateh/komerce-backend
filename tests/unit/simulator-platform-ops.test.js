'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/simulator/
 *
 * Couvre :
 *   journal.js   : log, getRecent, getAll, getForOrder, countSuccess, countChaos, clear
 *   scenarios.js : structure SCENARIOS (statique, pur)
 *   cleanup.js   : cleanup() — mock db
 *
 * engine.js et state-advancer.js utilisent setInterval + transitionOrderStatus
 * et nécessitent un bootstrap plus lourd — non couverts ici.
 */

// ══════════════════════════════════════════════════════════════════════════════
// JOURNAL
// ══════════════════════════════════════════════════════════════════════════════

describe("simulator/journal", () => {
  let journal;

  beforeEach(() => {
    jest.resetModules();
    journal = require('../../services/simulator/journal');
    // journal.log() s'appelle lui-même via log.info() — stub pour éviter TypeError
    journal.log.info = jest.fn();
    journal.clear();
  });

  test("log() ajoute une entrée avec time, ref, message", () => {
    journal.log('ord-1', 'REF001', 'nominal', 'Test message');
    const all = journal.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].orderId).toBe('ord-1');
    expect(all[0].ref).toBe('REF001');
    expect(all[0].message).toBe('Test message');
  });

  test("log() sans orderId → orderId:null, ref:\"—\"", () => {
    journal.log(null, null, null, 'Global message');
    const entry = journal.getAll()[0];
    expect(entry.orderId).toBeNull();
    expect(entry.ref).toBe('—');
  });

  test("success par défaut true, false si passé explicitement", () => {
    journal.log('o1', 'R1', 'sc', 'OK message');
    journal.log('o2', 'R2', 'sc', 'KO message', false);
    const all = journal.getAll();
    expect(all[0].success).toBe(true);
    expect(all[1].success).toBe(false);
  });

  test("getRecent(n) retourne les n dernières entrées", () => {
    for (let i = 0; i < 5; i++) journal.log('o', 'R', 'sc', `msg ${i}`);
    expect(journal.getRecent(3)).toHaveLength(3);
    expect(journal.getRecent(3)[2].message).toBe('msg 4'); // le plus récent en dernier
  });

  test("getForOrder() filtre par orderId", () => {
    journal.log('o-A', 'RA', 's', 'A1');
    journal.log('o-B', 'RB', 's', 'B1');
    journal.log('o-A', 'RA', 's', 'A2');
    expect(journal.getForOrder('o-A')).toHaveLength(2);
    expect(journal.getForOrder('o-B')).toHaveLength(1);
  });

  test("countSuccess() compte uniquement les entrées avec orderId et success:true", () => {
    journal.log('o1', 'R', 's', 'OK');       // success:true, orderId présent
    journal.log(null, null, null, 'Global');  // orderId null → non compté
    journal.log('o2', 'R', 's', 'KO', false);// success:false → non compté
    expect(journal.countSuccess()).toBe(1);
  });

  test("countChaos() compte les entrées contenant \"Chaos\" dans le message", () => {
    journal.log('o1', 'R', 's', 'Action normale');
    journal.log('o2', 'R', 's', 'Chaos: duplicate_scan');
    journal.log('o3', 'R', 's', 'Chaos: desync_payment');
    expect(journal.countChaos()).toBe(2);
  });

  test("clear() vide le journal", () => {
    journal.log('o', 'R', 's', 'msg');
    journal.clear();
    expect(journal.getAll()).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIOS (statique — aucun accès base)
// ══════════════════════════════════════════════════════════════════════════════

describe("simulator/scenarios", () => {
  let scenarios;

  beforeAll(() => {
    jest.resetModules();
    scenarios = require('../../services/simulator/scenarios');
  });

  test("SCENARIOS est exporté et non vide", () => {
    expect(scenarios.SCENARIOS).toBeDefined();
    expect(Object.keys(scenarios.SCENARIOS).length).toBeGreaterThan(0);
  });

  test("le scénario \"nominal\" existe avec ses steps", () => {
    const nom = scenarios.SCENARIOS.nominal;
    expect(nom).toBeDefined();
    expect(Array.isArray(nom.steps)).toBe(true);
    expect(nom.steps.length).toBeGreaterThan(0);
  });

  test("chaque scénario a name, steps et category", () => {
    for (const [key, sc] of Object.entries(scenarios.SCENARIOS)) {
      expect(sc.name).toBeDefined();
      expect(Array.isArray(sc.steps)).toBe(true);
      expect(sc.category).toBeDefined();
    }
  });

  test("chaque step a au moins \"action\"", () => {
    for (const sc of Object.values(scenarios.SCENARIOS)) {
      for (const step of sc.steps) {
        expect(step.action).toBeDefined();
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CLEANUP (mock db)
// ══════════════════════════════════════════════════════════════════════════════

describe("simulator/cleanup", () => {
  let mockQuery;

  function loadCleanup() {
    jest.resetModules();
    jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
    return require('../../services/simulator/cleanup');
  }

  beforeEach(() => {
    mockQuery = jest.fn();
  });

  test("nominal : exécute 3 DELETE et retourne les counts", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rowCount: 5 })  // parcel_items
      .mockResolvedValueOnce({ rowCount: 2 })  // parcels
      .mockResolvedValueOnce({ rowCount: 8 }); // scans

    const { cleanup } = loadCleanup();
    const result = await cleanup();
    expect(result.errors).toHaveLength(0);
    expect(result.deleted.parcel_items).toBe(5);
    expect(result.deleted.parcels).toBe(2);
    expect(result.deleted.scans).toBe(8);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  test("les DELETE filtrent sur notes LIKE \"%simulateur%\"", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rowCount: 0 });
    const { cleanup } = loadCleanup();
    await cleanup();
    const sqls = mockQuery.mock.calls.map(c => c[0]);
    expect(sqls[0]).toMatch(/simulateur/);
    expect(sqls[1]).toMatch(/simulateur/);
    expect(sqls[2]).toMatch(/simulateur/i);
  });

  test("une erreur DB est capturée dans errors[]", async () => {
    mockQuery = jest.fn().mockRejectedValue(new Error('DB error'));
    const { cleanup } = loadCleanup();
    const result = await cleanup();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/DB error/);
  });
});
