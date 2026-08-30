'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/radar-alerts/treasury-signals.js
 * et services/radar-alerts/commerce-signals.js (extraction I-BACK-2,
 * voir radar-alerts-payment-signals.test.js)
 */

const { checkWalletTotalHigh } = require('../../services/radar-alerts/treasury-signals');
const {
  checkCancelRate, checkOpenIncidents, checkLowStock, checkStockOut,
} = require('../../services/radar-alerts/commerce-signals');

function fakeDb(rows) {
  return { query: jest.fn(async () => ({ rows })) };
}

describe('checkWalletTotalHigh', () => {
  it('retourne null sous le seuil', async () => {
    const db = fakeDb([{ total: 4999999 }]);
    expect(await checkWalletTotalHigh(db, 5000000)).toBeNull();
  });

  it('retourne une alerte signal au seuil (>=)', async () => {
    const db = fakeDb([{ total: 5000000 }]);
    const alert = await checkWalletTotalHigh(db, 5000000);
    expect(alert).toMatchObject({ level: 'signal', code: 'WALLET_TOTAL_HIGH' });
  });
});

describe('checkCancelRate', () => {
  it('retourne null si aucune commande sur 7j', async () => {
    const db = fakeDb([{ total_7d: 0, cancelled_7d: 0 }]);
    expect(await checkCancelRate(db, 15)).toBeNull();
  });

  it('retourne null sous le seuil', async () => {
    const db = fakeDb([{ total_7d: 100, cancelled_7d: 10 }]);
    expect(await checkCancelRate(db, 15)).toBeNull();
  });

  it('retourne une alerte critical au-dessus du seuil', async () => {
    const db = fakeDb([{ total_7d: 100, cancelled_7d: 20 }]);
    const alert = await checkCancelRate(db, 15);
    expect(alert).toMatchObject({ level: 'critical', code: 'CANCEL_RATE_HIGH' });
  });
});

describe('checkOpenIncidents', () => {
  it('retourne null si aucun incident', async () => {
    expect(await checkOpenIncidents(fakeDb([{ cnt: 0 }]))).toBeNull();
  });
  it('retourne une alerte sinon', async () => {
    const alert = await checkOpenIncidents(fakeDb([{ cnt: 1 }]));
    expect(alert).toMatchObject({ level: 'critical', code: 'INCIDENTS_OPEN' });
  });
});

describe('checkLowStock / checkStockOut', () => {
  it('checkLowStock retourne null si aucun produit sous le seuil', async () => {
    expect(await checkLowStock(fakeDb([{ cnt: 0 }]), 5)).toBeNull();
  });
  it('checkLowStock retourne une alerte signal sinon', async () => {
    const alert = await checkLowStock(fakeDb([{ cnt: 3 }]), 5);
    expect(alert).toMatchObject({ level: 'signal', code: 'STOCK_LOW' });
  });
  it('checkStockOut retourne null si aucune rupture', async () => {
    expect(await checkStockOut(fakeDb([{ cnt: 0 }]))).toBeNull();
  });
  it('checkStockOut retourne une alerte signal sinon', async () => {
    const alert = await checkStockOut(fakeDb([{ cnt: 2 }]));
    expect(alert).toMatchObject({ level: 'signal', code: 'STOCK_OUT' });
  });
});
