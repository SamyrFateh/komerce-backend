/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const {graphFor}=require('../../scripts/recette/canonical/stage-registry');
const {loadManifest}=require('../../scripts/recette/canonical/manifest-loader');

describe('M06 Hub manual purchasing — non-regression against M03',()=>{
 test('M06 starts manual purchase after commitment, without external vendor-send readiness',()=>{
  const stages=graphFor('M06');
  expect(stages.byId.has('HUB_VENDOR_READINESS')).toBe(false);
  expect(stages.byId.get('M06_MANUAL_PURCHASE').requires).toEqual(['HUB_COMMITMENT']);
  const adapters=source('scripts/recette/canonical/real-buyer-cash-adapters.js');
  expect(adapters).toContain("M06_MANUAL_PURCHASE:'HUB_COMMITMENT'");
  expect(graphFor('M03').byId.has('HUB_VENDOR_READINESS')).toBe(true);
 });
 test('M06 Hub PO uses an allowed staging scenario and verifies PO membership independently',()=>{
  const po=source('tests/staging-clicks/g6-p3-kuyiyuk.spec.js');
  expect(po).toContain("else expect(['M01','M06']).toContain(env.G6_CANONICAL_SCENARIO)");
  expect(po).toContain('const prepare=await orderScoped.count()===1');
  expect(po).toContain("evidence.po_preparation_scope=prepare===orderScoped?'ORDER_ONLY':'SINGLE_GROUP'");
  expect(po).toContain("expect(members,'G6_HUB_PO_EXACTLY_ONE_PURCHASE_LINE').toHaveLength(1)");
  expect(po).toContain("expect(members[0].order_id,'G6_HUB_PO_CROSS_ORDER_LINE_BLOCKED').toBe(orderId)");
 });
 test('M06 commitment uses the actual central Hub candidate budget with fixed 30 EUR staging ceiling',()=>{
  const commitment=source('scripts/recette/g6-hub-commitment-chromium.js');
  const fixture=loadManifest('M06').fixture_plan;
  expect(fixture.product.product_ref).toBe('KPR-000255');
  expect(fixture.commitment).toEqual(expect.objectContaining({amount:30,currency:'EUR'}));
  expect(fixture.buyer_order.quantity).toBe(3);
  expect(commitment).toContain("['M01','M03','M06'].includes(env.G6_CANONICAL_SCENARIO)");
  expect(commitment).toContain('G6_M06_INDICATIVE_COMMITMENT_FIXTURE_MISMATCH');
  expect(commitment).toContain("G6_M06_INDICATIVE_BUDGET_FORM_MISSING");
  expect(source('scripts/recette/g6-m06-input-preflight.js')).toContain('commitmentAmount:plan.commitment.amount');
 });
});
