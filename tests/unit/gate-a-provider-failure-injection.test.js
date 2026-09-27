'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const cj=require('../../services/suppliers/connectors/cj-connector');
const ali=require('../../services/suppliers/connectors/aliexpress-connector');
function response(body,status){return{ok:status>=200&&status<300,status,json:async()=>body};}
describe('Gate A provider failure injection on real connectors',()=>{
 beforeEach(()=>cj.resetTokenCacheForTests());
 test.each([429,500,503])('CJ propagates HTTP %s without producing supplier products',async status=>{
  const fetchImpl=jest.fn().mockResolvedValue(response({result:false,success:false,message:'injected',requestId:'gate-a'},status));
  await expect(cj.fetchProducts({fetchImpl,env:{CJ_ACCESS_TOKEN:'fixture-token'},keyword:'fixture'})).rejects.toMatchObject({status});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 test('CJ invalid auth fails closed and exposes request id, not credential',async()=>{
  const fetchImpl=jest.fn().mockResolvedValue(response({result:false,success:false,message:'Authentication failed',requestId:'gate-auth'},401));
  let error;try{await cj.fetchProducts({fetchImpl,env:{CJ_ACCESS_TOKEN:'super-secret'},keyword:'fixture'});}catch(e){error=e;}
  expect(error).toBeTruthy(); expect(error.message).toMatch(/gate-auth/); expect(error.message).not.toMatch(/super-secret/);
 });
 test.each([429,500,503])('AliExpress propagates HTTP %s without normalized output',async status=>{
  const fetchImpl=jest.fn().mockResolvedValue(response({error_response:{msg:'injected'}},status));
  await expect(ali.invokeTop('aliexpress.ds.text.search',{keyword:'fixture'},{fetchImpl,env:{ALIEXPRESS_APP_KEY:'key',ALIEXPRESS_APP_SECRET:'secret',ALIEXPRESS_SESSION:'session'},now:new Date('2026-09-27T12:00:00Z')})).rejects.toThrow(new RegExp(String(status)));
 });
 test('AliExpress invalid auth fails closed without exposing app secret',async()=>{
  const fetchImpl=jest.fn().mockResolvedValue(response({error_response:{msg:'Invalid session'}},401));
  let error;try{await ali.invokeTop('aliexpress.ds.text.search',{keyword:'fixture'},{fetchImpl,env:{ALIEXPRESS_APP_KEY:'key',ALIEXPRESS_APP_SECRET:'never-leak',ALIEXPRESS_SESSION:'bad'},now:new Date('2026-09-27T12:00:00Z')});}catch(e){error=e;}
  expect(error).toBeTruthy(); expect(error.message).toMatch(/401/); expect(error.message).not.toMatch(/never-leak/);
 });
});
