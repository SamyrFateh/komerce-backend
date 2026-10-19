'use strict';
const assert = require('node:assert/strict');
const { validateManifest, execute } = require('../../scripts/recette/rct1-canonical-cost-phase');
const manifest = { scope:'RCT1', orders:[{reference:'RCT1-E1',manual_costs:[
  {cost_type:'sourcing',amount_kmf:300},{cost_type:'packaging',amount_kmf:200},
  {cost_type:'hub',amount_kmf:400},{cost_type:'local_distribution',amount_kmf:300}
]}]};
assert.equal(validateManifest(manifest), manifest);
assert.throws(() => validateManifest({scope:'REAL',orders:[]}), /RCT1_MANIFEST_INVALID/);
assert.throws(() => validateManifest({scope:'RCT1',orders:[
  {reference:'RCT1-E1',manual_costs:[]},{reference:'RCT1-E1',manual_costs:[]}
]}), /RCT1_REFERENCE_INVALID/);
assert.throws(() => validateManifest({scope:'RCT1',orders:[
  {reference:'RCT1-G',manual_costs:[{cost_type:'product_purchase',amount_kmf:3000}]}
]}), /RCT1_COST_INVALID/);
(async () => {
  const calls = [];
  const client = {query:async (sql,params) => {
    calls.push(sql);
    if (sql.startsWith('SELECT id, reference')) return {rows:[{id:'00000000-0000-0000-0000-000000000001',reference:params[0],simulation_scope:null}]};
    if (sql.startsWith('SELECT id FROM order_cost_entry_events')) return {rows:[]};
    return {rows:[]};
  },release:()=>{}};
  const r = await execute({db:{pool:{connect:async()=>client}},manifest});
  assert.equal(r.mode,'DRY_RUN');
  assert.equal(r.actions.length,5);
  assert.deepEqual(calls.filter(x=>/INSERT|UPDATE|DELETE|FOR UPDATE/i.test(x)),[]);
  assert.equal(calls[0],'BEGIN READ ONLY');
  assert.equal(calls[calls.length-1],'ROLLBACK');
  await assert.rejects(() => execute({db:{pool:{connect:async()=>client}},manifest,apply:true}), /RCT1_APPLY_REQUIRES/);
  process.stdout.write('RCT1 canonical cost phase dry-run PASS\n');
})().catch(e=>{console.error(e);process.exitCode=1});
