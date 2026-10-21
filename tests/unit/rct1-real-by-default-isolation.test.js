'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Isolation RCT1 : Commandes, chaîne de contrôle, Hub, Relais lisent le réel par défaut
 * (`simulation_scope IS NULL`) — jamais de mélange recette/réel dans KPI, files, détails.
 * Order 360 : une commande RCT1 reste ouvrable par référence et porte son scope.
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/operations-relay-projection', () => ({ countRelayParcels: jest.fn(() => Promise.resolve({ available: 0, in_transit: 0 })) }));

const db = require('../../db');
const NOSCOPE = /simulation_scope IS NULL/;

function allSql() { return db.query.mock.calls.map(c => String(c[0])); }
beforeEach(() => {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [{}], rowCount: 1 });
});

describe('RCT1 isolation — réel par défaut', () => {
  test('dashboard-orders : toute requête sur orders exclut RCT1', async () => {
    const svc = require('../../services/dashboard-orders');
    await svc.buildOrders({}).catch(() => {});
    const sql = allSql().filter(s => /FROM orders o|JOIN orders o/.test(s) && !/o\.id = ANY/.test(s));
    expect(sql.length).toBeGreaterThan(5);
    for (const s of sql) expect(s).toMatch(NOSCOPE);
  });

  test('chaîne de contrôle : scoped_orders exclut RCT1', async () => {
    const svc = require('../../services/logistics-control-chain-projection');
    const fn = svc.getControlChain;
    await fn({}).catch(() => {});
    expect(allSql().some(s => /scoped_orders/.test(s) && NOSCOPE.test(s))).toBe(true);
  });

  test('hub KPI et liste : exclut RCT1', async () => {
    const svc = require('../../services/hub-dashboard-queries');
    await svc.getDashboardKPIs({}).catch(() => {});
    await svc.getQueue({}, {}).catch(() => {});
    const sql = allSql().filter(s => /orders/.test(s));
    expect(sql.length).toBeGreaterThan(3);
    for (const s of sql) expect(s).toMatch(NOSCOPE);
  });

  test('relais KPI et liste : exclut RCT1', async () => {
    const svc = require('../../services/relay-dashboard-queries');
    await svc.getDashboardKPIs({ role: 'admin' }).catch(() => {});
    await svc.getOrders({ role: 'admin' }, {}).catch(() => {});
    const sql = allSql().filter(s => /FROM orders|JOIN orders/.test(s));
    expect(sql.length).toBeGreaterThan(1);
    for (const s of sql) expect(s).toMatch(NOSCOPE);
  });

  test('Order 360 : une commande RCT1 reste ouvrable et marquée', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'x', reference: 'KM-RCT1-1', status: 'confirmed', simulation_scope: 'RCT1' }] });
    const svc = require('../../services/order-360');
    const { order } = await svc.resolveOrder('KM-RCT1-1');
    expect(order.simulation_scope).toBe('RCT1');
    expect(allSql()[0]).not.toMatch(NOSCOPE);
  });
});
