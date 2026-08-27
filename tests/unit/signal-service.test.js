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
    expect(params[2]).toBe('Colis bloqué'); // aucun UUID interne dans le titre public
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

// ─── LOT 4H — Decision Signals Truth ──────────────────────────────────────────
describe("LOT 4H truth generators", () => {
  test("les trois pseudo-vérités historiques ne sont plus des generators actifs", () => {
    const { GENERATORS } = loadService();
    expect(GENERATORS).not.toHaveProperty('stock_rupture');
    expect(GENERATORS).not.toHaveProperty('margin_drift');
    expect(GENERATORS).not.toHaveProperty('dispute_sensitive');
  });

  test("retire les anciens signaux actifs sans toucher la donnée métier", async () => {
    mockQuery = jest.fn().mockResolvedValueOnce({ rowCount: 3 });
    const { retireObsoleteSignalTypes } = loadService();
    const count = await retireObsoleteSignalTypes();
    expect(count).toBe(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE signals/);
    expect(sql).toContain("status IN ('open','acknowledged','snoozed')");
    expect(params[0]).toEqual(['stock_rupture', 'margin_drift', 'dispute_sensitive']);
  });

  test("ordered_without_purchase_order utilise ordered + PO active + fenêtre 15 min", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-PO', minutes_waiting: 37 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.ordered_without_purchase_order();
    expect(result.generated).toBe(1);
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain("o.status = 'ordered'");
    expect(selectSql).toContain("INTERVAL '15 minutes'");
    expect(selectSql).toContain('FROM purchase_orders po');
    const [, params] = mockQuery.mock.calls[1];
    expect(params[0]).toBe('ordered_without_purchase_order');
    expect(params[9]).toBe('order');
    expect(params[10]).toBe('o1');
  });

  test("purchase_order_overreceived compare received_qty à la vraie colonne qty", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o2', reference: 'CMD-OVER', po_count: 2, excess_qty: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's2' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.purchase_order_overreceived();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('po.received_qty > po.qty');
    expect(selectSql).not.toContain('po.quantity');
    const [, params] = mockQuery.mock.calls[1];
    expect(params[0]).toBe('purchase_order_overreceived');
    expect(params[1]).toBe('critical');
  });

  test("purchase_order_receipt_stuck exige toutes les PO complètes et horodatées", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o3', reference: 'CMD-STUCK', po_count: 2, minutes_stuck: 31 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's3' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.purchase_order_receipt_stuck();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain("o.status = 'ordered'");
    expect(selectSql).toContain('BOOL_AND(po.received_qty >= po.qty AND po.hub_received_at IS NOT NULL)');
    expect(selectSql).toContain("INTERVAL '15 minutes'");
  });

  test("pickup_overdue utilise available_at, pas updated_at", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o4', reference: 'CMD-PICK', days_waiting: 9 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's4' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.pickup_overdue();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('o.available_at');
    expect(selectSql).toContain("INTERVAL '7 days'");
    expect(selectSql).not.toContain('o.updated_at');
  });

  test("preparation_stuck utilise preparation_at, pas updated_at", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o5', reference: 'CMD-PREP', days_stuck: 6 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's5' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.preparation_stuck();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('o.preparation_at');
    expect(selectSql).toContain("INTERVAL '4 days'");
    expect(selectSql).not.toContain('o.updated_at');
  });

  test("chaque nouveau generator auto-résout le signal quand sa condition disparaît", async () => {
    const names = [
      'ordered_without_purchase_order',
      'purchase_order_overreceived',
      'purchase_order_receipt_stuck',
      'pickup_overdue',
      'preparation_stuck',
    ];
    for (const name of names) {
      mockQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 });
      const { GENERATORS } = loadService();
      const result = await GENERATORS[name]();
      expect(result.generated).toBe(0);
      const [resolveSql, params] = mockQuery.mock.calls[1];
      expect(resolveSql).toContain("status = 'resolved'");
      expect(params).toEqual([name]);
    }
  });
});
