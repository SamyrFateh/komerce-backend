#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-sav-physical-intake-proof
 * @domain        logistics
 * @layer         tooling
 * @criticality   high
 * @inputs        guarded staging DB and dedicated E2E relay/admin accounts
 * @outputs       fail-closed report, no persistent business fixtures
 * @depends       target-guard.js, relay-product-return-intake-service.js
 * @db-read       schema_migrations, pg_trigger, users, markets, products, disputes, relay_product_return_receipts
 * @db-write      synthetic orders/items/disputes/receipts only inside outer transaction ALWAYS ROLLBACK
 * @db-txn        single uncommitted outer transaction; service COMMIT mapped to inner SAVEPOINT release
 * @doctrine      no_payment_writes, staging_only, no_persistent_recette_pollution, target_confirmed_first
 * @impact-areas  staging, logistics, orders, dashboard, refunds
 */
const fs = require('fs');
const crypto = require('crypto');
const db = require('../../db');
const {confirmTarget} = require('./target-guard');
const intake = require('../../services/relay-product-return-intake-service');

const BASE = 'https://komerce-backend-production.up.railway.app';
const ABSENT = '00000000-0000-4000-8000-000000000000';
const TAG = 'SAV-CERT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
const uuid = () => crypto.randomUUID();
const report = {schema:'staging-sav-physical-intake/1', scope:'staging', mode:'rollback-only', checks:[], verdict:'NO_GO'};
const ok = (value, code) => { if (!value) throw new Error(code); };
function step(name, detail) { report.checks.push({name, result:'PASS', detail}); }

function guard(env) {
  ok(env.KOMERCE_ENV === 'staging' && env.KOMERCE_TARGET_ENV === 'staging' &&
    env.NODE_ENV === 'test' && env.KOMERCE_DISABLE_CRONS === 'true', 'STAGING_ONLY');
  ok(env.EXPECTED_RAILWAY_ENVIRONMENT === 'staging', 'RAILWAY_ENVIRONMENT_REQUIRED');
  ok(env.STAGING_BASE_URL === BASE, 'STAGING_HOST_MISMATCH');
  ok(env.SAV_CERT_CONFIRMATION === 'SAV-ROLLBACK-ONLY', 'EXACT_CONFIRMATION_REQUIRED');
  ok(env.DATABASE_URL, 'STAGING_DATABASE_SECRET_MISSING');
}

async function login(role, env) {
  const prefix = role === 'admin' ? 'E2E_ADMIN' : 'E2E_AGENT_RELAIS';
  const email = env[prefix + '_EMAIL'], password = env[prefix + '_PASSWORD'];
  ok(email && password, 'E2E_CREDENTIALS_MISSING_' + role);
  // The credentials are supplied by the dedicated E2E_* GitHub secrets, not by a hard-coded email domain.
  // Only HTTP 401/403/404 probes on an absent request are permitted with these sessions.
  ok(/^[^@\s]+@[^@\s]+$/.test(email), 'E2E_EMAIL_FORMAT_INVALID');
  const response = await fetch(BASE + '/api/auth/login', {
    method:'POST', headers:{origin:BASE,'content-type':'application/json'},
    body:JSON.stringify({email,password})
  });
  const body = await response.json().catch(()=>({}));
  ok(response.status === 200 && body.user?.role === role, 'E2E_LOGIN_ROLE_MISMATCH_' + role);
  const cookie = (response.headers.get('set-cookie')||'').split(';')[0];
  ok(cookie && cookie.includes('='), 'E2E_COOKIE_REQUIRED_' + role);
  return cookie;
}

async function probeHttp(env) {
  const relay = await login('agent_relais',env);
  const admin = await login('admin',env);
  const body = JSON.stringify({
    request_id:ABSENT, condition_code:'opened', storage_zone:'A',
    observation:'Certification negative sans dossier existant.'
  });
  async function probe(name,cookie,expected) {
    const response = await fetch(BASE + '/api/relay/returns/intake', {
      method:'POST',headers:{origin:BASE,'content-type':'application/json',...(cookie?{cookie}:{})},body
    });
    ok(response.status === expected, 'HTTP_' + name + '_EXPECTED_' + expected + '_GOT_' + response.status);
    step('HTTP_' + name, 'HTTP ' + expected + ', dossier inexistant; aucune réception possible');
  }
  await probe('anonymous_denied',null,401);
  await probe('admin_denied',admin,403);
  await probe('relay_absent_request_denied',relay,404);
  const list = await fetch(BASE + '/api/relay/returns',{headers:{cookie:relay,origin:BASE}});
  ok(list.status === 200,'HTTP_RELAY_LIST_' + list.status);
  step('HTTP_relay_list','liste des retours accessible à un agent authentifié');
}

