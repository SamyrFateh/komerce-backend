'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { resolveReadAuthority }=require('../../services/market-delegation-read-authority');
const args={userId:'u',marketCode:'CM',primaryCapability:'client.read',fallbackCapability:'client.case.handle'};
const deny=(code,status=403)=>Object.assign(new Error(code),{code,status});

test('la capability de lecture est prioritaire',async()=>{
  const resolve=jest.fn().mockResolvedValue({market_id:'m',capabilities:['client.read']});
  expect(await resolveReadAuthority(resolve,{},args)).toMatchObject({market_id:'m'});
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve.mock.calls[0][1].requiredCapability).toBe('client.read');
});
test('le manager existant avec action mais sans read peut toujours consulter',async()=>{
  const resolve=jest.fn(async(_db,c)=>{
    if(c.requiredCapability==='client.read')throw deny('MARKET_CAPABILITY_REQUIRED');
    return {market_id:'m',capabilities:['client.case.handle']};
  });
  expect((await resolveReadAuthority(resolve,{},args)).market_id).toBe('m');
  expect(resolve.mock.calls.map(c=>c[1].requiredCapability)).toEqual(['client.read','client.case.handle']);
});
test.each(['MARKET_MEMBERSHIP_REQUIRED','MARKET_NOT_FOUND','AUTH_REQUIRED','MARKET_SUSPENDED'])(
 'jamais de fallback sur %s',async(code)=>{
  const first=deny(code,code==='MARKET_SUSPENDED'?409:403);
  const resolve=jest.fn().mockRejectedValue(first);
  await expect(resolveReadAuthority(resolve,{},args)).rejects.toBe(first);
  expect(resolve).toHaveBeenCalledTimes(1);
});
test('deux capabilities refusées donnent un refus serveur',async()=>{
  const resolve=jest.fn().mockRejectedValue(deny('MARKET_CAPABILITY_REQUIRED'));
  await expect(resolveReadAuthority(resolve,{},args)).rejects.toMatchObject({status:403,code:'MARKET_CAPABILITY_REQUIRED'});
  expect(resolve).toHaveBeenCalledTimes(2);
});

const {resolveCanonicalMarketRead}=require('../../services/market-delegation-read-authority');
const mockDashboardGlobal=jest.fn(),mockCatalogGlobal=jest.fn(),mockAssignment=jest.fn();
jest.mock('../../middleware/require-dashboard-global-authority',()=>({hasDashboardGlobalAuthority:(...a)=>mockDashboardGlobal(...a)}));
jest.mock('../../middleware/require-catalog-global-authority',()=>({hasCatalogGlobalAuthority:(...a)=>mockCatalogGlobal(...a)}));
jest.mock('../../services/market-delegation-service',()=>({resolveActiveAssignmentByMarketCode:(...a)=>mockAssignment(...a)}));
beforeEach(()=>{mockDashboardGlobal.mockReset();mockCatalogGlobal.mockReset();mockAssignment.mockReset();});
test('A1 : admin central sans grant, target market and READ only',async()=>{
  mockDashboardGlobal.mockResolvedValue(false);mockAssignment.mockResolvedValue({market_id:'cm',market_code:'CM',assignment_id:'a'});
  const delegate=jest.fn(),executor={};
  expect(await resolveCanonicalMarketRead(delegate,executor,{...args,actorRole:'admin'})).toEqual({market_id:'cm',market_code:'CM',assignment_id:'a',membership_id:null,capabilities:['client.read'],canonical_central_read:true});
  expect(mockAssignment).toHaveBeenCalledWith(executor,'CM');expect(delegate).not.toHaveBeenCalled();
});
test('operator never gets a central grant from role or a market locator',async()=>{
  const delegate=jest.fn().mockRejectedValue(deny('MARKET_MEMBERSHIP_REQUIRED'));
  await expect(resolveCanonicalMarketRead(delegate,{}, {...args,actorRole:'market_operator'})).rejects.toMatchObject({status:403});
  expect(mockDashboardGlobal).not.toHaveBeenCalled();expect(mockAssignment).not.toHaveBeenCalled();
});
test('catalog READ does not require a separate central grant; no membership or ACT rights',async()=>{
  mockCatalogGlobal.mockResolvedValue(false);
  mockAssignment.mockResolvedValue({market_id:'cm',market_code:'CM',assignment_id:'a'});
  const delegate=jest.fn().mockRejectedValue(deny('MARKET_MEMBERSHIP_REQUIRED'));
  expect(await resolveCanonicalMarketRead(delegate,{}, {userId:'a',actorRole:'admin',marketCode:'CM',primaryCapability:'catalog.read'})).toMatchObject({market_id:'cm',membership_id:null,capabilities:['catalog.read']});
  expect(mockCatalogGlobal).not.toHaveBeenCalled();expect(mockDashboardGlobal).not.toHaveBeenCalled();expect(delegate).not.toHaveBeenCalled();
});
test('no central market ACT capability can be manufactured by this helper',async()=>{
  await expect(resolveCanonicalMarketRead(jest.fn(),{}, {...args,actorRole:'admin',primaryCapability:'client.case.handle'})).rejects.toThrow('READ capability');
  expect(mockDashboardGlobal).not.toHaveBeenCalled();
});
