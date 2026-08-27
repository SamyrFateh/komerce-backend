'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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
    expect(sql).toContain("WHERE status IN ('open','acknowledged','snoozed')");
    expect(sql).toContain("WHEN signals.status = 'snoozed' AND signals.snoozed_until <= NOW() THEN 'open'");
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

// ─── GENERATORS.parcel_blocked ─────────────────────────────────────────────────
describe("GENERATORS.parcel_blocked", () => {
  test("aucune ligne → generated:0, autoResolve appelé en mode 'resolve tout' (entityIds vide)", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [] })   // SELECT
      .mockResolvedValueOnce({ rowCount: 0 }); // autoResolve — branche "resolve ALL"
    const { GENERATORS } = loadService();

    const result = await GENERATORS.parcel_blocked();

    expect(result).toEqual({ generated: 0, resolved: 0 });
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).not.toMatch(/entity_id != ALL/);
    expect(params).toEqual(['parcel_blocked']);
  });

  test("severity critical si days_stuck > 7, recommandation escalade, résumé avec référence", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'p1', tracking_number: 'TRK1', status: 'in_transit', days_stuck: 9, reference: 'CMD-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] }) // upsertSignal
      .mockResolvedValueOnce({ rowCount: 0 });           // autoResolve

    const { GENERATORS } = loadService();
    const result = await GENERATORS.parcel_blocked();

    expect(result.generated).toBe(1);
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('critical');           // severity
    expect(params[2]).toMatch(/Colis bloqué — TRK1/); // title (tracking_number)
    expect(params[3]).toMatch(/CMD-1/);            // summary avec référence
    expect(params[11]).toMatch(/escalader/);       // recommendation
  });

  test("severity warning si 5 < days_stuck <= 7", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'p1', tracking_number: null, status: 'available', days_stuck: 6 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const { GENERATORS } = loadService();
    await GENERATORS.parcel_blocked();

    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('warning');
    expect(params[2]).toMatch(/Colis bloqué — p1/); // title fallback sur id (pas de tracking_number)
    expect(params[3]).not.toMatch(/cmd/); // pas de référence
  });

  test("severity info si days_stuck <= 5, recommandation 'Vérifier le suivi'", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'p1', tracking_number: 'TRK2', status: 'available', days_stuck: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const { GENERATORS } = loadService();
    await GENERATORS.parcel_blocked();

    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('info');
    expect(params[11]).toMatch(/Vérifier le suivi/);
  });

  test("erreur DB → catch non-fatal, { generated: 0, error }", async () => {
    mockQuery = jest.fn().mockRejectedValueOnce(new Error('db down'));
    const { GENERATORS } = loadService();
    const result = await GENERATORS.parcel_blocked();
    expect(result).toEqual({ generated: 0, error: 'db down' });
  });
});

// ─── GENERATORS.cash_expiring ───────────────────────────────────────────────────
describe("GENERATORS.cash_expiring", () => {
  test("aucune ligne → generated:0", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.cash_expiring();
    expect(result).toEqual({ generated: 0 });
  });

  test("severity critical si days_pending > 10, titre avec montant formaté, résumé avec référence", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'cc1', order_id: 'o1', amount: 150000, relay_id: 'r1', days_pending: 12, reference: 'CMD-2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const { GENERATORS } = loadService();
    const result = await GENERATORS.cash_expiring();

    expect(result.generated).toBe(1);
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('critical');
    expect(params[2]).toContain(`${(150000).toLocaleString('fr-FR')} KMF`);
    expect(params[3]).toMatch(/CMD-2/);
  });

  test("severity warning si days_pending <= 10, résumé sans référence si absente", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'cc1', order_id: 'o1', amount: null, relay_id: 'r1', days_pending: 6 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const { GENERATORS } = loadService();
    await GENERATORS.cash_expiring();

    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('warning');
    expect(params[2]).toMatch(/0 KMF/); // amount fallback à 0
    expect(params[3]).not.toMatch(/cmd/);
  });

  test("erreur DB → catch non-fatal", async () => {
    mockQuery = jest.fn().mockRejectedValueOnce(new Error('db down'));
    const { GENERATORS } = loadService();
    const result = await GENERATORS.cash_expiring();
    expect(result).toEqual({ generated: 0, error: 'db down' });
  });
});

