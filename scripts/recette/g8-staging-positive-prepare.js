'use strict';
/** @komerce-arch
 * @role g8-official-staging-positive-fixture
 * @domain refunds
 * @layer test-tooling
 * @criticality high
 * @inputs pinned official staging database, owner-authorized RUN8
 * @outputs synthetic scoped F1/F2 orders and isolated test credentials
 * @depends hub-v1-certification-runner, target-guard
 * @db-write only E2E-HUB-V1-scope fixture on official disposable Railway staging
 * @doctrine no_actual_cash_no_provider_call_no_production
 * @impact-areas refunds, cash-custody, financial-receipts
 * @version 2026-11
 */
const crypto=require('crypto'),fs=require('fs'),path=require('path'),bcrypt=require('bcryptjs');
const db=require('../../db'),runner=require('./hub-v1-certification-runner');
const {confirmTarget}=require('./target-guard');
const uuid=()=>crypto.randomUUID();
const ROOT='test-results/g8-staging-positive';
function assertStaging(){
 const e=process.env;
 if(e.GITHUB_ACTOR!==e.GITHUB_REPOSITORY_OWNER ||
    e.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||
    e.G8_STAGING_SYNTHETIC_APPROVED!=='1'||
    e.KOMERCE_ENV!=='staging'||e.KOMERCE_TARGET_ENV!=='staging'||
    e.NODE_ENV!=='test'||e.KOMERCE_DISABLE_CRONS!=='true'||
    e.HUB_V1_STAGING_DISPOSABLE_MODE!=='1'||
    e.HUB_V1_E2E_APPLY_MODE!=='approved'||
    e.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'||
    e.STAGING_BASE_URL!=='https://komerce-backend-production.up.railway.app'||
    !/^[A-F0-9]{8}$/.test(e.HUB_V1_CERTIFICATION_RUN||'')||
    !/^[0-9a-f]{40}$/i.test(e.E2E_EXPECTED_DEPLOY_SHA||'')||
    !e.GITHUB_ENV)
   throw Error('G8_OFFICIAL_STAGING_OWNER_APPROVAL_MISSING');
 const url=new URL(String(e.DATABASE_URL||''));
 if(['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname))
   throw Error('G8_NOT_OFFICIAL_RAILWAY_DATABASE');
 return e.HUB_V1_CERTIFICATION_RUN;
}
async function main(){
 const run=assertStaging();
 const attested=await confirmTarget({db});
 if(attested.confirmed!==true)throw Error('G8_STAGING_DATABASE_IDENTITY_INVALID');
 const v=await fetch(process.env.STAGING_BASE_URL+'/health/version');
 const current=await v.json();
 if(!v.ok||current.commit!==process.env.E2E_EXPECTED_DEPLOY_SHA)
   throw Error('G8_DEPLOY_SHA_MISMATCH_BEFORE_WRITES');
 // Every checkout is canonical and simulated. The official runner verifies its
 // own 10 mandatory preflight controls before writing ANY fixture record.
 const seeded=await runner.runCertification({
   db,run,argv:['node','g8','--allow-remote-staging','--run='+run,'--market=KM','--stop-after=2']
 });
 if(seeded.verdict!=='PARTIAL_STOP_AFTER_STEP_PASS'||seeded.steps.length!==2||
    !seeded.steps.every(s=>s.status==='PASS')||
    seeded.external_effects?.zero_external_effects!==true)
   throw Error('G8_CANONICAL_STAGING_FIXTURE_NOT_PROVEN:'+seeded.verdict);
 const orders={};
 for(const key of ['KOM-101','KOM-102']){
  const rows=(await db.query(
   "SELECT id,reference,total_kmf,market_id,relais_id,payment_status,simulation_scope FROM orders WHERE reference=$1 AND simulation_scope='E2E-HUB-V1'",
   [runner.orderRef(run,key)])).rows;
  if(rows.length!==1||rows[0].payment_status!=='paid')throw Error('G8_NOT_PAID_TEST_ORDER_'+key);
  const items=(await db.query(
   'SELECT id,quantity,price_kmf,qty_collected FROM order_items WHERE order_id=$1 ORDER BY id',[rows[0].id])).rows;
  if(!items.length||Number(items[0].qty_collected)!==0)throw Error('G8_TEST_ORDER_LINE_INVALID_'+key);
  orders[key]={...rows[0],item:items[0]};
 }
 const ids={admin:seeded.fixture.users.admin.id,relay:seeded.fixture.users.relay_agent.id};
 if(!ids.admin||!ids.relay||ids.admin===ids.relay)throw Error('G8_F1_ROLES_INVALID');
 const users={admin:{id:ids.admin,email:runner.emailOf(run,'admin')},
   relay:{id:ids.relay,email:runner.emailOf(run,'agent-relais')}};
 for(const role of ['operator','reviewer']){
  const id=uuid(),email='e2e-g8-'+run.toLowerCase()+'-'+role+'@komerce.test';
  await db.query("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,'admin')",
   [id,'E2E G8 STAGING '+role,email,runner.phoneOf(run,role==='operator'?82:83)]);
  ids[role]=id;users[role]={id,email};
 }
 const password=crypto.randomBytes(24).toString('base64url')+'Aa1!';
 console.log('::add-mask::'+password);
 for(const user of Object.values(users)){
  const update=await db.query(
   'UPDATE users SET password_hash=$1,account_activation_required=FALSE WHERE id=$2 AND lower(email)=lower($3)',
   [await bcrypt.hash(password,10),user.id,user.email]);
  if(update.rowCount!==1)throw Error('G8_TEST_USER_SCOPE_CONFLICT');
 }
 const cash=orders['KOM-101'],source=orders['KOM-102'];
 const mm={...source,id:uuid(),reference:'E2E-HUB-V1-'+run+'-MOBILE',
   item:{...source.item,id:uuid()}};
 const nativeAmount=String(mm.total_kmf).split('.')[0],capture='G8-SYNTH-CAPTURE-'+run;
 // FX snapshot is immutable. Source MM payment type, synthetic reference and
 // commercial snapshot are all fixed at INSERT; never UPDATE an existing order.
 await db.query(
  "INSERT INTO orders(id,reference,user_id,market_id,relais_id,total_kmf,payment_mode,payment_status,status,fx_snapshot,simulation_scope) VALUES($1,$2,$3,$4,$5,$6,'mobile_money','paid','confirmed',$7::jsonb,'E2E-HUB-V1')",
  [mm.id,mm.reference,seeded.fixture.users.client.id,mm.market_id,mm.relais_id,mm.total_kmf,
   JSON.stringify({market:{market_id:mm.market_id,currency:'KMF',minor_unit:0,amount_text:nativeAmount}})]
 );
 await db.query(
  'INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) SELECT $1,$2,product_id,quantity,price_kmf,sku_id,fulfillment_source FROM order_items WHERE id=$3',
  [mm.item.id,mm.id,source.item.id]);
 await db.query('INSERT INTO cash_collections(id,order_id,amount_kmf,collected_by,relais_id) VALUES($1,$2,$3,$4,$5)',
  [uuid(),cash.id,String(cash.total_kmf),ids.relay,cash.relais_id]);
 await db.query(
  "INSERT INTO mobile_money_transactions(id,order_id,market_id,provider,status,currency,minor_unit,amount_minor,external_transaction_id) VALUES($1,$2,$3,'orange_money','succeeded','KMF',0,$4,$5)",
  [uuid(),mm.id,mm.market_id,nativeAmount,capture]);
 const cases={};
 for(const [label,order] of [['cash',cash],['mobile',mm]]){
  const incident=uuid();
  await db.query(
   "INSERT INTO incidents(id,order_id,order_item_id,incident_type,title,description,details,origin_domain,resolver_domain,resolution_class,detected_source) VALUES($1,$2,$3,'reconciliation_error',$4,'SYNTHETIC ONLY - NO ACTUAL GOODS OR PAYMENT',$5::jsonb,'PURCHASING','ORDERS','UPSTREAM_TRUTH','admin')",
   [incident,order.id,order.item.id,'G8 STAGING E2E SYNTHETIC '+run,
    JSON.stringify({type:'supplier_shortage',missing_quantity:1,run})]);
  cases[label]={orderId:order.id,itemId:order.item.id,reference:order.reference,
    itemQuantity:order.item.quantity,incidentId:incident};
 }
 cases.mobile.captureRef=capture;
 const plan={kind:'G8_OFFICIAL_STAGING_SYNTHETIC',run,staging_go:false,
  stage:'READY_FOR_REAL_BROWSER',deployed_sha:current.commit,
  cases,ids,emails:Object.fromEntries(Object.entries(users).map(([k,v])=>[k,v.email])),
  noRealTransfers:true,noPhysicalCashHandover:true,
  scope:'E2E-HUB-V1',externalEffects:seeded.external_effects};
 fs.mkdirSync(ROOT,{recursive:true});
 fs.writeFileSync(path.join(ROOT,'prepare.json'),JSON.stringify(plan,null,2)+'\n');
 const env={G8_RUN8:run,G8_ADMIN_EMAIL:users.admin.email,G8_RELAY_EMAIL:users.relay.email,
  G8_OPERATOR_EMAIL:users.operator.email,G8_REVIEWER_EMAIL:users.reviewer.email,
  G8_PASSWORD:password};
 fs.appendFileSync(process.env.GITHUB_ENV,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});
 console.log(JSON.stringify({verdict:'G8_STAGING_SYNTHETIC_READY',run,orders:2,actors:4,
  testedRuntimeSha:current.commit,realMoney:0}));
}
main().catch(e=>{console.error('G8_STAGING_PREP_FAIL:'+String(e.message).slice(0,300));process.exitCode=2})
 .finally(()=>db.pool?.end?.());
