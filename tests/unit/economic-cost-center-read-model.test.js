'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockQuery=jest.fn(),mockRelease=jest.fn(),mockClient=jest.fn(),mockGrant=jest.fn(),mockAuthz=jest.fn();
jest.mock('../../db',()=>({getClient:(...a)=>mockClient(...a)}));
jest.mock('../../middleware/require-pricing-global-authority',()=>({hasPricingGlobalAuthority:(...a)=>mockGrant(...a)}));
jest.mock('../../services/market-delegation-service',()=>({resolveAuthorization:(...a)=>mockAuthz(...a)}));
const {readCostCenters,budgetSummary,recordedPostBalance,recordedBalanceSummary,commitmentRemainingEur,commitmentSummary,structureEvidenceSummary,structureEurProjector,shipmentActivity,shipmentPurchase,observedProfitability,periodSalesEvidence,projectGroupPeriodResult}=require('../../services/economic-cost-center-read-model');
const client={query:mockQuery,release:mockRelease},actor={id:'actor',role:'admin'},month='2026-01-01';
const ok=(rows=[])=>({rows});
beforeEach(()=>{jest.resetAllMocks();mockClient.mockResolvedValue(client);mockGrant.mockResolvedValue(true);});
function projection(postRows=[],commitmentRows=[],structureRows=[],market=false){
  mockQuery.mockResolvedValueOnce(ok([{id:'center'}])).mockResolvedValueOnce(ok([{id:'family'}])).mockResolvedValueOnce(ok([{id:'resource'}])).mockResolvedValueOnce(ok(postRows)).mockResolvedValueOnce(ok(commitmentRows)).mockResolvedValueOnce(ok(structureRows));
  mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
  mockQuery.mockResolvedValueOnce(ok([
    {parcel_id:'parcel-a',pickup_method:'PICKUP_CODE',units:4},
    {parcel_id:'parcel-a',pickup_method:'PICKUP_CODE',units:4},
    {parcel_id:'parcel-b',pickup_method:'UNSUPPORTED',units:99},
  ])).mockResolvedValueOnce(ok([{count:1,amount_kmf:'500.00'}])).mockResolvedValueOnce(ok([{covered_units:4,amount_kmf:'1000.00'}])).mockResolvedValueOnce(ok([{parcel_count:1,amount_kmf:'315.25'}]));
  if(!market)mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
  mockQuery.mockResolvedValueOnce(ok());
}
test('reject unauthenticated and implicit scope',async()=>{
  await expect(readCostCenters(null,{marketCode:null,periodStart:month})).rejects.toMatchObject({status:401});
  await expect(readCostCenters(actor,{periodStart:month})).rejects.toMatchObject({status:400});
  expect(mockClient).not.toHaveBeenCalled();
});
test('A1 admin without global ACT grant reads group without write controls',async()=>{
  mockGrant.mockResolvedValue(false);mockQuery.mockResolvedValueOnce(ok());projection();
  const model=await readCostCenters(actor,{marketCode:null,periodStart:month});
  expect(model).toMatchObject({scope:'GROUP',globalRead:true,central:false,readOnly:true,
    costCapabilities:{budget:false,commitment:false,consume:false,actual:false,reference:false}});
  expect(mockAuthz).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls.some(([sql])=>/^INSERT|^UPDATE|^DELETE/.test(sql))).toBe(false);
});
test('A1 admin without global ACT grant reads exact market but has no ungranted write capabilities',async()=>{
  mockGrant.mockResolvedValue(false);
  mockAuthz.mockRejectedValue(Object.assign(new Error('no delegation'),{status:403}));
  mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok([{id:'market-CM'}]));projection([],[],[],true);
  const model=await readCostCenters(actor,{marketCode:'CM',periodStart:month});
  expect(model).toMatchObject({scope:'MARKET',marketCode:'CM',globalRead:true,central:false,readOnly:true,
    costCapabilities:{budget:false,commitment:false,consume:false,actual:false,reference:false}});
  expect(mockQuery.mock.calls[1]).toEqual(['SELECT id FROM markets WHERE code=$1',['CM']]);
});
test('market delegation resolves exact market and no other scope is queried',async()=>{
  mockAuthz.mockImplementation(async(_client,{requiredCapability})=>{if(requiredCapability!=='pricing.read')throw Object.assign(new Error('read only'),{status:403});return {market_id:'market-CM'};});
  mockQuery.mockResolvedValueOnce(ok());projection([],[],[],true);
  const result=await readCostCenters({id:'member',role:'market_operator'},{marketCode:'CM',periodStart:month});
  expect(mockAuthz).toHaveBeenCalledWith(client,{userId:'member',marketCode:'CM',requiredCapability:'pricing.read'});
  expect(result).toMatchObject({scope:'MARKET',marketCode:'CM',central:false,readOnly:true});
  for(const call of mockQuery.mock.calls.slice(1,8))expect(call[1][0]).toBe('market-CM');
  expect(result.profitability.recognitionEvidence).toEqual({handoffParcelCount:1,attestedUnits:4,
    confirmedRefundCount:1,confirmedRefundKmf:'500.00',pricedHandoffUnits:4,documentedHandoffSalesKmf:'1000.00',parcelCostEvidenceCount:1,
    documentedParcelVariableCostKmf:'315.25',coverage:'DOCUMENTED_EVENTS_ONLY'});
  for (const call of mockQuery.mock.calls.filter(([sql]) => sql.includes('FROM scans s') || sql.includes('FROM refunds r JOIN'))) {
    expect(call[1]).toEqual(['market-CM','2026-01-01','2026-02-01']);
  }
  expect(mockQuery.mock.calls.find(([sql]) => sql.includes('JOIN order_item_real_cost_allocations a'))[1][0]).toEqual(['parcel-a']);
  expect(mockGrant).not.toHaveBeenCalled();
});
test('denied delegation never queries economic tables',async()=>{
  mockAuthz.mockRejectedValue(Object.assign(new Error('denied'),{status:403}));
  mockQuery.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
  await expect(readCostCenters({id:'member',role:'market_operator'},{marketCode:'CG',periodStart:month})).rejects.toMatchObject({status:403});
  expect(mockQuery.mock.calls.map(c=>c[0])).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','ROLLBACK']);
});
test('latest revision preserves explicit zero distinct from absent budget; no invented actuals',async()=>{
  mockQuery.mockResolvedValueOnce(ok());
  projection([{id:'p1',budget_revision:2,budget_currency:'EUR',budget_native:'0.0000',budget_eur:'0.00'},{id:'p2',budget_revision:null}], [{id:'k',post_id:'p1',remaining_native:'40.0000',requires_reconciliation:true}]);
  const x=await readCostCenters(actor,{marketCode:null,periodStart:month});
  expect(x.posts[0]).toMatchObject({budget:{revision:2,eur:'0.00'},actual:null,available:null,commitments:[{requires_reconciliation:true}]});
  expect(x.posts[1]).toMatchObject({budget:null,actual:null,available:null,commitments:[]});
  expect(x.actualCoverage).toBe('NOT_RECONCILED');
  expect(x.activity.scopeCoverage).toBe('ALL_MARKETS_NON_SIMULATED');
  expect(x.profitability.salesEvidence.scope).toBe('ALL_MARKETS_NON_SIMULATED');
  expect(x.profitability.structureCoverage).toMatchObject({evidenceCount:0,recognizedKmf:null});
  expect(mockQuery.mock.calls[4][0]).toContain('ORDER BY revision DESC LIMIT 1');
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

test('budget subtotal preserves exact cents and distinguishes coverage from zero',()=>{
  expect(budgetSummary([{budget:{eur:'99999999999999.99'}},{budget:{eur:'0.02'}}])).toEqual({recordedEur:'100000000000000.01',totalEur:'100000000000000.01',coveredPosts:2,totalPosts:2});
  expect(budgetSummary([{budget:{eur:'0.00'}},{budget:null}])).toEqual({recordedEur:'0.00',totalEur:null,coveredPosts:1,totalPosts:2});
  expect(budgetSummary([])).toEqual({recordedEur:null,totalEur:null,coveredPosts:0,totalPosts:0});
});

test('frozen EUR commitment valuation uses exact half-even rounding without revaluing FX',()=>{
  expect(commitmentRemainingEur({initial_native:'100.0000',initial_eur:'100.00',remaining_native:'70.0000'})).toBe('70.00');
  expect(commitmentRemainingEur({initial_native:'2',initial_eur:'0.01',remaining_native:'1'})).toBe('0.00');
  expect(commitmentRemainingEur({initial_native:'2',initial_eur:'0.03',remaining_native:'1'})).toBe('0.02');
  expect(commitmentRemainingEur({initial_native:'100',initial_eur:'25.00',remaining_native:'101'})).toBeNull();
  expect(commitmentRemainingEur({initial_native:'100',initial_eur:'25.00',remaining_native:'20',requires_reconciliation:true})).toBeNull();
});
test('commitment aggregation distinguishes unknown correction, empty scope, and known zero',()=>{
  expect(commitmentSummary([{commitments:[{remaining_eur:'70.00'},{remaining_eur:null}]}])).toMatchObject({recordedEur:'70.00',totalEur:null,coveredCommitments:1,totalCommitments:2});
  expect(commitmentSummary([{commitments:[]}])).toMatchObject({recordedEur:'0.00',totalEur:'0.00'});
  expect(commitmentSummary([])).toMatchObject({recordedEur:null,totalEur:null});
});

test('structure evidence sums signed canonical amounts and excludes unmapped and crossing facts',()=>{
  expect(structureEvidenceSummary([{post_id:'p',whole_period:true,amount_kmf:'100.10'},{post_id:'p',whole_period:true,amount_kmf:'-10.01'},{post_id:'p',whole_period:false,amount_kmf:'500.00'},{post_id:null,whole_period:true,amount_kmf:'999.00'}])).toEqual({amountKmf:'90.09',included:2,unmapped:1,crossPeriod:1,invalid:0,coverage:'STRUCTURE_EVIDENCE_ONLY'});
  expect(structureEvidenceSummary([]).amountKmf).toBeNull();
  expect(structureEvidenceSummary([{post_id:'p',whole_period:true,amount_kmf:'-1.01'}]).amountKmf).toBe('-1.01');
});

test('structure EUR is projected via governed KMF parity, cached within read transaction',async()=>{
  const query=jest.fn().mockResolvedValue({rows:[{rate:'491.96775',updated_at:'2026-01-01T00:00:00Z'}]});
  const project=structureEurProjector({query});
  const rows=[{post_id:'p',whole_period:true,amount_kmf:'1000.00'}];
  const result=await project(rows);
  expect(result).toMatchObject({amountKmf:'1000.00',amountEur:'2.03',fxStatus:'GOVERNED_FIXED_PARITY_PROJECTION'});
  expect(result.fxLegs[0]).toMatchObject({pair:'EUR/KMF',rate:'491.96775',source:'currency_parities'});
  await project(rows);expect(query).toHaveBeenCalledTimes(1);
  expect(await project([])).toMatchObject({amountEur:null,fxStatus:'NO_EVIDENCE'});
});
test('missing governed parity preserves KMF evidence and never fabricates EUR',async()=>{
  const project=structureEurProjector({query:jest.fn().mockResolvedValue({rows:[]})});
  expect(await project([{post_id:'p',whole_period:true,amount_kmf:'1000.00'}])).toMatchObject({amountKmf:'1000.00',amountEur:null,fxStatus:'FX_UNAVAILABLE'});
});

test('shipment cohort uses closed reconciled snapshot exactly once; unknown is not zero',()=>{
  const closed={reference:'S1',rail:'sea',physical_closed_at:'2026-01-15T10:00:00Z',financial_closed_at:'2026-02-10T10:00:00Z',
    financial_close_proof_ref:'proof',snapshot_hash:'a'.repeat(64),freight_known:true,allocation_rows:0,
    freight_kmf:'100.10',customs_kmf:'20.00',arrival_kmf:'5.00',local_kmf:'4.90',customs_fees_kmf:'1.00',documented_kmf:'131.00'};
  expect(shipmentActivity([closed])).toMatchObject({physicalClosedCount:1,financialClosedCount:1,
    documentedTransportTotalKmf:'131.00',freightCustomsSubtotalKmf:'120.10',coverage:'TRANSPORT_DOCUMENTED'});
  const pending={...closed,reference:'S2',financial_closed_at:null};
  expect(shipmentActivity([closed,pending])).toMatchObject({physicalClosedCount:2,financialClosedCount:1,
    documentedTransportSubtotalKmf:'131.00',documentedTransportTotalKmf:null,coverage:'PARTIAL'});
  expect(shipmentActivity([{...closed,documented_kmf:'999.00'}])).toMatchObject({financialClosedCount:0,documentedTransportTotalKmf:null});
  expect(shipmentActivity([{...closed,allocation_rows:1}])).toMatchObject({financialClosedCount:0});
  expect(shipmentActivity([])).toMatchObject({coverage:'NO_OBSERVATIONS',documentedTransportTotalKmf:null,purchaseKmf:null});
});

test('weighted transport cost uses same financially closed measured cohort, no averaging ratios',()=>{
  const a={reference:'A',rail:'sea',physical_closed_at:'2026-01-15T10:00:00Z',financial_closed_at:'2026-02-10T10:00:00Z',financial_close_proof_ref:'proof',snapshot_hash:'a'.repeat(64),freight_known:true,allocation_rows:0,freight_kmf:'100.10',customs_kmf:'20.00',arrival_kmf:'5.00',local_kmf:'4.90',customs_fees_kmf:'1.00',documented_kmf:'131.00',actual_weight_kg:'10',weight_proof_ref:'weigh',weight_basis:'MEASURED_GROSS_KG'};
  const b={...a,reference:'B',actual_weight_kg:'30.000',freight_kmf:'300.10',documented_kmf:'331.00'};
  const x=shipmentActivity([a,b]);expect(x).toMatchObject({weightKg:'40.000',weightedTransportKmf:'462.00',weightedWeightKg:'40.000',costPerKgKmf:'11.55',costPerKgCoverage:'COMPLETE'});
  expect(x.shipments[0].costPerKgKmf).toBe('13.10');
  const pending={...b,financial_closed_at:null};const y=shipmentActivity([a,pending]);expect(y).toMatchObject({weightKg:'40.000',weightedShipmentCount:1,costPerKgKmf:'13.10',costPerKgCoverage:'PARTIAL'});
  const unknown={...b,weight_proof_ref:null};expect(shipmentActivity([a,unknown])).toMatchObject({weightKg:null,measuredWeightSubtotalKg:'10.000',weightedShipmentCount:1,costPerKgCoverage:'PARTIAL'});
  expect(shipmentActivity([{...a,weight_basis:'CHARGEABLE'}])).toMatchObject({costPerKgKmf:null,weightKg:null,costPerKgCoverage:'NO_WEIGHTED_OBSERVATIONS'});
});

test('shipment purchase reuses reconciled real PO valuation, rejects split and simulation',()=>{
  const base={lines:[{id:'a',purchase_order_id:'po',confirmed_at:'2026-01-01',confirmed_quantity:1,confirmed_unit_price:'10.0000',supplier_currency:'USD',in_order:true,full_line:true,real_order:true},
    {id:'b',purchase_order_id:'po',confirmed_at:'2026-01-01',confirmed_quantity:1,confirmed_unit_price:'30.0000',supplier_currency:'USD',in_order:false,real_order:true}],
    payments:[{id:'p',purchase_order_id:'po',status:'succeeded',real_debit_verified:true,reconciliation_status:'matched',currency:'USD'}],
    settlements:[{supplier_execution_payment_id:'p',kind:'payment',amount_currency:'40.0000',currency:'USD',amount_kmf:'16000.00',fees_kmf:'100.00'}]};
  expect(shipmentPurchase(base)).toEqual({amount:'4000.00',status:'SETTLEMENT_RECONCILED'});
  expect(shipmentPurchase({...base,lines:[{...base.lines[0],full_line:false},base.lines[1]]}).amount).toBeNull();
  expect(shipmentPurchase({...base,lines:[base.lines[0],{...base.lines[1],real_order:false}]}).amount).toBeNull();
  expect(shipmentPurchase({...base,payments:[{...base.payments[0],real_debit_verified:false}]}).amount).toBeNull();
  expect(shipmentPurchase({...base,settlements:[]}).amount).toBeNull();
});
test('purchase + transport coefficient is explicitly non-decisional and weighted on matching observations',()=>{
  const closed={reference:'S1',rail:'sea',physical_closed_at:'2026-01-15T10:00:00Z',financial_closed_at:'2026-02-10T10:00:00Z',financial_close_proof_ref:'proof',snapshot_hash:'a'.repeat(64),freight_known:true,allocation_rows:0,freight_kmf:'100.10',customs_kmf:'20.00',arrival_kmf:'5.00',local_kmf:'4.90',customs_fees_kmf:'1.00',documented_kmf:'131.00',purchase:{amount:'1000.00',status:'SETTLEMENT_RECONCILED'}};
  const second={...closed,reference:'S2',actual_weight_kg:'25',weight_proof_ref:'scale',weight_basis:'MEASURED_GROSS_KG',purchase:{amount:'3000.00',status:'SETTLEMENT_RECONCILED'}};
  expect(shipmentActivity([closed,second]).purchaseTransportObservation).toMatchObject({purchaseKmf:'4000.00',transportKmf:'262.00',coefficient:'1.0655',minCoefficient:'1.0437',maxCoefficient:'1.1310',coefficientWeightKg:'25.000',coefficientWeightCount:1,observations:2,decisional:false});
  expect(shipmentActivity([closed,{...second,financial_closed_at:null}]).purchaseTransportObservation).toMatchObject({coefficient:'1.1310',minCoefficient:'1.1310',maxCoefficient:'1.1310',coefficientWeightKg:null,coefficientWeightCount:0,observations:1,coverage:'PARTIAL',decisional:false});
});

test('activity totals keep cohort and coverage, separate documented subtotal from complete economic cost',()=>{
  const a={reference:'A',rail:'sea',physical_closed_at:'2026-01-15T10:00:00Z',financial_closed_at:'2026-02-10T10:00:00Z',financial_close_proof_ref:'proof',snapshot_hash:'a'.repeat(64),freight_known:true,allocation_rows:0,freight_kmf:'100.10',customs_kmf:'20.00',arrival_kmf:'5.00',local_kmf:'4.90',customs_fees_kmf:'1.00',documented_kmf:'131.00',actual_weight_kg:'10',weight_proof_ref:'weigh',weight_basis:'MEASURED_GROSS_KG',volume_m3:'0.25000',box_count:1,expected_articles:3,received_articles:2,purchase:{amount:'1000.00',status:'SETTLEMENT_RECONCILED'}};
  const b={...a,reference:'B',actual_weight_kg:'30.000',freight_kmf:'300.10',documented_kmf:'331.00',volume_m3:'0.75',box_count:2,expected_articles:4,received_articles:4,purchase:{amount:'3000.00',status:'SETTLEMENT_RECONCILED'}};
  expect(shipmentActivity([a,b])).toMatchObject({boxCount:'3',expectedArticles:'7',receivedArticles:'6',volumeM3:'1.00000',volumeCoveredCount:2,minCostPerKgKmf:'11.03',maxCostPerKgKmf:'13.10',costPerKgKmf:'11.55',purchaseTransportObservation:{purchaseKmf:'4000.00',freightCustomsKmf:'440.20',otherTransportKmf:'21.80',documentedSubtotalKmf:'4462.00',fullEconomicCostKmf:null,observations:2,decisional:false}});
  expect(shipmentActivity([a,{...b,volume_m3:null,financial_closed_at:null}])).toMatchObject({volumeM3:null,volumeSubtotalM3:'0.25000',volumeCoveredCount:1,minCostPerKgKmf:'13.10',maxCostPerKgKmf:'13.10',purchaseTransportObservation:{documentedSubtotalKmf:'1131.00',fullEconomicCostKmf:null,observations:1,coverage:'PARTIAL'}});
  expect(shipmentActivity([a,{...b,reconciliation_stale:true}])).toMatchObject({
    physicalClosedCount:2,financialClosedCount:1,documentedTransportTotalKmf:null,
    purchaseTransportObservation:{observations:1,coefficient:'1.1310',coverage:'PARTIAL'},
    shipments:[{financialStatus:'DOCUMENTED_CLOSED'},{financialStatus:'PENDING_RECONCILIATION',documentedTransportKmf:null}],
  });
  expect(shipmentActivity([])).toMatchObject({boxCount:null,volumeM3:null,minCostPerKgKmf:null,purchaseTransportObservation:{documentedSubtotalKmf:null,fullEconomicCostKmf:null}});
});

test('monthly, YTD and rolling observations weight the same receipt cohorts; empty month remains unknown',()=>{
 const base={rail:'sea',financial_closed_at:'2026-04-10T10:00:00Z',financial_close_proof_ref:'proof',snapshot_hash:'a'.repeat(64),freight_known:true,allocation_rows:0,freight_kmf:'100.10',customs_kmf:'20.00',arrival_kmf:'5.00',local_kmf:'4.90',customs_fees_kmf:'1.00',documented_kmf:'131.00',purchase:{amount:'1000.00',status:'SETTLEMENT_RECONCILED'}};
 const a={...base,reference:'A',physical_closed_at:'2025-12-15T10:00:00Z'},b={...base,reference:'B',physical_closed_at:'2026-01-15T10:00:00Z',purchase:{amount:'3000.00',status:'SETTLEMENT_RECONCILED'}},c={...base,reference:'C',physical_closed_at:'2026-03-15T10:00:00Z'};
 const x=observedProfitability([a,b,c],'2026-03-01');
 expect(x.points.map(p=>p.monthly.coefficient)).toEqual(['1.0437',null,'1.1310']);
 expect(x.points[0].rolling3).toMatchObject({purchaseKmf:'4000.00',transportKmf:'262.00',coefficient:'1.0655',observations:2});
 expect(x.points[2].cumulative).toMatchObject({purchaseKmf:'4000.00',transportKmf:'262.00',coefficient:'1.0655',observations:2});
 expect(x.points[2].rolling3.coefficient).toBe('1.0655');
 expect(x.ranges.month.coefficient).toBe('1.1310');expect(x.ranges.quarter.coefficient).toBe('1.0655');
 expect(x).toMatchObject({decisional:false,netSalesKmf:null,economicResultKmf:null,fullCoefficient:null});
});

test('net commercial sales use paid cohort only, restore wallet, subtract completed refunds exactly',()=>{
 const row={status:'collected',payment_status:'paid',total_kmf:'1000.10',wallet_kmf:'100.20',refunds_kmf:'50.05',pending_refunds:0};
 expect(periodSalesEvidence([row])).toMatchObject({observedNetSalesKmf:'1050.25',checkoutSubtotalKmf:'1000.10',walletSubtotalKmf:'100.20',completedRefundSubtotalKmf:'50.05',coverage:'PAID_COHORT_RESTATED',decisional:false});
 const x=periodSalesEvidence([row,{...row,status:'confirmed',payment_status:'pending'},{...row,status:'refunded',payment_status:'refunded',refunds_kmf:'0.00'},{...row,pending_refunds:1}]);
 expect(x).toMatchObject({observedNetSalesKmf:'2100.50',paidOrderCount:3,coveredOrderCount:2,unpaidOrderCount:1,terminalExceptions:1,pendingRefundOrders:1,coverage:'PARTIAL'});
 expect(periodSalesEvidence([])).toMatchObject({observedNetSalesKmf:null,coverage:'NO_PAID_ORDERS'});
 expect(periodSalesEvidence([{...row,refunds_kmf:'9999.00'}])).toMatchObject({observedNetSalesKmf:null,invalidOrderCount:1});
});

test('recorded balance conserves budget, remaining commitments and actual evidence without certifying completeness',()=>{
  const post={acceptsStructureActual:true,budget:{eur:'100.00'},commitments:[{remaining_eur:'25.00'}],structureEvidence:{amountEur:'80.00',unmapped:0,crossPeriod:0,invalid:0}};
  expect(recordedPostBalance(post)).toEqual({recordedActualEur:'80.00',recordedAvailableEur:'-5.00',status:'RECORDED_OVER_BUDGET',decisional:false});
  expect(recordedPostBalance({...post,structureEvidence:{...post.structureEvidence,crossPeriod:1}}).recordedAvailableEur).toBeNull();
  expect(recordedPostBalance({...post,commitments:[{remaining_eur:null}]}).recordedAvailableEur).toBeNull();
  expect(recordedBalanceSummary([post,{budget:null}])).toMatchObject({recordedAvailableEur:null,partialAvailableEur:'-5.00',coveredPosts:1,totalPosts:2,decisional:false});
});


test('group result conserves cents and stays provisional after risk review',()=>{
  const recognition={documentedHandoffSalesKmf:'1000.00',pricedHandoffUnits:2,attestedUnits:2,
    documentedParcelVariableCostKmf:'315.25',parcelCostEvidenceCount:1,handoffParcelCount:1,
    confirmedRefundCount:1,confirmedRefundKmf:'100.02'};
  const structure={recognizedKmf:200.12};
  expect(projectGroupPeriodResult(recognition,structure,{amountKmf:null})).toEqual({
    status:'NOT_RECONCILED',reasons:['RISK_REVIEW_INCOMPLETE'],resultKmf:null,
  });
  expect(projectGroupPeriodResult(recognition,structure,{amountKmf:'50.01'})).toEqual({
    status:'PROVISIONAL',reasons:[],netSalesKmf:'899.98',variableCostKmf:'365.26',
    actualRiskKmf:'50.01',contributionKmf:'534.72',structureKmf:'200.12',resultKmf:'334.60',
  });
  expect(projectGroupPeriodResult({...recognition,parcelCostEvidenceCount:0},structure,{amountKmf:'0.00'}))
    .toMatchObject({status:'NOT_RECONCILED',reasons:['VARIABLE_COSTS_INCOMPLETE']});
});
