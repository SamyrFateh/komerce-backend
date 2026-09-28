'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db',()=>({getClient:jest.fn()}));
const db=require('../../db');
const policy=require('../../services/sourcing-provider-control-policy');

function clientFor(source){
 const query=jest.fn()
  .mockResolvedValueOnce({})
  .mockResolvedValueOnce({rows:source?[source]:[]})
  .mockResolvedValueOnce({})
  .mockResolvedValueOnce({})
  .mockResolvedValueOnce({});
 const release=jest.fn();
 db.getClient.mockResolvedValue({query,release});
 return {query,release};
}

describe('Provider capability policy',()=>{
 beforeEach(()=>jest.clearAllMocks());

 test('unknown capability and invalid state fail closed',async()=>{
  await expect(policy.setCapability('source','unknown',true,null,'test')).rejects.toMatchObject({status:400,code:'provider_capability_invalid'});
  await expect(policy.setCapability('source','sync','yes',null,'test')).rejects.toMatchObject({status:400,code:'provider_state_invalid'});
  await expect(policy.setCapability('source','sync',true,null,'')).rejects.toMatchObject({status:400,code:'provider_reason_required'});
 });

 test('production ON requires durable runtime provider evidence',async()=>{
  const {query}=clientFor({
   source_id:'source',
   discovery_enabled:true,sync_enabled:true,import_enabled:true,production_enabled:false,
   production_certified_capture_id:null,production_certified_at:null,
  });
  await expect(policy.setCapability('source','production',true,null,'operator'))
   .rejects.toMatchObject({status:409,code:'provider_certification_runtime_evidence_required'});
  expect(query.mock.calls.some(([sql])=>String(sql).includes('UPDATE sourcing_sources SET production_enabled'))).toBe(false);
  expect(query).toHaveBeenCalledWith('ROLLBACK');
 });

 test('a complete capture can become durable runtime evidence only for CANONICAL_RESOLVED',async()=>{
  const q={query:jest.fn().mockResolvedValue({rows:[{source_ref:'api:cj',production_certified_at:'2026-09-28T12:00:00Z'}]})};
  await expect(policy.recordRuntimeCertification({
   sourceRef:'api:cj',captureId:'capture-1',pipelineStatus:'CANONICAL_RESOLVED',
  },q)).resolves.toMatchObject({source_ref:'api:cj',certified:true});
  expect(q.query.mock.calls[0][0]).toContain("c.status='complete'");
  expect(q.query.mock.calls[0][1]).toEqual(['api:cj','capture-1']);

  q.query.mockClear();
  await expect(policy.recordRuntimeCertification({
   sourceRef:'api:cj',captureId:'capture-2',pipelineStatus:'PARTIAL_BLOCKED',
  },q)).resolves.toMatchObject({certified:false,reason:'runtime_evidence_incomplete'});
  expect(q.query).not.toHaveBeenCalled();
 });

 test('automatic import requires four capabilities and runtime certification',()=>{
  const all={
   discovery_enabled:true,sync_enabled:true,import_enabled:true,production_enabled:true,
   production_certified_capture_id:'capture-1',production_certified_at:'2026-09-28T12:00:00Z',
  };
  expect(policy.canRunAutomaticImport(all)).toBe(true);
  for(const key of ['discovery_enabled','sync_enabled','import_enabled','production_enabled']){
   expect(policy.canRunAutomaticImport({...all,[key]:false})).toBe(false);
  }
  expect(policy.canRunAutomaticImport({...all,production_certified_capture_id:null})).toBe(false);
  expect(policy.canRunAutomaticImport({...all,production_certified_at:null})).toBe(false);
 });

 test('production ON succeeds after runtime certification and is audited atomically',async()=>{
  const {query,release}=clientFor({
   source_id:'source',
   discovery_enabled:true,sync_enabled:true,import_enabled:true,production_enabled:false,
   production_certified_capture_id:'capture-1',production_certified_at:'2026-09-28T12:00:00Z',
  });
  await expect(policy.setCapability('source','production',true,{id:'operator'},'runtime proof verified'))
   .resolves.toMatchObject({enabled:true,changed:true});
  expect(query.mock.calls.some(call=>String(call[0]).includes('UPDATE sourcing_sources SET production_enabled'))).toBe(true);
  expect(query.mock.calls.some(call=>String(call[0]).includes('INSERT INTO sourcing_provider_control_events'))).toBe(true);
  expect(release).toHaveBeenCalled();
 });

 test('mutation and audit commit atomically',async()=>{
  const {query,release}=clientFor({source_id:'source',sync_enabled:false});
  await expect(policy.setCapability('source','sync',true,{id:'operator'},'manual review')).resolves.toMatchObject({enabled:true,changed:true});
  expect(query.mock.calls.map(call=>call[0])).toEqual(expect.arrayContaining(['BEGIN','COMMIT']));
  expect(query.mock.calls.some(call=>String(call[0]).includes('INSERT INTO sourcing_provider_control_events'))).toBe(true);
  expect(release).toHaveBeenCalled();
 });
});
