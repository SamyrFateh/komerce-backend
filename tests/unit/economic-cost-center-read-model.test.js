'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockQuery=jest.fn(),mockRelease=jest.fn(),mockClient=jest.fn(),mockGrant=jest.fn(),mockAuthz=jest.fn();
jest.mock('../../db',()=>({getClient:(...a)=>mockClient(...a)}));
jest.mock('../../middleware/require-pricing-global-authority',()=>({hasPricingGlobalAuthority:(...a)=>mockGrant(...a)}));
jest.mock('../../services/market-delegation-service',()=>({resolveAuthorization:(...a)=>mockAuthz(...a)}));
const {readCostCenters}=require('../../services/economic-cost-center-read-model');
const client={query:mockQuery,release:mockRelease},actor={id:'actor',role:'admin'},month='2026-01-01';
const ok=(rows=[])=>({rows});
beforeEach(()=>{jest.resetAllMocks();mockClient.mockResolvedValue(client);mockGrant.mockResolvedValue(true);});
function projection(postRows=[],commitmentRows=[]){
  mockQuery.mockResolvedValueOnce(ok([{id:'center'}])).mockResolvedValueOnce(ok([{id:'family'}])).mockResolvedValueOnce(ok([{id:'resource'}])).mockResolvedValueOnce(ok(postRows)).mockResolvedValueOnce(ok(commitmentRows)).mockResolvedValueOnce(ok());
}
test('reject unauthenticated and implicit scope',async()=>{
  await expect(readCostCenters(null,{marketCode:null,periodStart:month})).rejects.toMatchObject({status:401});
  await expect(readCostCenters(actor,{periodStart:month})).rejects.toMatchObject({status:400});
  expect(mockClient).not.toHaveBeenCalled();
});
test('global grant required for group; role alone does not grant it',async()=>{
  mockGrant.mockResolvedValue(false);mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
  await expect(readCostCenters(actor,{marketCode:null,periodStart:month})).rejects.toMatchObject({status:403});
  expect(mockQuery.mock.calls[1][0]).toBe('ROLLBACK');
});
test('market delegation resolves exact market and no other scope is queried',async()=>{
  mockAuthz.mockResolvedValue({market_id:'market-CM'});
  mockQuery.mockResolvedValueOnce(ok());projection();
  const result=await readCostCenters({id:'member',role:'market_operator'},{marketCode:'CM',periodStart:month});
  expect(mockAuthz).toHaveBeenCalledWith(client,{userId:'member',marketCode:'CM',requiredCapability:'pricing.read'});
  expect(result).toMatchObject({scope:'MARKET',marketCode:'CM',central:false,readOnly:true});
  for(const call of mockQuery.mock.calls.slice(1,6))expect(call[1][0]).toBe('market-CM');
  expect(mockGrant).not.toHaveBeenCalled();
});
test('denied delegation never queries economic tables',async()=>{
  mockAuthz.mockRejectedValue(Object.assign(new Error('denied'),{status:403}));
  mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
  await expect(readCostCenters({id:'member',role:'market_operator'},{marketCode:'CG',periodStart:month})).rejects.toMatchObject({status:403});
  expect(mockQuery.mock.calls.map(c=>c[0])).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','ROLLBACK']);
});
test('latest revision preserves explicit zero distinct from absent budget; no invented actuals',async()=>{
  mockQuery.mockResolvedValueOnce(ok());
  projection([{id:'p1',budget_revision:2,budget_currency:'EUR',budget_native:'0.0000',budget_eur:'0.00'},{id:'p2',budget_revision:null}], [{id:'k',post_id:'p1',remaining_native:'40.0000',requires_reconciliation:true}]);
  const x=await readCostCenters(actor,{marketCode:null,periodStart:month});
  expect(x.posts[0]).toMatchObject({budget:{revision:2,eur:'0.00'},actual:null,available:null,commitments:[{requires_reconciliation:true}]});
  expect(x.posts[1]).toMatchObject({budget:null,actual:null,available:null,commitments:[]});
  expect(x.actualCoverage).toBe('NOT_RECONCILED');
  expect(mockQuery.mock.calls[4][0]).toContain('ORDER BY revision DESC LIMIT 1');
  expect(mockRelease).toHaveBeenCalledTimes(1);
});
