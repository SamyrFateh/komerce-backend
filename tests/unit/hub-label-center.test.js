/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const sourcePath=path.resolve(__dirname,'../../public/dashboards/canonical/js/hub-label-center.js');
const source=fs.readFileSync(sourcePath,'utf8');
describe('Hub label center: QR index and authenticated PDF reprinting',()=>{
 test('script parses on Node and never offers a SAC operation',()=>{
  const check=spawnSync(process.execPath,['--check',sourcePath],{encoding:'utf8',timeout:15000});
  expect(check.error).toBeUndefined();expect(check.status).toBe(0);
  expect(source).not.toContain('/bags');
  expect(source).not.toContain('Déposer dans le sac');
 });
 test('catalogue always reads issued labels, independent from outstanding fillable stock',()=>{
  expect(source).toContain("fetchFn(endpoint(marketCode,'labels/index')");
  expect(source).toContain('issued=data.labels;paint()');
  expect(source).toContain("const missing=new Set(issued.filter(e=>e.type==='ARTICLE')");
  expect(source).toContain("item.allocation_id");
  expect(source).toContain('entry.type');
 });
 test('QR identity never leaks to UI, PDF URLs use scoped authenticated download',()=>{
  expect(source).toContain("credentials:'include'");
  expect(source).toContain("headers:{Accept:'application/pdf'}");
  expect(source).toContain("a.setAttribute('data-hub-label-pdf'");
  expect(source).toContain('URL.createObjectURL(blob)');
  expect(source).toContain('download.click()');
  expect(source).not.toContain('qr_value');
 });
 test('supports typed search, accessible labels and explicit user-confirmed operations',()=>{
  expect(source).toContain("search.setAttribute('aria-label','Rechercher les étiquettes QR')");
  expect(source).toContain("type.setAttribute('aria-label','Type d’étiquette QR')");
  expect(source).toContain('Étiquettes QR · ARTICLE et COMBOX');
  expect(source).toContain('seule la confirmation de l’agent valide une opération');
  expect(source).toContain("url:endpoint(marketCode,'labels/articles/'");
 });
});
