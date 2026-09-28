'use strict';
jest.mock('../../db',()=>({getClient:jest.fn()}));
const db=require('../../db');
const policy=require('../../services/sourcing-provider-control-policy');
describe('Provider capability policy',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('unknown capability and invalid state fail closed',async()=>{
  await expect(policy.setCapability('source','unknown',true,null,'test')).rejects.toMatchObject({status:400,code:'provider_capability_invalid'});
  await expect(policy.setCapability('source','sync','yes',null,'test')).rejects.toMatchObject({status:400,code:'provider_state_invalid'});
  await expect(policy.setCapability('source','sync',true,null,'')).rejects.toMatchObject({status:400,code:'provider_reason_required'});
 });
 test('production ON requires durable runtime provider evidence, never a static manifest',async()=>{
  await expect(policy.setCapability('source','production',true,null,'operator')).rejects.toMatchObject({status:409,code:'provider_certification_runtime_evidence_required'});
  expect(db.getClient).not.toHaveBeenCalled();
 });
 test('automatic import requires all four independently authorized capabilities',()=>{
  const all={discovery_enabled:true,sync_enabled:true,import_enabled:true,production_enabled:true};
  expect(policy.canRunAutomaticImport(all)).toBe(true);
  for(const key of Object.keys(all))expect(policy.canRunAutomaticImport({...all,[key]:false})).toBe(false);
 });
 test('mutation and audit commit atomically',async()=>{
  const query=jest.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({rows:[{source_id:'source',sync_enabled:false}]}).mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockResolvedValueOnce({});
  const release=jest.fn();db.getClient.mockResolvedValue({query,release});
  await expect(policy.setCapability('source','sync',true,{id:'operator'},'manual review')).resolves.toMatchObject({enabled:true,changed:true});
  expect(query.mock.calls.map(call=>call[0])).toEqual(expect.arrayContaining(['BEGIN','COMMIT']));
  expect(query.mock.calls.some(call=>call[0].includes('INSERT INTO sourcing_provider_control_events'))).toBe(true);
  expect(release).toHaveBeenCalled();
 });
});
