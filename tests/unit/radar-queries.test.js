'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/radar-queries.js (R9)
 *
 * Couvre :
 *   getDetail / computeDetailFallback — fonctions pures (caractérisation)
 *   getOrdersByDetail — guard via ALLOWED_DETAILS (route 400 si invalide)
 *   getAlerts / getMoneyCards / getStatusDetails — comportement avec mock db
 *   invalidateCache — vide bien le cache mémoire
 *
 * db et utils/rules sont mockés (aucune connexion réelle).
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/rules', () => ({
  getRuleNumber: jest.fn(async (key, def) => def),
}));

const db = require('../../db');
const { getRuleNumber } = require('../../utils/rules');
const radarQueries = require('../../services/radar-queries');

beforeEach(() => {
  jest.clearAllMocks();
  getRuleNumber.mockImplementation(async (key, def) => def);
  radarQueries.invalidateCache();
});

// ── ALLOWED_DETAILS ───────────────────────────────────────────────────────────

describe('ALLOWED_DETAILS', () => {
  it('contient les 8 buckets de status_detail', () => {
    expect(radarQueries.ALLOWED_DETAILS).toEqual([
      'full_available', 'partial_available', 'partial_collected',
      'remaining_in_transit', 'awaiting_stock', 'fully_cancelled',
      'fully_collected', 'no_parcels',
    ]);
  });
});

// ── computeDetailFallback (fonction pure de secours) ──────────────────────────

describe('computeDetailFallback', () => {
  const { computeDetailFallback } = radarQueries;

  it('retourne null si parcels vide ou absent', () => {
    expect(computeDetailFallback([])).toBeNull();
    expect(computeDetailFallback(undefined)).toBeNull();
  });

  it('fully_cancelled si tous cancelled', () => {
    expect(computeDetailFallback([{ status: 'cancelled' }, { status: 'cancelled' }]))
      .toBe('fully_cancelled');
  });

  it('fully_collected si tous collected', () => {
    expect(computeDetailFallback([{ status: 'collected' }, { status: 'collected' }]))
      .toBe('fully_collected');
  });

  it('remaining_in_transit si collected + in_transit', () => {
    expect(computeDetailFallback([{ status: 'collected' }, { status: 'in_transit' }]))
      .toBe('remaining_in_transit');
  });

  it('remaining_in_transit si collected + shipped', () => {
    expect(computeDetailFallback([{ status: 'collected' }, { status: 'shipped' }]))
      .toBe('remaining_in_transit');
  });

  it('partial_collected si collected + available', () => {
    expect(computeDetailFallback([{ status: 'collected' }, { status: 'available' }]))
      .toBe('partial_collected');
  });

  it('partial_available si available + shipped', () => {
    expect(computeDetailFallback([{ status: 'available' }, { status: 'shipped' }]))
      .toBe('partial_available');
  });

  it('partial_available si available + in_transit', () => {
    expect(computeDetailFallback([{ status: 'available' }, { status: 'in_transit' }]))
      .toBe('partial_available');
  });

  it('full_available si tous available', () => {
    expect(computeDetailFallback([{ status: 'available' }, { status: 'available' }]))
      .toBe('full_available');
  });

  it('awaiting_stock si draft ou preparation présent', () => {
    expect(computeDetailFallback([{ status: 'draft' }, { status: 'preparation' }]))
      .toBe('awaiting_stock');
  });

  it('retourne null si aucune règle ne correspond', () => {
    expect(computeDetailFallback([{ status: 'unknown_status' }])).toBeNull();
  });
});

// ── getDetail ──────────────────────────────────────────────────────────────────

describe('getDetail', () => {
  it('retourne une valeur cohérente pour un cas simple (fully_collected)', () => {
    const r = radarQueries.getDetail([{ status: 'collected' }, { status: 'collected' }]);
    expect(r).toBe('fully_collected');
  });

  it('retourne une valeur «no detail» pour une liste vide', () => {
    const r = radarQueries.getDetail([]);
    // computeOrderStatusDetail([]) -> 'none' ; fallback (computeDetailFallback) -> null
    expect(['none', null]).toContain(r);
  });
});

// ── getAlerts ─────────────────────────────────────────────────────────────────

// Ligne neutre pour toutes les requêtes COUNT/SUM génériques (A-E, G-M)
const ROW_ZERO = { cnt: 0, total_kmf: 0, total: 0, total_7d: 0, cancelled_7d: 0, agent_count: 0 };

function mockAlertsQueries(overrides = {}) {
  db.query.mockImplementation(async (sql) => {
    const s = sql.trim();
    // F. partialOrders — shape différente (parcel_statuses / parcel_ids)
    if (s.startsWith('SELECT o.id, o.reference')) {
      return overrides.partialOrders || { rows: [] };
    }
    // N. suspect agents — CTE agent_gaps
    if (s.includes('agent_gaps')) {
      return overrides.suspectAgents || { rows: [] };
    }
    return overrides.default ? overrides.default() : { rows: [ROW_ZERO] };
  });
}

