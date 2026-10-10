'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/market-delegation-team-service', () => ({ resolveAuthorization: jest.fn() }));
const { resolveAuthorization } = require('../../services/market-delegation-team-service');
const { getMarketCostStatement, MAX_LINES } = require('../../services/market-delegation-cost-statement-service');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-cost-statement.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(ROOT, 'services', 'market-delegation-cost-statement-service.js'), 'utf8');

function line(origin, amount, extra = {}) {
  return {
    event_id: 'e-' + Math.random(), origin, charge_family: 'Hébergement', charge_name: 'Railway', event_kind: 'ACCRUAL',
    economic_from: '2026-09-01T00:00:00Z', economic_to: '2026-10-01T00:00:00Z', amount_kmf: amount,
    allocation_key: origin === 'GROUP_ATTRIBUTED' ? 'orders_share' : null, policy_version: null, source_kind: 'INVOICE', ...extra,
  };
}
const dbWith = rows => ({ calls: [], async query(sql, params) { this.calls.push({ sql, params }); return { rows }; } });

beforeEach(() => {
  resolveAuthorization.mockReset();
  resolveAuthorization.mockResolvedValue({ market_id: 'm-cm', market_code: 'CM' });
});

describe('relevé de coûts du marché (D7)', () => {
  test('exige la capacité finance.read et filtre sur le marché issu du mandat, jamais du client', async () => {
    const db = dbWith([]);
    await getMarketCostStatement(db, { marketCode: 'cm', actorUserId: 'u1' });
    expect(resolveAuthorization).toHaveBeenCalledWith(db, { userId: 'u1', marketCode: 'cm', requiredCapability: 'finance.read' });
    expect(db.calls[0].params[0]).toBe('m-cm');
  });

  test('refus d’autorisation : aucune requête de données', async () => {
    resolveAuthorization.mockRejectedValue(Object.assign(new Error('refus'), { code: 'MARKET_DELEGATION_FORBIDDEN', status: 403 }));
    const db = dbWith([]);
    await expect(getMarketCostStatement(db, { marketCode: 'CM', actorUserId: 'u1' })).rejects.toMatchObject({ status: 403 });
    expect(db.calls).toHaveLength(0);
  });

  test('totalise charges directes et mutualisées, avec contre-passations négatives, sans erreur d’arrondi', async () => {
    const db = dbWith([
      line('MARKET_DIRECT', '100000.10'), line('MARKET_DIRECT', '-0.20', { event_kind: 'REVERSAL' }),
      line('GROUP_ATTRIBUTED', '40000.30'), line('GROUP_ATTRIBUTED', '0.10'),
    ]);
    const view = await getMarketCostStatement(db, { marketCode: 'CM', actorUserId: 'u1' });
    expect(view.totals).toEqual({ direct_kmf: '99999.90', group_attributed_kmf: '40000.40', total_kmf: '140000.30' });
    expect(view).toMatchObject({ market_code: 'CM', currency_basis: 'KMF', truncated: false, not_covered: ['purchase_rebilling'] });
    expect(view.lines).toHaveLength(4);
  });

  test('plafonne à MAX_LINES et signale la troncature', async () => {
    const rows = Array.from({ length: MAX_LINES + 1 }, () => line('MARKET_DIRECT', '1.00'));
    const view = await getMarketCostStatement(dbWith(rows), { marketCode: 'CM', actorUserId: 'u1' });
    expect(view.lines).toHaveLength(MAX_LINES);
    expect(view.truncated).toBe(true);
  });

  test('période : bornes ISO transmises au SQL ; date invalide ou inversée → 400 avant toute autorisation', async () => {
    const db = dbWith([]);
    await getMarketCostStatement(db, { marketCode: 'CM', actorUserId: 'u1', from: '2026-09-01', to: '2026-10-01' });
    expect(db.calls[0].params.slice(1)).toEqual(['2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
    await expect(getMarketCostStatement(dbWith([]), { marketCode: 'CM', actorUserId: 'u1', from: 'nope' })).rejects.toMatchObject({ code: 'COST_STATEMENT_PERIOD_INVALID', status: 400 });
    await expect(getMarketCostStatement(dbWith([]), { marketCode: 'CM', actorUserId: 'u1', from: '2026-10-01', to: '2026-09-01' })).rejects.toMatchObject({ status: 400 });
    expect(resolveAuthorization).toHaveBeenCalledTimes(1);
  });

  test('exécuteur invalide : TypeError explicite', async () => {
    await expect(getMarketCostStatement(null, { marketCode: 'CM', actorUserId: 'u1' })).rejects.toThrow(TypeError);
  });

  test('le justificatif, les notes et l’auteur du siège ne sont jamais sélectionnés', () => {
    const code = serviceSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/evidence_ref|\bnotes\b|recorded_by/);
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});

describe('route', () => {
  test('GET seul, authentifiée, marché pris du chemin et capacité résolue par le service', () => {
    expect(routeSource).toMatch(/router\.get\('\/markets\/:marketCode\/cost-statement', authenticate/);
    expect(routeSource).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(routeSource).not.toMatch(/req\.(body|query)\.(market_id|marketId)/);
    expect(routeSource).toMatch(/from: req\.query\.from \|\| null/);
  });
});
