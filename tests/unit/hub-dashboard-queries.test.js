'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/hub-dashboard-queries.js
 *
 * Invariants couverts :
 *   getDashboardKPIs  : agrège orders/parcels/incidents/stock en parallèle défensif ;
 *                       une erreur partielle ne fait pas planter la fonction (catch interne)
 *   getQueue          : pagination safe (page >= 1, limit <= 100) ; filtrage par tab ;
 *                       retourne { data, pagination, tab }
 *   getOrderDetail    : retourne null si commande absente ;
 *                       agrège items, parcels, timeline, incidents, comments, client_history
 *   getValidation     : retourne null si commande absente ;
 *                       can_prepare:false si NO_ITEMS ;
 *                       ajoute STOCK_RUPTURE en error / STOCK_PARTIAL en warning ;
 *                       ajoute UNPAID warning si payment_status != 'paid' et mode != cash
 *
 * DB mockée — aucune connexion Postgres.
 */

// ─── Mock db ─────────────────────────────────────────────────────────────────
let mockQuery;
jest.mock('../../db', () => ({ get query() { return mockQuery; } }));
jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn(), warn: jest.fn() }) }));

function loadService() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
  jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn(), warn: jest.fn() }) }));
  return require('../../services/hub-dashboard-queries');
}

beforeEach(() => {
  mockQuery = jest.fn();
});

// ─── getDashboardKPIs ─────────────────────────────────────────────────────────
describe("getDashboardKPIs", () => {
  function successMocks() {
    return jest.fn()
      // orders KPI row
      .mockResolvedValueOnce({ rows: [{ to_prepare: '5', in_preparation: '3', shipped_today: '1',
        shipped_total: '10', urgent: '2', cash_pending: '1', pending: '0', total_active: '8' }] })
      // orders today count
      .mockResolvedValueOnce({ rows: [{ c: '4' }] })
      // parcels
      .mockResolvedValueOnce({ rows: [{ draft: '2', preparation: '3', shipped: '1', in_transit: '2', at_relay: '0' }] })
      // incidents
      .mockResolvedValueOnce({ rows: [{ open_count: '1', critical_count: '0' }] })
      // stock
      .mockResolvedValueOnce({ rows: [{ c: '3' }] });
  }

  test("retourne les 4 sections (orders, parcels, incidents, stock)", async () => {
    mockQuery = successMocks();
    const svc = loadService();
    const kpis = await svc.getDashboardKPIs();
    expect(kpis.orders.to_prepare).toBe(5);
    expect(kpis.orders.today).toBe(4);
    expect(kpis.parcels.draft).toBe(2);
    expect(kpis.incidents.open).toBe(1);
    expect(kpis.stock.low_stock_count).toBe(3);
  });

  test("une erreur sur orders ne fait pas planter, retourne défaut 0", async () => {
    mockQuery = jest.fn()
      .mockRejectedValueOnce(new Error('DB down')) // orders KPI error
      .mockRejectedValueOnce(new Error('DB down')) // orders today error
      .mockResolvedValueOnce({ rows: [{ draft: '0', preparation: '0', shipped: '0', in_transit: '0', at_relay: '0' }] })
      .mockResolvedValueOnce({ rows: [{ open_count: '0', critical_count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ c: '0' }] });
    const svc = loadService();
    const kpis = await svc.getDashboardKPIs();
    expect(kpis.orders.to_prepare).toBe(0);
    expect(kpis.parcels).toBeDefined();
  });
});

// ─── getQueue ─────────────────────────────────────────────────────────────────
describe("getQueue", () => {
  function queueMocks(rows = []) {
    return jest.fn()
      .mockResolvedValueOnce({ rows: [{ count: String(rows.length) }] }) // count
      .mockResolvedValueOnce({ rows });                                   // data
  }

  test("retourne { data, pagination, tab } avec tab par défaut to_prepare", async () => {
    mockQuery = queueMocks([{ id: 'o1', reference: 'REF001' }]);
    const svc = loadService();
    const result = await svc.getQueue();
    expect(result.tab).toBe('to_prepare');
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
    expect(result.pagination.page).toBe(1);
  });

  test("page < 1 est normalisée à 1", async () => {
    mockQuery = queueMocks([]);
    const svc = loadService();
    const result = await svc.getQueue({ page: -5, limit: 10 });
    expect(result.pagination.page).toBe(1);
  });

  test("limit > 100 est plafonnée à 100", async () => {
    mockQuery = queueMocks([]);
    const svc = loadService();
    const result = await svc.getQueue({ limit: 999 });
    expect(result.pagination.limit).toBe(100);
  });

  test("tab=blocked déclenche le filtre open incidents", async () => {
    mockQuery = queueMocks([]);
    const svc = loadService();
    await svc.getQueue({ tab: 'blocked' });
    const [countSql] = mockQuery.mock.calls[0];
    expect(countSql).toMatch(/order_incidents/);
  });
});

