'use strict';
/** @komerce-arch
 * @role g8-isolated-positive-fixture
 * @domain refunds
 * @layer tooling
 * @criticality high
 * @inputs disposable localhost PG16 canonical runner
 * @outputs synthetic cash/MM paid orders, four test actors
 * @depends scripts/recette/hub-v1-certification-runner.js
 * @db-write disposable postgres only
 * @doctrine no real cash or provider transaction
 * @impact-areas refunds,cash-custody
 * @version 2026-11
 */
const crypto=require('crypto'),fs=require('fs'),path=require('path'),bcrypt=require('bcryptjs');
const db=require('../../db'),runner=require('./hub-v1-certification-runner'),uuid=()=>crypto.randomUUID();
async function main(){
 runner.assertEphemeralTarget(process.env.DATABASE_URL,[]);
 if(process.env.G8_ISOLATED_LOCAL!=='1'||process.env.GITHUB_ACTIONS!=='true'||
    process.env.NODE_ENV!=='test'||process.env.KOMERCE_ENV!=='test'||
    process.env.STAGING_BASE_URL||process.env.E2E_STAGING_BASE_URL||!process.env.GITHUB_ENV)
      throw Error('G8_DISPOSABLE_ONLY');
 const run=runner.newRun8(),s=await runner.runCertification({db,run,argv:['node','g8','--market=KM','--stop-after=2']});
 if(s.verdict!=='PARTIAL_STOP_AFTER_STEP_PASS'||!s.external_effects?.zero_external_effects)
   throw Error('G8_CANONICAL_FIXTURE_INVALID:'+s.verdict);
 const orders={};
 for(const key of ['KOM-101','KOM-102']){
  const o=(await db.query('SELECT id,reference,total_kmf,market_id,relais_id,payment_status FROM orders WHERE reference=$1 AND simulation_scope=$2',
   [runner.orderRef(run,key),'E2E-HUB-V1'])).rows;
  if(o.length!==1||o[0].payment_status!=='paid')throw Error('G8_NOT_PAID_'+key);
  const i=(await db.query('SELECT id,quantity,price_kmf,qty_collected FROM order_items WHERE order_id=$1 ORDER BY id',[o[0].id])).rows[0];
  if(!i||Number(i.qty_collected)!==0)throw Error('G8_BAD_ITEM_'+key);
  orders[key]={...o[0],item:i};
 }
 const ids={admin:s.fixture.users.admin.id,relay:s.fixture.users.relay_agent.id};
 const users={admin:{id:ids.admin,email:runner.emailOf(run,'admin')},
 relay:{id:ids.relay,email:runner.emailOf(run,'agent-relais')}};
 for(const label of ['operator','reviewer']){
  const id=uuid(),email='e2e-g8-'+run.toLowerCase()+'-'+label+'@komerce.test';
  await db.query("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,'admin')",
   [id,'G8 isolated '+label,email,runner.phoneOf(run,label==='operator'?82:83)]);
  ids[label]=id;users[label]={id,email};
 }
 const pwd=crypto.randomBytes(24).toString('base64url')+'Aa1!';
 console.log('::add-mask::'+pwd);
 for(const user of Object.values(users)){
  await db.query('UPDATE users SET password_hash=$1,account_activation_required=false WHERE id=$2',
    [await bcrypt.hash(pwd,10),user.id]);
 }
 const cash=orders['KOM-101'],source=orders['KOM-102'];
 // Snapshot is immutable after INSERT; never mutate a pre-existing paid order.
 // Create a dedicated synthetic Mobile Money order with its original rail and FX snapshot.
 const mm={...source,id:uuid(),reference:'E2E-HUB-V1-'+run+'-MOBILE',
   item:{...source.item,id:uuid()}};
 const mAmount=String(mm.total_kmf).split('.')[0],capture='G8-SYNTH-CAPTURE-'+run;
 const fx=JSON.stringify({market:{market_id:mm.market_id,currency:'KMF',
   minor_unit:0,amount_text:mAmount}});
 await db.query("INSERT INTO orders(id,reference,user_id,market_id,relais_id,total_kmf,payment_mode,payment_status,status,fx_snapshot,simulation_scope) VALUES($1,$2,$3,$4,$5,$6,'mobile_money','paid','confirmed',$7::jsonb,'E2E-HUB-V1')",
   [mm.id,mm.reference,s.fixture.users.client.id,mm.market_id,mm.relais_id,mm.total_kmf,fx]);
 await db.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) SELECT $1,$2,product_id,quantity,price_kmf,sku_id,fulfillment_source FROM order_items WHERE id=$3",
   [mm.item.id,mm.id,source.item.id]);
 await db.query('INSERT INTO cash_collections(id,order_id,amount_kmf,collected_by,relais_id) VALUES($1,$2,$3,$4,$5)',
   [uuid(),cash.id,String(cash.total_kmf),ids.relay,cash.relais_id]);
 await db.query("INSERT INTO mobile_money_transactions (id,order_id,market_id,provider,status,currency,minor_unit,amount_minor,external_transaction_id) VALUES($1,$2,$3,'orange_money','succeeded','KMF',0,$4,$5)",
   [uuid(),mm.id,mm.market_id,mAmount,capture]);
 const cases={};
 for(const [label,order] of [['cash',cash],['mobile',mm]]){
  const incident=uuid();
  await db.query("INSERT INTO incidents(id,order_id,order_item_id,incident_type,title,description,details,origin_domain,resolver_domain,resolution_class,detected_source) VALUES($1,$2,$3,'reconciliation_error',$4,'SYNTHETIC ONLY - NO REAL GOODS',$5::jsonb,'PURCHASING','ORDERS','UPSTREAM_TRUTH','admin')",
   [incident,order.id,order.item.id,'G8 SYNTHETIC '+run,JSON.stringify({type:'supplier_shortage',missing_quantity:1})]);
  cases[label]={orderId:order.id,itemId:order.item.id,reference:order.reference,
   itemQuantity:order.item.quantity,incidentId:incident};
 }
 cases.mobile.captureRef=capture;
 const dir='test-results/g8-positive-isolated';fs.mkdirSync(dir,{recursive:true});
 const plan={kind:'G8_ISOLATED_SYNTHETIC',staging_go:false,run,cases,ids,
  noRealTransfers:true,noPhysicalCashHandover:true};
 fs.writeFileSync(path.join(dir,'prepare.json'),JSON.stringify(plan,null,2)+'\n');
 const env={G8_RUN8:run,G8_ADMIN_EMAIL:users.admin.email,G8_RELAY_EMAIL:users.relay.email,
  G8_OPERATOR_EMAIL:users.operator.email,G8_REVIEWER_EMAIL:users.reviewer.email,G8_PASSWORD:pwd};
 fs.appendFileSync(process.env.GITHUB_ENV,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});
 console.log(JSON.stringify({ready:true,run,cases:2,actors:4,realMoney:0}));
}
main().catch(e=>{console.error('G8_PREP_FAIL:'+String(e.message).slice(0,350));process.exitCode=2})
.finally(()=>db.pool?.end?.());
