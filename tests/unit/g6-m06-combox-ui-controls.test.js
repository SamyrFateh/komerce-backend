/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const runner=fs.readFileSync(path.join(root,'scripts/recette/g6-m06-direct-combox-chromium.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/dashboards/canonical/js/operations-workspace.js'),'utf8');

describe('M06 direct COMBOX — Chromium fields match the real Hub operator UI',()=>{
 test('uses the existing accessible controls, not selectors absent from the page',()=>{
  expect(ui).toContain("method.setAttribute('aria-label','Mode de preuve du scan article dans '+box.reference)");
  expect(ui).toContain("'Preuve du constat manuel pour '+box.reference");
  expect(runner).toContain("row.getByRole('combobox',{name:'Mode de preuve du scan article dans '+BOXREF})");
  expect(runner).toContain("row.getByRole('textbox',{name:'Code physique de l’article à placer dans '+BOXREF})");
  expect(runner).not.toContain("row.locator('[data-hub-box-evidence-method]')");
  expect(runner).not.toContain("row.locator('[data-hub-box-manual-proof]')");
 });
 test('retains actual Chromium gestures, exact three-unit mutation and PostgreSQL custody oracle',()=>{
  expect(runner).toContain("await humanSelect(null,method,'SCAN')");
  expect(runner).toContain("Number(b.quantity)===1");
  expect(runner).toContain("b.evidence_method==='SCAN'");
  expect(runner).toContain("b.evidence_code===alias");
  expect(runner).toContain("hub_scan_label_box_scans");
  expect(runner).toContain("after.scans.length===3");
  expect(runner).toContain("print-article-labels");
  expect(runner).toContain("HARDWARE_NOT_PROVEN");
  expect(runner).toContain("after.receipt_state==='RECEIVED'"); // after empty COMBOX creation
  expect(runner).toContain("after.receipt_state==='SUPERSEDED'"); // after moving all three units
  expect(runner).toContain("!!after.receipt_placement_removed_at");
  expect(runner).toContain("p0.removed_at AS receipt_placement_removed_at");
  expect(runner).not.toContain("p0.operation_type='RECEIVE' AND p0.removed_at IS NULL");
  expect(runner).toContain("'G6_M06_COMBOX_POSTGRES_CUSTODY_INVALID'");
  expect(runner).toContain("report.verdict='G6_M06_DIRECT_COMBOX_CHROMIUM_PG_PASS'");
 });
});
