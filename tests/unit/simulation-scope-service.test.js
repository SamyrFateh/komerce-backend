'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const svc = require('../../services/simulation-scope-service');

const exec = (order) => ({ query: jest.fn(async (sql) => (/SELECT id, simulation_scope/.test(sql) ? { rows: order ? [order] : [] } : { rows: [] })) });

describe('L3 — périmètre de recette', () => {
  test('format du périmètre et provenance simulée', () => {
    expect(svc.isValidScope('RCT1')).toBe(true);
    expect(svc.isValidScope("RCT1'; DROP")).toBe(false);
    expect(svc.isSimulatedProvenance('FICTIF recette')).toBe(true);
    expect(svc.isSimulatedProvenance('facture fournisseur 123')).toBe(false);
  });

  test('prédicats : activité réelle = périmètre NULL', () => {
    expect(svc.realActivityOrderSql('o')).toBe('o.simulation_scope IS NULL');
    expect(svc.realActivityByOrderIdSql('alc')).toContain('sim_o.simulation_scope IS NOT NULL');
  });

  test('pose tracée, idempotente, immuable', async () => {
    const e = exec({ id: 'o1', simulation_scope: null });
    const r = await svc.assignOrderSimulationScope(e, { orderId: 'o1', scope: 'RCT1', actorId: 'u', reason: 'recette', env: { KOMERCE_ENV: 'staging' } });
    expect(r).toEqual({ order_id: 'o1', simulation_scope: 'RCT1', already: false });
    const sqls = e.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((q) => /UPDATE orders SET simulation_scope/.test(q))).toBe(true);
    expect(sqls.some((q) => /INSERT INTO order_cost_entry_events/.test(q))).toBe(true);

    const same = await svc.assignOrderSimulationScope(exec({ id: 'o1', simulation_scope: 'RCT1' }), { orderId: 'o1', scope: 'RCT1', reason: 'x', env: { KOMERCE_ENV: 'staging' } });
    expect(same.already).toBe(true);
    await expect(svc.assignOrderSimulationScope(exec({ id: 'o1', simulation_scope: 'RCT0' }), { orderId: 'o1', scope: 'RCT1', reason: 'x', env: { KOMERCE_ENV: 'staging' } }))
      .rejects.toMatchObject({ code: 'SIMULATION_SCOPE_IMMUTABLE' });
  });

  test('refus en production, sans motif, ou périmètre invalide', async () => {
    const e = exec({ id: 'o1', simulation_scope: null });
    await expect(svc.assignOrderSimulationScope(e, { orderId: 'o1', scope: 'RCT1', reason: 'x', env: { KOMERCE_ENV: 'production' } })).rejects.toMatchObject({ code: 'SIMULATION_FORBIDDEN_IN_PRODUCTION' });
    await expect(svc.assignOrderSimulationScope(e, { orderId: 'o1', scope: 'RCT1', reason: ' ', env: { KOMERCE_ENV: 'staging' } })).rejects.toMatchObject({ code: 'SIMULATION_REASON_REQUIRED' });
    await expect(svc.assignOrderSimulationScope(e, { orderId: 'o1', scope: 'bad', reason: 'x', env: { KOMERCE_ENV: 'staging' } })).rejects.toMatchObject({ code: 'SIMULATION_SCOPE_INVALID' });
    expect(e.query).not.toHaveBeenCalled();
  });

  test('agrégats inter-commandes : les commandes simulées sont exclues', () => {
    const fs = require('fs'); const path = require('path');
    for (const rel of ['services/product-360.js', 'services/cost-allocation/variance.js', 'services/cost-allocation/product-margin-steering.js', 'routes/admin-costing.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
      expect(src).toMatch(/simulation_scope IS NULL|realActivityByOrderIdSql/);
    }
  });
});
