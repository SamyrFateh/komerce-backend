/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {
 IDS,checkPrecondition,validateG5aEvidence,snapshotBuyerEffects
}=require('../../scripts/recette/canonical/g5a-checkout-negative-oracles');
const no=()=>({orders:0,order_items:0,cash_collections:0,allocations:0,purchase_lines:0});
const pre={
 N01:{price_status:'DRAFT'},
 N02:{exposure_recorded:true,commercial_exposure:'DISABLED'},
 N03:{market_lifecycle:'SUSPENDED',route_available:true},
 N05:{product_candidate:true,sku_complete:false,soi_complete:false},
 N06:{quote_before:5990,quote_after:6490}
};
const fresh=id=>({
 scenario_id:id,market:'KM',actor_role:'client',gesture_source:'CHROMIUM',
 trace_path:'test-results/g6-negative/trace.zip',screenshot_path:'test-results/g6-negative/screen.png',
 staging_only:true,external_psp_calls:0,precondition:pre[id],before:no(),after:no(),
 before_stock_available:10,after_stock_available:10,
 http_attempts:[{method:'POST',path:'/api/orders',status:409,code:'not_available'}],
 ui:{attempted_open_product:true,purchase_control_absent_or_disabled:true,buy_unavailable:true}
});
describe('G6 G5A — scénarios manquants N01/N02/N03/N05/N06 (contrats avant Chromium)',()=>{
 it('registre exact des cinq cas et aucune confusion avec N04 déjà monté',()=>{
  expect(IDS).toEqual(['N01','N02','N03','N05','N06']);
  expect(IDS).not.toContain('N04');
 });
 for(const [id,description] of [
  ['N01','prix non actif'],['N02','exposition OFF'],
  ['N03','marché suspendu ou route absente'],['N05','SKU/SOI incomplet']
 ]){
  it(id+' '+description+' : refus UI/HTTP + aucune commande, paiement, ligne ou réservation',()=>{
   expect(validateG5aEvidence(id,fresh(id))).toMatchObject({
    oracle_verdict:'PASS',no_order:true,no_payment:true,no_reservation:true
   });
  });
  it(id+' : bloque un effet métier même si HTTP dit refus',()=>{
   for(const key of ['orders','order_items','cash_collections','allocations','purchase_lines']){
    const x=fresh(id);x.after[key]=1;
    expect(()=>validateG5aEvidence(id,x)).toThrow('PRODUCT_GAP_UNEXPECTED_EFFECT_'+key);
   }
   const changed=fresh(id);changed.after_stock_available=9;
   expect(()=>validateG5aEvidence(id,changed)).toThrow('PRODUCT_GAP_STOCK_CHANGED');
  });
  it(id+' : interdit faux PASS sans Chromium, sans précondition, ou sur rejet d’authentification',()=>{
   const a=fresh(id);a.gesture_source='API_PROBE_NO_SCREEN_GESTURE';
   expect(()=>validateG5aEvidence(id,a)).toThrow('NOT_PROVEN_CHROMIUM_EVIDENCE');
   const b=fresh(id);b.precondition={};
   expect(()=>validateG5aEvidence(id,b)).toThrow('PREREQ_MISSING_NEGATIVE_CONDITION');
   const c=fresh(id);c.http_attempts=[{method:'POST',path:'/api/orders',status:401,code:'AUTH_REQUIRED'}];
   expect(()=>validateG5aEvidence(id,c)).toThrow('PRODUCT_GAP_UNEXPECTED_CHECKOUT_RESPONSE');
   const d=fresh(id);d.http_attempts=[];d.ui={buy_unavailable:true};
   expect(()=>validateG5aEvidence(id,d)).toThrow('NOT_PROVEN_UI_BLOCK');
  });
 }
 it('N03 valide aussi la branche marché actif avec route absente, pas un marché actif livrable',()=>{
  expect(()=>checkPrecondition('N03',{market_lifecycle:'ACTIVE',route_available:false})).not.toThrow();
  expect(()=>checkPrecondition('N03',{market_lifecycle:'ACTIVE',route_available:true})).toThrow();
 });
 it('N05 : le SOI manquant suffit même si le SKU est techniquement complet',()=>{
  expect(()=>checkPrecondition('N05',{product_candidate:true,sku_complete:true,soi_complete:false})).not.toThrow();
 });
 it('N06 : ancien total refusé 409, nouveau total affiché et accepté par deuxième clic, une seule commande',()=>{
  const x=fresh('N06');
  x.http_attempts=[
   {method:'POST',path:'/api/orders',status:409,code:'price_changed'},
   {method:'POST',path:'/api/orders',status:201,order_id:'order-1'}
  ];
  x.ui={old_total_shown:5990,new_total_shown:6490,explicit_second_click:true};
  x.after={orders:1,order_items:1,cash_collections:0,allocations:1,purchase_lines:0,
   order_display_total:6490,order_id:'order-1'};
  expect(validateG5aEvidence('N06',x)).toMatchObject({oracle_verdict:'PASS',explicit_reconfirmation:true});
  const oldPrice={...x,after:{...x.after,order_display_total:5990}};
  expect(()=>validateG5aEvidence('N06',oldPrice)).toThrow('PRODUCT_GAP_WRONG_PRICE_SNAPSHOT');
  const silent={...x,ui:{...x.ui,explicit_second_click:false}};
  expect(()=>validateG5aEvidence('N06',silent)).toThrow('PRODUCT_GAP_SILENT_REPRICING');
  const duplicate={...x,after:{...x.after,orders:2}};
  expect(()=>validateG5aEvidence('N06',duplicate)).toThrow('PRODUCT_GAP_DUPLICATE_OR_PREMATURE_EFFECT');
  const acceptedOld={...x,http_attempts:[{...x.http_attempts[0],status:201},x.http_attempts[1]]};
  expect(()=>validateG5aEvidence('N06',acceptedOld)).toThrow('PRODUCT_GAP_STALE_PRICE_NOT_REJECTED');
  const wrongStatus={...x,http_attempts:[x.http_attempts[0]]};
  expect(()=>validateG5aEvidence('N06',wrongStatus)).toThrow('NOT_PROVEN_TWO_EXPLICIT_POSTS');
 });
 it('les oracles relisent seulement les compteurs PG, tous bornés au buyer du run',async()=>{
  const query=jest.fn(async (sql,args)=>{
   expect(sql).toMatch(/FROM orders o WHERE o.user_id=\$1/);
   expect(sql).toMatch(/FROM cash_collections c JOIN orders o ON o.id=c.order_id WHERE o.user_id=\$1/);
   expect(sql).toMatch(/FROM local_stock_allocations a JOIN orders o ON o.id=a.order_id WHERE o.user_id=\$1/);
   expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
   expect(args).toEqual(['buyer-only']);
   return {rows:[no()]};
  });
  await expect(snapshotBuyerEffects({query},'buyer-only')).resolves.toEqual(no());
  expect(query).toHaveBeenCalledTimes(1);
 });
});
