'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { configureProvisioningProvider } = require('../../services/market-payment-provider-config-service');

describe('market payment provider provisioning writer', () => {
  test('writes only for a PROVISIONING market and enforces market currency', async () => {
    const db={query:jest.fn()
      .mockResolvedValueOnce({rows:[{id:'m1',code:'CG',currency:'XAF',lifecycle_status:'PROVISIONING'}]})
      .mockResolvedValueOnce({rows:[{market_id:'m1',provider:'mtn_momo',currency:'XAF',is_enabled:true,priority:10}]})};
    await expect(configureProvisioningProvider(db,{marketId:'m1',provider:'mtn_momo',currency:'XAF'}))
      .resolves.toMatchObject({provider:'mtn_momo',is_enabled:true});
    expect(db.query.mock.calls[1][0]).toMatch(/INSERT INTO market_payment_providers/);
  });

  test('currency mismatch fails before mutation', async () => {
    const db={query:jest.fn().mockResolvedValueOnce({rows:[{id:'m1',code:'CG',currency:'XAF',lifecycle_status:'PROVISIONING'}]})};
    await expect(configureProvisioningProvider(db,{marketId:'m1',provider:'mtn_momo',currency:'KMF'}))
      .rejects.toMatchObject({code:'MARKET_PAYMENT_CURRENCY_MISMATCH'});
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('central payment authorization during market preparation #4370', () => {
  const { configureCentralCollectionModes, assertMobileMarketEligibility } = require('../../services/market-payment-provider-config-service');
  test('incompatible mobile-money country is rejected', () => {
    expect(() => assertMobileMarketEligibility('GA','orange_money')).toThrow(/compatible/);
    expect(() => assertMobileMarketEligibility('CM','orange_money')).not.toThrow();
  });
  test('central payment needs named decision evidence before any query', async () => {
    const db = {query:jest.fn()};
    await expect(configureCentralCollectionModes(db,{marketId:'m1',actorUserId:'admin',modes:[{payment_mode:'stripe_eur'}]})).rejects.toMatchObject({code:'MARKET_CENTRAL_EVIDENCE_REQUIRED'});
    expect(db.query).not.toHaveBeenCalled();
  });
  test('uses the existing grant table and canonical actor', async () => {
    const mode = {payment_mode:'stripe_eur',evidence_ref:'DECISION-12'};
    const db = {query:jest.fn().mockResolvedValueOnce({rows:[{lifecycle_status:'PROVISIONING'}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[mode]})};
    await expect(configureCentralCollectionModes(db,{marketId:'m1',actorUserId:'admin',modes:[mode]})).resolves.toEqual([mode]);
    expect(db.query.mock.calls[1][0]).toContain('INSERT INTO market_central_collection_modes');
    expect(db.query.mock.calls[1][1]).toEqual(['m1','stripe_eur','DECISION-12','admin']);
  });
  test('cannot grant for an already active market via provisioning', async () => {
    const db = {query:jest.fn().mockResolvedValueOnce({rows:[{lifecycle_status:'ACTIVE'}]})};
    await expect(configureCentralCollectionModes(db,{marketId:'m1',actorUserId:'admin',modes:[{payment_mode:'paypal_eur',evidence_ref:'DECISION-12'}]})).rejects.toMatchObject({code:'MARKET_CENTRAL_MODES_PROVISIONING_ONLY'});
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

test('canonical provider writer refuses a different country even with the same currency',async()=>{
  const db={query:jest.fn().mockResolvedValue({rows:[{id:'m1',code:'CG',currency:'XAF',lifecycle_status:'PROVISIONING'}]})};
  await expect(configureProvisioningProvider(db,{marketId:'m1',provider:'orange_money',currency:'XAF'})).rejects.toMatchObject({code:'MARKET_PAYMENT_PROVIDER_INELIGIBLE',status:409});
  expect(db.query).toHaveBeenCalledTimes(1);
});
