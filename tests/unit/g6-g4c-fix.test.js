/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
describe('G6-G4C-FIX',()=>{
 it('workflow : tous les rapports g6-negative-* sont conservés',()=>{
  expect(read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml')).toContain('test-results/g6-negative-*/');
 });
 it('oracle simulation M01 : exécutions manuelles bornées à la ligne de la commande, oracle non affaibli',()=>{
  const s=read('scripts/recette/g6-hub-vendor-simulation-chromium.js');
  expect(s).toContain('e.purchase_line_id=pl.id');
  expect(s).not.toMatch(/manual_executions\)>=1|manual_executions\)>0/);
  expect(s).toContain("Number(after.manual_executions)===1");
  expect(s).toContain("check(before.po_status==='notified'");
 });
 it('N13/N14 : 202 quarantined = refus, excès > capacité PO/SKU, received===0 maintenu',()=>{
  const s=read('scripts/recette/g6-negative-n13-n14-chromium.js');
  expect(s).toContain("res.status()===202&&j.quarantined===true");
  expect(s).toContain("!quarantined)report.gaps.push('ACCEPTED_'");
  expect(s).toContain('po_sku_quantity');
  expect(s).toContain("mid.received===0&&mid.po_status==='confirmed'");
  expect(s).toContain('e.purchase_line_id=pl.id');
 });
});
describe('G6 N15 act : verdict indépendant d\'une réponse absente',()=>{
 it('plus de waitForResponse 30s ; refus d\'écran silencieux = no_request, garde = guard_blocked',()=>{
  const s=read('scripts/recette/g6-negative-n15-n16-chromium.js');
  expect(s).not.toContain('waitForResponse');
  expect(s).toContain('no_request:true');
  expect(s).toContain('guard_blocked');
  expect(s).toContain("check(actor.blocked.length===0,'G6_N15_UNEXPECTED_BROWSER_WRITE')");
 });
});