async function dbSchema(client) {
  const q = await client.query("SELECT filename FROM public.schema_migrations WHERE filename='401_relay_product_return_intake.sql'");
  ok(q.rowCount===1,'MIGRATION_401_NOT_APPLIED');
  const t=await client.query("SELECT tgname FROM pg_trigger WHERE tgrelid='public.relay_product_return_receipts'::regclass AND NOT tgisinternal");
  const names=new Set(t.rows.map(r=>r.tgname));
  ok(names.has('trg_guard_relay_product_return_receipt') && names.has('trg_immutable_relay_product_return_receipt'),
    'DB_GUARD_OR_IMMUTABILITY_TRIGGER_MISSING');
  step('migration_401_and_triggers','migration appliquée et deux triggers physiques actifs');
}

function txService(client) {
  return {getClient:async()=>({
    release:()=>{},
    query:async (sql,params)=>{
      if (sql==='BEGIN') return client.query('SAVEPOINT sav_service');
      if (sql==='COMMIT') return client.query('RELEASE SAVEPOINT sav_service');
      if (sql==='ROLLBACK') {
        await client.query('ROLLBACK TO SAVEPOINT sav_service');
        return client.query('RELEASE SAVEPOINT sav_service');
      }
      return client.query(sql,params);
    }
  })};
}

async function expectRejected(action,code) {
  try { await action(); } catch(e) { ok(e.code===code,'EXPECTED_'+code+'_GOT_'+String(e.code||e.message).slice(0,80)); return; }
  throw new Error('UNEXPECTED_SUCCESS_' + code);
}

async function expectedPgFailure(client,stmt,values,expected) {
  await client.query('SAVEPOINT sav_raw');
  try {
    await client.query(stmt,values);
    throw new Error('UNEXPECTED_RAW_SQL_SUCCESS');
  } catch(e) {
    ok(e.code===expected,'EXPECTED_SQLSTATE_'+expected+'_GOT_'+String(e.code||e.message).slice(0,80));
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT sav_raw');
    await client.query('RELEASE SAVEPOINT sav_raw');
  }
}

