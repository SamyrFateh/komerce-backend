'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../services/market-delegation-service',()=>({resolveAuthorization:jest.fn()}));
jest.mock('../../services/market-delegation-read-authority',()=>({resolveCanonicalMarketRead:jest.fn()}));
jest.mock('../../services/catalog-market-exposure-service',()=>({isProductExposedForMarketCode:jest.fn()}));
jest.mock('../../services/conversation-service',()=>({list:jest.fn().mockResolvedValue([]),append:jest.fn(),attachment:jest.fn(),setRetention:jest.fn()}));
const {resolveAuthorization}=require('../../services/market-delegation-service');
const {resolveCanonicalMarketRead}=require('../../services/market-delegation-read-authority');
const conversations=require('../../services/conversation-service');
const svc=require('../../services/market-delegation-client-request-service');
const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',marketId='33333333-3333-4333-8333-333333333333';
const client={id:owner,role:'client'}, agent={id,role:'market_operator'},hub={id,role:'agent_hub'};
const row={id,reference:'D-TEST',market_id:marketId,user_id:owner,motif:'auto_parts',status:'new',hub_shared:true,verified_callback_phone:'+2693212345'};
const denied=()=>Object.assign(new Error('denied'),{status:403,code:'MARKET_CAPABILITY_REQUIRED'});
beforeEach(()=>{jest.clearAllMocks();resolveCanonicalMarketRead.mockResolvedValue({market_id:marketId,capabilities:['client.read','client.case.handle']});resolveAuthorization.mockResolvedValue({market_id:marketId});});
test('client lookup includes authenticated owner and unauthorized request is 404',async()=>{
 const q={query:jest.fn().mockResolvedValue({rows:[]})};
 await expect(svc.read(q,{actor:client,scope:'client',ref:'D-TEST'})).rejects.toMatchObject({status:404});
 expect(q.query.mock.calls[0][0]).toContain('r.user_id=$1');expect(q.query.mock.calls[0][1]).toEqual([owner,'D-TEST']);
 expect(conversations.list).not.toHaveBeenCalled();
});
test('market lookup always includes resolved market; other market dossier gives 404',async()=>{
 const q={query:jest.fn().mockResolvedValue({rows:[]})};
 await expect(svc.read(q,{actor:agent,scope:'market',market:'CM',ref:'D-TEST'})).rejects.toMatchObject({status:404});
 expect(q.query.mock.calls[0][0]).toContain('r.market_id=$1');expect(q.query.mock.calls[0][1]).toEqual([marketId,'D-TEST']);
});
test('Hub lookup enforces explicit sharing; revoked dossier is 404',async()=>{
 const q={query:jest.fn().mockResolvedValue({rows:[]})};
 await expect(svc.read(q,{actor:hub,scope:'hub',ref:'D-TEST'})).rejects.toMatchObject({status:404});
 expect(q.query.mock.calls[0][0]).toContain('r.hub_shared IS TRUE');
 expect(conversations.list).not.toHaveBeenCalled();
});
test('Hub projection never returns client identity or callback and requests internal scope',async()=>{
 const q={query:jest.fn().mockResolvedValue({rows:[row]})};
 const data=await svc.read(q,{actor:hub,scope:'hub',ref:'D-TEST'});
 expect(data.request).not.toHaveProperty('user_id');expect(data.request).not.toHaveProperty('callback_phone');
 expect(data.request).not.toHaveProperty('verified_callback_phone');
 expect(conversations.list).toHaveBeenCalledWith(q,{requestId:id,scope:'hub',before:null});
});
test('read-only market agent has no callback or writer permission even when membership projection includes handle',async()=>{
 resolveAuthorization.mockRejectedValue(denied());
 const q={query:jest.fn().mockResolvedValue({rows:[row]})};
 const data=await svc.read(q,{actor:agent,scope:'market',market:'CM',ref:'D-TEST'});
 expect(data.request.can_handle).toBe(false);expect(data.request).not.toHaveProperty('callback_phone');
 expect(q.query).toHaveBeenCalledTimes(1);
 await expect(svc.post(q,{actor:agent,scope:'market',market:'CM',ref:'D-TEST',visibility:'client',body:'reply'})).rejects.toMatchObject({status:403});
 expect(conversations.append).not.toHaveBeenCalled();
});
test('callback only appears in handler detail, and is omitted if current account no longer matches proof',async()=>{
 const q={query:jest.fn().mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{phone:'+2693212345'}]})};
 const data=await svc.read(q,{actor:agent,scope:'market',market:'CM',ref:'D-TEST'});
 expect(data.request.callback_phone).toBe(row.verified_callback_phone);
 q.query.mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{phone:'+2693212346'}]});
 const changed=await svc.read(q,{actor:agent,scope:'market',market:'CM',ref:'D-TEST'});
 expect(changed.request).not.toHaveProperty('callback_phone');
 q.query.mockResolvedValueOnce({rows:[row]});
 expect((await svc.list(q,{actor:agent,scope:'market',market:'CM'}))[0]).not.toHaveProperty('callback_phone');
});
