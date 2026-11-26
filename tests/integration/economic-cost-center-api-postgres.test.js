'use strict';
/** @test-kind integration @test-runner jest @test-requires postgres
 * ECO disposable database proof. Committed immutable fixtures are necessary for
 * real HTTP requests on separate connections. The runner must provision a
 * disposable database, either the CI container or a named loopback cluster.
 */
const request=require('supertest');
const {createMarketDelegationFixture,makeApp}=require('../helpers/marketDelegationE2EKit');
const {reviseBudget}=require('../../services/economic-cost-budget-service');
const {loadComparableSaleShipments}=require('../../services/cost-allocation/product-margin-steering');
const {findWithdrawnSkuRail,sweepSkuRailWithdrawals}=require('../../services/economic-sku-rail-selection');
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
    const [relay,product,sku,order,item,supplier,po,allocation,unit,box,shipment,line,group,payment]=Array.from({length:14},id);
    const purchase=financial&&!simulated;
    const identity=JSON.stringify({provider:'manual',version:1,payload:{supplier_sku:ref}});
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'CI','+2693000001','CI',$3)",[relay,ref,market.id]);
    await q("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,$2,10000,0)",[product,ref]);
    await q("INSERT INTO suppliers(id,name,platform) VALUES($1,$2,'cj')",[supplier,ref]);
    await q(`INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
      VALUES($1,$2,$3,0,true,'SUPPLIER',$3,$3,$4::jsonb)`,[sku,product,ref,identity]);
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,simulation_scope,created_at)
      VALUES($1,$2,$3,$4,$5,'confirmed','paid','cash_relais',10000,20,$6,'2026-01-05T10:00:00Z')`,[order,fx.viewerA.id,relay,market.id,ref,simulated?'G6-BUYER':null]);
    await q("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) VALUES($1,$2,$3,1,10000,$4,'IMPORT')",[item,order,product,sku]);
    if(purchase){
      await q(`INSERT INTO purchase_orders(id,order_id,supplier_id,market_id,status,trigger_mode,procurement_hub_ref,qty,supplier_sku) VALUES($1,NULL,$2,$3,'draft','auto','DXB',NULL,NULL)`,[po,supplier,market.id]);
      await q(`INSERT INTO purchase_lines(id,order_item_id,supplier_id,product_sku_id,supplier_sku,supplier_unit_ref,supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref) VALUES($1,$2,$3,$4,$5,$5,$6::jsonb,1,10,'USD','DXB')`,[line,item,supplier,sku,ref,identity]);
      await q('UPDATE purchase_lines SET purchase_order_id=$2 WHERE id=$1',[line,po]);
      await q("UPDATE purchase_orders SET status='notified' WHERE id=$1",[po]);
      await q("UPDATE purchase_lines SET confirmed_quantity=1,confirmed_unit_price=10,confirmed_at=now() WHERE id=$1",[line]);
      await q("UPDATE purchase_orders SET status='confirmed',confirmed_at=now() WHERE id=$1",[po]);
      await q("INSERT INTO supplier_execution_groups(id,purchase_order_id,provider,supplier_parent_order_id) VALUES($1,$2,'cj',$3)",[group,po,ref+'-GROUP']);
      await q(`INSERT INTO supplier_execution_payments(id,purchase_order_id,provider,payment_execution_key,supplier_execution_group_id,expected_amount,observed_amount,currency,status,reconciliation_status,real_debit_verified) VALUES($1,$2,'cj',$3,$4,10,10,'USD','succeeded','matched',true)`,[payment,po,ref+'-PAY',group]);
      await q(`INSERT INTO supplier_payment_settlements(supplier_execution_payment_id,kind,amount_currency,currency,amount_kmf,fees_kmf,proof_ref,idempotency_key) VALUES($1,'payment',10,'USD',1000,25,$2,$3)`,[payment,ref+'-DEBIT',ref+'-IDEM']);
    }else await q(`INSERT INTO purchase_orders(id,order_id,order_item_id,product_sku_id,supplier_id,supplier_sku,supplier_unit_ref,supplier_order_identity,qty,status)
      VALUES($1,$2,$3,$4,$5,$6,$6,$7::jsonb,1,'confirmed')`,[po,order,item,sku,supplier,ref,identity]);
    await q(`INSERT INTO hub_purchase_allocations(id,purchase_order_id,order_id,order_item_id,product_sku_id,supplier_id,supplier_unit_ref,supplier_order_identity,quantity,market_id,destination_ref,purchase_line_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,$9,$10,$11)`,[allocation,po,order,item,sku,supplier,ref,identity,market.id,'relais:'+relay,purchase?line:null]);
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
    const ci = process.env.GITHUB_ACTIONS === 'true' && url?.hostname === 'localhost';
    const local = process.env.ECO_LOCAL_PG_PROOF === '1' && url?.hostname === '127.0.0.1' && url.port === '55433';
    if ((!ci && !local) || url?.pathname !== '/komerce_test' || process.env.NODE_ENV !== 'test')
      throw new Error('Refusing committed ECO fixtures outside disposable PostgreSQL');
    const { name, cluster } = (await q("SELECT current_database() AS name, current_setting('cluster_name') AS cluster")).rows[0];
    if (name !== 'komerce_test' || (local && cluster !== 'komerce_eco_disposable'))
      throw new Error('Unexpected ECO proof cluster');
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
    expect(closed).toMatchObject({purchaseKmf:'1000.00',purchaseStatus:'SETTLEMENT_RECONCILED'});
    expect(response.body.activity).toMatchObject({boxCount:'2',expectedArticles:'2',receivedArticles:'2',volumeM3:'0.50000',volumeCoveredCount:2,minCostPerKgKmf:'13.10',maxCostPerKgKmf:'13.10',purchaseTransportObservation:{freightCustomsKmf:'120.10',otherTransportKmf:'10.90',documentedSubtotalKmf:'1131.00',fullEconomicCostKmf:null}});
    expect(response.body.activity).toMatchObject({purchaseKmf:null,purchaseSubtotalKmf:'1000.00',purchaseCoveredCount:1,purchaseTransportObservation:{purchaseKmf:'1000.00',transportKmf:'131.00',coefficient:'1.1310',observations:1,decisional:false,coverage:'PARTIAL'}});
    expect(response.body.profitability).toMatchObject({decisional:false,fullCoefficient:null,points:[{periodStart:'2026-01-01',monthly:{coefficient:'1.1310',observations:1,physicalClosedCount:2},rolling3:{coefficient:'1.1310'},cumulative:{coefficient:'1.1310'}}]});
    expect(response.body.profitability.salesEvidence).toMatchObject({paidOrderCount:2,coveredOrderCount:2,observedNetSalesKmf:'20000.00',coverage:'PAID_COHORT_RESTATED',decisional:false});
    expect(response.body.profitability.netSalesKmf).toBeNull();
    expect(response.body.profitability.periodDecisionEvidence).toMatchObject({basis:'CANONICAL_MATURE_ORDER_PERIOD_DECISION',periodStart:month,fullEconomicResult:false,status:'NOT_DECISIONAL',resultKmf:null});
    expect(closed.physicalClosedAt.slice(0,10)).toBe('2026-01-15');
    expect(closed.financialClosedAt.slice(0,10)).toBe('2026-02-10');
    expect(response.body.activity.shipments.find(s=>s.reference===activityRefs.pending)).toMatchObject({financialStatus:'NOT_RECONCILED',documentedTransportKmf:null});
  });
  test('market reader can read own scope only; group and foreign market refused',async()=>{
    const own=await get(fx.viewerA,fx.marketA.code);expect(own.status).toBe(200);
    expect(own.body.activity.shipments.map(s=>s.reference).sort()).toEqual([activityRefs.closed,activityRefs.pending].sort());
    const foreign=await get(fx.central,fx.marketB.code);expect(foreign.status).toBe(200);
    expect(foreign.body.activity.shipments.map(s=>s.reference)).toEqual([activityRefs.foreign]);
    expect(foreign.body.profitability.salesEvidence).toMatchObject({paidOrderCount:1,observedNetSalesKmf:'10000.00'});
    expect((await get(fx.viewerA,fx.marketB.code)).status).toBe(403);
    expect((await get(fx.viewerA,null)).status).toBe(403);
    expect((await get(fx.outsider,fx.marketA.code)).status).toBe(403);
  });
  test('central group keeps central centers and consolidates market activity',async()=>{
    const result=await get(fx.central,null);expect(result.status).toBe(200);
    expect(result.body.centers.map(c=>c.id)).toContain(g.center);
    expect(result.body.centers.map(c=>c.id)).not.toContain(a.center);
    expect(result.body.structureEvidence.amountKmf).toBeNull();
    expect(result.body.profitability.structureCoverage).toMatchObject({
      status:'GROUP_PERIOD_TRUTH_AVAILABLE',evidenceCount:2,groupSharedKmf:0,marketDirectKmf:2050.85,recognizedKmf:2050.85,
    });
    expect(result.body.activity.scopeCoverage).toBe('ALL_MARKETS_NON_SIMULATED');
    expect(result.body.activity.shipments.map(s=>s.reference)).toContain(activityRefs.foreign);
    expect(result.body.profitability.salesEvidence).toMatchObject({scope:'ALL_MARKETS_NON_SIMULATED',decisional:false});
    const next=await get(fx.central,fx.marketA.code,'2026-02-01');
    expect(next.status).toBe(200);
    expect(next.body.posts.find(p=>p.id===a.post)).toMatchObject({budget:null,commitments:[],actual:null});
    expect(next.body.activity).toMatchObject({physicalClosedCount:0,financialClosedCount:0,documentedTransportTotalKmf:null});
    expect(next.body.profitability.salesEvidence).toMatchObject({paidOrderCount:0,observedNetSalesKmf:null});
    expect(next.body.profitability.points).toHaveLength(2);
    expect(next.body.profitability.points[1]).toMatchObject({monthly:{coefficient:null,observations:0},cumulative:{coefficient:'1.1310',observations:1},rolling3:{coefficient:'1.1310',observations:1}});
    expect(next.body.profitability.ranges.ytd).toMatchObject({coefficient:'1.1310',observations:1,physicalClosedCount:2});
  });
  test('budget HTTP revision preserves scope, actor, immutable history and idempotency',async()=>{
    const post=(actor,code,id,body)=>request(app).post(endpoint(code)+'/posts/'+id+'/budget-revisions').set('Authorization',actor.token).send(body);
    const input={periodStart:month,expectedRevision:2,currency:'EUR',amountNative:'500.00',reason:'CI budget revision',requestKey:tag+'HTTP'};
    expect((await post(fx.viewerA,fx.marketA.code,a.post,input)).status).toBe(403);
    expect((await post(fx.central,fx.marketB.code,a.post,input)).status).toBe(404);
    expect((await post(fx.central,fx.marketA.code,a.post,{...input,marketCode:fx.marketB.code})).status).toBe(400);
    const created=await post(fx.central,fx.marketA.code,a.post,input);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({outcome:'created',revision:{revision:3,previous_revision:2,recorded_by:fx.central.id}});
    const replay=await post(fx.central,fx.marketA.code,a.post,input);
    expect(replay.status).toBe(200);expect(replay.body.outcome).toBe('replayed');
    expect((await post(fx.central,fx.marketA.code,a.post,{...input,amountNative:'501'})).status).toBe(409);
    expect((await post(fx.central,fx.marketA.code,a.post,{...input,requestKey:tag+'STALE'})).status).toBe(409);
    expect((await get(fx.central,fx.marketA.code)).body.posts.find(p=>p.id===a.post).budget).toMatchObject({revision:3,currency:'EUR',native:'500.0000'});
    const group=await post(fx.central,null,g.post,{...input,expectedRevision:0,requestKey:tag+'GROUP'});
    expect(group.status).toBe(201);
    expect((await post(fx.central,null,a.post,input)).status).toBe(404);
  });
  test('commitment API opens, replays and partially releases without creating actual charges',async()=>{
    const post=(actor,code,path,body)=>request(app).post(endpoint(code)+path).set('Authorization',actor.token).send(body);
    const body={periodStart:month,currency:'EUR',amountNative:'100.50',evidenceRef:'CI contract',requestKey:tag+'OPEN'};
    const path='/posts/'+a.post+'/commitments';
    expect((await post(fx.viewerA,fx.marketA.code,path,body)).status).toBe(403);
    expect((await post(fx.central,fx.marketB.code,path,body)).status).toBe(404);
    const count=async()=>Number((await q('SELECT count(*) AS n FROM economic_structure_cost_events')).rows[0].n);
    const before=await count();
    const opened=await post(fx.central,fx.marketA.code,path,body);
    expect(opened.status).toBe(201);
    const k=opened.body.commitment;
    expect(k).toMatchObject({currency:'EUR',amount_native:'100.5000',recorded_by:fx.central.id});
    expect((await post(fx.central,fx.marketA.code,path,body)).body.outcome).toBe('replayed');
    expect((await post(fx.central,fx.marketA.code,path,{...body,amountNative:'101'})).status).toBe(409);
    const move='/commitments/'+k.id+'/movements',release={periodStart:month,kind:'RELEASE',amountNative:'40.25',evidenceRef:'CI release',requestKey:tag+'MOVE'};
    expect((await post(fx.central,fx.marketB.code,move,release)).status).toBe(404);
    expect((await post(fx.central,fx.marketA.code,move,release)).status).toBe(201);
    expect((await post(fx.central,fx.marketA.code,move,release)).body.outcome).toBe('replayed');
    expect((await post(fx.central,fx.marketA.code,move,{...release,amountNative:'60.26',requestKey:tag+'OVER'})).status).toBe(409);
    const model=(await get(fx.central,fx.marketA.code)).body;
    expect(model.posts.find(p=>p.id===a.post).commitments.find(x=>x.id===k.id)).toMatchObject({remaining_native:'60.2500'});
    expect(await count()).toBe(before);
    const fact=model.posts.find(p=>p.id===a.post).eligibleStructureFacts.find(x=>x.currency==='KMF');
    expect(fact).toBeDefined();
    const local=await post(fx.central,fx.marketA.code,path,{...body,currency:'KMF',amountNative:'1000',requestKey:tag+'KMF'});
    expect(local.status).toBe(201);
    const consume='/commitments/'+local.body.commitment.id+'/movements';
    const used={periodStart:month,kind:'CONSUME_STRUCTURE',amountNative:'500',structureEventId:fact.id,evidenceRef:'CI matching',requestKey:tag+'USE'};
    expect((await post(fx.central,fx.marketA.code,consume,used)).status).toBe(201);
    expect((await post(fx.central,fx.marketA.code,consume,used)).body.outcome).toBe('replayed');
    const read=(await get(fx.central,fx.marketA.code)).body.posts.find(p=>p.id===a.post);
    expect(read.commitments.find(x=>x.id===local.body.commitment.id).remaining_native).toBe('500.0000');
    expect(Number(read.eligibleStructureFacts.find(x=>x.id===fact.id).remainingNative)).toBe(500);
    expect(await count()).toBe(before);
  });
  test('actual posting uses canonical journal and rejects foreign scope and duplicate evidence',async()=>{
    const post=(actor,code,id,body)=>request(app).post(endpoint(code)+'/posts/'+id+'/actuals').set('Authorization',actor.token).send(body);
    const body={periodStart:month,currency:'KMF',amountNative:'250',evidenceRef:tag+'-INVOICE'};
    expect((await post(fx.viewerA,fx.marketA.code,a.post,body)).status).toBe(403);
    expect((await post(fx.central,fx.marketB.code,a.post,body)).status).toBe(404);
    expect((await post(fx.central,null,g.post,body)).status).toBe(409);
    const created=await post(fx.central,fx.marketA.code,a.post,body);
    expect(created.status).toBe(201);
    expect(created.body.outcome).toBe('created');
    expect((await post(fx.central,fx.marketA.code,a.post,body)).body.outcome).toBe('replayed');
    expect((await post(fx.central,fx.marketA.code,a.post,{...body,amountNative:'251'})).status).toBe(409);
    const stored=(await q('SELECT count(*)::int AS n,SUM(amount_kmf)::text AS total FROM economic_structure_cost_events WHERE evidence_ref=$1',[body.evidenceRef])).rows[0];
    expect(stored).toEqual({n:1,total:'250.00'});
    expect((await get(fx.central,fx.marketA.code)).body.posts.find(p=>p.id===a.post).structureEvidence.amountKmf).toBe('1250.00');
  });
  test('reference creation is scoped and idempotent, creates no realized fact',async()=>{
    const model=(await get(fx.central,fx.marketA.code)).body;
    const family=model.families.find(x=>x.center_id===a.center);
    const post=(actor,code,id,body)=>request(app).post(endpoint(code)+'/families/'+id+'/posts').set('Authorization',actor.token).send(body);
    const input={code:'NEW_FIXED',label:tag+' fixed reference',economicNature:'FIXED',allocationPerimeter:'DIRECT',allocationBasis:'PERIOD',source:'STRUCTURE',reason:'CI metadata only'};
    expect((await post(fx.viewerA,fx.marketA.code,family.id,input)).status).toBe(403);
    expect((await post(fx.central,fx.marketB.code,family.id,input)).status).toBe(404);
    const created=await post(fx.central,fx.marketA.code,family.id,input);
    expect(created.status).toBe(201);
    expect(created.body.post.structure_charge_id).toBeTruthy();
    expect((await post(fx.central,fx.marketA.code,family.id,input)).body.outcome).toBe('replayed');
    expect((await post(fx.central,fx.marketA.code,family.id,{...input,label:'Changed'})).status).toBe(409);
    expect((await q('SELECT count(*)::int AS n FROM economic_structure_cost_events WHERE charge_id=$1',[created.body.post.structure_charge_id])).rows[0].n).toBe(0);
    const row=(await get(fx.central,fx.marketA.code)).body.posts.find(p=>p.id===created.body.post.id);
    expect(row).toMatchObject({budget:null,actual:null,acceptsStructureActual:true});
  });
  test('delegated market manager can write locally, never group or foreign market',async()=>{
    const post=(actor,code,path,body)=>request(app).post(endpoint(code)+path).set('Authorization',actor.token).send(body);
    const own=await get(fx.managerA,fx.marketA.code);
    expect(own.body.costCapabilities).toMatchObject({budget:true,commitment:true,consume:true,actual:true,reference:true});
    const viewer=await get(fx.viewerA,fx.marketA.code);
    expect(viewer.body.costCapabilities).toMatchObject({budget:false,commitment:false,actual:false,reference:false});
    const body={periodStart:'2026-03-01',expectedRevision:0,currency:'EUR',amountNative:'100',reason:'CI local budget',requestKey:tag+'LOCAL'};
    const path='/posts/'+a.post+'/budget-revisions';
    expect((await post(fx.managerA,fx.marketA.code,path,body)).status).toBe(201);
    expect((await post(fx.managerA,fx.marketB.code,path,body)).status).toBe(403);
    expect((await post(fx.managerA,null,path,body)).status).toBe(403);
    expect((await post(fx.viewerA,fx.marketA.code,path,body)).status).toBe(403);
    const k=await post(fx.managerA,fx.marketA.code,'/posts/'+a.post+'/commitments',{periodStart:month,currency:'EUR',amountNative:'10',evidenceRef:'CI local commitment',requestKey:tag+'LOCAL-K'});
    expect(k.status).toBe(201);
    const actual=await post(fx.managerA,fx.marketA.code,'/posts/'+a.post+'/actuals',{periodStart:month,currency:'KMF',amountNative:'10',evidenceRef:tag+'LOCAL-FACT'});
    expect(actual.status).toBe(201);
  });
  test('reference initialization is idempotent and contains no economic facts',async()=>{
    const post=(actor,code)=>request(app).post(endpoint(code)+'/initialize').set('Authorization',actor.token).send({});
    expect((await post(fx.viewerA,fx.marketA.code)).status).toBe(403);
    expect((await post(fx.managerA,fx.marketB.code)).status).toBe(403);
    expect((await post(fx.managerA,null)).status).toBe(403);
    const first=await post(fx.managerA,fx.marketA.code);
    expect(first.status).toBe(200);expect(first.body).toEqual({centers:3,families:9});
    expect((await post(fx.managerA,fx.marketA.code)).body).toEqual({centers:0,families:0});
    const model=(await get(fx.central,fx.marketA.code)).body;
    const ids=model.centers.filter(c=>['RELAIS_LOCAL','TRANSPORT_DOUANE','SERVICES_MARCHE'].includes(c.code)).map(c=>c.id);
    expect(ids).toHaveLength(3);expect(model.posts.filter(p=>ids.includes(p.center_id))).toEqual([]);
    expect((await post(fx.central,null)).body).toEqual({centers:2,families:7});
  });
  test('reference hierarchy extensions and responsible are scoped and audited',async()=>{
    const post=(actor,code,body)=>request(app).post(endpoint(code)+'/references').set('Authorization',actor.token).send(body);
    const base={kind:'CENTER',code:'EXTENSION',label:'Centre ajouté',reason:'CI extension'};
    expect((await post(fx.viewerA,fx.marketA.code,base)).status).toBe(403);
    const created=await post(fx.managerA,fx.marketA.code,base);expect(created.status).toBe(201);
    const centerId=created.body.reference.id;
    expect((await post(fx.managerA,fx.marketA.code,base)).body.outcome).toBe('replayed');
    const family={kind:'FAMILY',centerId,code:'EXT_FAMILY',label:'Famille',reason:'CI extension'};
    expect((await post(fx.central,fx.marketB.code,family)).status).toBe(404);
    expect((await post(fx.managerA,fx.marketA.code,family)).status).toBe(201);
    expect((await post(fx.managerA,fx.marketA.code,{...family,kind:'RESOURCE',code:'EXT_RESOURCE',resourceKind:'Personnel'})).status).toBe(201);
    const owner={kind:'RESPONSIBLE',centerId,responsibleUserId:fx.managerA.id,expectedResponsibleUserId:null,reason:'CI owner'};
    expect((await post(fx.central,fx.marketA.code,{...owner,responsibleUserId:fx.managerB.id})).status).toBe(403);
    expect((await post(fx.central,fx.marketA.code,owner)).status).toBe(201);
    const staleRemoval={...owner,responsibleUserId:null,reason:'CI concurrent removal'};
    expect((await post(fx.central,fx.marketA.code,staleRemoval)).status).toBe(409);
    const model=(await get(fx.managerA,fx.marketA.code)).body;
    expect(model.centers.find(c=>c.id===centerId)).toMatchObject({responsible_user_id:fx.managerA.id,is_active:true});
    expect(model.responsibleCandidates.some(x=>x.id===fx.managerB.id)).toBe(false);
  });
  test('documented activity stays isolated across the five reference markets', async () => {
    const currencies = { KM: 'KMF', CM: 'XAF', CG: 'XAF', DJ: 'DJF', YT: 'EUR' };
    const { rows: markets } = await q(
      'SELECT id, code, currency, is_active FROM markets WHERE code=ANY($1::text[]) ORDER BY code',
      [Object.keys(currencies)],
    );
    expect(Object.fromEntries(markets.map(({ code, currency }) => [code, currency]))).toEqual(currencies);
    const references = new Map();
    for (const market of markets) references.set(market.code, await seedActivity(market, market.code));

    for (const market of markets) {
      const response = await get(fx.central, market.code);
      if (!market.is_active) {
        expect(response.status).toBe(404);
        continue;
      }
      expect(response.status).toBe(200);
      expect(response.body.marketCode).toBe(market.code);
      expect(response.body.activity.shipments.map(({ reference }) => reference).filter((reference) => reference.startsWith(tag)))
        .toEqual([references.get(market.code)]);
      expect(response.body.activity.purchaseTransportObservation.coefficient).toBe('1.1310');
    }

    const group = await get(fx.central, null);
    expect(group.status).toBe(200);
    const groupRefs = group.body.activity.shipments.map(({ reference }) => reference);
    expect(groupRefs).toEqual(expect.arrayContaining([...references.values()]));
    expect((await q("SELECT is_active FROM markets WHERE code='DJ'")).rows[0].is_active).toBe(false);
  });

  test('after-sale scope retains financially closed, nonsimulated shipments only', async () => {
    const { rows } = await q(
      'SELECT oi.id AS order_item_id, o.reference FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.reference=ANY($1::text[])',
      [Object.values(activityRefs)],
    );
    const lines = rows.map((line) => ({ ...line, result: { reconciled_after_sale_margin_kmf: -10 } }));
    const scoped = await loadComparableSaleShipments(fx.marketA.id, lines);
    const closedLine = rows.find(({ reference }) => reference === activityRefs.closed);
    expect([...scoped.keys()]).toEqual([closedLine.order_item_id]);
    expect(scoped.get(closedLine.order_item_id)).toMatchObject({ rail: 'sea', sku_line_count: 1 });
  });

  test('buyer lookup applies a withdrawal and restore to the exact SKU, market and rail', async () => {
    const { rows: [{ sku_id: skuId }] } = await q(
      'SELECT oi.sku_id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.reference=$1',
      [activityRefs.closed],
    );
    const event = (action) => q(
      `INSERT INTO economic_sku_rail_selection_events
        (market_id,sku_id,rail,action,policy_version,evidence,reason,actor_id)
       VALUES ($1,$2,'SEA_STANDARD',$3,$4,'{}','CI selection fixture',$5)`,
      [fx.marketA.id, skuId, action, tag, fx.central.id],
    );
    const sea = [{ skuId, rail: 'SEA_STANDARD' }];
    await event('WITHDRAW');
    expect(await findWithdrawnSkuRail(db, fx.marketA.id, sea)).toEqual({ sku_id: skuId, rail: 'SEA_STANDARD' });
    expect(await findWithdrawnSkuRail(db, fx.marketB.id, sea)).toBeNull();
    expect(await findWithdrawnSkuRail(db, fx.marketA.id, [{ skuId, rail: 'AIR_EXPRESS' }])).toBeNull();
    await expect(q('DELETE FROM economic_sku_rail_selection_events WHERE sku_id=$1', [skuId])).rejects.toThrow(/append-only/);
    await event('RESTORE');
    expect(await findWithdrawnSkuRail(db, fx.marketA.id, sea)).toBeNull();
    const policyEvent = (action, actorId) => q(
      `INSERT INTO economic_sku_rail_selection_events
        (market_id,sku_id,rail,action,policy_version,evidence,reason,actor_id,decision_source)
       VALUES ($1,$2,'SEA_STANDARD',$3,$4,'{}','CI selection automation',$5,'POLICY_AUTOMATION')`,
      [fx.marketA.id, skuId, action, tag, actorId],
    );
    await expect(policyEvent('WITHDRAW', fx.central.id)).rejects.toThrow(/decision_source_check/);
    await expect(policyEvent('RESTORE', null)).rejects.toThrow(/decision_source_check/);
    await policyEvent('WITHDRAW', null);
    expect(await findWithdrawnSkuRail(db, fx.marketA.id, sea)).toEqual({ sku_id: skuId, rail: 'SEA_STANDARD' });
  });

  test('market family thresholds are persisted as a new policy and isolated by market', async () => {
    const path = (code) => mount + '/market/' + code + '/decision-policy';
    const selection_by_family = { audio: { minimum_contribution_kmf: 150, loss_observation_count: 3 } };
    const input = {
      version: tag + '-POLICY',
      window_days: 30, maturity_threshold: 0.9, coverage_threshold: 1, max_disposition_ratio: 0.05,
      source: 'CI family policy', evidence_ref: tag, rationale: 'Recette des seuils par famille',
      selection_by_family,
    };
    const post = (actor, code) => request(app).post(path(code)).set('Authorization', actor.token).send(input);
    expect((await post(fx.viewerA, fx.marketA.code)).status).toBe(403);
    expect((await post(fx.managerA, fx.marketB.code)).status).toBe(403);
    const created = await post(fx.managerA, fx.marketA.code);
    expect(created.status).toBe(201);
    expect(created.body.result.selection_by_family).toEqual(selection_by_family);
    const history = await request(app).get(path(fx.marketA.code) + '/history').set('Authorization', fx.viewerA.token);
    expect(history.body.policies).toContainEqual(expect.objectContaining({ version: input.version, selection_by_family }));
    const persisted = await q(
      'SELECT market_id, selection_by_family, recorded_by FROM pricing_market_decision_policy_events WHERE version=$1',
      [input.version],
    );
    expect(persisted.rows).toEqual([{
      market_id: fx.marketA.id, selection_by_family, recorded_by: fx.managerA.id,
    }]);
    await expect(sweepSkuRailWithdrawals()).resolves.toEqual({ recorded: 0, cursor: null });
  });

  test('a later charge invalidates a documented coefficient until reconciliation', async () => {
    const { rows: [{ id }] } = await q(
      'SELECT id FROM international_shipments WHERE reference=$1', [activityRefs.closed],
    );
    await q(
      `INSERT INTO international_shipment_charges
         (shipment_id,fee_type,kind,amount_kmf,proof_ref,idempotency_key,actor_id,recorded_at)
       SELECT shipment_id,'local_transport','charge',10,$2,$2,$3,reconciled_at + interval '1 second'
         FROM international_n1_reconciliations WHERE shipment_id=$1`,
      [id, tag + '-LATE', fx.central.id],
    );
    const response = await get(fx.central, fx.marketA.code);
    expect(response.status).toBe(200);
    expect(response.body.activity.shipments.find(({ reference }) => reference === activityRefs.closed))
      .toMatchObject({ financialStatus: 'PENDING_RECONCILIATION', documentedTransportKmf: null });
    expect(response.body.profitability.ranges.month).toMatchObject({ coefficient: null, observations: 0 });
  });

  test('browser authority injection and invalid period rejected',async()=>{
    expect((await request(app).get(endpoint(fx.marketA.code)).query({periodStart:month,market_id:fx.marketB.id}).set('Authorization',fx.viewerA.token)).status).toBe(400);
    expect((await get(fx.central,fx.marketA.code,'2026-01-02')).status).toBe(400);
    expect((await request(app).get(endpoint(fx.marketA.code)).query({periodStart:month})).status).toBe(401);
  });
});
