#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-g4-ab-relay-identity-provision
 * @domain        auth-identity
 * @layer         tooling
 * @criticality   high
 * @inputs        two independently created canonical local KM fixture RUN8s, owner-only staging, E2E_ADMIN_EMAIL
 * @outputs       GITHUB_ENV (ephemeral generated credentials), private JSON identity/ownership report
 * @depends       scripts/recette/target-guard.js, services/user-mutation-service.js, scripts/recette/staging-e2e-provision.js
 * @db-read       markets, orders, relais, users, assignment_memberships, membership_capabilities, e2e_test_accounts
 * @db-write      users via user-mutation-service, e2e_test_accounts and delegation via canonical E2E provisioner
 * @db-txn        single owned transaction + independent post-commit readback
 * @doctrine      staging_only_owner_authorized, two_dedicated_users, no_external_effects, no_sql_test_order_seed
 * @impact-areas  g4, relay, staging
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {confirmTarget}=require('./target-guard');
const {disposableStagingAuthorized}=require('./hub-v1-staging-transactional-preflight');
const {markE2eTestAccount,ensureRelayAgentMembership}=require('./staging-e2e-provision');
const {createAdminUser,assignAgentRelais}=require('../../services/user-mutation-service');
const bcrypt=require('bcryptjs');

function requireOwner(env=process.env) {
  if (!disposableStagingAuthorized(env) || !env.GITHUB_ENV ||
      !/^[A-F0-9]{8}$/.test(String(env.G4_A_RUN8||'')) ||
      !/^[A-F0-9]{8}$/.test(String(env.G4_B_RUN8||'')) ||
      env.G4_A_RUN8===env.G4_B_RUN8 ||
      env.GITHUB_EVENT_NAME!=='issues' ||
      !['KM','CM','CG'].includes(env.G4_MARKET) ||
      env.GITHUB_ISSUE_TITLE!=='[staging-op] g4-ab-chromium-'+env.G4_MARKET)
    throw Error('G4_STAGING_OWNER_TWO_RUNS_REQUIRED');
}
async function inspect(db,accounts,marketCode) {
  const {rows}=await db.query(
    "SELECT u.id AS user_id,u.role::text AS role,u.relais_id,r.market_id, "+
    "m.code AS market_code,(e.user_id IS NOT NULL) AS e2e, "+
    "(SELECT count(DISTINCT mc.capability)::int FROM assignment_memberships am "+
    " JOIN market_operating_assignments moa ON moa.id=am.assignment_id "+
    " JOIN membership_capabilities mc ON mc.membership_id=am.id AND mc.revoked_at IS NULL "+
    " WHERE am.user_id=u.id AND am.status='ACTIVE' AND moa.market_id=r.market_id "+
    " AND mc.capability=ANY($2::text[])) AS caps "+
    "FROM users u JOIN relais r ON r.id=u.relais_id "+
    " JOIN markets m ON m.id=r.market_id LEFT JOIN e2e_test_accounts e ON e.user_id=u.id "+
    "WHERE u.id=ANY($1::uuid[]) ORDER BY u.id",
    [accounts.map(a=>a.user_id),['execution.parcel.receive','execution.parcel.collect']]
  );
  if(rows.length!==2||new Set(rows.map(x=>String(x.relais_id))).size!==2||
     new Set(rows.map(x=>String(x.user_id))).size!==2||
     rows.some(x=>x.role!=='agent_relais'||x.market_code!==marketCode||x.e2e!==true||Number(x.caps)!==2))
    throw Error('G4_REAL_KM_TWO_RELAY_READBACK_MISMATCH');
  for(const a of accounts)if(!rows.some(x=>String(x.user_id)===a.user_id&&
      String(x.relais_id)===a.relais_id))throw Error('G4_PROVISION_USER_RELAY_MISMATCH');
  return rows;
}
async function provision({db,env=process.env,fetchImpl=fetch}={}) {
  requireOwner(env);
  const target=await confirmTarget({db,env,fetchImpl});
  if(!target.confirmed)throw Error('G4_STAGING_DB_FINGERPRINT_MISMATCH');
  const rsp=await fetchImpl('https://komerce-backend-production.up.railway.app/health/version');
  if(!rsp.ok)throw Error('G4_STAGING_UNAVAILABLE');
  const v=await rsp.json();
  if(String(v.commit||v.sha||'').toLowerCase()!==String(env.E2E_EXPECTED_DEPLOY_SHA||'').toLowerCase())
    throw Error('G4_STAGING_SHA_DRIFT');
  const client=await db.getClient();let opened=false;
  const accounts=[];
  try {
    await client.query('BEGIN');opened=true;
    const {rows:[admin]}=await client.query(
      "SELECT id,role::text AS role FROM users WHERE lower(email)=lower($1)",
      [env.E2E_ADMIN_EMAIL]);
    if(!admin||admin.role!=='admin')throw Error('G4_STAGING_ADMIN_REQUIRED');
    for(const label of ['A','B']) {
      const run8=env['G4_'+label+'_RUN8'];
      const reference='E2E-HUB-V1-'+run8+'-LOCAL';
      const {rows:orders}=await client.query(
        "SELECT o.id::text AS order_id,o.relais_id::text AS relais_id,m.code AS market_code "+
        "FROM orders o JOIN markets m ON m.id=o.market_id "+
        "JOIN relais r ON r.id=o.relais_id WHERE o.reference=$1 "+
        "AND o.simulation_scope='E2E-HUB-V1' AND r.is_active=TRUE",
        [reference]);
      if(orders.length!==1||orders[0].market_code!==env.G4_MARKET)throw Error('G4_EXPECTED_CANONICAL_LOCAL_FIXTURE:'+label);
      const email='e2e-g4-staging-'+run8.toLowerCase()+'-'+label.toLowerCase()+'@komerce.test';
      const {rows:[existing]}=await client.query('SELECT id FROM users WHERE lower(email)=$1',[email]);
      if(existing)throw Error('G4_IDENTITY_COLLISION');
      const password='A1!'+crypto.randomBytes(22).toString('base64url');
      const created=await createAdminUser(client,{
        fullName:'G4 staged relay '+label+' '+run8,email,phone:null,
        role:'agent_relais',currencyPref:'KMF',passwordHash:await bcrypt.hash(password,12),
      });
      const user=created.rows[0];
      if(!user?.id)throw Error('G4_CANONICAL_USER_CREATION_FAILED');
      const mark=await markE2eTestAccount(client,{userId:user.id,actorId:admin.id});
      if(mark!=='marked')throw Error('G4_E2E_USER_MARK_FAILED');
      const assignment=await assignAgentRelais(client,{userId:user.id,relaisId:orders[0].relais_id});
      if(assignment.status!=='assigned')throw Error('G4_CANONICAL_RELAY_ASSIGNMENT_FAILED');
      await ensureRelayAgentMembership(client,
        {delegation:require('../../services/market-delegation-service')},
        {userId:user.id,marketCode:env.G4_MARKET,actorId:admin.id});
      accounts.push({label,run8,email,password,user_id:String(user.id),
        relais_id:orders[0].relais_id,order_id:orders[0].order_id,reference});
    }
    if(new Set(accounts.map(a=>a.relais_id)).size!==2)throw Error('G4_NOT_TWO_DISTINCT_RELAYS');
    await client.query('COMMIT');opened=false;
    await inspect(db,accounts,env.G4_MARKET);
    // Never print credentials or store them in evidence artifacts.
    const vars=accounts.flatMap(a=>[
      'G4_'+a.label+'_EMAIL='+a.email,
      'G4_'+a.label+'_PASSWORD='+a.password,
      'G4_'+a.label+'_ORDER_ID='+a.order_id,
      'G4_'+a.label+'_REFERENCE='+a.reference,
    ]);
    fs.appendFileSync(env.GITHUB_ENV,vars.join('\n')+'\n',{mode:0o600});
    const report={schema:'g4-real-staging-ab-provision/1',verdict:'G4_AB_TWO_AGENTS_TWO_RELAIS_PROVISIONED',
      market:env.G4_MARKET,staging_sha:env.E2E_EXPECTED_DEPLOY_SHA,accounts:accounts.map(
        ({label,run8,user_id,relais_id,order_id,reference})=>
          ({label,run8,user_id,relais_id,order_id,reference})),
      separate_agents:true,separate_relays:true,payment_provider:'SIMULATED_ONLY',chromium:'NOT_YET_RUN'};
    fs.mkdirSync('test-results/g4-staging',{recursive:true});
    fs.writeFileSync('test-results/g4-staging/provision.json',JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({verdict:report.verdict,market:env.G4_MARKET,agents:2,relais:2,orders:2}));
    return report;
  }catch(e){if(opened)await client.query('ROLLBACK').catch(()=>{});throw e;
  }finally{client.release();}
}
async function main() {
  const db=require('../../db');
  try{await provision({db});}finally{await db.pool?.end?.();}
}
if(require.main===module)main().catch(e=>{
  console.error('G4_STAGING_PROVISION_REFUSED:'+String(e.code||e.message).slice(0,160));process.exitCode=2;
});
module.exports={requireOwner,inspect,provision};