// ─── GENERATORS.stock_rupture ───────────────────────────────────────────────────
describe("GENERATORS.stock_rupture", () => {
  test("aucune ligne → generated:0", async () => {
    mockQuery = jest.fn().mockResolvedValueOnce({ rows: [] });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.stock_rupture();
    expect(result).toEqual({ generated: 0 });
  });

  test("génère un signal 'info' par produit sans vente, pas d'autoResolve (revue manuelle)", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'prod1', name: 'Power Bank', category: 'tech', price_kmf: 25000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] }); // upsertSignal — pas de 3e appel (pas d'autoResolve)

    const { GENERATORS } = loadService();
    const result = await GENERATORS.stock_rupture();

    expect(result).toEqual({ generated: 1 });
    expect(mockQuery).toHaveBeenCalledTimes(2); // SELECT + upsert, jamais autoResolve
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('info');
    expect(params[2]).toMatch(/Power Bank/);
    expect(params[3]).toMatch(/tech/);
  });

  test("nom de produit absent → titre replié sur chaîne vide tronquée", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'prod2', name: null, category: 'mode', price_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig2' }] });

    const { GENERATORS } = loadService();
    const result = await GENERATORS.stock_rupture();

    expect(result).toEqual({ generated: 1 });
    const [, params] = mockQuery.mock.calls[1];
    expect(params[2]).toBe('Produit sans vente — ');
  });

  test("erreur DB → catch non-fatal", async () => {
    mockQuery = jest.fn().mockRejectedValueOnce(new Error('db down'));
    const { GENERATORS } = loadService();
    const result = await GENERATORS.stock_rupture();
    expect(result).toEqual({ generated: 0, error: 'db down' });
  });
});

// ─── GENERATORS.margin_drift ────────────────────────────────────────────────────
describe("GENERATORS.margin_drift", () => {
  test("aucune ligne → generated:0", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.margin_drift();
    expect(result).toEqual({ generated: 0 });
  });

  test("calcule avgPerItem correctement et génère le signal 'warning'", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-3', total_kmf: 12000, items: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const { GENERATORS } = loadService();
    const result = await GENERATORS.margin_drift();

    expect(result.generated).toBe(1);
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('warning');
    expect(params[3]).toContain(`${(4000).toLocaleString('fr-FR')} KMF (3 articles)`); // 12000/3 = 4000
  });

  test("erreur DB → catch non-fatal", async () => {
    mockQuery = jest.fn().mockRejectedValueOnce(new Error('db down'));
    const { GENERATORS } = loadService();
    const result = await GENERATORS.margin_drift();
    expect(result).toEqual({ generated: 0, error: 'db down' });
  });
});

// ─── GENERATORS.dispute_sensitive ───────────────────────────────────────────────
describe("GENERATORS.dispute_sensitive", () => {
  test("aucune ligne → generated:0", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.dispute_sensitive();
    expect(result).toEqual({ generated: 0 });
  });

  test("severity critical + recommandation escalade si days_in_status > 5, résumé avec nom client", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-4', status: 'disputed', total_kmf: 50000, days_in_status: 8, client_name: 'Ahmed', phone: '+269000' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const { GENERATORS } = loadService();
    const result = await GENERATORS.dispute_sensitive();

    expect(result.generated).toBe(1);
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('critical');
    expect(params[3]).toMatch(/Ahmed/);
    expect(params[11]).toMatch(/Escalader/);
  });

  test("severity warning + recommandation traiter rapidement si days_in_status <= 5, résumé sans nom client", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-5', status: 'problem', total_kmf: 20000, days_in_status: 2, client_name: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const { GENERATORS } = loadService();
    const result = await GENERATORS.dispute_sensitive();

    expect(result.generated).toBe(1);
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe('warning');
    expect(params[11]).toMatch(/rapidement/);
  });

  test("reference absente → titre replié sur l'id", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-123456', reference: null, status: 'problem', total_kmf: 10000, days_in_status: 1, client_name: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sig1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const { GENERATORS } = loadService();
    await GENERATORS.dispute_sensitive();

    const [, params] = mockQuery.mock.calls[1];
    expect(params[2]).toBe('Litige — cmd ' + 'order-uuid-123456'.substring(0, 12));
  });

  test("erreur DB → catch non-fatal", async () => {
    mockQuery = jest.fn().mockRejectedValueOnce(new Error('db down'));
    const { GENERATORS } = loadService();
    const result = await GENERATORS.dispute_sensitive();
    expect(result).toEqual({ generated: 0, error: 'db down' });
  });
});
