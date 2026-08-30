'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/radar-alerts/payment-signals.js
 *
 * Extrait de radar-queries.test.js (checks A, B, D) lors du refactoring
 * I-BACK-2 (2026-08) : radar-queries.js::getAlerts() reste couvert
 * end-to-end par radar-queries.test.js, ces tests couvrent en plus
 * chaque check en isolation (seuil pile atteint, en dessous, au-dessus).
 */

const { checkCashOverdue, checkStripeFailed, checkCashPendingAtRelais } =
  require('../../services/radar-alerts/payment-signals');

function fakeDb(rows) {
  return { query: jest.fn(async () => ({ rows })) };
}

describe('checkCashOverdue', () => {
  it('retourne null si aucune commande en retard', async () => {
    const db = fakeDb([{ cnt: 0, total_kmf: 0 }]);
    expect(await checkCashOverdue(db, 36)).toBeNull();
  });

  it('retourne une alerte critical avec le compte et le montant', async () => {
    const db = fakeDb([{ cnt: 3, total_kmf: 150000 }]);
    const alert = await checkCashOverdue(db, 36);
    expect(alert).toMatchObject({
      level: 'critical', code: 'CASH_OVERDUE', count: 3, value_kmf: 150000,
    });
  });
});

describe('checkStripeFailed', () => {
  it('retourne null si le nombre d\'échecs est sous le seuil', async () => {
    const db = fakeDb([{ cnt: 4 }]);
    expect(await checkStripeFailed(db, 5)).toBeNull();
  });

  it('retourne une alerte quand le seuil est atteint (>=)', async () => {
    const db = fakeDb([{ cnt: 5 }]);
    const alert = await checkStripeFailed(db, 5);
    expect(alert).toMatchObject({ level: 'critical', code: 'STRIPE_FAILED', count: 5 });
  });

  it('retourne null si la requête échoue (fallback catch)', async () => {
    const db = { query: jest.fn(async () => { throw new Error('boom'); }) };
    expect(await checkStripeFailed(db, 5)).toBeNull();
  });
});

describe('checkCashPendingAtRelais', () => {
  it('retourne null si le cash en attente est sous le seuil', async () => {
    const db = fakeDb([{ cnt: 2, total_kmf: 999999 }]);
    expect(await checkCashPendingAtRelais(db, 1000000)).toBeNull();
  });

  it('retourne une alerte quand le seuil est atteint (>=)', async () => {
    const db = fakeDb([{ cnt: 2, total_kmf: 1000000 }]);
    const alert = await checkCashPendingAtRelais(db, 1000000);
    expect(alert).toMatchObject({ level: 'critical', code: 'CASH_PENDING_HIGH', value_kmf: 1000000 });
  });
});
