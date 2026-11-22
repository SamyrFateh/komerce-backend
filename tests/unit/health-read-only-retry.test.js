'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {attestHealthVersion,fetchHealthReadOnly}=require('../../scripts/recette/canonical/health-read-only-retry');
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

test('target identity GET /health survives one transport drop, then returns response to canonical PG verifier',async()=>{
 const target=URL.replace('/health/version','/health');
 const body={target:{fingerprint:'fingerprint-from-server'}};
 const fetchImpl=jest.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce({
  ok:true,status:200,json:async()=>body
 });
 const sleep=jest.fn().mockResolvedValue();
 const response=await fetchHealthReadOnly({fetchImpl,url:target,sleep});
 expect(await response.json()).toEqual(body);
 expect(fetchImpl.mock.calls.map(([url,request])=>[url,request.method])).toEqual([[target,'GET'],[target,'GET']]);
 expect(sleep).toHaveBeenCalledTimes(1);
});

test('target identity HTTP 200 does not imply PG match; mismatched target body remains visible for confirmTarget',async()=>{
 const url=URL.replace('/health/version','/health');
 const fake={target:{fingerprint:'wrong-pg-target'}};
 const fetchImpl=jest.fn().mockResolvedValue({ok:true,status:200,json:async()=>fake});
 const response=await fetchHealthReadOnly({fetchImpl,url,sleep:jest.fn()});
 expect(await response.json()).toEqual(fake);
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('target identity transport exhaustion is fail-closed; no mutation ever retried',async()=>{
 const url=URL.replace('/health/version','/health');
 const fetchImpl=jest.fn().mockRejectedValue(new TypeError('fetch failed'));
 const sleep=jest.fn().mockResolvedValue();
 await expect(fetchHealthReadOnly({fetchImpl,url,sleep}))
  .rejects.toThrow('G6_DYNAMIC_DEPLOY_HEALTH_TRANSPORT_EXHAUSTED');
 expect(fetchImpl).toHaveBeenCalledTimes(3);
 expect(fetchImpl.mock.calls.every(([_,request])=>request.method==='GET')).toBe(true);
});
