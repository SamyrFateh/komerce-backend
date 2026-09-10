'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/pricing-market-decision-policy', () => ({
  evaluateMarketDecision: jest.fn(),
}));

const { evaluateMarketDecision } = require('../../services/pricing-market-decision-policy');
const performance = require('../../services/market-delegation-performance-service');

function executor() {
  return { query: jest.fn() };
}

function mockAuthz(db, { capabilities = ['finance.read'] } = {}) {
  db.query
    .mockResolvedValueOnce({ rows: [{ market_id: 'mkt-cm', market_code: 'CM', market_name: 'Cameroun', currency: 'XAF', assignment_id: 'a-cm', assignment_status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'm1', assignment_id: 'a-cm', user_id: 'u1', status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: capabilities.map(capability => ({ capability })) })
    .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
}

const DECISIONAL = {
  canonical_period: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  evaluated_at: '2026-09-01T00:00:00.000Z',
  coverage: {
    threshold_applied: true,
    coverage_status: 'COVERED',
    coverage_ratio: 1.35,
    numerator_contribution_kmf: 540000,
    denominator_n3_kmf: 400000,
    structure: { market_n3_total_kmf: 400000, market_n3_decisional: true },
    contribution: {
      mature_order_count: 128,
      revenue_kmf: 900000,
      transaction_variable_cost_kmf: 300000,
      contribution_before_risk_kmf: 600000,
      reconciled_contribution_kmf: 540000,
      reconciled_risk_cost_kmf: 60000,
    },
  },
};

beforeEach(() => jest.clearAllMocks());

describe('market-delegation performance service', () => {
  test('projette la décision canonique sans rien recalculer', async () => {
    const db = executor();
    mockAuthz(db);
    evaluateMarketDecision.mockResolvedValueOnce(DECISIONAL);

    const view = await performance.getMarketPerformance(db, { marketCode: 'CM', actorUserId: 'u1' });

    // Le market_id transmis au moteur est celui résolu serveur.
    expect(evaluateMarketDecision).toHaveBeenCalledWith('mkt-cm', {});
    expect(view.status).toBe('AVAILABLE');
    expect(view.contribution.reconciled_kmf).toBe(540000);
    expect(view.structure_costs.market_n3_total_kmf).toBe(400000);
    expect(view.coverage.ratio).toBe(1.35);
    expect(view.market.currency).toBe('XAF');
  });

  test('transmet le refus du moteur tel quel plutôt qu’un chiffre approximatif', async () => {
    // Quand les données sont insuffisantes, afficher une estimation serait
    // pire que ne rien afficher : c'est de l'argent.
    const db = executor();
    mockAuthz(db);
    evaluateMarketDecision.mockResolvedValueOnce({
      canonical_period: null,
      reason: 'MARKET_N3_NOT_DECISIONAL',
      coverage: { threshold_applied: false, reason: 'MARKET_N3_NOT_DECISIONAL', contribution: null, structure: null },
    });

    const view = await performance.getMarketPerformance(db, { marketCode: 'CM', actorUserId: 'u1' });

    expect(view.status).toBe('NOT_DECISIONAL');
    expect(view.reason).toBe('MARKET_N3_NOT_DECISIONAL');
    expect(view.coverage).toBeNull();
  });

  test('absence de politique de décision remonte un motif lisible, jamais un crash', async () => {
    const db = executor();
    mockAuthz(db);
    evaluateMarketDecision.mockResolvedValueOnce({
      decision_status: 'NOT_DECISIONAL',
      reason: 'MARKET_DECISION_POLICY_REQUIRED',
      coverage: null,
      canonical_period: null,
    });

    const view = await performance.getMarketPerformance(db, { marketCode: 'CM', actorUserId: 'u1' });
    expect(view.status).toBe('NOT_DECISIONAL');
    expect(view.reason).toBe('MARKET_DECISION_POLICY_REQUIRED');
    expect(view.activity).toBeNull();
  });

  test('capability finance.read absente → 403, le moteur n’est jamais sollicité', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: [] });

    await expect(performance.getMarketPerformance(db, { marketCode: 'CM', actorUserId: 'u1' }))
      .rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });

    expect(evaluateMarketDecision).not.toHaveBeenCalled();
  });

  test('la vue annonce explicitement que le règlement reste une attestation centrale', async () => {
    // Garde-fou anti-malentendu : cette vue dit ce que le marché produit, pas
    // ce que le partenaire touche. Tant qu'aucune règle de partage n'existe,
    // la charge utile doit le dire elle-même.
    const db = executor();
    mockAuthz(db);
    evaluateMarketDecision.mockResolvedValueOnce(DECISIONAL);

    const view = await performance.getMarketPerformance(db, { marketCode: 'CM', actorUserId: 'u1' });
    expect(view.settlement_basis.source).toBe('CENTRAL_ATTESTATION');
    expect(view.settlement_basis.note).toMatch(/attesté par le central/);
  });

  test('n’invente aucune part partenaire — aucun champ de partage dans la sortie', async () => {
    const db = executor();
    mockAuthz(db);
    evaluateMarketDecision.mockResolvedValueOnce(DECISIONAL);

    const view = await performance.getMarketPerformance(db, { marketCode: 'CM', actorUserId: 'u1' });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/partner_share|revenue_share|commission_kmf|partner_earnings/);
  });

  test('le service ne contient aucun SQL ni aucune arithmétique de partage', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-performance-service.js'), 'utf8');
    // On vise le CODE, pas la prose : les commentaires mentionnent
    // légitimement « revenue-share » pour expliquer qu'il n'y en a pas.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/SELECT |INSERT |UPDATE /);
    // Aucun pourcentage ni multiplication appliqué à un montant.
    expect(code).not.toMatch(/\*\s*0\.\d/);
    expect(code).not.toMatch(/partner_share|revenue_share|commission_pct/i);
  });
});