async function dbProof(client) {
  const market = (await client.query("SELECT id FROM markets WHERE code='KM'")).rows[0];
  ok(market?.id,'MARKET_KM_MISSING');
  const admin=uuid(), agentId=uuid(), relayA=uuid(), relayB=uuid(),prod=uuid(),order=uuid(),item=uuid(),request=uuid();
  const q=(sql,params)=>client.query(sql,params);

  await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,'admin')",
    [admin,TAG+' admin',TAG.toLowerCase()+'-admin@komerce.test','+2693'+String(Date.now()).slice(-7)]);
  await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'Agent cert','+2693999991','CIBLE E2E',$3)",
    [relayA,TAG+'-A',market.id]);
  await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'Agent cert','+2693999992','CIBLE E2E',$3)",
    [relayB,TAG+'-B',market.id]);
  await q("INSERT INTO users(id,full_name,email,phone,role,relais_id) VALUES($1,$2,$3,$4,'agent_relais',$5)",
    [agentId,TAG+' relay',TAG.toLowerCase()+'-relay@komerce.test','+2694'+String(Date.now()).slice(-7),relayA]);
  await q("INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,10000,3000,1000,0,100,'SKU')",
    [prod,TAG+' produit']);
  await q("INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur) VALUES($1,$2,$3,$4,$5,'collected','paid','cash_relais',10000,20)",
    [order,admin,relayA,market.id,TAG+'-ORDER']);

  // Only the synthetic line fixture bypasses scan triggers, inside a transaction
  // never committed. Production triggers are restored before any tested writer runs.
  await q("SET LOCAL session_replication_role='replica'");
  try {
    await q("INSERT INTO order_items(id,order_id,product_id,quantity,qty_collected,price_kmf) VALUES($1,$2,$3,1,1,10000)",
      [item,order,prod]);
  } finally { await q("SET LOCAL session_replication_role='origin'"); }
  await q("INSERT INTO disputes(id,order_id,type,status,description,return_order_item_id,return_quantity,return_reason,created_by) VALUES($1,$2,'product_return','open','Produit E2E à examiner',$3,1,'defective',$4)",
    [request,order,item,admin]);
  step('fixture_rollback_only','ligne et dossier SAV synthétiques non visibles hors transaction');

  const facade=txService(client);
  const actor={id:agentId,role:'agent_relais',relais_id:relayA};
  const other={...actor,relais_id:relayB};
  const payload={requestId:request,condition:'opened',zone:'A',
    observation:'Article repris et contrôlé physiquement au relais E2E.',db:facade};
  await expectRejected(()=>intake.recordIntake({...payload,actor:other}),'RETURN_INTAKE_NOT_FOUND');
  step('wrong_relay_denied','un autre relais ne peut ni voir ni reprendre ce dossier');
  const first=await intake.recordIntake({...payload,actor});
  ok(first.replayed===false && Number(first.receipt.quantity)===1 && first.receipt.storage_zone==='A',
    'PHYSICAL_RECEIPT_INVALID');
  step('physical_receipt_created','preuve distincte avec quantité 1 et zone A');
  const replay=await intake.recordIntake({...payload,actor});
  ok(replay.replayed===true && replay.receipt.id===first.receipt.id,'REPLAY_NOT_IDEMPOTENT');
  step('identical_replay','un seul reçu pour le même geste');
  await expectRejected(()=>intake.recordIntake({...payload,actor,zone:'B'}),'RETURN_INTAKE_ALREADY_RECORDED');
  step('changed_replay_denied','changement de preuve refusé');
  await expectedPgFailure(client,"UPDATE relay_product_return_receipts SET storage_zone='B' WHERE request_id=$1",
    [request],'P0001');
  await expectedPgFailure(client,"DELETE FROM relay_product_return_receipts WHERE request_id=$1",[request],'P0001');
  step('db_immutability','UPDATE et DELETE refusés par triggers PostgreSQL');
  const truth=(await q("SELECT d.status,p.stock,(SELECT COUNT(*)::int FROM relay_product_return_receipts WHERE request_id=$1) AS receipts FROM disputes d JOIN order_items oi ON oi.id=d.return_order_item_id JOIN products p ON p.id=oi.product_id WHERE d.id=$1",[request])).rows[0];
  ok(truth?.status==='open' && Number(truth.stock)===0 && truth.receipts===1,'SIDE_EFFECT_OR_DUPLICATION');
  step('no_implicit_disposition_or_wallet','dossier toujours ouvert et stock vendable nul; service sans writer financier');
  return {product:prod,request};
}

async function run() {
  guard(process.env);
  const target=await confirmTarget({db});
  ok(target.confirmed,'DB_RUNTIME_TARGET_NOT_CONFIRMED');
  step('staging_target','empreinte base identique au service Railway staging');
  const version=await (await fetch(BASE+'/health/version')).json();
  ok(/^[a-f0-9]{40}$/i.test(String(version.commit||'')),'DEPLOY_SHA_UNAVAILABLE');
  report.runtime_sha=version.commit;
  step('runtime_version','SHA staging identifié');
  await probeHttp(process.env);

  const client=await db.getClient();
  let tx=false,ids=null;
  try{
    await dbSchema(client);
    await client.query('BEGIN');tx=true;
    ids=await dbProof(client);
  }finally{
    if(tx) await client.query('ROLLBACK');
    if(ids){
      const check=await client.query("SELECT (SELECT COUNT(*)::int FROM products WHERE id=$1) AS products, (SELECT COUNT(*)::int FROM relay_product_return_receipts WHERE request_id=$2) AS receipts",
        [ids.product,ids.request]);
      ok(check.rows[0].products===0 && check.rows[0].receipts===0,'TRANSACTION_ROLLBACK_NOT_CLEAN');
      step('database_rollback','aucune fixture ni preuve physique conservée sur staging');
    }
    client.release();
  }
  report.verdict='PASS_TRANSACTIONAL_AND_NEGATIVE_HTTP';
  report.remaining='Une attestation HTTP positive avec dossier de recette persistant et le contrôle Chromium authentifié restent à certifier séparément.';
  return report;
}

async function main(){
  try{await run();}
  catch(error){report.failure=String(error.code||error.message).slice(0,180);report.verdict='FAIL_CLOSED';process.exitCode=1;}
  finally{
    fs.mkdirSync('test-results/staging-sav-physical-intake',{recursive:true});
    fs.writeFileSync('test-results/staging-sav-physical-intake/report.json',JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
    if(db.pool?.end)await db.pool.end();
  }
}
if(require.main===module)main().catch(e=>{console.error('SAV_CERT_FATAL:'+String(e.code||e.message).slice(0,150));process.exitCode=2;});
module.exports={guard,txService,expectedPgFailure};
