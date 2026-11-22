'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {attestHealthVersion}=require('../../scripts/recette/canonical/health-read-only-retry');
const SHA='2b5fa4456d9b200eb3bc567b239835136c6ae48f';
const URL='https://komerce-backend-production.up.railway.app/health/version';
const good=()=>({ok:true,status:200,json:async()=>({commit:SHA})});

test('retries one transient transport failure on GET only, preserving SHA attestation',async()=>{
 const fetchImpl=jest.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(good());
 const sleep=jest.fn().mockResolvedValue();
 expect(await attestHealthVersion({fetchImpl,url:URL,expectedSha:SHA,sleep})).toEqual({commit:SHA});
 expect(fetchImpl).toHaveBeenCalledTimes(2);
 expect(fetchImpl.mock.calls.every(([url,options])=>url===URL&&options.method==='GET'
  &&options.redirect==='error'&&options.signal instanceof AbortSignal)).toBe(true);
 expect(sleep).toHaveBeenCalledTimes(1);
 expect(sleep).toHaveBeenCalledWith(250);
});

test('exhausted network failures are explicit, bounded, and never declared GO',async()=>{
 const fetchImpl=jest.fn().mockRejectedValue(new TypeError('fetch failed'));
 const sleep=jest.fn().mockResolvedValue();
 await expect(attestHealthVersion({fetchImpl,url:URL,expectedSha:SHA,sleep}))
  .rejects.toMatchObject({message:'G6_DYNAMIC_DEPLOY_HEALTH_TRANSPORT_EXHAUSTED'});
 expect(fetchImpl).toHaveBeenCalledTimes(3);
 expect(sleep.mock.calls.map(args=>args[0])).toEqual([250,750]);
});

test('HTTP rejection never retries, even if a later attempt could be successful',async()=>{
 const fetchImpl=jest.fn().mockResolvedValueOnce({ok:false,status:502}).mockResolvedValueOnce(good());
 await expect(attestHealthVersion({fetchImpl,url:URL,expectedSha:SHA,sleep:jest.fn()}))
  .rejects.toThrow('G6_DYNAMIC_DEPLOY_HEALTH_FAILURE');
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('healthy HTTP 200 with changed SHA fails closed without retry',async()=>{
 const fetchImpl=jest.fn().mockResolvedValueOnce({ok:true,status:200,json:async()=>({commit:'a'.repeat(40)})});
 await expect(attestHealthVersion({fetchImpl,url:URL,expectedSha:SHA,sleep:jest.fn()}))
  .rejects.toThrow('G6_DYNAMIC_DEPLOY_SHA_DRIFT');
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('malformed health payload fails closed without retry',async()=>{
 const fetchImpl=jest.fn().mockResolvedValueOnce({ok:true,status:200,json:async()=>{throw Error('bad json');}});
 await expect(attestHealthVersion({fetchImpl,url:URL,expectedSha:SHA,sleep:jest.fn()}))
  .rejects.toThrow('G6_DYNAMIC_DEPLOY_HEALTH_JSON_INVALID');
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('refuses a non-health destination before making a request',async()=>{
 const fetchImpl=jest.fn();
 await expect(attestHealthVersion({fetchImpl,url:URL.replace('/health/version','/api/orders'),expectedSha:SHA}))
  .rejects.toThrow('G6_DYNAMIC_DEPLOY_HEALTH_ARGUMENTS_INVALID');
 expect(fetchImpl).not.toHaveBeenCalled();
});
