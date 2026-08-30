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

const {
  checkCashNotCollected, checkCashNotDeposited, checkDepositsPendingReview, checkSuspectCashPattern,
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
