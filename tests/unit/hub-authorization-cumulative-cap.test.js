'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief A2-ter : le plafond de paiement fournisseur est cumulé (tranches), pas une égalité par tranche.
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const auth = require('../../services/hub-authorization-service');

const clientWith = (prior) => ({
  query: jest.fn(async (sql) => (/FROM purchase_order_authorizations/.test(sql)
    ? { rows: [{ amount: '100', currency: 'AED' }] }
    : { rows: [{ total: String(prior) }] })),
});

describe('assertPaymentAuthorized — cumul', () => {
  it('une tranche inférieure au total passe tant que le cumul reste sous le plafond', async () => {
    await expect(auth.assertPaymentAuthorized(clientWith(40), 'po', 60, 'AED', { excludePaymentKey: 'k' })).resolves.toBeUndefined();
  });
  it('le cumul au-delà du plafond est refusé', async () => {
    await expect(auth.assertPaymentAuthorized(clientWith(40), 'po', 61, 'AED')).rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION' });
  });
  it('une autre devise est refusée', async () => {
    await expect(auth.assertPaymentAuthorized(clientWith(0), 'po', 10, 'USD')).rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION' });
  });
});
