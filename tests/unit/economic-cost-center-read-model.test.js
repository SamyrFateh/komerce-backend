'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockQuery=jest.fn(),mockRelease=jest.fn(),mockClient=jest.fn(),mockGrant=jest.fn(),mockAuthz=jest.fn();
jest.mock('../../db',()=>({getClient:(...a)=>mockClient(...a)}));
jest.mock('../../middleware/require-pricing-global-authority',()=>({hasPricingGlobalAuthority:(...a)=>mockGrant(...a)}));
jest.mock('../../services/market-delegation-service',()=>({resolveAuthorization:(...a)=>mockAuthz(...a)}));
const {readCostCenters,budgetSummary,commitmentRemainingEur,commitmentSummary,structureEvidenceSummary}=require('../../services/economic-cost-center-read-model');
const client={query:mockQuery,release:mockRelease},actor={id:'actor',role:'admin'},month='2026-01-01';
const ok=(rows=[])=>({rows});
beforeEach(()=>{jest.resetAllMocks();mockClient.mockResolvedValue(client);mockGrant.mockResolvedValue(true);});
function projection(postRows=[],commitmentRows=[],structureRows=[]){
  mockQuery.mockResolvedValueOnce(ok([{id:'center'}])).mockResolvedValueOnce(ok([{id:'family'}])).mockResolvedValueOnce(ok([{id:'resource'}])).mockResolvedValueOnce(ok(postRows)).mockResolvedValueOnce(ok(commitmentRows)).mockResolvedValueOnce(ok(structureRows)).mockResolvedValueOnce(ok());
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
  for(const call of mockQuery.mock.calls.slice(1,7))expect(call[1][0]).toBe('market-CM');
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

test('budget subtotal preserves exact cents and distinguishes coverage from zero',()=>{
  expect(budgetSummary([{budget:{eur:'99999999999999.99'}},{budget:{eur:'0.02'}}])).toEqual({recordedEur:'100000000000000.01',totalEur:'100000000000000.01',coveredPosts:2,totalPosts:2});
  expect(budgetSummary([{budget:{eur:'0.00'}},{budget:null}])).toEqual({recordedEur:'0.00',totalEur:null,coveredPosts:1,totalPosts:2});
  expect(budgetSummary([])).toEqual({recordedEur:null,totalEur:null,coveredPosts:0,totalPosts:0});
});

test('frozen EUR commitment valuation uses exact half-even rounding without revaluing FX',()=>{
  expect(commitmentRemainingEur({initial_native:'100.0000',initial_eur:'100.00',remaining_native:'70.0000'})).toBe('70.00');
  expect(commitmentRemainingEur({initial_native:'2',initial_eur:'0.01',remaining_native:'1'})).toBe('0.00');
  expect(commitmentRemainingEur({initial_native:'2',initial_eur:'0.03',remaining_native:'1'})).toBe('0.02');
  expect(commitmentRemainingEur({initial_native:'100',initial_eur:'25.00',remaining_native:'101'})).toBeNull();
  expect(commitmentRemainingEur({initial_native:'100',initial_eur:'25.00',remaining_native:'20',requires_reconciliation:true})).toBeNull();
});
test('commitment aggregation distinguishes unknown correction, empty scope, and known zero',()=>{
  expect(commitmentSummary([{commitments:[{remaining_eur:'70.00'},{remaining_eur:null}]}])).toMatchObject({recordedEur:'70.00',totalEur:null,coveredCommitments:1,totalCommitments:2});
  expect(commitmentSummary([{commitments:[]}])).toMatchObject({recordedEur:'0.00',totalEur:'0.00'});
  expect(commitmentSummary([])).toMatchObject({recordedEur:null,totalEur:null});
});

test('structure evidence sums signed canonical amounts and excludes unmapped and crossing facts',()=>{
  expect(structureEvidenceSummary([{post_id:'p',whole_period:true,amount_kmf:'100.10'},{post_id:'p',whole_period:true,amount_kmf:'-10.01'},{post_id:'p',whole_period:false,amount_kmf:'500.00'},{post_id:null,whole_period:true,amount_kmf:'999.00'}])).toEqual({amountKmf:'90.09',included:2,unmapped:1,crossPeriod:1,invalid:0,coverage:'STRUCTURE_EVIDENCE_ONLY'});
  expect(structureEvidenceSummary([]).amountKmf).toBeNull();
  expect(structureEvidenceSummary([{post_id:'p',whole_period:true,amount_kmf:'-1.01'}]).amountKmf).toBe('-1.01');
});
