'use strict';
/**
 * Catalogue -> Sourcing category gate -> pricing authority.
 * No DB or supplier network: injected pricing oracle gives explicit economic
 * costs, and the production supplier scanner must propagate all input evidence
 * and recompute the correct decision. No market price is ever assigned.
 */
jest.mock('../../services/pricing-engine', () => ({
  loadGlobalConfig: jest.fn(),
  recommend: jest.fn(),
}));
const pricing=require('../../services/pricing-engine');
const scanner=require('../../services/supplier-catalog-scanner');

const config={
  categories: {
    electronics:{key:'electronics',default_margin_pct:35},
    home:{key:'home',default_margin_pct:45},
  },
  finance:{},
};
const missing={
  supplier_name:'CJdropshipping',
  supplier_product_id:'CJ-ECON',
  product_name:'Importé à qualifier',
  supplier_category:'Electronic components',
  purchase_price_kmf:2000,
  estimated_weight_kg:0.8,
  estimated_volume_m3:0.003,
  data_sources:{category:'default'},
};
beforeEach(()=>{
  jest.clearAllMocks();
  pricing.loadGlobalConfig.mockResolvedValue(config);
});
test('catégorie absente : pas de CDR, pas de prix test fabriqué, aucune approbation',async()=>{
 const out=await scanner.scanCandidate(missing,{config});
 expect(out.sourcing_decision).toBe('WATCH');
 expect(out.scan_result).toMatchObject({
   customs_review:{status:'REQUIRED',calculation_allowed:false,publication_allowed:false},
   economic_test_health_status:'unknown',
 });
 expect(pricing.recommend).not.toHaveBeenCalled();
});
test.each([
 {label:'coût contributif',variable:3000,testPrice:6000,decision:'TEST',health:'strong'},
 {label:'coût fragile',variable:4800,testPrice:6000,decision:'WATCH',health:'fragile'},
 {label:'coût destructeur',variable:6500,testPrice:6000,decision:'LOSS',health:'loss'},
])('après correction économique ($label), recalcul coût puis verdict $decision',async item=>{
 pricing.recommend.mockResolvedValue({
   health_status:'unknown',
   test_price_kmf:item.testPrice,
   variable_cost_complete_kmf:item.variable,
   landed_relay_cost_kmf:item.variable-450,
   purchase_cost_kmf:2000,
   minimum_safe_price_kmf:item.variable+250,
   final_price_kmf:null,
   cost_breakdown:{landed_relay:{product_cost:2000,freight:650,customs:250},
                   business:{payment:200,risk_provision:250}},
 });
 const input={...missing,komerce_category:'electronics',data_sources:{category:'manual'}};
 const output=await scanner.scanCandidate(input,{config});
 expect(pricing.recommend).toHaveBeenCalledTimes(1);
 expect(pricing.recommend).toHaveBeenCalledWith(expect.objectContaining({
   product_id:null,category:'electronics',cost_kmf:2000,weight_kg:0.8,
   volume_m3:0.003,current_price_kmf:0,
 }),{config});
 expect(output.sourcing_decision).toBe(item.decision);
 expect(output.scan_result).toMatchObject({
   variable_cost_complete_kmf:item.variable,
   test_price_kmf:item.testPrice,
   minimum_safe_price_kmf:item.variable+250,
   final_price_kmf:null,
   economic_test_health_status:item.health,
 });
 expect(output.scan_result.economic_test_margin_pct).toBeCloseTo(
   ((item.testPrice-item.variable)/item.testPrice)*100,1);
 expect(output).not.toHaveProperty('market_code');
 expect(output).not.toHaveProperty('market_exposure');
});
test('une catégorie nouvelle change explicitement l’entrée économique et doit entraîner nouveau calcul',async()=>{
 pricing.recommend.mockImplementation(async input=>({
   health_status:'unknown',test_price_kmf:5000,
   variable_cost_complete_kmf:input.category==='electronics'?2500:5200,
   final_price_kmf:null,
 }));
 const source={...missing,data_sources:{category:'manual'}};
 const a=await scanner.scanCandidate({...source,komerce_category:'electronics'},{config});
 const b=await scanner.scanCandidate({...source,komerce_category:'home'},{config});
 expect(pricing.recommend.mock.calls.map(call=>call[0].category)).toEqual(['electronics','home']);
 expect(a.sourcing_decision).toBe('TEST');
 expect(b.sourcing_decision).toBe('LOSS');
 expect(a.scan_result.variable_cost_complete_kmf).not.toBe(b.scan_result.variable_cost_complete_kmf);
});
