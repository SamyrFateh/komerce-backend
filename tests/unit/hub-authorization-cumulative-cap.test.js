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
  query: jest.fn(async (sql) => {
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/pg_locks/.test(sql)) return { rows: [{ '?column?': 1 }] };
    if (/FROM purchase_order_authorizations/.test(sql)) {
      return { rows: [{ authorization_type: 'supplier_payment', amount: '100', currency: 'AED' }, { authorization_type: 'purchase_commitment', amount: '100', currency: 'AED' }] };
    }
    return { rows: [{ total: String(prior), other_currency: 0 }] };
  }),
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
