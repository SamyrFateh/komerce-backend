'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Paiement & autorité FX : le montant EUR d'une commande vient du snapshot FX (autorité, pivot EUR),
 * jamais d'une lecture finance_config ni d'un repli.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../db', () => ({ query: jest.fn() }));

const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

describe('Payment & FX Authority', () => {
  test('getAuthoritativeRates ne lit plus finance_config : il s\'appuie sur l\'autorité FX', () => {
    const src = read('utils/rates.js');
    expect(src).toContain("require('../services/fx-authority')");
    expect(src).not.toMatch(/FROM finance_config/);
  });

  test('le boundary checkout passe par le snapshot FX du service (cash KMF compris), sans garde locale', () => {
    const route = read('routes/orders/create.js');
    expect(route).not.toContain('EUR_PAYMENT_MODES');
    expect(route).not.toContain('getAuthoritativeRates');
    const svc = read('services/order-checkout-service.js');
    expect(svc).toContain('buildOrderFxSnapshot(');
    expect(svc).toContain('fx_rate_unavailable');
  });
});
