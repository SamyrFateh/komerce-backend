'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief E7 : prorata de la capture d'origine, sans PSP ni conversion du jour.
 */
jest.mock('../../db', () => ({ getClient: jest.fn() }));
const { calculateRefundShare } = require('../../services/item-refund-reservation-service');
describe('E7 item refund quote - captured snapshot', () => {
  it('un article manquant sur trois : 1/3 du montant encaissé sans taux du jour', () => {
    expect(calculateRefundShare({quantity:1,priceKmf:'1000',totalKmf:'3000',totalEur:'6.00'}))
      .toMatchObject({amountKmf:'1000.00',amountEur:'2.00'});
  });
  it('conserve le centime de la capture avec arrondi déterministe', () => {
    expect(calculateRefundShare({quantity:1,priceKmf:'1.00',totalKmf:'3.00',totalEur:'1.00'}).amountEur)
      .toBe('0.33');
  });
  it('refuse des prix qui dépassent la capture', () => {
    expect(() => calculateRefundShare({quantity:2,priceKmf:'1000',totalKmf:'1000',totalEur:'2.00'}))
      .toThrow('Montants capturés ou prix de ligne incompatibles');
  });
  it('refuse les quotités invalides ou sans snapshot', () => {
    expect(() => calculateRefundShare({quantity:0,priceKmf:'1',totalKmf:'2',totalEur:'1'})).toThrow();
    expect(() => calculateRefundShare({quantity:1,priceKmf:'1',totalKmf:'2',totalEur:''})).toThrow();
  });
});