describe('getAlerts', () => {
  it('retourne alerts=[] quand toutes les conditions sont sous les seuils', async () => {
    mockAlertsQueries();

    const result = await radarQueries.getAlerts();

    expect(result).toHaveProperty('alerts');
    expect(Array.isArray(result.alerts)).toBe(true);
    expect(result.total).toBe(result.alerts.length);
    expect(result.total).toBe(0);
  });

  it('déclenche CASH_OVERDUE si cashOverdue.cnt > 0', async () => {
    let call = 0;
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.startsWith('SELECT o.id, o.reference')) return { rows: [] };
      if (s.includes('agent_gaps')) return { rows: [] };
      call++;
      // A. cash overdue est la première requête générique exécutée
      if (call === 1) return { rows: [{ cnt: 3, total_kmf: 150000 }] };
      return { rows: [ROW_ZERO] };
    });

    const result = await radarQueries.getAlerts();
    const alert = result.alerts.find(a => a.code === 'CASH_OVERDUE');
    expect(alert).toBeDefined();
    expect(alert.level).toBe('critical');
    expect(alert.count).toBe(3);
    expect(alert.value_kmf).toBe(150000);
  });

  it('déclenche PARTIAL_COLLECTED_STALE si une commande de +7j a un colis collected + un available', async () => {
    const oldDate = new Date(Date.now() - 10 * 86400000).toISOString();
    mockAlertsQueries({
      partialOrders: {
        rows: [{
          id: 'o1', reference: 'R1', created_at: oldDate, total_kmf: 100,
          parcel_statuses: ['collected', 'available'], parcel_ids: ['p1', 'p2'],
        }],
      },
    });

    const result = await radarQueries.getAlerts();
    const alert = result.alerts.find(a => a.code === 'PARTIAL_COLLECTED_STALE');
    expect(alert).toBeDefined();
    expect(alert.count).toBe(1);
  });

  it('trie les alertes critical avant signal', async () => {
    let call = 0;
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.startsWith('SELECT o.id, o.reference')) return { rows: [] };
      if (s.includes('agent_gaps')) return { rows: [] };
      call++;
      // A. cash overdue -> critical
      if (call === 1) return { rows: [{ cnt: 1, total_kmf: 10 }] };
      // E. wallets -> signal (walletTotal >= walletTotalKmf default 5_000_000)
      if (call === 5) return { rows: [{ total: 6000000 }] };
      return { rows: [ROW_ZERO] };
    });

    const result = await radarQueries.getAlerts();
    const levels = result.alerts.map(a => a.level);
    const firstSignalIdx = levels.indexOf('signal');
    const lastCriticalIdx = levels.lastIndexOf('critical');
    if (firstSignalIdx !== -1 && lastCriticalIdx !== -1) {
      expect(lastCriticalIdx).toBeLessThan(firstSignalIdx);
    }
  });

  it('utilise le cache : un second appel rapproché ne refait pas les queries', async () => {
    mockAlertsQueries();

    await radarQueries.getAlerts();
    const callsAfterFirst = db.query.mock.calls.length;

    await radarQueries.getAlerts();
    const callsAfterSecond = db.query.mock.calls.length;

    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it('invalidateCache() force une nouvelle exécution des queries', async () => {
    mockAlertsQueries();

    await radarQueries.getAlerts();
    const callsAfterFirst = db.query.mock.calls.length;

    radarQueries.invalidateCache();
    await radarQueries.getAlerts();
    const callsAfterSecond = db.query.mock.calls.length;

    expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
  });
});

// ── getMoneyCards ─────────────────────────────────────────────────────────────

describe('getMoneyCards', () => {
  it('retourne 5 cards avec les ids attendus', async () => {
    db.query.mockResolvedValue({
      rows: [{
        ca_today_kmf: 100000, ca_yesterday_kmf: 50000, orders_today: 2, orders_yesterday: 1,
        ca_mtd_kmf: 500000, ca_prev_mtd_kmf: 400000,
        cnt: 0, total_kmf: 0, total: 0, active_count: 0,
        marge_mtd: 200000, marge_prev_mtd: 150000,
      }],
    });

    const result = await radarQueries.getMoneyCards();

    expect(result).toHaveProperty('cards');
    const ids = result.cards.map(c => c.id);
    expect(ids).toEqual(['ca_today', 'ca_mtd', 'cash_pending', 'wallets_total', 'marge_mtd']);
  });

  it('calcule delta_pct = 100 quand previous = 0 et current > 0', async () => {
    db.query.mockResolvedValue({
      rows: [{
        ca_today_kmf: 1000, ca_yesterday_kmf: 0, orders_today: 1, orders_yesterday: 0,
        ca_mtd_kmf: 1000, ca_prev_mtd_kmf: 0,
        cnt: 0, total_kmf: 0, total: 0, active_count: 0,
        marge_mtd: 0, marge_prev_mtd: 0,
      }],
    });

    const result = await radarQueries.getMoneyCards();
    const caToday = result.cards.find(c => c.id === 'ca_today');
    expect(caToday.comparison.delta_pct).toBe(100);
    expect(caToday.comparison.direction).toBe('up');
  });

  it('fallback marge via MARGE_PCT si la requête margin_kmf échoue', async () => {
    let call = 0;
    db.query.mockImplementation(async (sql) => {
      call++;
      const s = sql.trim();
      // La requête de marge (avec margin_kmf) doit échouer pour activer le fallback
      if (s.includes('margin_kmf')) {
        throw new Error('column margin_kmf does not exist');
      }
      if (s.includes('finance_config')) {
        throw new Error('finance_config not found');
      }
      return {
        rows: [{
          ca_today_kmf: 0, ca_yesterday_kmf: 0, orders_today: 0, orders_yesterday: 0,
          ca_mtd_kmf: 1000, ca_prev_mtd_kmf: 1000,
          cnt: 0, total_kmf: 0, total: 0, active_count: 0,
        }],
      };
    });
    getRuleNumber.mockImplementation(async (key, def) => key === 'MARGE_PCT' ? 40 : def);

    const result = await radarQueries.getMoneyCards();
    const marge = result.cards.find(c => c.id === 'marge_mtd');
    // caMtd=1000, margePct=40 -> margeMtd = round(1000*40/100) = 400
    expect(marge.value_kmf).toBe(400);
  });
});

