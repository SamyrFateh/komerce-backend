'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const mockTransition = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransition(...args),
}));
const { syncOrderFromParcels } = require('../../services/scan-engine');

const allCollected = {
  active: '1', collected: '1', available: '0', in_transit: '0', pending: '0',
};
function setup({ stats = allCollected, coverage = { total_lines: 2, still_due: 0 } } = {}) {
  const queries = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('AS total_lines')) return { rows: coverage ? [coverage] : [] };
      if (sql.includes('COUNT(*) FILTER (WHERE status')) return { rows: [stats] };
      return { rows: [], rowCount: 1 };
    }),
  };
  return { client, queries };
}
beforeEach(() => mockTransition.mockClear());

describe('RC-2 — clôture de commande uniquement sur couverture physique intégrale', () => {
  test('tous les colis collected avec une ligne encore due ne clôturent pas', async () => {
    const { client, queries } = setup({ coverage: { total_lines: 2, still_due: 1 } });
    await syncOrderFromParcels(client, 'order-A');
    expect(mockTransition).not.toHaveBeenCalled();
    const coverageSql = queries.find(q => q.sql.includes('AS total_lines'));
    expect(coverageSql.params).toEqual(['order-A']);
    expect(coverageSql.sql).toContain('FROM order_items oi');
    expect(coverageSql.sql).toContain('pi.order_item_id = oi.id');
    expect(coverageSql.sql).toContain('SUM(pi.qty_collected)');
    expect(coverageSql.sql).toContain("p.status <> 'cancelled'");
  });

  test('quantité partielle encore due ne clôture pas', async () => {
    const { client } = setup({ coverage: { total_lines: 1, still_due: 1 } });
    await syncOrderFromParcels(client, 'order-B');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('toutes les lignes remises : mockTransition via la machine SSOT', async () => {
    const { client } = setup({ coverage: { total_lines: 3, still_due: 0 } });
    await syncOrderFromParcels(client, 'order-C');
    expect(mockTransition).toHaveBeenCalledTimes(1);
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-C', newStatus: 'collected', dbClient: client,
      source: 'scan_engine_sync',
    }));
  });

  test('aucune ligne rattachée : ne pas convertir un colis vide en commande complète', async () => {
    const { client } = setup({ coverage: { total_lines: 0, still_due: 0 } });
    await syncOrderFromParcels(client, 'order-D');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('absence de preuve de couverture : fail-closed', async () => {
    const { client } = setup({ coverage: null });
    await syncOrderFromParcels(client, 'order-E');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('colis disponible : statut available sans requête de couverture terminale', async () => {
    const { client, queries } = setup({
      stats: { active: '2', collected: '1', available: '1', in_transit: '0', pending: '0' },
    });
    await syncOrderFromParcels(client, 'order-F');
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      newStatus: 'available',
    }));
    expect(queries.some(q => q.sql.includes('AS total_lines'))).toBe(false);
  });

  test('plusieurs colis collected mais un expédié : pas de clôture finale', async () => {
    const { client } = setup({
      stats: { active: '3', collected: '2', available: '0', in_transit: '1', pending: '0' },
    });
    await syncOrderFromParcels(client, 'order-G');
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      newStatus: 'in_transit',
    }));
    expect(mockTransition).not.toHaveBeenCalledWith(expect.objectContaining({
      newStatus: 'collected',
    }));
  });
});
