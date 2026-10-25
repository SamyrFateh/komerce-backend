'use strict';
/** @test-kind unit @test-runner node @test-requires none */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {discoverExemptionPairs,scanExemptionSinks}=require('../../scripts/audits/lib/exemption-invariant-detectors');
const root=path.resolve(__dirname,'../..');
const schema=fs.readFileSync(path.join(root,'docs/db/railway-live-schema.sql'),'utf8');
const pairs=discoverExemptionPairs(schema);

test('exemption constraints are inferred from SQL schema rather than known filenames',()=>{
  assert.ok(pairs.some(x=>x.table==='products' && x.flag==='repack_exempt' && x.field==='repack_volume_cm3'));
  const alternate=discoverExemptionPairs('CREATE TABLE public.crates (\n seal_exempt boolean DEFAULT FALSE,\n seal_weight numeric(10,2),\n name text\n);\n');
  assert.deepEqual(alternate,[{table:'crates',flag:'seal_exempt',field:'seal_weight'}]);
});

test('discover Hub unguarded write without hardcoding hub in the detector',()=>{
  const source=fs.readFileSync(path.join(root,'services/hub-operations.js'),'utf8');
  const findings=scanExemptionSinks(source,'services/hub-operations.js',pairs);
  assert.ok(findings.some(x=>x.function==='recordVolume' && x.kind==='EXEMPTION_WRITE_UNGUARDED'
    && x.field==='repack_volume_cm3'));
});

test('discover Sourcing unguarded use of an exemption-linked measurement',()=>{
  const source=fs.readFileSync(path.join(root,'services/sourcing-analysis.js'),'utf8');
  const findings=scanExemptionSinks(source,'services/sourcing-analysis.js',pairs);
  assert.ok(findings.some(x=>x.function==='getProductVolumeCm3' && x.kind==='EXEMPTION_READ_UNGUARDED'));
});

test('guarded mutations and guarded consumers are negative controls',()=>{
  const mutations = [
    'async function recordMeasurements(client,payload) {',
    '  if (item.seal_exempt) throw new Error("EXEMPT");',
    '  const sets = ["seal_weight = $1"];',
    '  await client.query("UPDATE crates SET seal_weight = $1 WHERE id = $2");',
    '}',
    'function getSealWeight(item) {',
    '  if (item.seal_exempt) return item.original_weight;',
    '  return Number(item.seal_weight);',
    '}'
  ].join('\n');
  const rule=[{table:'crates',flag:'seal_exempt',field:'seal_weight'}];
  assert.equal(scanExemptionSinks(mutations,'services/crates.js',rule).length,0);
});