// ── getStatusDetails ──────────────────────────────────────────────────────────

describe('getStatusDetails', () => {
  it('classe les commandes par status_detail et calcule les totaux', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 'o1', reference: 'REF-1', total_kmf: 1000, order_status: 'available',
          created_at: new Date().toISOString(), recipient_name: 'Alice', recipient_phone: '123',
          parcel_statuses: ['available', 'available'],
        },
        {
          id: 'o2', reference: 'REF-2', total_kmf: 2000, order_status: 'collected',
          created_at: new Date().toISOString(), recipient_name: 'Bob', recipient_phone: '456',
          parcel_statuses: ['collected', 'collected'],
        },
        {
          id: 'o3', reference: 'REF-3', total_kmf: 500, order_status: 'pending',
          created_at: new Date().toISOString(), recipient_name: 'Carol', recipient_phone: '789',
          parcel_statuses: [],
        },
      ],
    });

    const result = await radarQueries.getStatusDetails();

    expect(result.total_orders_analyzed).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.details.full_available.count).toBe(1);
    expect(result.details.full_available.value_kmf).toBe(1000);
    expect(result.details.fully_collected.count).toBe(1);
    expect(result.details.fully_collected.value_kmf).toBe(2000);
  });

  it('truncated=true si on atteint exactement RADAR_MAX_ORDERS (2000)', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      id: `o${i}`, reference: `REF-${i}`, total_kmf: 0, order_status: 'available',
      created_at: new Date().toISOString(), recipient_name: 'X', recipient_phone: '0',
      parcel_statuses: [],
    }));
    db.query.mockResolvedValue({ rows });

    const result = await radarQueries.getStatusDetails();
    expect(result.truncated).toBe(true);
    expect(result.total_orders_analyzed).toBe(2000);
  });
});

// ── getOrdersByDetail ─────────────────────────────────────────────────────────

describe('getOrdersByDetail', () => {
  it('filtre les commandes par computed_detail et calcule total_value_kmf', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 'o1', reference: 'REF-1', total_kmf: 1000, order_status: 'available',
          created_at: new Date().toISOString(), recipient_name: 'Alice', recipient_phone: '123',
          payment_mode: 'cash_relais', parcel_statuses: ['available', 'available'],
        },
        {
          id: 'o2', reference: 'REF-2', total_kmf: 2000, order_status: 'collected',
          created_at: new Date().toISOString(), recipient_name: 'Bob', recipient_phone: '456',
          payment_mode: 'cash_relais', parcel_statuses: ['collected', 'collected'],
        },
      ],
    });

    const result = await radarQueries.getOrdersByDetail('full_available');

    expect(result.detail).toBe('full_available');
    expect(result.count).toBe(1);
    expect(result.total_value_kmf).toBe(1000);
    expect(result.orders[0].id).toBe('o1');
  });

  it('retourne count=0 et orders=[] si aucune commande ne correspond', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const result = await radarQueries.getOrdersByDetail('fully_cancelled');

    expect(result.count).toBe(0);
    expect(result.total_value_kmf).toBe(0);
    expect(result.orders).toEqual([]);
  });
});

// ── getRadarSummary ───────────────────────────────────────────────────────────

describe('getRadarSummary', () => {
  it('retourne ok=true et alert_count depuis signals', async () => {
    db.query.mockResolvedValue({ rows: [{ c: 4 }] });

    const result = await radarQueries.getRadarSummary();

    expect(result.ok).toBe(true);
    expect(result.alert_count).toBe(4);
    expect(result).toHaveProperty('generated_at');
    expect(result).toHaveProperty('hint');
  });

  it('alert_count=0 si la table signals n\'existe pas', async () => {
    db.query.mockRejectedValue(new Error('relation "signals" does not exist'));

    const result = await radarQueries.getRadarSummary();

    expect(result.ok).toBe(true);
    expect(result.alert_count).toBe(0);
  });
});
