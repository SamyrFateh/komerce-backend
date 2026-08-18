'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const { verify } = require('../../tools/dashboard-contracts/verify-0c-ui');

const ROOT = path.resolve(__dirname, '../..');
const REGISTRY = path.join(ROOT, 'docs/contract/DASHBOARDS_CONTRACTS_0C.json');

describe('LOT 0C-ui — harnais contrats Pilotage/Finance', () => {
  test('chaque appel consommé par les vues prioritaires est enregistré sans mismatch', () => {
    const r = verify();
    expect(r.scope_views).toEqual([
      'SanteView',
      'PilotageView',
      'ControlTowerView',
      'EconomicView',
      'CostingView',
      'PilotageFinView',
    ]);
    expect(r.consumed_edges).toBeGreaterThan(0);
    expect(r.registered_edges).toBe(r.consumed_edges);
    expect(r.missing).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(r.mismatches).toEqual([]);
    expect(r.invalid).toEqual([]);
  });

  test('aucun PROVEN sans forme et aucune incertitude silencieuse', () => {
    const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
    for (const c of registry.contracts) {
      if (c.status === 'PROVEN') {
        expect(Array.isArray(c.top_level_fields)).toBe(true);
        expect(c.top_level_fields.length).toBeGreaterThan(0);
        expect(c.proof).toEqual(expect.objectContaining({ path: expect.any(String), type: expect.any(String) }));
      } else {
        expect(c.status).toBe('UNKNOWN');
        expect(c.reason).toEqual(expect.any(String));
        expect(c.reason.length).toBeGreaterThan(7);
      }
    }
  });
});
