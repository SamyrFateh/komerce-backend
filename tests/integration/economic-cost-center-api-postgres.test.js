'use strict';
/** @test-kind integration @test-runner jest @test-requires postgres
 * ECO disposable database proof. Committed immutable fixtures are necessary for
 * real HTTP requests on separate connections. Run ONLY on dedicated CI postgres
 * container with explicit opt-in; no trigger disable, reset, or shared database.
 */
const request=require('supertest');
const {createMarketDelegationFixture,makeApp}=require('../helpers/marketDelegationE2EKit');
const {reviseBudget}=require('../../services/economic-cost-budget-service');
const crypto=require('crypto');
const {recordStructureCostEvent}=require('../../services/pricing-period-structure');
const url=process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const enabled=process.env.ECO_DISPOSABLE_PG_PROOF==='1';
const run=enabled?describe:describe.skip;
jest.setTimeout(60000);
run('ECO-1f canonical read API on disposable PostgreSQL',()=>{
  const db=require('../../db');
  const tag='ECOAPI'+crypto.randomBytes(5).toString('hex').toUpperCase();
  let fx,app,a,b,g,activityRefs;
  const month='2026-01-01', mount='/api/admin/workspaces/pricing';
  const q=(sql,params)=>db.query(sql,params);
  async function seed(marketId,suffix){
    const center=(await q('INSERT INTO economic_cost_centers(market_id,code,label) VALUES ($1,$2,$2) RETURNING id',[marketId,tag+suffix])).rows[0].id;
    const family=(await q("INSERT INTO economic_cost_families(center_id,code,label) VALUES ($1,'PERSONNEL','Personnel') RETURNING id",[center])).rows[0].id;
    const resource=(await q("INSERT INTO economic_cost_resources(center_id,code,label,resource_kind) VALUES ($1,'EQUIPE','Equipe','PERSONNEL') RETURNING id",[center])).rows[0].id;
    const post=(await q("INSERT INTO economic_cost_posts(center_id,family_id,resource_id,code,label,economic_nature,allocation_perimeter,allocation_basis) VALUES ($1,$2,$3,'SALAIRES','Salaires','FIXED','DIRECT','PERIOD') RETURNING id",[center,family,resource])).rows[0].id;
    return {center,post};
  }
  // Historical projection fixtures in disposable CI only. Populate the
  // physical chain with normal DB guards enabled; snapshots and dated events
  // are test facts, NOT certification of the logistics writer or Chromium.
  async function seedActivity(market,suffix,{financial=true,simulated=false,attested=true}={}){
    const ref=tag+'-'+suffix, id=()=>crypto.randomUUID();
    const [relay,product,sku,order,item,supplier,po,allocation,unit,box,shipment]=Array.from({length:11},id);
    const identity=JSON.stringify({provider:'manual',version:1,payload:{supplier_sku:ref}});
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'CI','+2693000001','CI',$3)",[relay,ref,market.id]);
    await q("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,$2,10000,0)",[product,ref]);
    await q("INSERT INTO suppliers(id,name,platform) VALUES($1,$2,'cj')",[supplier,ref]);
    await q(`INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
      VALUES($1,$2,$3,0,true,'SUPPLIER',$3,$3,$4::jsonb)`,[sku,product,ref,identity]);
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,simulation_scope)
      VALUES($1,$2,$3,$4,$5,'confirmed','paid','cash_relais',10000,20,$6)`,[order,fx.viewerA.id,relay,market.id,ref,simulated?'G6-BUYER':null]);
    await q("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) VALUES($1,$2,$3,1,10000,$4,'IMPORT')",[item,order,product,sku]);
    await q(`INSERT INTO purchase_orders(id,order_id,order_item_id,product_sku_id,supplier_id,supplier_sku,supplier_unit_ref,supplier_order_identity,qty,status)
      VALUES($1,$2,$3,$4,$5,$6,$6,$7::jsonb,1,'confirmed')`,[po,order,item,sku,supplier,ref,identity]);
    await q(`INSERT INTO hub_purchase_allocations(id,purchase_order_id,order_id,order_item_id,product_sku_id,supplier_id,supplier_unit_ref,supplier_order_identity,quantity,market_id,destination_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,$9,$10)`,[allocation,po,order,item,sku,supplier,ref,identity,market.id,'relais:'+relay]);
    await q("INSERT INTO hub_physical_units(id,reference,unit_type,state,external_ref,current_location_ref) VALUES($1,$2,'SUPPLIER_PACKAGE','RECEIVED',$2,'DXB-HUB')",[unit,ref+'-UNIT']);
    await q("INSERT INTO hub_physical_units(id,reference,unit_type,state,current_location_ref) VALUES($1,$2,'MARKET_PARCEL','RECEIVED','DXB-HUB')",[box,ref+'-BOX']);
    await q("INSERT INTO hub_physical_unit_placements(physical_unit_id,allocation_id,quantity,operation_type) VALUES($1,$2,1,'RECEIVE')",[unit,allocation]);
    await q("UPDATE hub_physical_unit_placements SET removed_at=GREATEST(clock_timestamp(),placed_at+interval '1 microsecond') WHERE physical_unit_id=$1 AND allocation_id=$2 AND removed_at IS NULL",[unit,allocation]);
    await q("INSERT INTO hub_physical_unit_placements(physical_unit_id,allocation_id,quantity,operation_type) VALUES($1,$2,1,'REPACK')",[box,allocation]);
    for(const state of ['IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED','PACKED'])
      await q('UPDATE hub_physical_units SET state=$1 WHERE id=$2',[state,box]);
    await q("INSERT INTO international_shipments(id,market_id,reference,created_by,hub_draft,volume_m3) VALUES($1,$2,$3,$4,true,0.25000)",[shipment,market.id,ref,fx.central.id]);
    await q("INSERT INTO international_shipment_hub_units(shipment_id,physical_unit_id) VALUES($1,$2)",[shipment,box]);
    await q("UPDATE hub_physical_units SET state='DISPATCHED' WHERE id=$1",[box]);
    await q("UPDATE international_shipments SET stage='handed_over',forwarder_name='CI carrier',transport_mode='sea' WHERE id=$1",[shipment]);
    await q("UPDATE international_shipments SET stage='local_delivery' WHERE id=$1",[shipment]);
    if(attested)await q(`INSERT INTO international_shipment_relay_receipts(shipment_id,order_item_id,relais_id,expected_qty,received_qty,proof_ref,received_at)
      VALUES($1,$2,$3,1,1,'CI receipt','2026-01-15T10:00:00Z')`,[shipment,item,relay]);
    await q("UPDATE international_shipments SET stage='relay_received' WHERE id=$1",[shipment]);
    await q(`INSERT INTO international_shipment_events(shipment_id,event_type,from_stage,to_stage,proof_ref,actor_id,occurred_at,payload)
      VALUES($1,'stage_changed','local_delivery','relay_received','CI attestation',$2,'2026-01-15T10:01:00Z','{"attested_by":"relay"}')`,[shipment,fx.central.id]);
    if(financial){
      await q("UPDATE international_shipments SET freight_invoice_kmf=100.10,freight_invoice_ref=$2 WHERE id=$1",[shipment,ref+'-FREIGHT']);
      await q(`INSERT INTO international_shipment_events(shipment_id,event_type,from_stage,to_stage,proof_ref,actor_id,occurred_at,payload)
        VALUES($1,'freight_recorded','forwarder_received','forwarder_received',$2,$3,'2026-01-10T10:00:00Z',$4::jsonb)`,[shipment,ref+'-FREIGHT',fx.central.id,JSON.stringify({amount_kmf:'100.10',actual_weight_kg:'10.000',weight_proof_ref:ref+'-WEIGH',weight_basis:'MEASURED_GROSS_KG'})]);
    }
    if(financial)await q(`INSERT INTO international_n1_reconciliations(shipment_id,snapshot_hash,total_freight_kmf,total_arrival_kmf,total_local_kmf,allocation_rows,actor_id,freight_known,total_customs_kmf,total_customs_fees_kmf,documented_total_kmf,financial_closed_at,financial_closed_by,financial_close_proof_ref)
      VALUES($1,$2,100.10,5.00,4.90,0,$3,true,20.00,1.00,131.00,'2026-02-10T10:00:00Z',$3,'CI financial proof')`,[shipment,crypto.createHash('sha256').update(ref).digest('hex'),fx.central.id]);
    return ref;
  }
  const endpoint=code=>mount+(code?'/market/'+code:'')+'/cost-centers';
  const get=(actor,code,period=month)=>request(app).get(endpoint(code)).query({periodStart:period}).set('Authorization',actor.token);
  beforeAll(async()=>{
    if(process.env.GITHUB_ACTIONS!=='true'||!url||url.hostname!=='localhost'||url.pathname!=='/komerce_test'||process.env.NODE_ENV!=='test')
      throw new Error('Refusing committed ECO fixtures outside disposable CI postgres');
    const pin=(await q('SELECT current_database() AS name')).rows[0].name;
    if(pin!=='komerce_test')throw new Error('Unexpected database');
    fx=await createMarketDelegationFixture(db);
    await q("INSERT INTO pricing_global_access_grants(user_id,reason) VALUES ($1,'ECO isolated CI') ON CONFLICT DO NOTHING",[fx.central.id]);
    app=makeApp([{mount,modulePath:'../../routes/admin-pricing-workspace'}]);
    a=await seed(fx.marketA.id,'A'); b=await seed(fx.marketB.id,'B'); g=await seed(null,'G');
    const input={postId:a.post,marketCode:fx.marketA.code,periodStart:month,expectedRevision:0,currency:'XAF',amountNative:'655957',reason:'Budget test',requestKey:tag+'B1'};
    await reviseBudget(fx.central,input);
    const latest=await reviseBudget(fx.central,{...input,amountNative:'327979',expectedRevision:1,requestKey:tag+'B2'});
    expect(latest.revision.revision).toBe(2);
    await expect(reviseBudget(fx.central,{...input,amountNative:'327979',expectedRevision:1,requestKey:tag+'B2'})).resolves.toMatchObject({outcome:'replayed'});
    const k=(await q("INSERT INTO economic_cost_commitments(post_id,period_start,currency,amount_native,amount_eur,fx_legs,fx_as_of,evidence_ref,request_key,recorded_by) VALUES ($1,$2,'EUR',100,100,'[]',now(),'CI contract',$3,$4) RETURNING id",[a.post,month,tag+'K1',fx.central.id])).rows[0].id;
    await q("INSERT INTO economic_cost_commitment_movements(commitment_id,kind,amount_native,evidence_ref,request_key,recorded_by) VALUES ($1,'RELEASE',30,'CI release',$2,$3)",[k,tag+'M1',fx.central.id]);
    const charge=(await q("INSERT INTO charges(family,name,amount_kmf,is_recurring,recurrence_period,market_owner_id) VALUES ('operationnelle',$1,0,true,'monthly',$2) RETURNING id",[tag,fx.marketA.id])).rows[0].id;
    await q('UPDATE economic_cost_posts SET structure_charge_id=$1 WHERE id=$2',[charge,a.post]);
    const event={charge_id:charge,scope_kind:'MARKET_DIRECT',market_id:fx.marketA.id,event_kind:'ACCRUAL',economic_from:'2026-01-01T00:00:00Z',economic_to:'2026-02-01T00:00:00Z',amount_original:1000,currency:'KMF',fx_rate_to_kmf:1,fx_source:'CI fixture',amount_kmf:1000,source_kind:'MANUAL',evidence_ref:'CI canonical structure'};
    await recordStructureCostEvent(event,fx.central.id);
    await recordStructureCostEvent({...event,economic_to:'2026-03-01T00:00:00Z',amount_original:2000,amount_kmf:2000},fx.central.id);
    activityRefs={closed:await seedActivity(fx.marketA,'CLOSED'),pending:await seedActivity(fx.marketA,'PENDING',{financial:false}),simulated:await seedActivity(fx.marketA,'SIM',{simulated:true}),foreign:await seedActivity(fx.marketB,'FOREIGN')};

  });
  test('central sees exact market, latest budget and remaining commitment; no fake actual',async()=>{
    const response=await get(fx.central,fx.marketA.code);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.centers.map(c=>c.id)).toContain(a.center);
    expect(response.body.centers.map(c=>c.id)).not.toContain(b.center);
    expect(response.body.centers.map(c=>c.id)).not.toContain(g.center);
    const p=response.body.posts.find(p=>p.id===a.post);
    expect(p.budget).toMatchObject({revision:2,currency:'XAF',native:'327979.0000'});
    const actual=(await q('SELECT amount_eur::text AS eur FROM economic_cost_budget_revisions WHERE post_id=$1 AND revision=2',[a.post])).rows[0].eur;
    expect(p.budget.eur).toBe(actual);
    expect(p.commitments[0].remaining_native).toBe('70.0000');
    expect(p.commitments[0].remaining_eur).toBe('70.00');
    expect(response.body.commitmentSummary).toMatchObject({totalEur:'70.00',valuation:'FROZEN_OPENING_EUR'});
    expect(response.body.centers.find(c=>c.id===a.center).commitmentSummary.totalEur).toBe('70.00');
    expect(response.body.budgetSummary.totalEur).toBe(actual);
    expect(p.structureEvidence).toMatchObject({amountKmf:'1000.00',included:1,crossPeriod:1});
    expect(response.body.structureEvidence).toMatchObject({amountKmf:'1000.00',amountEur:'2.03',fxStatus:'GOVERNED_FIXED_PARITY_PROJECTION',included:1,crossPeriod:1});
    expect(response.body.structureEvidence.fxLegs[0]).toMatchObject({pair:'EUR/KMF',source:'currency_parities'});
    expect(response.body.centers.find(c=>c.id===a.center).structureEvidence.amountEur).toBe('2.03');
    expect(p.actual).toBeNull();expect(p.available).toBeNull();
    expect(response.body.activity).toMatchObject({physicalClosedCount:2,financialClosedCount:1,documentedTransportSubtotalKmf:'131.00',freightCustomsSubtotalKmf:'120.10',documentedTransportTotalKmf:null,coverage:'PARTIAL'});
    expect(response.body.activity.shipments.map(s=>s.reference).sort()).toEqual([activityRefs.closed,activityRefs.pending].sort());
    const closed=response.body.activity.shipments.find(s=>s.reference===activityRefs.closed);
    expect(closed).toMatchObject({rail:'sea',boxCount:1,expectedArticles:1,receivedArticles:1,documentedTransportKmf:'131.00',freightCustomsKmf:'120.10',financialStatus:'DOCUMENTED_CLOSED',weightKg:'10.000',costPerKgKmf:'13.10'});
    expect(response.body.activity).toMatchObject({weightKg:null,measuredWeightSubtotalKg:'10.000',weightedShipmentCount:1,weightedWeightKg:'10.000',weightedTransportKmf:'131.00',costPerKgKmf:'13.10',costPerKgCoverage:'PARTIAL'});
    expect(closed.physicalClosedAt.slice(0,10)).toBe('2026-01-15');
    expect(closed.financialClosedAt.slice(0,10)).toBe('2026-02-10');
    expect(response.body.activity.shipments.find(s=>s.reference===activityRefs.pending)).toMatchObject({financialStatus:'NOT_RECONCILED',documentedTransportKmf:null});
  });
  test('market reader can read own scope only; group and foreign market refused',async()=>{
    const own=await get(fx.viewerA,fx.marketA.code);expect(own.status).toBe(200);
    expect(own.body.activity.shipments.map(s=>s.reference).sort()).toEqual([activityRefs.closed,activityRefs.pending].sort());
    const foreign=await get(fx.central,fx.marketB.code);expect(foreign.status).toBe(200);
    expect(foreign.body.activity.shipments.map(s=>s.reference)).toEqual([activityRefs.foreign]);
    expect((await get(fx.viewerA,fx.marketB.code)).status).toBe(403);
    expect((await get(fx.viewerA,null)).status).toBe(403);
    expect((await get(fx.outsider,fx.marketA.code)).status).toBe(403);
  });
  test('central group excludes both local markets and period with no budget stays null',async()=>{
    const result=await get(fx.central,null);expect(result.status).toBe(200);
    expect(result.body.centers.map(c=>c.id)).toContain(g.center);
    expect(result.body.centers.map(c=>c.id)).not.toContain(a.center);
    expect(result.body.structureEvidence.amountKmf).toBeNull();
    expect(result.body.activity).toBeNull();
    const next=await get(fx.central,fx.marketA.code,'2026-02-01');
    expect(next.status).toBe(200);
    expect(next.body.posts.find(p=>p.id===a.post)).toMatchObject({budget:null,commitments:[],actual:null});
    expect(next.body.activity).toMatchObject({physicalClosedCount:0,financialClosedCount:0,documentedTransportTotalKmf:null});
  });
  test('browser authority injection and invalid period rejected',async()=>{
    expect((await request(app).get(endpoint(fx.marketA.code)).query({periodStart:month,market_id:fx.marketB.id}).set('Authorization',fx.viewerA.token)).status).toBe(400);
    expect((await get(fx.central,fx.marketA.code,'2026-01-02')).status).toBe(400);
    expect((await request(app).get(endpoint(fx.marketA.code)).query({periodStart:month})).status).toBe(401);
  });
});
