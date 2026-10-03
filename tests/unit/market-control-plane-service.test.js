'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { GAP_MESSAGES, computeGaps, getControlPlane, listMarkets } = require('../../services/market-control-plane');

const healthy = () => ({
  market: { id: 'm1', code: 'KM', is_active: true },
  assignment: { id: 'a1', status: 'ACTIVE' },
  ceiling: ['team.grant', 'network.read'],
  team: [{ membership_id: 'x', user_id: 'u', capabilities: ['team.grant'] }],
  paymentProviders: [{ provider: 'orange_money', is_enabled: true }],
  cashPolicy: { cash_enabled: true, confirmation_mode: 'SINGLE' },
  relaisActive: 2,
});

const codes = snapshot => computeGaps(snapshot).map(gap => gap.code);

describe('computeGaps — rapport d’écarts du Control Plane', () => {
  test('un marché complet n’a aucun écart', () => {
    expect(codes(healthy())).toEqual([]);
  });

  test('marché inactif sans affectation', () => {
    const s = healthy();
    s.market.is_active = false;
    s.assignment = null;
    expect(codes(s)).toEqual(['MARKET_INACTIVE', 'NO_ASSIGNMENT']);
  });

  test('affectation non ACTIVE, plafond vide, équipe absente', () => {
    const s = healthy();
    s.assignment.status = 'DRAFT';
    s.ceiling = [];
    s.team = [];
    expect(codes(s)).toEqual(['ASSIGNMENT_NOT_ACTIVE', 'EMPTY_CEILING', 'NO_ACTIVE_MEMBERSHIP']);
  });

  test('équipe sans team.grant : verrouillage local signalé', () => {
    const s = healthy();
    s.team[0].capabilities = ['network.read'];
    expect(codes(s)).toEqual(['NO_TEAM_GRANT_HOLDER']);
  });

  test('paiement, caisse et relais manquants', () => {
    const s = healthy();
    s.paymentProviders = [{ provider: 'mtn_momo', is_enabled: false }];
    s.cashPolicy = null;
    s.relaisActive = 0;
    expect(codes(s)).toEqual(['NO_PAYMENT_PROVIDER', 'NO_CASH_POLICY', 'NO_RELAIS']);
  });

  test('chaque écart porte son message', () => {
    for (const gap of computeGaps({ ...healthy(), assignment: null, cashPolicy: null })) {
      expect(gap.message).toBe(GAP_MESSAGES[gap.code]);
    }
  });
});

describe('getControlPlane / listMarkets — lecture seule', () => {
  function fakeDb(plan) {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        calls.push(sql);
        const hit = plan.find(([needle]) => sql.includes(needle));
        return { rows: hit ? hit[1] : [] };
      },
    };
  }

  test('code invalide : 400 sans requête', async () => {
    const db = fakeDb([]);
    await expect(getControlPlane(db, 'KMF')).rejects.toMatchObject({ code: 'MARKET_CODE_INVALID', status: 400 });
    expect(db.calls).toHaveLength(0);
  });

  test('marché inconnu : 404', async () => {
    await expect(getControlPlane(fakeDb([]), 'zz')).rejects.toMatchObject({ code: 'MARKET_NOT_FOUND', status: 404 });
  });

  test('marché sans affectation : vue partielle et écarts', async () => {
    const db = fakeDb([
      ['FROM markets WHERE code', [{ id: 'm1', code: 'CG', name: 'Congo', currency: 'XAF', minor_unit: 0, is_active: false }]],
      ['FROM relais', [{ n: 0 }]],
    ]);
    const view = await getControlPlane(db, ' cg ');
    expect(view.assignment).toBeNull();
    expect(view.team).toEqual([]);
    expect(view.gaps.map(gap => gap.code)).toEqual(
      ['MARKET_INACTIVE', 'NO_ASSIGNMENT', 'NO_PAYMENT_PROVIDER', 'NO_CASH_POLICY', 'NO_RELAIS']
    );
  });

  test('marché complet : équipe et plafond lus, aucun écart, aucune écriture', async () => {
    const db = fakeDb([
      ['FROM markets WHERE code', [{ id: 'm1', code: 'KM', name: 'Comores', currency: 'KMF', minor_unit: 0, is_active: true }]],
      ['FROM market_operating_assignments', [{ id: 'a1', status: 'ACTIVE' }]],
      ['FROM assignment_capability_ceiling', [{ capability: 'team.grant' }]],
      ['FROM assignment_memberships', [{ membership_id: 'x', user_id: 'u', capabilities: ['team.grant'] }]],
      ['FROM market_payment_providers', [{ provider: 'orange_money', currency: 'KMF', is_enabled: true, priority: 1 }]],
      ['FROM market_cash_control_policies', [{ cash_enabled: true, confirmation_mode: 'SINGLE' }]],
      ['FROM relais', [{ n: 3 }]],
    ]);
    const view = await getControlPlane(db, 'KM');
    expect(Object.keys(view).sort()).toEqual(
      ['assignment', 'cashPolicy', 'ceiling', 'gaps', 'market', 'paymentProviders', 'relaisActive', 'team']
    );
    expect(view.gaps).toEqual([]);
    expect(view.team[0].capabilities).toEqual(['team.grant']);
    expect(db.calls.every(sql => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  test('listMarkets exige un exécuteur et ne fait que lire', async () => {
    await expect(listMarkets(null)).rejects.toMatchObject({ code: 'EXECUTOR_REQUIRED' });
    const db = fakeDb([['FROM markets m', [{ code: 'KM' }]]]);
    expect(await listMarkets(db)).toEqual([{ code: 'KM' }]);
    expect(db.calls.every(sql => /^\s*SELECT/i.test(sql))).toBe(true);
  });
});
