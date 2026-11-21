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
 N05:{product_candidate:true,sku_complete:false,soi_complete:false,
   certification_rule:'active_supplier_sku_missing',certification_verdict:'BLOCKED'},
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
 it('workflow propriétaire : N01 N02 N03 N05 N06 sur KM CM CG ; aucun run automatiquement revendiqué',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const root=path.resolve(__dirname,'../..');
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml'),'utf8');
  for(const id of IDS)for(const market of ['KM','CM','CG'])
   expect(workflow).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+market+"'");
  for(const id of ['N03-ROUTE','N05-SOI'])for(const market of ['KM','CM','CG'])
   expect(workflow).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+market+"'");
  expect(workflow).toContain("G6_G5A_NEGATIVE_BRANCH:");
  expect(workflow).toContain("node scripts/recette/g6-negative-g5a-storefront-chromium.js");
  expect(workflow).toContain("node scripts/recette/g6-negative-n06-price-changed-chromium.js");
  const n06=fs.readFileSync(path.join(root,'scripts/recette/g6-negative-n06-price-changed-chromium.js'),'utf8');
  expect(n06).toContain("changePriceFromMarketUI(actor,{from:actual,to:original,kind:'RESTORE'})");
  expect(n06).toContain("G6_N06_RESTORE_FAILED_REQUIRES_MANUAL_STAGING_REPAIR");
  expect(n06).toContain("G6_N06_PRODUCT_GAP_OLD_PRICE_CHECKOUT_NOT_REJECTED");
  expect(n06).not.toMatch(/route\.fulfill\s*\(/);
 });
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
 it('N03 route absente : uniquement si le référentiel de routage canonique n’a aucun relais routable',()=>{
  const condition={market_lifecycle:'ACTIVE',route_available:false,
   route_basis:'CANONICAL_IS_RELAIS_ROUTABLE',active_relays:2,routable_relays:0};
  expect(()=>checkPrecondition('N03',condition)).not.toThrow();
  expect(()=>checkPrecondition('N03',{...condition,routable_relays:1})).toThrow();
  expect(()=>checkPrecondition('N03',{...condition,route_basis:'GUESS'})).toThrow();
  const x=fresh('N03');x.precondition=condition;x.route_before={market_lifecycle:'ACTIVE',active_relays:2,
   routable_relays:0,route_available:false,resolution:'CANONICAL_IS_RELAIS_ROUTABLE'};
  x.route_after={...x.route_before};
  x.ui={attempted_open_product:true,purchase_control_absent_or_disabled:true,buy_unavailable:true,
   route_checkout_attempted:true,route_checkout_refused:true,public_routable_relais:0,confirm_enabled:false};
  expect(validateG5aEvidence('N03',x).oracle_verdict).toBe('PASS');
  expect(()=>validateG5aEvidence('N03',{...x,ui:{...x.ui,route_checkout_attempted:false}})).toThrow('NOT_PROVEN_ROUTE_CHECKOUT_GESTURE');
  const activeConfirm={...x,ui:{...x.ui,confirm_enabled:true}};
  expect(()=>validateG5aEvidence('N03',activeConfirm)).toThrow('NOT_PROVEN_ROUTE_CHECKOUT_GESTURE');
  const refusedByServer={...activeConfirm,
   http_attempts:[{method:'POST',path:'/api/orders',status:400,code:'relay_required'}]};
  expect(validateG5aEvidence('N03',refusedByServer).oracle_verdict).toBe('PASS');
  expect(()=>validateG5aEvidence('N03',{...x,route_after:{...x.route_after,routable_relays:1}})).toThrow('NOT_PROVEN_ROUTE_PG_READBACK');
 });
 it('N05 : certificat canonique BLOQUÉ requis, y compris avec SKU actif sans SOI',()=>{
  const soi={product_candidate:true,sku_complete:true,soi_complete:false,
   certification_verdict:'BLOCKED',certification_rule:'supplier_order_identity_incomplete',
   active_supplier_skus:2,complete_supplier_skus:1};
  expect(()=>checkPrecondition('N05',soi)).not.toThrow();
  expect(()=>checkPrecondition('N05',{...soi,complete_supplier_skus:2})).toThrow();
  expect(()=>checkPrecondition('N05',{...soi,certification_verdict:'PASS'})).toThrow();
  const sku=fresh('N05');
  expect(validateG5aEvidence('N05',{...sku,precondition:soi}).oracle_verdict).toBe('PASS');
 });
 it('N06 : ancien total refusé 409, nouveau total affiché et accepté par deuxième clic, une seule commande',()=>{
  const x=fresh('N06');
  x.restore={success:true};x.market_price_before=5990;x.market_price_after=5990;
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
  expect(()=>validateG5aEvidence('N06',{...x,restore:{success:false}})).toThrow('NOT_PROVEN_RESTORE_PRICE');
  expect(()=>validateG5aEvidence('N06',{...x,market_price_after:6490})).toThrow('NOT_PROVEN_RESTORE_PRICE');
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
