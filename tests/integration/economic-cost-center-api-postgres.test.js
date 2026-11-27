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
    app=makeApp([{mount,modulePath:'../../routes/admin-pricing-workspace'},{mount:'/api/admin/costing',modulePath:'../../routes/admin-costing'}]);
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
    expect(response.body.profitability.recognitionEvidence).toMatchObject({
      handoffParcelCount:0,attestedUnits:0,confirmedRefundCount:0,confirmedRefundKmf:null,
      parcelCostEvidenceCount:0,documentedParcelVariableCostKmf:null,
      coverage:'DOCUMENTED_EVENTS_ONLY',
    });
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
  test('A1 admin without pricing global grant reads group and both markets, but cannot write',async()=>{
    // Use the isolated outsider fixture only, restore its identity in all outcomes.
    const actor=fx.outsider;
    await q("UPDATE users SET role='admin' WHERE id=$1",[actor.id]);
    try {
      expect((await q("SELECT 1 FROM pricing_global_access_grants WHERE user_id=$1 AND revoked_at IS NULL",[actor.id])).rows).toHaveLength(0);
      for(const code of [null,fx.marketA.code,fx.marketB.code]){
        const reply=await get(actor,code);
        expect(reply.status).toBe(200);
        expect(reply.body).toMatchObject({globalRead:true,central:false,readOnly:true,
          costCapabilities:{budget:false,commitment:false,consume:false,actual:false,reference:false}});
      }
      const path=endpoint(null)+'/posts/'+g.post+'/budget-revisions';
      const count=async()=>String((await q('SELECT count(*) FROM economic_cost_budget_revisions WHERE post_id=$1',[g.post])).rows[0].count);
      const before=await count();
      const refused=await request(app).post(path).set('Authorization',actor.token).send({periodStart:month,expectedRevision:0,currency:'EUR',amountNative:'1.00',reason:'must refuse',requestKey:tag+'A1DENY'});
      expect(refused.status).toBe(403);
      expect(await count()).toBe(before);
      const marketDenied=await request(app).post(endpoint(fx.marketA.code)+'/posts/'+a.post+'/budget-revisions').set('Authorization',actor.token).send({periodStart:month,expectedRevision:2,currency:'EUR',amountNative:'1.00',reason:'must refuse',requestKey:tag+'A1MKT'});
      expect(marketDenied.status).toBe(403);
      const close=await request(app).post(endpoint(null)+'/close-period').set('Authorization',actor.token).send({periodStart:month,evidenceHash:'a'.repeat(64),evidenceRef:'must refuse',attested:true});
      expect(close.status).toBe(403);
    } finally {await q("UPDATE users SET role='client' WHERE id=$1",[actor.id]);}
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
  test('documented allocation follows the attested handoff month and excludes simulated cost facts',async()=>{
    const {rows:[item]}=await q(
      'SELECT oi.id,oi.order_id,oi.product_id,o.relais_id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.reference=$1',
      [activityRefs.closed]);
    const parcelId=crypto.randomUUID();
    const collectedAt='2026-02-01T00:00:00.000Z';
    await q(`INSERT INTO parcels(id,order_id,reference,status,collected_at,relais_id)
      VALUES($1,$2,$3,'collected',$4,$5)`,[parcelId,item.order_id,tag+'-HANDOFF',collectedAt,item.relais_id]);
    await q(`INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity,
      qty_allocated,qty_packed,qty_shipped,qty_received,qty_collected)
      VALUES($1,$2,$3,1,1,1,1,1,1)`,[parcelId,item.id,item.product_id]);
    await q(`INSERT INTO scans(order_id,parcel_id,step,scan_code,pickup_method,pickup_relais_id,created_at)
      VALUES($1,$2,'collected',$3,'PICKUP_CODE',$4,$5)`,[item.order_id,parcelId,tag+'-HANDOFF',item.relais_id,collectedAt]);
    await q(`INSERT INTO order_item_real_cost_allocations
      (order_id,order_item_id,parcel_id,cost_type,amount_kmf,allocation_method,source,provenance)
      VALUES($1,$2,$3,'packaging',315.25,'by_quantity','test_documented','preuve'),
      ($1,$2,$3,'hub',1000,'by_quantity','test_documented','FICTIF recette'),
      ($1,$2,NULL,'payment',40.50,'by_quantity','test_documented','preuve'),
      ($1,$2,NULL,'packaging',315.25,'by_quantity','test_documented','preuve')`,[item.order_id,item.id,parcelId]);
    const january=await get(fx.central,fx.marketA.code,'2026-01-01');
    const february=await get(fx.central,fx.marketA.code,'2026-02-01');
    const foreign=await get(fx.central,fx.marketB.code,'2026-02-01');
    expect(january.status).toBe(200);
    expect(february.status).toBe(200);
    expect(foreign.status).toBe(200);
    expect(january.body.profitability.recognitionEvidence).toMatchObject({attestedUnits:0,documentedParcelVariableCostKmf:null});
    expect(february.body.profitability.recognitionEvidence).toMatchObject({
      attestedUnits:1,pricedHandoffUnits:1,documentedHandoffSalesKmf:'10000.00',
      parcelCostEvidenceCount:1,documentedParcelVariableCostKmf:'355.75',
    });
    expect(foreign.body.profitability.recognitionEvidence).toMatchObject({attestedUnits:0,documentedParcelVariableCostKmf:null});

    const discountOrder=crypto.randomUUID();
    const discountItems=[crypto.randomUUID(),crypto.randomUUID()].sort();
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,
      payment_mode,total_kmf,discount_kmf,wallet_applied_kmf,total_eur,created_at)
      VALUES($1,$2,$3,$4,$5,'confirmed','paid','cash_relais',27000,1000.01,1999.99,55,'2026-01-31')`,
      [discountOrder,fx.viewerA.id,item.relais_id,fx.marketA.id,tag+'-DISCOUNT']);
    for (const [at,quantity] of [['2026-04-01T00:00:00.000Z',1],['2026-05-01T00:00:00.000Z',2]]) {
      const discountItem=discountItems[quantity-1];
      await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source)
        VALUES($1,$2,$3,$4,10000,'LOCAL_STOCK')`,[discountItem,discountOrder,item.product_id,quantity]);
      const parcel=crypto.randomUUID(),reference=tag+'-DISCOUNT-'+quantity;
      await q(`INSERT INTO parcels(id,order_id,reference,status,collected_at,relais_id)
        VALUES($1,$2,$3,'collected',$4,$5)`,[parcel,discountOrder,reference,at,item.relais_id]);
      await q(`INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity,
        qty_allocated,qty_packed,qty_shipped,qty_received,qty_collected)
        VALUES($1,$2,$3,$4,$4,$4,$4,$4,$4)`,[parcel,discountItem,item.product_id,quantity]);
      await q(`INSERT INTO scans(order_id,parcel_id,step,scan_code,pickup_method,pickup_relais_id,created_at)
        VALUES($1,$2,'collected',$3,'PICKUP_CODE',$4,$5)`,[discountOrder,parcel,reference,item.relais_id,at]);
    }
    const [firstHandoff,secondHandoff]=await Promise.all([
      get(fx.central,fx.marketA.code,'2026-04-01'),get(fx.central,fx.marketA.code,'2026-05-01'),
    ]);
    expect(firstHandoff.body.profitability.recognitionEvidence).toMatchObject({
      pricedHandoffUnits:1,documentedHandoffSalesKmf:'9666.66',documentedParcelVariableCostKmf:null,
    });
    expect(secondHandoff.body.profitability.recognitionEvidence).toMatchObject({
      pricedHandoffUnits:2,documentedHandoffSalesKmf:'19333.33',documentedParcelVariableCostKmf:null,
    });
  });

  test('Direction closes a reviewed month and a later charge reopens it',async()=>{
    const period='2026-04-01';
    const {rows:[line]}=await q(`SELECT o.id AS order_id,pi.order_item_id,p.id AS parcel_id
      FROM parcels p JOIN orders o ON o.id=p.order_id JOIN parcel_items pi ON pi.parcel_id=p.id
      WHERE p.reference=$1`,[tag+'-DISCOUNT-1']);
    await q(`INSERT INTO order_item_real_cost_allocations
      (order_id,order_item_id,parcel_id,cost_type,amount_kmf,allocation_method,source)
      VALUES($1,$2,$3,'packaging',300,'by_quantity','fixture_revue')`,
      [line.order_id,line.order_item_id,line.parcel_id]);
    await q(`INSERT INTO economic_risk_watermark_events(market_id,closed_through,review_version,source,evidence_ref,recorded_by)
      SELECT id,'2026-05-01','v1','fixture revue','preuves de revue',$1 FROM markets`,[fx.central.id]);
    const {rows:[charge]}=await q('SELECT id FROM charges WHERE name=$1',[tag]);
    const event={charge_id:charge.id,scope_kind:'MARKET_DIRECT',market_id:fx.marketA.id,event_kind:'ACCRUAL',
      economic_from:'2026-04-01T00:00:00Z',economic_to:'2026-05-01T00:00:00Z',amount_original:50,currency:'KMF',
      fx_rate_to_kmf:1,fx_source:'CI fixture',amount_kmf:50,source_kind:'MANUAL',evidence_ref:'Pièce initiale'};
    await recordStructureCostEvent(event,fx.central.id);
    const read=async()=> {
      const reply=await get(fx.central,null,period);
      expect(reply.status).toBe(200);
      return reply.body.profitability.groupPeriodResult;
    };
    const incomplete=await read();
    expect(incomplete).toMatchObject({status:'NOT_RECONCILED',reasons:expect.arrayContaining(['VARIABLE_COSTS_INCOMPLETE'])});
    // Explicit confirmed zero for other applicable costs of this isolated local-stock line.
    await q(`INSERT INTO order_item_real_cost_allocations
      (order_id,order_item_id,parcel_id,cost_type,amount_kmf,allocation_method,source,provenance)
      SELECT $1,$2,$3,kind,0,'by_quantity','fixture_revue','zero confirmed by CI evidence'
        FROM unnest(ARRAY['product_purchase','sourcing','local_distribution','relay']::text[]) kind`,
      [line.order_id,line.order_item_id,line.parcel_id]);
    const initial=await read();
    expect(initial).toMatchObject({status:'PROVISIONAL',resultKmf:'9316.66'});
    const direction=require('../../services/economic-cost-center-read-model').readGroupPeriodDecision;
    const compact=await direction(fx.central,period);
    expect(initial.display).toEqual(compact.display);
    expect(initial.display).toMatchObject({currency:'EUR',result:compact.resultEur,fxStatus:'GOVERNED_FIXED_PARITY_PROJECTION'});
    expect(compact).toMatchObject({status:initial.status,resultKmf:initial.resultKmf,fxStatus:'GOVERNED_FIXED_PARITY_PROJECTION'});
    expect(compact).not.toHaveProperty('evidenceHash');
    await expect(direction(fx.viewerA,period)).rejects.toMatchObject({status:403});
    const submit=(actor,hash)=>request(app).post(mount+'/cost-centers/close-period')
      .set('Authorization',actor.token).send({periodStart:period,evidenceHash:hash,evidenceRef:'Revue Direction avril',attested:true});
    expect((await submit(fx.viewerA,initial.evidenceHash)).status).toBe(403);
    expect((await submit(fx.central,initial.evidenceHash)).status).toBe(201);
    expect((await submit(fx.central,initial.evidenceHash)).status).toBe(200);
    expect(await read()).toMatchObject({status:'CLOSED',resultKmf:'9316.66'});
    expect(await direction(fx.central,period)).toMatchObject({status:'CLOSED',resultKmf:'9316.66'});
    await recordStructureCostEvent({...event,amount_original:20,amount_kmf:20,evidence_ref:'Facture tardive'},fx.central.id);
    expect(await read()).toMatchObject({status:'REOPENED',resultKmf:'9296.66'});
    expect(await direction(fx.central,period)).toMatchObject({status:'REOPENED',resultKmf:'9296.66'});
    const marketDecision=require('../../services/economic-cost-center-read-model').readMarketPeriodDecision;
    const readMarket=()=>marketDecision(fx.viewerA,fx.marketA.code,period);
    const marketBefore=await readMarket();
    expect(marketBefore).toMatchObject({status:'PROVISIONAL',resultKmf:'9296.66'});
    await expect(marketDecision(fx.viewerA,fx.marketB.code,period)).rejects.toMatchObject({status:403});
    const groupCharge=(await q("INSERT INTO charges(family,name,amount_kmf,is_recurring,recurrence_period) VALUES('operationnelle',$1,0,true,'monthly') RETURNING id",[tag+'-APRIL-GROUP'])).rows[0].id;
    const shared=await recordStructureCostEvent({...event,charge_id:groupCharge,scope_kind:'GROUP',market_id:null,amount_original:100,amount_kmf:100,evidence_ref:'Pool CI'},fx.central.id);
    expect(await readMarket()).toMatchObject({status:'NOT_RECONCILED',resultKmf:null});
    await q(`INSERT INTO market_cost_attributions(source_event_id,market_id,event_kind,amount_kmf,allocation_key,allocation_basis,policy_version,recorded_by)
       VALUES($1,$2,'ATTRIBUTION',40,'CI_PROOF','{}','CI_V1',$4),($1,$3,'ATTRIBUTION',60,'CI_PROOF','{}','CI_V1',$4)`,[shared.id,fx.marketA.id,fx.marketB.id,fx.central.id]);
    const marketAfter=await readMarket();
    expect(marketAfter).toMatchObject({status:'PROVISIONAL',resultKmf:'9256.66'});
    const cockpit=await get(fx.viewerA,fx.marketA.code,period);expect(cockpit.status).toBe(200);
    expect(cockpit.body.profitability.marketPeriodResult).toMatchObject({resultKmf:marketAfter.resultKmf,display:marketAfter.display});
    expect(cockpit.body.profitability.structureCoverage).not.toHaveProperty('groupSharedKmf');

    expect((await submit(fx.central,initial.evidenceHash)).status).toBe(409);
  });

  test('LOCAL_STOCK: three actual receipt lots, partial coverage, cent conservation and market isolation (HTTP/PG)',async()=>{
    // Historical synthetic facts on the guarded disposable DB only.
    // These inserts are NOT a proof of W3 reception or checkout UI.
    const fixture=require('../../scripts/recette/fixtures/sku-landed-cost.test-values.json').local;
    const values=fixture.per_lot;
    const id=()=>crypto.randomUUID();
    const [product,sku,relay,stock]=Array.from({length:4},id);
    const market=fx.marketA;
    await q("INSERT INTO products(id,name,price_kmf,stock,weight_kg,cost_kmf) VALUES($1,$2,7000,0,1,5000)",[product,tag+'-LOCAL']);
    await q("INSERT INTO product_skus(id,product_id,sku,stock,is_active) VALUES($1,$2,$3,0,TRUE)",[sku,product,tag+'-LOCAL-SKU']);
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'CI','+2693000001','CI',$3)",[relay,tag+'-LOCAL',market.id]);
    await q("INSERT INTO local_stock(id,product_id,market_id,location,qty_physical) VALUES($1,$2,$3,'KM_MAIN',0)",[stock,product,market.id]);
    const receiptIds=[];
    for (let n=0;n<3;n++) {
      const receipt=id();receiptIds.push(receipt);
      await q(`INSERT INTO market_delegation_audit(id,market_id,actor_user_id,action,payload_after,occurred_at,correlation_id)
        VALUES($1,$2,$3,'LOCAL_STOCK_RECEIPT',$4::jsonb,now()-interval '2 days',$5)`,
        [receipt,market.id,fx.central.id,JSON.stringify({product_id:product,sku_id:sku,relais_id:relay,qty_received:10,proof_ref:tag+'-BL-'+n}),tag+'-LOCAL-'+n]);
    }
    const items=[];
    for(let n=0;n<3;n++){
      const order=id(),item=id();items.push(item);
      await q(`INSERT INTO orders(id,reference,user_id,relais_id,market_id,total_kmf,payment_mode,payment_status,status,created_at,collected_at)
        VALUES($1,$2,$3,$4,$5,70000,'cash_relais','paid','collected',now()-interval '1 day',now())`,[order,tag+'-LOCAL-O'+n,fx.viewerA.id,relay,market.id]);
      await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source,qty_ordered,qty_allocated,qty_packed,qty_shipped,qty_received,qty_collected)
        VALUES($1,$2,$3,10,7000,$4,'LOCAL_STOCK',10,10,10,10,10,10)`,[item,order,product,sku]);
      await q("INSERT INTO local_stock_allocations(local_stock_id,order_id,quantity,consumed_at) VALUES($1,$2,10,now())",[stock,order]);
      const breakdown={landed_relay:{product_purchase:5000,relay:120,freight:0,customs:0},business:{payment:80},target_margin_pct:20};
      await q(`INSERT INTO order_item_cost_imputations(order_id,order_item_id,product_id,quantity,sale_unit_price_kmf,sale_total_kmf,
        estimated_landed_relay_cost_kmf,estimated_business_variable_cost_kmf,estimated_business_complete_cost_kmf,cost_breakdown)
        VALUES($1,$2,$3,10,7000,70000,51200,52000,52000,$4::jsonb)`,[order,item,product,JSON.stringify(breakdown)]);
      for(const [type,amount] of [['relay',values.relay_real_kmf],['payment',values.payment_real_kmf]]){
        await q(`INSERT INTO order_item_real_cost_allocations(order_id,order_item_id,cost_type,amount_kmf,allocation_method,source,is_actual,confidence,provenance)
          VALUES($1,$2,$3,$4,'manual','manual_entry',TRUE,'high',$5)`,[order,item,type,amount,tag+' isolated synthetic proof']);
      }
    }
    const base='/api/admin/costing/local-stock/receipt-lots';
    const submit=(actor,action,body)=>request(app).post(base+'/'+action).set('Authorization',actor.token).send({market_code:market.code,...body});
    const close=(receipt,overrides={})=>({receipt_id:receipt,purchase_total_kmf:values.product_purchase_real_kmf,payment_proof_ref:tag+'-BANK-'+receipt,...overrides});
    const link=(receipt,item,quantity)=>({receipt_id:receipt,order_item_id:item,quantity,lot_proof_ref:tag+'-SCAN-'+receipt+'-'+item});
    const read=async(actor=fx.central,code=market.code)=>request(app).get('/api/admin/costing/products/margin-steering')
      .query({market_code:code,product_id:product,since_days:90}).set('Authorization',actor.token);
    const result=response=>response.body.products.find(p=>p.product_id===product).observed_landed_cost.find(c=>c.rail==='LOCAL_STOCK');
    expect((await submit(fx.viewerA,'close',close(receiptIds[0]))).status).toBe(403);
    expect((await submit(fx.central,'close',close(receiptIds[0],{market_code:fx.marketB.code}))).status).toBe(404);
    for(const receipt of receiptIds)expect((await submit(fx.central,'close',close(receipt))).status).toBe(200);
    expect((await submit(fx.central,'link',link(receiptIds[0],items[0],4))).status).toBe(200);
    let response=await read();expect(response.status).toBe(200);
    expect(result(response)).toMatchObject({observations:0,unit_cost_kmf:null,status:'INSUFFICIENT_OBSERVATIONS'});
    expect((await submit(fx.central,'link',link(receiptIds[1],items[0],6))).status).toBe(200);
    expect((await submit(fx.central,'link',link(receiptIds[1],items[0],6))).status).toBe(200);
    expect((await submit(fx.central,'link',link(receiptIds[2],items[0],1))).status).toBe(409);
    expect((await submit(fx.central,'link',link(receiptIds[0],items[1],6))).status).toBe(200);
    expect((await submit(fx.central,'link',link(receiptIds[1],items[1],4))).status).toBe(200);
    expect((await submit(fx.central,'link',link(receiptIds[2],items[2],10))).status).toBe(200);
    response=await read();expect(response.status).toBe(200);
    expect(result(response)).toMatchObject({rail:'LOCAL_STOCK',unit_cost_kmf:5200,observations:3,quantity:30,status:'DECISIONAL',display_currency:market.currency});
    expect(result(response).observed_multiplier).toBeCloseTo(1.04,8);
    expect(result(response).unit_cost_local).not.toBeNull();
    // The shared delegation fixture uses client identities. The canonical
    // finance read route additionally requires the real staff role. Prove the
    // client denial first, then exercise the staff identity on the same
    // read-only membership; do not broaden production permissions.
    expect((await read(fx.viewerA)).status).toBe(403);
    await q("UPDATE users SET role='market_operator' WHERE id=$1",[fx.viewerA.id]);
    const marketReader={...fx.viewerA,role:'market_operator',token:require('../helpers/marketDelegationE2EKit').bearer(fx.viewerA.id,'market_operator')};
    const own=await read(marketReader);expect(own.status).toBe(200);
    expect(result(own)).toMatchObject({observations:3,unit_cost_kmf:5200});
    expect((await read(marketReader,fx.marketB.code)).status).toBe(403);
    const {rows:[total]}=await q(`SELECT SUM(quantity)::int AS quantity,SUM(purchase_kmf)::text AS purchase
      FROM local_stock_economic_lot_lines WHERE receipt_id=ANY($1::uuid[])`,[receiptIds]);
    expect(total).toEqual({quantity:30,purchase:'150000.00'});
    expect((await q('SELECT qty_physical FROM local_stock WHERE id=$1',[stock])).rows[0].qty_physical).toBe(0);
  });

  test('Hub invoice: conserved pool, reciprocal scope, exact payment, late adjustment and no additional group expense',async()=>{
    // Committed fixtures in the already guarded disposable DB only.
    const from='2024-01-01',to='2024-02-01';
    const marketApp=makeApp([
      {mount:'/api/admin/market-settlements',modulePath:'../../routes/admin-market-settlement'},
      {mount:'/api/market-delegation',modulePath:'../../routes/market-delegation-cost-statement'},
    ]);
    const centralPath=code=>'/api/admin/market-settlements/markets/'+code+'/hub-invoices';
    const marketPath=code=>'/api/market-delegation/markets/'+code+'/cost-statement';
    const preview=(code=fx.marketA.code)=>request(marketApp).get(centralPath(code)).query({from,to}).set('Authorization',fx.central.token);
    const read=(actor,code)=>request(marketApp).get(marketPath(code)).query({scope:'hub',from,to}).set('Authorization',actor.token);
    const groupTruth=()=>require('../../services/pricing-period-structure').computePeriodStructureTruth({from,to});
    const center=(await q("INSERT INTO economic_cost_centers(code,label) VALUES('HUB_CENTRAL','Hub central') ON CONFLICT(market_id,code) DO UPDATE SET label=economic_cost_centers.label RETURNING id")).rows[0].id;
    const family=(await q("INSERT INTO economic_cost_families(center_id,code,label) VALUES($1,$2,$2) RETURNING id",[center,tag+'HUB'])).rows[0].id;
    const charge=(await q("INSERT INTO charges(family,name,amount_kmf,is_recurring,recurrence_period) VALUES('operationnelle',$1,0,true,'monthly') RETURNING id",[tag+'HUB'])).rows[0].id;
    await q("INSERT INTO economic_cost_posts(center_id,family_id,code,label,economic_nature,allocation_perimeter,allocation_basis,structure_charge_id) VALUES($1,$2,'HUB_TEST','Hub test','FIXED','MUTUALIZED','PERIOD',$3)",[center,family,charge]);
    const record=amount=>recordStructureCostEvent({charge_id:charge,scope_kind:'GROUP',event_kind:'ACCRUAL',economic_from:from+'T00:00:00Z',economic_to:to+'T00:00:00Z',amount_original:amount,currency:'KMF',fx_rate_to_kmf:1,fx_source:'CI fixture',amount_kmf:amount,source_kind:'MANUAL',evidence_ref:tag+'HUB'},fx.central.id);
    const allocate=(event,partA,partB)=>q(`INSERT INTO market_cost_attributions(source_event_id,market_id,event_kind,amount_kmf,allocation_key,allocation_basis,policy_version,recorded_by)
       VALUES($1,$2,'ATTRIBUTION',$4,'CI_PROOF','{}','CI_V1',$6),($1,$3,'ATTRIBUTION',$5,'CI_PROOF','{}','CI_V1',$6)`,[event.id,fx.marketA.id,fx.marketB.id,partA,partB,fx.central.id]);
    const source=await record(100000);
    let response=await preview();expect(response.status).toBe(200);
    expect(response.body).toMatchObject({can_issue:false,statement:{coverage:{status:'POOL_RECONCILIATION_REQUIRED'}}});
    const issue=hash=>request(marketApp).post(centralPath(fx.marketA.code)).set('Authorization',fx.central.token).send({from,to,evidence_hash:hash});
    expect((await issue(response.body.evidence_hash)).status).toBe(409);
    await allocate(source,40000,60000);
    response=await preview();expect(response.status).toBe(200);
    expect(response.body).toMatchObject({can_issue:true,statement:{total_kmf:'40000.00',coverage:{status:'NO_CROSS_PERIOD_ATTRIBUTIONS'}}});
    const before=(await groupTruth()).recognized_total_kmf;
    const issued=await issue(response.body.evidence_hash);expect(issued.status).toBe(200);
    const invoice=issued.body.invoice;
    expect(invoice.balance).toMatchObject({hub_receivable_kmf:'40000.00',market_payable_kmf:'40000.00'});
    expect((await issue(response.body.evidence_hash)).body.invoice.id).toBe(invoice.id);
    const own=await read(fx.viewerA,fx.marketA.code);expect(own.status).toBe(200);
    expect(own.body.invoice).toMatchObject({id:invoice.id,amount_kmf:'40000.00',balance:invoice.balance});
    expect(own.body.invoice).not.toHaveProperty('issued_by');
    expect((await read(fx.viewerA,fx.marketB.code)).status).toBe(403);
    expect((await read(fx.outsider,fx.marketA.code)).status).toBe(403);
    const pay=amount=>request(marketApp).post(centralPath(fx.marketA.code)+'/'+invoice.id+'/payment').set('Authorization',fx.central.token).send({amount_kmf:amount,reference:tag+'-HUB-PAY'});
    expect((await pay('39999.99')).status).toBe(409);
    const paid=await pay('40000.00');expect(paid.status).toBe(200);
    expect(paid.body.invoice.balance).toMatchObject({hub_receivable_kmf:'0.00',market_payable_kmf:'0.00',settlement_status:'PAYMENT_ATTESTED'});
    expect((await groupTruth()).recognized_total_kmf).toBe(before);
    const late=await record(10000);
    expect((await preview()).body.adjustment).toMatchObject({invoice_id:invoice.id,status:'RECONCILIATION_REQUIRED',delta_kmf:null});
    await allocate(late,4000,6000);
    const updated=await preview();expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({invoice:{id:invoice.id,status:'PAID',amount_kmf:'40000.00'},adjustment_required:true,adjustment:{invoice_id:invoice.id,delta_kmf:'4000.00',status:'REVIEW_REQUIRED'}});
    expect((await read(fx.viewerA,fx.marketA.code)).body.adjustment).toEqual(updated.body.adjustment);
    expect((await groupTruth()).recognized_total_kmf-before).toBe(10000);
    const facts=(await q('SELECT COUNT(*)::int AS count,SUM(amount_kmf)::text AS total FROM hub_internal_invoices WHERE market_id=$1',[fx.marketA.id])).rows[0];
    expect(facts).toEqual({count:1,total:'40000.00'});
  });

});
