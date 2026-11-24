/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const scripts=[
 'scripts/recette/g6-m06-direct-combox-chromium.js',
 'scripts/recette/g6-m06-shipment-handover-chromium.js',
];
describe('M06 Chromium QR printing scripts parse before mutating staging',()=>{
 test.each(scripts)('%s passes node --check and retains distinct QR / privacy oracles',relative=>{
  const file=path.resolve(__dirname,'../..',relative);
  const parsed=spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:15000});
  expect(parsed.error).toBeUndefined();
  expect(parsed.status).toBe(0);
  const source=fs.readFileSync(file,'utf8');
  expect(source).toContain("src.startsWith('data:image/png;base64,')");
  expect(source).toContain("new Set(qrSources).size===expected.length");
  expect(source).toContain('G6_HUB_PRINT_COMMERCIAL_REFERENCE_EXPOSED_');
 });
});
