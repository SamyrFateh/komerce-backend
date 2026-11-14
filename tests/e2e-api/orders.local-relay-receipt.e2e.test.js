'use strict';
/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 * @feature orders
 * @brief Local relay physical receipt -> available -> one-shot pickup,
 *        with paid, cross-relay and mixed-order guards on real PostgreSQL.
 */
const request=require('supertest');
const express=require('express');
const {signAuthToken}=require('../../utils/auth-session');
const {generateAndStoreSecret}=require('../../services/pickup-secret-service');
const {describeE2E,createCleanup,assertTestDatabase,tag,uuid}=require('../helpers/e2eDbKit');
jest.setTimeout(90000);

describeE2E('Orders - local relay receipt without hub',({db})=>{
  const user=uuid(),agent=uuid(),foreignAgent=uuid(),relay=uuid(),foreignRelay=uuid();
  const product=uuid(),importProduct=uuid(),stock=uuid();
  const orders={local:uuid(),mixed:uuid(),unpaid:uuid()};
  const items={local:uuid(),mixedLocal:uuid(),mixedImport:uuid(),unpaid:uuid()};
  let app,token,foreignToken,cleanup,cleanupClient,market;
  const refs={local: 'E2E-LR-'+tag('local'),mixed:'E2E-LR-'+tag('mixed'),unpaid:'E2E-LR-'+tag('unpaid')};
  const q=(sql,params=[])=>db.query(sql,params);
  const send=(which,auth=token)=>request(app)
    .post('/api/orders/'+orders[which]+'/local-relay-receipt')
    .set('Authorization','Bearer '+auth)
    .send({physical_received:true,note:'Unités présentes et contrôlées au relais'});

  beforeAll(async()=>{
    // Teardown executes under one scoped transaction on the disposable PG test DB.
    // Do not bypass immutable physical facts in application routes.
    cleanup=createCleanup({ query:(sql,args)=> {
      if(!cleanupClient)throw new Error('Local test cleanup client unavailable');
      return cleanupClient.query(sql,args);
    } });
    market=(await q("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];
    if(!market)throw new Error('Marché KM requis pour la recette');
    const ids=Object.values(orders);
    // E2E database only: teardown all children first; no production writes.
    // createCleanup is LIFO; register parents first and children last.
    cleanup.trackSql('DELETE FROM relais WHERE id=ANY($1::uuid[])',[[relay,foreignRelay]]);
    cleanup.trackSql('DELETE FROM users WHERE id=ANY($1::uuid[])',[[user,agent,foreignAgent]]);
    cleanup.trackSql('DELETE FROM products WHERE id=ANY($1::uuid[])',[[product,importProduct]]);
    cleanup.trackSql('DELETE FROM local_stock WHERE id=$1',[stock]);
    const childCleanup=[
      'DELETE FROM scans WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM parcel_events WHERE parcel_id IN (SELECT id FROM parcels WHERE order_id=ANY($1::uuid[]))',
      'DELETE FROM parcel_items WHERE parcel_id IN (SELECT id FROM parcels WHERE order_id=ANY($1::uuid[]))',
      'DELETE FROM parcels WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM order_status_history WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM pickup_reveal_codes WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM pickup_print_tokens WHERE order_id=ANY($1::uuid[])',
      "DELETE FROM client_notifications WHERE entity_type='order' AND entity_id=ANY($1::uuid[])",
      'DELETE FROM local_stock_allocations WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM order_items WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM orders WHERE id=ANY($1::uuid[])',
    ];
    for(const sql of childCleanup.reverse())cleanup.trackSql(sql,[ids]);

    await q("INSERT INTO relais (id,name,agent_name,phone,address,market_id) VALUES ($1,$2,'Agent','+269000221','Test',$3),($4,$5,'Agent','+269000222','Test',$3)",
      [relay,tag('relay'),market.id,foreignRelay,tag('other'),]);
    await q("INSERT INTO users (id,full_name,email,phone,role) VALUES ($1,'Client',$2,$3,'client')",
      [user,tag('buyer')+'@komerce.test','+2693'+String(Date.now()).slice(-7)]);
    await q("INSERT INTO users (id,full_name,email,phone,role,relais_id) VALUES ($1,'Relay Agent',$2,$3,'agent_relais',$4),($5,'Foreign Agent',$6,$7,'agent_relais',$8)",
      [agent,tag('agent')+'@komerce.test','+2694'+String(Date.now()).slice(-7),relay,
       foreignAgent,tag('foreign')+'@komerce.test','+2695'+String(Date.now()).slice(-7),foreignRelay]);
    await q("INSERT INTO products (id,name,price_kmf,stock) VALUES ($1,$2,10000,0),($3,$4,10000,0)",
      [product,tag('local-product'),importProduct,tag('import-product')]);
    await q("INSERT INTO local_stock (id,product_id,market_id,location,qty_physical,commercial_exposure) VALUES ($1,$2,$3,'KM_MAIN',0,'ENABLED')",
      [stock,product,market.id]);
    for(const which of Object.keys(orders)) {
      await q("INSERT INTO orders (id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur) VALUES ($1,$2,$3,$4,$5,'confirmed',$6,'cash_relais',20000,40)",
        [orders[which],user,relay,market.id,refs[which],which==='unpaid'?'pending':'paid']);
    }
    const lines=[
      [items.local,orders.local,product,2,'LOCAL_STOCK'],
      [items.mixedLocal,orders.mixed,product,1,'LOCAL_STOCK'],
      [items.mixedImport,orders.mixed,importProduct,1,'IMPORT'],
      [items.unpaid,orders.unpaid,product,1,'LOCAL_STOCK'],
    ];
    for(const row of lines)await q(
      'INSERT INTO order_items (id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES ($1,$2,$3,$4,10000,$5)',row);
    for(const which of ['local','mixed']) await q(
      'INSERT INTO local_stock_allocations (local_stock_id,order_id,quantity,consumed_at) VALUES ($1,$2,$3,NOW())',
      [stock,orders[which],which==='local'?2:1]);
    token=signAuthToken({id:agent,role:'agent_relais'},{method:'e2e'});
    foreignToken=signAuthToken({id:foreignAgent,role:'agent_relais'},{method:'e2e'});
    app=express();app.use(require('cookie-parser')());app.use(express.json());
    app.use('/api/orders',require('../../routes/orders/status'));
    app.use('/api/pickup',require('../../routes/pickup-secret'));
    app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:err.message}));
  });
  afterAll(async()=>{
    if(!cleanup)return;
    // Physical parcel/history deletion is intentionally forbidden in runtime.
    // This cleanup is permitted ONLY on an isolated loopback *test* database.
    const target=assertTestDatabase();
    if(!['localhost','127.0.0.1','::1'].includes(target.host)) {
      throw new Error('Refus du teardown avec triggers désactivés hors PostgreSQL test local');
    }
    const client=await db.getClient();
    let inTx=false;
    try {
      await client.query('BEGIN');inTx=true;
      // SET LOCAL never outlives this transaction and cannot weaken runtime guards.
      await client.query('SET LOCAL session_replication_role = replica');
      cleanupClient=client;
      await cleanup.run();
      await client.query('COMMIT');inTx=false;
    }catch(error){
      if(inTx)await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{
      cleanupClient=null;
      client.release();
    }
  });

  test('paid local -> receipt proof -> available -> secure parcel pickup once',async()=>{
    // Une tentative préalable de répartition Hub ne crée JAMAIS un colis
    // local : seule l'attestation relais peut le faire après preuve physique.
    const preHub = await require('../../services/auto-parcel').distributeOrder(orders.local);
    expect(preHub).toMatchObject({ success: true, nothing_eligible: true, local_direct_items: 1 });
    expect((await q('SELECT count(*)::int AS n FROM parcel_items WHERE order_item_id=$1',
      [items.local])).rows[0].n).toBe(0);
    const secret=await generateAndStoreSecret({orderId:orders.local,relaisId:relay,channel:'cash_relais'});
    const response=await send('local');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({success:true,status:'available'});
    const {rows:[state]}=await q('SELECT status FROM orders WHERE id=$1',[orders.local]);
    expect(state.status).toBe('available');
    const {rows:[parcel]}=await q('SELECT status,shipment_id,shipped_at,in_transit_at,relais_id FROM parcels WHERE id=$1',
      [response.body.parcel_id]);
    expect(parcel).toMatchObject({status:'available',shipment_id:null,shipped_at:null,in_transit_at:null,relais_id:relay});
    const {rows:qty}=await q('SELECT qty_received,qty_shipped FROM parcel_items WHERE parcel_id=$1',[response.body.parcel_id]);
    expect(qty).toMatchObject([{qty_received:2,qty_shipped:0}]);
    const {rows:[count]}=await q("SELECT count(*)::int AS n FROM order_status_history WHERE order_id=$1 AND status='available'",[orders.local]);
    expect(count.n).toBe(1);
    const {rows:[physical]}=await q('SELECT count(*)::int AS n FROM scans WHERE order_id=$1 AND step=\'relais_received\'',[orders.local]);
    expect(physical.n).toBe(1);
    const {rows:[po]}=await q('SELECT count(*)::int AS n FROM purchase_orders WHERE order_id=$1',[orders.local]);
    expect(po.n).toBe(0);
    const again=await send('local');
    expect(again.status).toBe(409);
    const collected=await request(app).post('/api/pickup/collect/'+orders.local)
      .set('Authorization','Bearer '+token)
      .send({collected_by_name:'Client',pickup_code:secret.code});
    expect(collected.status).toBe(200);
    const {rows:[after]}=await q('SELECT status FROM orders WHERE id=$1',[orders.local]);
    expect(after.status).toBe('collected');
  });
  test('mixed: local pickup now, import remains outstanding, then second one-shot pickup',async()=>{
    const secret=await generateAndStoreSecret({orderId:orders.mixed,relaisId:relay,channel:'cash_relais'});
    const local=await send('mixed');
    expect(local.status).toBe(200);
    const {rows:localLines}=await q(
      'SELECT pi.order_item_id, pi.qty_received, pi.qty_shipped FROM parcel_items pi WHERE pi.parcel_id=$1',
      [local.body.parcel_id]);
    expect(localLines).toMatchObject([{order_item_id:items.mixedLocal,qty_received:1,qty_shipped:0}]);
    const first=await request(app).post('/api/pickup/collect/'+orders.mixed)
      .set('Authorization','Bearer '+token)
      .send({collected_by_name:'Client',pickup_code:secret.code});
    expect(first.status).toBe(200);
    const {rows:[partial]}=await q('SELECT status FROM orders WHERE id=$1',[orders.mixed]);
    expect(partial.status).toBe('available');
    const {rows:[localParcel]}=await q('SELECT status FROM parcels WHERE id=$1',[local.body.parcel_id]);
    expect(localParcel.status).toBe('collected');
    // The new one-shot secret is issued atomically after partial pickup.
    const {rows:[next]}=await q('SELECT code FROM pickup_reveal_codes WHERE order_id=$1',[orders.mixed]);
    expect(next?.code).toBeTruthy();
    expect(next.code).not.toBe(secret.code);
    // The import parcel is initially empty: the physical-proof guard MUST
    // reject quantities unsupported by an actual Hub receipt and KOM-BOX
    // placement. This spec tests pickup reconciliation, NOT a full customs /
    // transitaire E2E journey; those are certified separately.
    const importParcel=uuid();
    await q("INSERT INTO parcels (id,order_id,reference,type,status,relais_id) VALUES ($1,$2,$3,'standard','preparation',$4)",
      [importParcel,orders.mixed,'E2E-LR-'+tag('import-parcel'),relay]);
    await q("INSERT INTO parcel_items (parcel_id,order_item_id,product_id,quantity) VALUES ($1,$2,$3,1)",
      [importParcel,items.mixedImport,importProduct]);
    await expect(q('UPDATE parcel_items SET qty_allocated=1 WHERE parcel_id=$1 AND order_item_id=$2',
      [importParcel,items.mixedImport])).rejects.toThrow(/parcel_item_no_physical_proof/);

    // Minimal real-Postgres fixture for the *separate* import leg:
    // PO -> purchase allocation -> supplier receipt -> physical KOM-BOX.
    // No bypass of the runtime trigger, no fictitious qty_shipped for LOCAL.
    const supplier=uuid(),sku=uuid(),po=uuid(),allocation=uuid(),unit=uuid(),box=uuid();
    const hubRef=tag('mixed-import-hub');
    const supplierIdentity={provider:'manual',version:1,payload:{supplier_sku:hubRef}};
    // The teardown already uses a transaction-scoped disabled-trigger role
    // on the disposable localhost PostgreSQL. Register physical children in
    // LIFO order, ahead of existing order/parcel fixture cleanup.
    cleanup.trackSql('DELETE FROM suppliers WHERE id=$1',[supplier]);
    cleanup.trackSql('DELETE FROM product_skus WHERE id=$1',[sku]);
    cleanup.trackSql('DELETE FROM purchase_orders WHERE id=$1',[po]);
    cleanup.trackSql('DELETE FROM hub_physical_units WHERE id=ANY($1::uuid[])',[[unit,box]]);
    cleanup.trackSql('DELETE FROM international_shipments WHERE reference LIKE $1',[hubRef+'-SHIP%']);
    cleanup.trackSql('DELETE FROM international_shipment_hub_units WHERE physical_unit_id=ANY($1::uuid[])',[[unit,box]]);
    cleanup.trackSql('DELETE FROM hub_purchase_allocations WHERE id=$1',[allocation]);
    cleanup.trackSql('DELETE FROM hub_physical_unit_placements WHERE allocation_id=$1',[allocation]);

    await q("INSERT INTO suppliers (id,name,platform) VALUES ($1,$2,'cj')",[supplier,hubRef]);
    await q(`INSERT INTO product_skus
      (id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
      VALUES ($1,$2,$3,0,TRUE,'SUPPLIER',$4,$4,$5::jsonb)`,
      [sku,importProduct,'K-'+hubRef,hubRef,JSON.stringify(supplierIdentity)]);
    await q(`INSERT INTO purchase_orders
      (id,order_id,order_item_id,product_sku_id,supplier_id,supplier_sku,supplier_unit_ref,supplier_order_identity,qty,status)
      VALUES ($1,$2,$3,$4,$5,$6,$6,$7::jsonb,1,'confirmed')`,
      [po,orders.mixed,items.mixedImport,sku,supplier,hubRef,JSON.stringify(supplierIdentity)]);
    await q(`INSERT INTO hub_purchase_allocations
      (id,purchase_order_id,order_id,order_item_id,product_sku_id,supplier_id,supplier_unit_ref,supplier_order_identity,quantity,market_id,destination_ref)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,$9,$10)`,
      [allocation,po,orders.mixed,items.mixedImport,sku,supplier,hubRef,JSON.stringify(supplierIdentity),market.id,'relais:'+relay]);
    await q(`INSERT INTO hub_physical_units
      (id,reference,unit_type,state,external_ref,current_location_ref)
      VALUES ($1,$2,'SUPPLIER_PACKAGE','RECEIVED',$2,'DXB-HUB')`,[unit,hubRef]);
    // Le Hub exige RECEIVED comme état initial. Le marché de KOM-BOX est
    // ensuite dérivé des allocations au passage PACKED, jamais à l'INSERT.
    await q(`INSERT INTO hub_physical_units
      (id,reference,unit_type,state,current_location_ref)
      VALUES ($1,$2,'MARKET_PARCEL','RECEIVED','DXB-HUB')`,[box,hubRef+'-BOX']);
    await q("INSERT INTO hub_physical_unit_placements (physical_unit_id,allocation_id,quantity,operation_type) VALUES ($1,$2,1,'RECEIVE')",[unit,allocation]);
    // Une allocation ne peut pas être simultanément active dans le colis
    // fournisseur ET la KOM-BOX. Clôturer la source avant REPACK.
    await q(`UPDATE hub_physical_unit_placements
      SET removed_at=GREATEST(clock_timestamp(),placed_at+INTERVAL '1 microsecond')
      WHERE physical_unit_id=$1 AND allocation_id=$2 AND removed_at IS NULL`,[unit,allocation]);
    await q("INSERT INTO hub_physical_unit_placements (physical_unit_id,allocation_id,quantity,operation_type) VALUES ($1,$2,1,'REPACK')",[box,allocation]);
    // Transitions canoniques, dans l'ordre strict imposé par PostgreSQL.
    for(const state of ['IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED','PACKED'])
      await q('UPDATE hub_physical_units SET state=$1 WHERE id=$2',[state,box]);
    const {rows:[boxIdentity]}=await q('SELECT state,market_id FROM hub_physical_units WHERE id=$1',[box]);
    expect(boxIdentity).toMatchObject({state:'PACKED',market_id:market.id});
    const {rows:[proof]}=await q('SELECT received,boxed FROM hub_item_physical_proof($1)',[items.mixedImport]);
    expect(proof).toMatchObject({received:1,boxed:1});
    const {rows:[beforeShipment]}=await q(
      'SELECT qty_allocated,qty_packed,qty_shipped,qty_received FROM parcel_items WHERE parcel_id=$1 AND order_item_id=$2',
      [importParcel,items.mixedImport]);
    expect(beforeShipment).toMatchObject({qty_allocated:1,qty_packed:1,qty_shipped:0,qty_received:0});
    // Carrier/relay evidence is outside this scoped spec; transition here
    // represents arrival after the separately certified physical leg.
    // « Expédié » = remis au transitaire (migration 370) : le carton rejoint une expédition puis la remise est constatée.
    const {rows:[shipment]}=await q(
      "INSERT INTO international_shipments(market_id,reference,created_by,hub_draft) VALUES ($1,$2,$3,TRUE) RETURNING id",
      [market.id,hubRef+'-SHIP',String(agent)]);
    await q('INSERT INTO international_shipment_hub_units(shipment_id,physical_unit_id) VALUES ($1,$2)',[shipment.id,box]);
    await q("UPDATE hub_physical_units SET state='DISPATCHED' WHERE id=$1",[box]);
    await q("UPDATE international_shipments SET stage='handed_over',forwarder_name='Transitaire',transport_mode='sea' WHERE id=$1",[shipment.id]);
    // La réception import n'est constatée que par l'attestation immuable du relais (migration 371).
    await q("UPDATE international_shipments SET stage='local_delivery' WHERE id=$1",[shipment.id]);
    await q(`INSERT INTO international_shipment_relay_receipts (shipment_id,order_item_id,relais_id,expected_qty,received_qty,received_by,proof_ref)
      SELECT $1,$2,o.relais_id,1,1,$3,'E2E-ATT' FROM orders o WHERE o.id=$4`,[shipment.id,items.mixedImport,String(agent),orders.mixed]);
    await q(`UPDATE parcel_items SET qty_received=1,verified=TRUE
      WHERE parcel_id=$1 AND order_item_id=$2`,[importParcel,items.mixedImport]);
    await q("UPDATE parcels SET status='available',available_at=NOW() WHERE id=$1",[importParcel]);
    const second=await request(app).post('/api/pickup/collect/'+orders.mixed)
      .set('Authorization','Bearer '+token)
      .send({collected_by_name:'Client',pickup_code:next.code});
    expect(second.status).toBe(200);
    const {rows:[complete]}=await q('SELECT status FROM orders WHERE id=$1',[orders.mixed]);
    expect(complete.status).toBe('collected');
    const {rows:[history]}=await q("SELECT COUNT(*)::int AS n FROM order_status_history WHERE order_id=$1 AND status='collected'",[orders.mixed]);
    expect(history.n).toBe(1);
  });
  test('foreign relay and unpaid orders cannot attest, including on mixed checkout',async()=>{
    expect((await send('unpaid')).status).toBe(409);
    expect((await send('mixed',foreignToken)).status).toBe(403);
  });
});
