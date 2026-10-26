/**
 * @test-kind unit
 * @feature dashboard
 * Golden P1 read-only evidence. Mocked SQL: L2, not browser or staging certification.
 */
'use strict';
const { loadCheckoutThread,resolveProvenance,resolveEvidenceLevel,computeTraceId,buildOperatorScript,EVIDENCE_LEVEL } = require('../../services/golden-checkout-thread');
const { GATE } = require('../../services/golden-gate-kit');
const { deriveReadiness,STAGE } = require('../../services/golden-upstream-evidence');
const PID='11111111-1111-4111-8111-111111111111', REF='K-2026-0001', T0=new Date('2026-10-13T10:00:00Z');
function facts(over={}) {return {
  order:[{id:'o1',reference:REF,user_id:'u1',status:'pending',payment_status:'pending',payment_mode:'cash_relais',recipient_id:'r1',relais_id:'rl1',total_kmf:37500,stripe_payment_id:null,created_at:T0,market_code:'KM'}],
  first:[{status:'pending',note:'Commande créée',changed_by:'u1'}],
  items:[{id:'oi1',product_id:PID,sku_id:'s1',price_kmf:37500,quantity:1,customs_category_key:'maison',sku_product_id:PID}],
  user:[{id:'u1',phone:'+26933000001'}],otp:[{n:1}],cash:[{total:0,n:0}],trail:[{n:0}],parcels:[],...over
};}
const dbWith=f=>({query:jest.fn(async sql=>{
  if(/FROM orders o LEFT JOIN markets m/.test(sql))return {rows:f.order};
  if(/FROM order_status_history WHERE order_id=\$1 ORDER BY/.test(sql))return {rows:f.first};
  if(/FROM order_items oi LEFT JOIN product_skus ps/.test(sql))return {rows:f.items};
  if(/FROM users WHERE id/.test(sql))return {rows:f.user};
  if(/FROM otp_codes/.test(sql)){if(f.otpError)throw new Error('otp unreadable');return {rows:f.otp};}
  if(/FROM cash_collections/.test(sql))return {rows:f.cash};
  if(/status::text <> 'pending'/.test(sql))return {rows:f.trail};
  if(/FROM parcels p/.test(sql))return {rows:f.parcels};
  throw new Error('Unexpected query: '+sql.slice(0,70));
})});
const storefront={key:'STOREFRONT_PROVED',evidence:{price_kmf:37500},status:GATE.PROVED,checks:[]};
const upstream=[
  {key:'SOURCE_PROVED',status:GATE.PROVED,checks:[],evidence:{source_id:'src-cj',capture_id:'cap-1'}},
  {key:'CATALOG_RELEASE_PROVED',status:GATE.PROVED,checks:[],evidence:{skus:[{product_sku_id:'s1',supplier_unit_ref:'U-1'}]}},storefront
];
const run=(f,ref=REF)=>loadCheckoutThread(dbWith(f),{orderReference:ref,productId:PID,marketCode:'KM',upstreamGates:upstream});
const gate=(r,k)=>r.gates.find(g=>g.key===k);
describe('Golden P1 checkout origin',()=>{
  test('canonical checkout birth, OTP, SKU and price are proved',async()=>expect(gate(await run(facts()),'CHECKOUT_ORIGIN_PROVED').status).toBe(GATE.PROVED));
  test('synthetic Golden is never checkout evidence',async()=>{
    const db=dbWith(facts()),r=await loadCheckoutThread(db,{orderReference:'K-GOLDEN-1',productId:PID,marketCode:'KM',upstreamGates:upstream});
    expect(gate(r,'CHECKOUT_ORIGIN_PROVED').status).toBe(GATE.ANOMALIE);
    expect(gate(r,'PAYMENT_FINAL_PROVED').status).toBe(GATE.ANOMALIE);
    expect(db.query).not.toHaveBeenCalled();
  });
  test.each([
    ['no OTP',{otp:[{n:0}]}],['OTP unreadable',{otpError:true}],
    ['no checkout birth',{first:[]}],['wrong birth',{first:[{status:'ordered',note:'Commande créée',changed_by:'u1'}]}],
    ['no relay',{order:[{...facts().order[0],relais_id:null}]}],
    ['unfrozen customs',{items:[{...facts().items[0],customs_category_key:null}]}],
    ['changed price',{items:[{...facts().items[0],price_kmf:30000}]}],
  ])('%s must not pass',async(_,over)=>expect(gate(await run(facts(over)),'CHECKOUT_ORIGIN_PROVED').status).toBe(GATE.NON_PROUVE));
  test('wrong SKU is ANOMALIE',async()=>expect(gate(await run(facts({items:[{...facts().items[0],sku_product_id:'other'}]})),'CHECKOUT_ORIGIN_PROVED').status).toBe(GATE.ANOMALIE));
});
describe('Golden P1 payment',()=>{
  test('cash not yet paid is non proved',async()=>expect(gate(await run(facts()),'PAYMENT_FINAL_PROVED').status).toBe(GATE.NON_PROUVE));
  test('paid with matched cash amount is proved',async()=>{
    const f=facts({order:[{...facts().order[0],payment_status:'paid'}],cash:[{total:37500,n:1}]});
    expect(gate(await run(f),'PAYMENT_FINAL_PROVED').status).toBe(GATE.PROVED);
  });
  test('paid without cash collection is not proved',async()=>{
    const f=facts({order:[{...facts().order[0],payment_status:'paid'}]});
    expect(gate(await run(f),'PAYMENT_FINAL_PROVED').status).toBe(GATE.NON_PROUVE);
  });
  test('cash overcollection is anomalous',async()=>{
    const f=facts({order:[{...facts().order[0],payment_status:'paid'}],cash:[{total:75000,n:2}]});
    expect(gate(await run(f),'PAYMENT_FINAL_PROVED').status).toBe(GATE.ANOMALIE);
  });
  test('a status transition without paid is anomalous',async()=>{
    const f=facts({trail:[{n:1}]});
    expect(gate(await run(f),'PAYMENT_FINAL_PROVED').status).toBe(GATE.ANOMALIE);
  });
});
describe('Golden thread and verdict',()=>{
  test('trace is stable and uses market, source, SKU and order',async()=>{
    const a=(await run(facts())).thread;
    expect(a).toMatchObject({market:'KM',source_id:'src-cj',capture_id:'cap-1',product_id:PID,sku_ids:['s1'],soi_unit_refs:['U-1'],order_reference:REF});
    expect(a.trace_id).toMatch(/^GT-[0-9a-f]{16}$/);
    expect((await run(facts())).thread.trace_id).toBe(a.trace_id);
    expect(computeTraceId({productId:PID})).toBeNull();
    expect(computeTraceId({market:'CM',sourceId:'src-cj',captureId:'cap-1',productId:PID,skuIds:['s1'],soiRefs:['U-1'],orderReference:REF})).not.toBe(a.trace_id);
  });
  test('staging is separately labeled, no environment alone proves a real browser',()=>{
    expect(resolveEvidenceLevel({})).toBe(EVIDENCE_LEVEL.L4_ISOLATED);
    expect(resolveEvidenceLevel({KOMERCE_ENV:'staging'})).toBe(EVIDENCE_LEVEL.L5_STAGING);
  });
  test('provenance stays fail closed',async()=>{
    expect(resolveProvenance({orderReference:''})).toBe('NO_ORDER');
    expect(resolveProvenance({orderReference:'K-GOLDEN-1'})).toBe('SYNTHETIC_GOLDEN_CREATE');
    expect(resolveProvenance({orderReference:REF,gates:[]})).toBe('ORDER_ORIGIN_NOT_PROVED');
    expect(resolveProvenance({orderReference:REF,gates:(await run(facts())).gates})).toBe('CHECKOUT_EVENTS_PROVED');
  });
  test('operator steps lock after missing OTP',async()=>{
    const r=await run(facts({otp:[{n:0}]})),st=buildOperatorScript({gates:[storefront,...r.gates]});
    expect(st.map(s=>s.key)).toEqual(['BOUTIQUE','OTP','CHECKOUT','PAIEMENT','COCKPIT']);
    expect(st[1].status).toBe(GATE.NON_PROUVE);
    expect(st[2].locked).toBe(true);
  });
  test('seven gates required and anomaly blocks readiness',()=>{
    const gs=x=>x.map(status=>({status}));
    expect(deriveReadiness({productId:PID,orderReference:REF,gates:gs(Array(7).fill(GATE.PROVED))})).toBe(STAGE.PRET);
    expect(deriveReadiness({productId:PID,orderReference:REF,gates:gs([...Array(6).fill(GATE.PROVED),GATE.ANOMALIE])})).toBe(STAGE.ANOMALIE);
  });
});

describe('Golden cross-market checkout continuity',()=>{
  test('market selected KM but actual order CM is ANOMALIE, never PROVED',async()=>{
    const actual=facts({order:[{...facts().order[0],market_code:'CM'}]});
    const result=await run(actual);
    const origin=gate(result,'CHECKOUT_ORIGIN_PROVED');
    expect(origin.status).toBe(GATE.ANOMALIE);
    expect(origin.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({key:'order_matches_selected_market',ok:false}),
    ]));
    expect(origin.anomalies).toEqual(expect.arrayContaining([expect.stringContaining('ORDER_MARKET_MISMATCH')]));
    expect(resolveProvenance({orderReference:REF,gates:result.gates})).toBe('ORDER_ORIGIN_NOT_PROVED');
  });
  test('market selected KM and actual order KM remains PROVED',async()=>{
    const result=await run(facts());
    expect(gate(result,'CHECKOUT_ORIGIN_PROVED')).toMatchObject({status:GATE.PROVED});
    expect(gate(result,'CHECKOUT_ORIGIN_PROVED').checks).toEqual(expect.arrayContaining([
      expect.objectContaining({key:'order_matches_selected_market',ok:true}),
    ]));
  });
});
