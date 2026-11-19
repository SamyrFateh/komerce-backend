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
