/** @komerce-arch
 * @role f3-staging-rollback-proof
 * @domain unsold-resolution
 * @layer tooling
 * @criticality high
 * @db-read schema_migrations, pg_trigger, orders, unsold_items, users, relais, markets
 * @db-write orders, unsold_items (single transaction ALWAYS ROLLBACK)
 * @doctrine fail_closed, target_confirmed_first, no_provider_effect, never_persistent_fixture
 */
'use strict';
const fs=require('fs'),crypto=require('crypto'),db=require('../../db');
const {confirmTarget}=require('./target-guard');
const BASE='https://komerce-backend-production.up.railway.app';
const RUN8=crypto.randomBytes(4).toString('hex').toUpperCase();
const report={kind:'F3_STAGING_NEGATIVE_HTTP_PG_ROLLBACK',run8:RUN8,verdict:'NOT_PROVEN',business_e2e:false,persistent_writes:false,checks:[]};
const ok=(v,s)=>{if(!v)throw Error(s)};
const step=(name)=>report.checks.push({name,result:'PASS'});
const save=()=>{fs.mkdirSync('test-results/f3-no-show',{recursive:true});fs.writeFileSync('test-results/f3-no-show/report.json',JSON.stringify(report,null,2)+'\n')};
async function reject(client,name,sql,args,match){
 await client.query('SAVEPOINT f3_case');let err;
 try{await client.query(sql,args);}catch(e){err=e;}
 finally{await client.query('ROLLBACK TO SAVEPOINT f3_case');await client.query('RELEASE SAVEPOINT f3_case');}
 ok(err?.code==='23514'&&err.message.includes(match),name+'_SQL_NOT_REJECTED');step(name);
}
async function proof(){
 const e=process.env;
 ok(e.GITHUB_EVENT_NAME==='issues'&&e.GITHUB_ACTOR===e.GITHUB_REPOSITORY_OWNER&&
 e.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&e.NODE_ENV==='test'&&
 e.KOMERCE_ENV==='staging'&&e.KOMERCE_TARGET_ENV==='staging'&&
 e.KOMERCE_DISABLE_CRONS==='true'&&e.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
 e.STAGING_BASE_URL===BASE&&e.F3_CERT_CONFIRMATION==='F3-ROLLBACK-ONLY'&&
 e.E2E_ADMIN_EMAIL&&e.E2E_ADMIN_PASSWORD&&e.DATABASE_URL,'F3_OWNER_STAGING_GUARD');
 const version=await(await fetch(BASE+'/health/version')).json();
 ok(/^[a-f0-9]{40}$/i.test(version.commit||'')&&version.commit===e.E2E_EXPECTED_DEPLOY_SHA,'STAGING_SHA_MISMATCH');
 report.sha=version.commit;
 ok((await confirmTarget({db})).confirmed,'TARGET_DB_FINGERPRINT_MISMATCH');step('staging_identity');
 const client=await db.getClient();let tx=false;
 const refs=['F3-ROLLBACK-'+RUN8+'-A','F3-ROLLBACK-'+RUN8+'-B','F3-ROLLBACK-'+RUN8+'-BAD'];
 try{
   const m=await client.query("SELECT filename FROM schema_migrations WHERE filename IN ('415_paid_no_show_liquidation_guard.sql','419_paid_no_show_payment_transition_guard.sql')");
   ok(m.rows.length===2,'F3_MIGRATION_415_OR_419_MISSING');
   const t=await client.query("SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid IN ('orders'::regclass,'unsold_items'::regclass) AND tgname IN ('trg_guard_paid_no_show_order','trg_guard_paid_unsold_item') AND NOT tgisinternal");
   ok(t.rows.length===2&&t.rows.every(x=>['O','A'].includes(x.tgenabled)),'F3_DB_TRIGGERS_MISSING');
   ok(t.rows.find(x=>x.tgname==='trg_guard_paid_no_show_order').def.includes('INSERT'),'F3_ORDER_INSERT_NOT_PROTECTED');
   step('migrations_415_419_and_triggers');
   const historic=await client.query("SELECT COUNT(*)::int AS n FROM unsold_items ui JOIN orders o ON o.id=ui.order_id WHERE o.payment_status='paid'");
   ok(historic.rows[0].n===0,'HISTORIC_PAID_UNSOLD_PRESENT');step('historical_no_double_sale');
   const user=(await client.query("SELECT id FROM users WHERE role='admin' LIMIT 1")).rows[0];
   const market=(await client.query("SELECT id FROM markets WHERE code='KM'")).rows[0];
   ok(user?.id&&market?.id,'F3_USERS_MARKET_MISSING');
   const relay=(await client.query('SELECT id FROM relais WHERE market_id=$1 LIMIT 1',[market.id])).rows[0];
   ok(relay?.id,'F3_RELAY_MISSING');
   await client.query('BEGIN');tx=true;
   await client.query("SET LOCAL statement_timeout='8000ms'");
   const paid=crypto.randomUUID(),unpaid=crypto.randomUUID();
   await client.query("INSERT INTO orders(id,reference,user_id,relais_id,market_id,total_kmf,payment_mode,payment_status,status,available_at) VALUES($1,$2,$3,$4,$5,8000,'cash_relais','paid','available',NOW()-INTERVAL '20 days')",[paid,refs[0],user.id,relay.id,market.id]);
   await reject(client,'paid_unsold_at_rejected','UPDATE orders SET unsold_at=NOW() WHERE id=$1',[paid],'UNSOLD_PAID_ORDER_PROTECTED');
   await reject(client,'paid_unsold_item_rejected',"INSERT INTO unsold_items(order_id,product_name,original_price_kmf,unsold_price_kmf) VALUES($1,'protected',8000,6000)",[paid],'UNSOLD_PAID_ITEM_PROTECTED');
   await reject(client,'paid_insert_with_unsold_at_rejected',"INSERT INTO orders(id,reference,user_id,relais_id,market_id,total_kmf,payment_mode,payment_status,status,unsold_at) VALUES($1,$2,$3,$4,$5,8000,'cash_relais','paid','available',NOW())",[crypto.randomUUID(),refs[2],user.id,relay.id,market.id],'UNSOLD_PAID_ORDER_PROTECTED');
   await client.query("INSERT INTO orders(id,reference,user_id,relais_id,market_id,total_kmf,payment_mode,payment_status,status,unsold_at) VALUES($1,$2,$3,$4,$5,8000,'cash_relais','pending','available',NOW())",[unpaid,refs[1],user.id,relay.id,market.id]);
   await client.query("INSERT INTO unsold_items(order_id,product_name,original_price_kmf,unsold_price_kmf) VALUES($1,'pending',8000,6000)",[unpaid]);
   await reject(client,'unsold_pending_to_paid_rejected',"UPDATE orders SET payment_status='paid' WHERE id=$1",[unpaid],'UNSOLD_PAID_ORDER_PROTECTED');
 }finally{
   if(tx)await client.query('ROLLBACK').catch(()=>{});
   const c=await client.query('SELECT COUNT(*)::int AS n FROM orders WHERE reference=ANY($1::text[])',[refs]).catch(()=>null);
   ok(c&&c.rows[0].n===0,'F3_ROLLBACK_NOT_CLEAN');step('no_persistent_fixture');
   client.release();
 }
 const auth=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{origin:BASE,'content-type':'application/json'},
  body:JSON.stringify({email:e.E2E_ADMIN_EMAIL,password:e.E2E_ADMIN_PASSWORD})});
 const body=await auth.json().catch(()=>({}));
 ok(auth.status===200&&body.user?.role==='admin','F3_ADMIN_LOGIN_FAIL');
 const cookie=(auth.headers.get('set-cookie')||'').split(';')[0];ok(cookie.includes('='),'F3_COOKIE_MISSING');
 const anon=await fetch(BASE+'/api/unsold/scan',{method:'POST',headers:{origin:BASE}});
 ok(anon.status===401,'F3_ANONYMOUS_SCAN_NOT_401');step('anonymous_401');
 const scan=await fetch(BASE+'/api/unsold/scan',{method:'POST',headers:{origin:BASE,cookie,'content-type':'application/json'},body:'{}'});
 const reply=await scan.json().catch(()=>({}));
 ok(scan.status===409&&reply.code==='UNSOLD_NO_SHOW_NOT_CERTIFIED','F3_ADMIN_SCAN_NOT_409');step('admin_409');
 const end=await(await fetch(BASE+'/health/version')).json();ok(end.commit===version.commit,'F3_SHA_DRIFT');
 report.verdict='PASS_NEGATIVE_STAGING_HTTP_PG_ROLLBACK_ONLY';
 report.remaining='A real paid-not-collected parcel followed by authentic Chromium pickup remains NOT_PROVEN; no full F3 lifecycle certification.';
}
(async()=>{try{await proof();}catch(x){report.error=String(x.code||x.message).slice(0,200);process.exitCode=2;}
finally{save();await db.pool.end();console.log(JSON.stringify(report));}})();