// ─── getOrderDetail ───────────────────────────────────────────────────────────
describe("getOrderDetail", () => {
  test("retourne null si commande introuvable", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    const svc = loadService();
    const result = await svc.getOrderDetail('ord-ghost');
    expect(result).toBeNull();
  });

  test("nominal : retourne un objet avec items, parcels, meta", async () => {
    const order = { id: 'ord-1', user_id: 'u1', payment_mode: 'stripe', payment_status: 'paid',
                    total_kmf: 15000, created_at: new Date().toISOString() };
    const items  = [{ id: 'oi-1', product_id: 'p1', quantity: 2, price_kmf: 5000, stock_status: 'ok' }];
    const parcel = { id: 'pcl-1', reference: 'P001', status: 'preparation',
                     shipped_at: null, prepared_at: null, created_at: new Date().toISOString() };

    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [order] })              // SELECT order
      .mockResolvedValueOnce({ rows: items })                // items
      .mockResolvedValueOnce({ rows: [parcel] })             // parcels
      .mockResolvedValueOnce({ rows: [] })                   // parcel items for pcl-1
      .mockResolvedValueOnce({ rows: [] })                   // timeline
      .mockResolvedValueOnce({ rows: [] })                   // incidents
      .mockResolvedValueOnce({ rows: [] })                   // comments
      .mockResolvedValueOnce({ rows: [{ total_orders: '3', completed: '2', cancelled: '0', first_order: null }] }); // client history

    const svc = loadService();
    const detail = await svc.getOrderDetail('ord-1');
    expect(detail).not.toBeNull();
    expect(detail.items).toHaveLength(1);
    expect(detail.parcels).toHaveLength(1);
    expect(detail.meta.items_count).toBe(1);
    expect(detail.meta.age_hours).toBeGreaterThanOrEqual(0);
  });
});

// ─── getValidation ────────────────────────────────────────────────────────────
describe("getValidation", () => {
  test("retourne null si commande introuvable", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    const svc = loadService();
    expect(await svc.getValidation('ghost')).toBeNull();
  });

  test("can_prepare:false et error NO_ITEMS si aucun article", async () => {
    const order = { id: 'ord-1', status: 'confirmed', payment_mode: 'stripe', payment_status: 'paid', total_kmf: 10000 };
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [order] })         // 1. SELECT order
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }) // 2. item count = 0
      .mockResolvedValueOnce({ rows: [] })              // 3. stock check
      .mockResolvedValueOnce({ rows: [] })              // 4. parcels destination check
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }) // 5. assigned count
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }); // 6. open incidents

    const svc = loadService();
    const v = await svc.getValidation('ord-1');
    expect(v.can_prepare).toBe(false);
    expect(v.errors.some(e => e.code === 'NO_ITEMS')).toBe(true);
  });

  test("error STOCK_RUPTURE si un article est en rupture", async () => {
    const order = { id: 'ord-2', status: 'confirmed', payment_mode: 'stripe', payment_status: 'paid', total_kmf: 10000 };
    const stockItem = { id: 'oi-1', name: 'Riz 5kg', quantity: 3, stock: 0, status: 'rupture' };
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [order] })          // 1. SELECT order
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] })  // 2. item count
      .mockResolvedValueOnce({ rows: [stockItem] })      // 3. stock check
      .mockResolvedValueOnce({ rows: [] })               // 4. parcels destination
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })  // 5. assigned count
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }); // 6. incidents

    const svc = loadService();
    const v = await svc.getValidation('ord-2');
    expect(v.errors.some(e => e.code === 'STOCK_RUPTURE')).toBe(true);
    expect(v.can_prepare).toBe(false);
  });

  test("warning UNPAID si paiement non cash et non paye", async () => {
    const order = { id: 'ord-3', status: 'confirmed', payment_mode: 'stripe', payment_status: 'pending', total_kmf: 10000 };
    const stockItem = { id: 'oi-1', name: 'Produit', quantity: 1, stock: 10, status: 'ok' };
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [order] })          // 1. SELECT order
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] })  // 2. item count
      .mockResolvedValueOnce({ rows: [stockItem] })      // 3. stock check
      .mockResolvedValueOnce({ rows: [] })               // 4. parcels destination
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] })  // 5. assigned count
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }); // 6. incidents

    const svc = loadService();
    const v = await svc.getValidation('ord-3');
    expect(v.warnings.some(w => w.code === 'UNPAID')).toBe(true);
    // Pas de stock error → can_prepare true (malgré warning)
    expect(v.errors).toHaveLength(0);
  });

  test("checks_passed:true si aucune erreur ni warning", async () => {
    const order = { id: 'ord-4', status: 'confirmed', payment_mode: 'stripe', payment_status: 'paid', total_kmf: 10000 };
    const stockItem = { id: 'oi-1', name: 'Produit', quantity: 1, stock: 5, status: 'ok' };
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [order] })          // 1. SELECT order
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] })  // 2. item count
      .mockResolvedValueOnce({ rows: [stockItem] })      // 3. stock check
      .mockResolvedValueOnce({ rows: [] })               // 4. parcels destination
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] })  // 5. assigned count (= item count)
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }); // 6. incidents

    const svc = loadService();
    const v = await svc.getValidation('ord-4');
    expect(v.checks_passed).toBe(true);
    expect(v.can_prepare).toBe(true);
  });
});
