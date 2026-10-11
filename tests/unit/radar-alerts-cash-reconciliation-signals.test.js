'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/radar-alerts/cash-reconciliation-signals.js
 * (extraction I-BACK-2, voir radar-alerts-payment-signals.test.js)
 *
 * Couvre en particulier le comportement défensif : si la table
 * cash_collections / cash_deposits n'existe pas encore, le check doit
 * retourner null plutôt que de lever une exception (comportement hérité
 * de l'ancien try/catch inline dans getAlerts()).
 */

jest.mock('../../services/cash-custody-service', () => ({ overdueHoldings: jest.fn() }));
const custody = require('../../services/cash-custody-service');
const {
  checkCashNotCollected, checkCashNotDeposited, checkDepositsPendingReview, checkCashLegacyToRegularize, checkCashCustodyLimits, checkSuspectCashPattern,
} = require('../../services/radar-alerts/cash-reconciliation-signals');

describe('checkCashNotCollected', () => {
  it('retourne null si aucune commande non encaissée', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ cnt: 0, total_kmf: 0 }] })) };
    expect(await checkCashNotCollected(db, 48)).toBeNull();
  });

  it('retourne une alerte critical sinon', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ cnt: 2, total_kmf: 40000 }] })) };
    const alert = await checkCashNotCollected(db, 48);
    expect(alert).toMatchObject({ level: 'critical', code: 'CASH_NOT_COLLECTED', count: 2 });
  });

  it('retourne null (pas d\'exception) si la table cash_collections est absente', async () => {
    const db = { query: jest.fn(async () => { throw new Error('relation "cash_collections" does not exist'); }) };
    await expect(checkCashNotCollected(db, 48)).resolves.toBeNull();
  });
});

describe('checkCashNotDeposited', () => {
  it('retourne null sous le seuil', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ agent_count: 0, total_kmf: 0 }] })) };
    expect(await checkCashNotDeposited(db, 72)).toBeNull();
  });

  it('retourne null si la table est absente', async () => {
    const db = { query: jest.fn(async () => { throw new Error('missing table'); }) };
    await expect(checkCashNotDeposited(db, 72)).resolves.toBeNull();
  });

  it('couverture canonique : seule une sortie ACCEPTÉE décharge, jamais l\'existence d\'un dépôt', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ agent_count: 1, total_kmf: 150000 }] })) };
    const alert = await checkCashNotDeposited(db, 72);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toContain('cash_custody_movements');
    expect(sql).not.toMatch(/status = 'verified'|NOT EXISTS|period_start/);
    expect(alert).toMatchObject({ code: 'CASH_NOT_DEPOSITED', value_kmf: 150000 });
    expect(alert.title).toMatch(/non remis et acceptés/);
  });
});

describe('checkDepositsPendingReview', () => {
  it('retourne null si aucun dépôt en attente', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ cnt: 0, total_kmf: 0 }] })) };
    expect(await checkDepositsPendingReview(db)).toBeNull();
  });

  it('retourne une alerte signal sinon', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ cnt: 1, total_kmf: 20000 }] })) };
    const alert = await checkDepositsPendingReview(db);
    expect(alert).toMatchObject({ level: 'signal', code: 'DEPOSITS_PENDING_REVIEW' });
  });
});

describe('checkSuspectCashPattern', () => {
  it('retourne null si aucun agent suspect', async () => {
    const db = { query: jest.fn(async () => ({ rows: [] })) };
    expect(await checkSuspectCashPattern(db)).toBeNull();
  });

  it('retourne une alerte avec les noms concaténés sinon', async () => {
    const db = {
      query: jest.fn(async () => ({
        rows: [{ agent_id: 'a1', full_name: 'Ali', weeks_with_gap: 3, total_gap_kmf: 5000 }],
      })),
    };
    const alert = await checkSuspectCashPattern(db);
    expect(alert).toMatchObject({ level: 'critical', code: 'CASH_SUSPECT_PATTERN', detail: 'Ali' });
  });
});

describe('checkCashLegacyToRegularize (remises historiques : jamais clôturées automatiquement)', () => {
  it('null si rien à régulariser', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ cnt: 0, total_kmf: 0 }] })) };
    expect(await checkCashLegacyToRegularize(db)).toBeNull();
  });

  it('signal explicite : l\'agent n\'est pas déchargé, reste calculé net des régularisations vérifiées', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ cnt: 2, total_kmf: 70000 }] })) };
    const alert = await checkCashLegacyToRegularize(db);
    expect(alert).toMatchObject({ level: 'signal', code: 'CASH_LEGACY_TO_REGULARIZE', value_kmf: 70000, count: 2 });
    expect(alert.title).toMatch(/n'est pas déchargé/);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toMatch(/movement_kind = 'LEGACY' AND d\.status = 'verified'/);
    expect(sql).toMatch(/regularizes_deposit_id = d\.id AND x\.status = 'verified'/);
  });

  it('défensif : table absente → null', async () => {
    const db = { query: jest.fn(async () => { throw new Error('relation does not exist'); }) };
    expect(await checkCashLegacyToRegularize(db)).toBeNull();
  });
});

describe('checkCashCustodyLimits (plafond et délai de garde)', () => {
  it('null si aucun détenteur hors limite', async () => {
    custody.overdueHoldings.mockResolvedValueOnce([]);
    expect(await checkCashCustodyLimits({})).toBeNull();
  });

  it('critical : nombre de détenteurs et somme détenue', async () => {
    custody.overdueHoldings.mockResolvedValueOnce([{ balance_kmf: 40000 }, { balance_kmf: 10000 }]);
    expect(await checkCashCustodyLimits({})).toMatchObject({ level: 'critical', code: 'CASH_CUSTODY_LIMIT_EXCEEDED', value_kmf: 50000, count: 2 });
  });

  it('défensif : erreur → null', async () => {
    custody.overdueHoldings.mockRejectedValueOnce(new Error('relation does not exist'));
    expect(await checkCashCustodyLimits({})).toBeNull();
  });
});
