'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { configureProvisioningProvider } = require('../../services/market-payment-provider-config-service');

describe('market payment provider provisioning writer', () => {
  test('writes only for a PROVISIONING market and enforces market currency', async () => {
    const db={query:jest.fn()
      .mockResolvedValueOnce({rows:[{id:'m1',currency:'XAF',lifecycle_status:'PROVISIONING'}]})
      .mockResolvedValueOnce({rows:[{market_id:'m1',provider:'mtn_momo',currency:'XAF',is_enabled:true,priority:10}]})};
    await expect(configureProvisioningProvider(db,{marketId:'m1',provider:'mtn_momo',currency:'XAF'}))
      .resolves.toMatchObject({provider:'mtn_momo',is_enabled:true});
    expect(db.query.mock.calls[1][0]).toMatch(/INSERT INTO market_payment_providers/);
  });

  test('currency mismatch fails before mutation', async () => {
    const db={query:jest.fn().mockResolvedValueOnce({rows:[{id:'m1',currency:'XAF',lifecycle_status:'PROVISIONING'}]})};
    await expect(configureProvisioningProvider(db,{marketId:'m1',provider:'mtn_momo',currency:'KMF'}))
      .rejects.toMatchObject({code:'MARKET_PAYMENT_CURRENCY_MISMATCH'});
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
