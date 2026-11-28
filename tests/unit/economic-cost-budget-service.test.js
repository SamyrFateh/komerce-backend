'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockQuery=jest.fn(), mockRelease=jest.fn(), mockGetClient=jest.fn(), mockGrant=jest.fn(), mockConvert=jest.fn();
jest.mock('../../db',()=>({getClient:(...a)=>mockGetClient(...a)}));
jest.mock('../../middleware/require-pricing-global-authority',()=>({hasPricingGlobalAuthority:(...a)=>mockGrant(...a)}));
jest.mock('../../services/fx-authority',()=>({MINOR_UNITS:{EUR:2,KMF:0},convert:(...a)=>mockConvert(...a)}));
const {reviseBudget,parseInput}=require('../../services/economic-cost-budget-service');
const actor={id:'actor',role:'admin'};
const postId='b4aa1768-1f81-4e12-9b1a-2c9df13c8c24';
const input={postId,marketCode:null,periodStart:'2026-01-01',expectedRevision:0,amountNative:'100.50',currency:'EUR',reason:'Budget annuel',requestKey:'request-01'};
const client={query:mockQuery,release:mockRelease};
const ok=(rows=[])=>({rows});
beforeEach(()=>{jest.resetAllMocks();mockGetClient.mockResolvedValue(client);mockGrant.mockResolvedValue(true);});
test('refuse implicit scope, floats, minor units and invalid months',()=>{
  expect(parseInput(input).amountNative).toBe('100.5000');
  for(const bad of [{marketCode:undefined},{amountNative:100.5},{amountNative:'1.01',currency:'KMF'},{periodStart:'2026-02-02'},{expectedRevision:-1}]) expect(()=>parseInput({...input,...bad})).toThrow();
});
test('role alone or non-admin cannot write',async()=>{
  mockGrant.mockResolvedValue(false);
  await expect(reviseBudget(actor,input)).rejects.toMatchObject({status:403});
  await expect(reviseBudget({...actor,role:'market_operator'},input)).rejects.toMatchObject({status:403});
  expect(mockGetClient).not.toHaveBeenCalled();
});
test('exact scope prevents wrong-market post access',async()=>{
  mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok([{id:'market-cm'}])).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
  await expect(reviseBudget(actor,{...input,marketCode:'CM'})).rejects.toMatchObject({status:404});
  expect(mockQuery.mock.calls[2][1]).toEqual([postId,'market-cm']);
  expect(mockQuery.mock.calls[3][0]).toBe('ROLLBACK');
  expect(mockConvert).not.toHaveBeenCalled();
});
test('writes one version with canonical conversion and server clock',async()=>{
  const asOf=new Date('2026-01-10T12:00:00Z');
  const legs=[{kind:'parity',rate:'491.96775'}];
  mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok([{id:postId}])).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok([{as_of:asOf}])).mockResolvedValueOnce(ok([{id:'revision'}])).mockResolvedValueOnce(ok());
  mockConvert.mockResolvedValue({amount_text:'2.03',legs});
  await expect(reviseBudget(actor,{...input,currency:'KMF',amountNative:'1000'})).resolves.toEqual({outcome:'created',revision:{id:'revision'}});
  expect(mockConvert).toHaveBeenCalledWith({amount:'1000.0000',from:'KMF',to:'EUR',at:asOf,client});
  expect(mockQuery.mock.calls[5][1]).toEqual([postId,input.periodStart,1,null,'KMF','1000.0000','2.03',JSON.stringify(legs),asOf,input.reason,input.requestKey,actor.id]);
  expect(mockQuery.mock.calls[5][0]).toContain('RETURNING *, amount_native::text AS amount_native, amount_eur::text AS amount_eur');
  expect(mockQuery.mock.calls[6][0]).toBe('COMMIT');
  expect(mockRelease).toHaveBeenCalledTimes(1);
});
test('idempotent replay keeps original FX snapshot, rejects changed payload',async()=>{
  const revision={currency:'EUR',amount_native:'100.5000',reason:input.reason,recorded_by:actor.id,previous_revision:null};
  const arrange=()=>mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok([{id:postId}])).mockResolvedValueOnce(ok([revision])).mockResolvedValueOnce(ok());
  arrange();await expect(reviseBudget(actor,input)).resolves.toEqual({outcome:'replayed',revision});
  arrange();await expect(reviseBudget(actor,{...input,amountNative:'101'})).rejects.toMatchObject({code:'economic_budget_idempotency_conflict'});
  expect(mockConvert).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls[2][0]).toContain('amount_native::text AS amount_native');
  expect(mockQuery.mock.calls[2][0]).toContain('amount_eur::text AS amount_eur');
});
test('optimistic revision conflict prevents lost update',async()=>{
  mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok([{id:postId}])).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok([{revision:2}])).mockResolvedValueOnce(ok());
  await expect(reviseBudget(actor,input)).rejects.toMatchObject({code:'economic_budget_revision_conflict'});
  expect(mockConvert).not.toHaveBeenCalled();
});
test('unavailable FX fails closed and rolls back',async()=>{
  mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok([{id:postId}])).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok([{as_of:new Date()}])).mockResolvedValueOnce(ok());
  mockConvert.mockRejectedValue(Object.assign(new Error('FX absent'),{code:'fx_rate_unavailable'}));
  await expect(reviseBudget(actor,{...input,currency:'KMF',amountNative:'1000'})).rejects.toMatchObject({code:'fx_rate_unavailable'});
  expect(mockQuery.mock.calls[5][0]).toBe('ROLLBACK');
});

test('preparation budget requires explicit market and refuses stale lifecycle before any post write',async()=>{
  await expect(reviseBudget(actor,input,{preparationOnly:true})).rejects.toMatchObject({status:404});
  expect(mockGetClient).not.toHaveBeenCalled();
  mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
  await expect(reviseBudget(actor,{...input,marketCode:'GA'},{preparationOnly:true})).rejects.toMatchObject({status:404});
  expect(mockQuery.mock.calls[1][0]).toContain("lifecycle_status='PROVISIONING' FOR SHARE");
  expect(mockQuery.mock.calls[2][0]).toBe('ROLLBACK');
  expect(mockConvert).not.toHaveBeenCalled();
});
