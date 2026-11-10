#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-local-chromium-prepare
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Prepare fresh four-order G2 proof only on disposable PG16, then handoff to real localhost Chromium.
 * @db-read orders, purchase_orders, purchase_lines, v_purchase_line_progress
 * @db-write users, dashboard_global_access_grants, e2e_test_accounts (disposable only); assignment/membership via canonical writers
 * @impact-areas logistics, dashboard, test-only
 */
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
const db=require('../../db');
const runner=require('./hub-v1-certification-runner');
const OUT=path.resolve('test-results/hub-v1-local-chromium');
const FILE=path.join(OUT,'prepare.json');

async function main(){
  // A localhost HTTP URL is not enough: the underlying DB must be local and disposable.
  runner.assertEphemeralTarget(process.env.DATABASE_URL,[]);
  if(!process.env.GITHUB_ENV) throw Error('HUB_LOCAL_CHROMIUM_GITHUB_ENV_REQUIRED');
  if(process.env.KOMERCE_TARGET_ENV==='staging' || process.env.KOMERCE_ENV==='production')
    throw Error('HUB_LOCAL_CHROMIUM_SHARED_ENV_FORBIDDEN');
  const run=runner.newRun8();
  const dry=await runner.runCertification({db,run,dryRun:true,argv:['node','harness','--market=KM']});
  if(dry.verdict!=='DRY_RUN_NO_WRITES'||dry.dry_run.existing_fixture_orders.length)
    throw Error('HUB_LOCAL_CHROMIUM_RUN_PREFIX_REUSED');
  const proof=await runner.runCertification({db,run,argv:['node','harness','--market=KM','--stop-after=7']});
  if(proof.verdict!=='PARTIAL_STOP_AFTER_STEP_PASS' || proof.steps.length!==7 ||
     proof.steps.some(s=>s.status!=='PASS') ||
     proof.external_effects?.zero_external_effects!==true)
    throw Error('HUB_LOCAL_CHROMIUM_CANONICAL_PRECONDITION_FAILED');
  // A fixture Admin has no global authority merely by having the 'admin' role.
  // This explicit grant exists ONLY in disposable localhost PG16, after the
  // assertEphemeralTarget() guard above; never in shared Railway staging.
  const fixtureAdmin=proof.fixture?.users?.admin;
  if(fixtureAdmin?.role!=='admin')throw Error('HUB_LOCAL_CHROMIUM_ADMIN_IDENTITY_REQUIRED');
  await db.query(
    `INSERT INTO dashboard_global_access_grants(user_id,reason)
       SELECT u.id,$2 FROM users u WHERE u.id=$1 AND u.role='admin'
       ON CONFLICT (user_id) WHERE revoked_at IS NULL DO NOTHING`,
    [fixtureAdmin.id,'E2E-HUB-V1-'+run+' disposable Chromium Admin context']);
  const {rows:[grant]}=await db.query(
    'SELECT COUNT(*)::int AS n FROM dashboard_global_access_grants WHERE user_id=$1 AND revoked_at IS NULL',
    [fixtureAdmin.id]);
  if(grant.n!==1)throw Error('HUB_LOCAL_CHROMIUM_ADMIN_GLOBAL_GRANT_NOT_PROVEN');
  const {rows:[others]}=await db.query(
    `SELECT COUNT(*)::int AS n FROM dashboard_global_access_grants
      WHERE revoked_at IS NULL AND user_id=ANY($1::uuid[])`,
    [[proof.fixture.users.hub_agent.id,proof.fixture.users.relay_agent.id,proof.fixture.users.forwarder.id]]);
  if(others.n!==0)throw Error('HUB_LOCAL_CHROMIUM_UNEXPECTED_NONADMIN_GLOBAL_GRANT');
  // The canonical Operations Workspace intentionally hides all simulated
  // orders unless the VIEWER is registered in e2e_test_accounts. A Relay
  // also needs a real, ACTIVE market assignment with exactly two execution
  // capabilities. Reuse the proven G3 canonical writers; never invent a
  // role-based bypass, market permission, or broad simulation flag.
  const provision=require('./staging-e2e-provision');
  const delegation=require('../../services/market-delegation-service');
  const assignments=require('../../services/market-operator-provisioning');
  const {isE2eTestAccount}=require('../../services/simulation-visibility');
  const expectedCaps=provision.RELAY_AGENT_CAPABILITIES.slice().sort();
  if(JSON.stringify(expectedCaps)!==JSON.stringify(['execution.parcel.collect','execution.parcel.receive']))
    throw Error('HUB_LOCAL_CHROMIUM_RELAY_CAPABILITY_DOCTRINE_DRIFT');
  const relayActor=proof.fixture.users.relay_agent;
  // The canonical fixture REPORT exposes relay_id (not internal manifest.relay).
  // Refuse a mismatched role or relay before writing an assignment.
  if(relayActor?.role!=='agent_relais'||!proof.fixture.market_id||!proof.fixture.relay_id)
    throw Error('HUB_LOCAL_CHROMIUM_RELAY_IDENTITY_REQUIRED');
  const {rows:[actualRelay]}=await db.query(
    "SELECT u.relais_id,r.market_id FROM users u "+
    "JOIN relais r ON r.id=u.relais_id "+
    "WHERE u.id=$1::uuid AND u.role='agent_relais' AND r.is_active=TRUE",
    [relayActor.id]);
  if(!actualRelay||
     String(actualRelay.relais_id)!==String(proof.fixture.relay_id)||
     String(actualRelay.market_id)!==String(proof.fixture.market_id))
    throw Error('HUB_LOCAL_CHROMIUM_RELAY_BINDING_MISMATCH');
  const grantClient=await db.getClient();
  let inTransaction=false;
  try{
    await grantClient.query('BEGIN');inTransaction=true;
    const {assignmentId}=await assignments.resolveOrCreateAssignment(grantClient,{
      marketId:proof.fixture.market_id,marketCode:'KM',
    });
    if(!assignmentId)throw Error('HUB_LOCAL_CHROMIUM_KM_ASSIGNMENT_NOT_ACTIVE');
    const {rows:ceiling}=await grantClient.query(
      'SELECT capability FROM assignment_capability_ceiling '+
      'WHERE assignment_id=$1::uuid AND revoked_at IS NULL '+
      'AND capability=ANY($2::text[]) ORDER BY capability',
      [assignmentId,expectedCaps]);
    if(JSON.stringify(ceiling.map(x=>x.capability))!==JSON.stringify(expectedCaps))
      throw Error('HUB_LOCAL_CHROMIUM_RELAY_CAPABILITY_CEILING_MISSING');
    await provision.ensureRelayAgentMembership(grantClient,{delegation},{
      userId:relayActor.id,marketCode:'KM',actorId:fixtureAdmin.id,
    });
    for(const key of ['admin','hub_agent','relay_agent']){
      await provision.markE2eTestAccount(grantClient,{
        userId:proof.fixture.users[key].id,actorId:fixtureAdmin.id,
      });
    }
    await grantClient.query('COMMIT');inTransaction=false;
  }catch(error){
    if(inTransaction)await grantClient.query('ROLLBACK');
    throw error;
  }finally{grantClient.release();}
  // Independent truth: only two ACTIVE Relay capabilities, one membership,
  // and explicit E2E visibility for the three fixture viewers.
  const {rows:grants}=await db.query(
    "SELECT am.id,mc.capability FROM market_operating_assignments ma "+
    "JOIN assignment_memberships am ON am.assignment_id=ma.id AND am.status='ACTIVE' "+
    "JOIN membership_capabilities mc ON mc.membership_id=am.id AND mc.revoked_at IS NULL "+
    "WHERE ma.market_id=$1::uuid AND ma.status='ACTIVE' AND am.user_id=$2::uuid "+
    "ORDER BY mc.capability",
    [proof.fixture.market_id,relayActor.id]);
  if(!grants.length||new Set(grants.map(x=>x.id)).size!==1||
      JSON.stringify(grants.map(x=>x.capability))!==JSON.stringify(expectedCaps))
    throw Error('HUB_LOCAL_CHROMIUM_RELAY_MEMBERSHIP_NOT_PROVEN');
  for(const key of ['admin','hub_agent','relay_agent']){
    if(!await isE2eTestAccount(proof.fixture.users[key].id))
      throw Error('HUB_LOCAL_CHROMIUM_E2E_VISIBILITY_NOT_PROVEN:'+key);
  }
  if(await isE2eTestAccount(proof.fixture.users.forwarder.id))
    throw Error('HUB_LOCAL_CHROMIUM_UNRELATED_FORWARDER_MARKED');
  const labels=[
    ['admin','admin','E2E_ADMIN_'],
    ['hub_agent','agent-hub','E2E_AGENT_HUB_'],
    ['relay_agent','agent-relais','E2E_AGENT_RELAIS_'],
    ['forwarder','transitaire','E2E_AGENT_TRANSITAIRE_'],
  ];
  const password=crypto.randomBytes(24).toString('base64url')+'Aa1!';
  // GitHub redacts it in every subsequent step's env logs, not only our script.
  process.stdout.write('::add-mask::'+password+'\n');
  const hash=await bcrypt.hash(password,10);
  const lines=['E2E_PROOF_RUN8='+run];
  for(const [key,label,envName] of labels){
    const actor=proof.fixture.users[key];
    const email=runner.emailOf(run,label);
    if(!actor || actor.role!=='admin'&&key==='admin')throw Error('HUB_LOCAL_CHROMIUM_ACTOR_MISSING:'+key);
    const {rowCount}=await db.query(
      'UPDATE users SET password_hash=$1,account_activation_required=FALSE WHERE id=$2 AND email=$3',
      [hash,actor.id,email]);
    if(rowCount!==1)throw Error('HUB_LOCAL_CHROMIUM_ACTOR_ID_MISMATCH:'+key);
    lines.push(envName+'EMAIL='+email,envName+'PASSWORD='+password);
  }
  // The runner's GITHUB_ENV file is private to the Actions job; never print it
  // or attach it to artifacts. Credentials exist only in disposable PG16.
  fs.appendFileSync(process.env.GITHUB_ENV,lines.join('\n')+'\n',{mode:0o600});
  const orders=proof.orders;
  const pos=(await db.query(
    `SELECT DISTINCT pl.purchase_order_id::text AS id
       FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
       JOIN orders o ON o.id=oi.order_id
      WHERE o.reference=ANY($1::text[]) AND pl.purchase_order_id IS NOT NULL
      ORDER BY pl.purchase_order_id::text`,[orders])).rows.map(r=>r.id);
  if(pos.length!==2)throw Error('HUB_LOCAL_CHROMIUM_EXPECTED_TWO_POS:'+pos.length);
  const state={schema:'hub-v1-isolated-chromium-prepared/1',
    mode:'EPHEMERAL_PG16_LOCALHOST_ONLY',run,orders,pos,
    steps:proof.steps.map(s=>({n:s.n,status:s.status})),
    zero_external_effects:true,
    admin_dashboard_global_grant:true,
    relay_capabilities:expectedCaps,
    operations_simulation_visibility:'EXPLICIT_E2E_IDENTITIES_ONLY',
    staging_go:false,chromium_proven:false};
  fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(FILE,JSON.stringify(state,null,2)+'\n');
  process.stdout.write(JSON.stringify({verdict:'PREPARED_LOCAL_ONLY',run,orders:orders.length,pos:pos.length,steps:7})+'\n');
}
main().catch(e=>{console.error('HUB_LOCAL_CHROMIUM_PREP_REFUSED:'+String(e.message).slice(0,180));process.exitCode=2})
 .finally(()=>db.pool?.end?.());
