#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g3-local-chromium-prepare
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Prepare canonical paid LOCAL_STOCK order exclusively on disposable PG16 for real relay Chromium clicks.
 * @db-read orders, order_items, parcels, scans, purchase_lines, cash_collections
 * @db-write users (test credentials only), E2E marker + KM assignment + Relay membership via canonical writers, plus canonical Hub V1 fixture writers on disposable PG16
 * @db-txn canonical services own transactions, disposable DB destroyed by GitHub runner
 * @impact-areas logistics, dashboard, test-only
 */
'use strict';
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const bcrypt=require('bcryptjs');
const db=require('../../db');
const runner=require('./hub-v1-certification-runner');
const {snapshot,assess}=require('./staging-local-stock-real-relay-cert');
const OUT=path.resolve('test-results/g3-local-chromium');
const FILE=path.join(OUT,'prepare.json');

async function main(){
  runner.assertEphemeralTarget(process.env.DATABASE_URL,[]);
  if(!process.env.GITHUB_ENV)throw Error('G3_LOCAL_GITHUB_ENV_REQUIRED');
  if(process.env.NODE_ENV!=='test'||process.env.KOMERCE_ENV!=='test'||
     process.env.KOMERCE_TARGET_ENV==='staging'||process.env.STAGING_BASE_URL||
     process.env.E2E_CLICKS_BASE_URL!=='http://localhost:3917')
    throw Error('G3_LOCAL_SHARED_ENV_FORBIDDEN');
  const run=runner.newRun8(),reference=runner.orderRef(run,'LOCAL');
  const dry=await runner.runCertification({db,run,dryRun:true,argv:['node','harness','--market=KM']});
  if(dry.verdict!=='DRY_RUN_NO_WRITES'||dry.dry_run.existing_fixture_orders.length)
    throw Error('G3_LOCAL_RUN_PREFIX_REUSED');
  // Only two canonical service stages: checkout and simulated payment. Do not fabricate
  // an available/collected status; those must come from the real browser clicks.
  const proof=await runner.runCertification({db,run,argv:['node','harness','--market=KM','--stop-after=2']});
  if(proof.verdict!=='PARTIAL_STOP_AFTER_STEP_PASS'||proof.steps.length!==2||
     proof.steps.some(x=>x.status!=='PASS')||
     proof.external_effects?.zero_external_effects!==true)
    throw Error('G3_LOCAL_CANONICAL_PRECONDITION_FAILED');
  const {rows:orders}=await db.query(
    'SELECT id FROM orders WHERE reference=$1 AND simulation_scope=$2',
    [reference,'E2E-HUB-V1']);
  if(orders.length!==1)throw Error('G3_LOCAL_ORDER_NOT_UNIQUE');
  const orderId=orders[0].id;
  const before=await snapshot(db,orderId);
  const errors=assess(before,'before');
  if(errors.length)throw Error('G3_LOCAL_INVALID_PRECONDITION:'+errors.join(','));
  const actor=proof.fixture?.users?.relay_agent;
  if(!actor?.id||actor.role!=='agent_relais')throw Error('G3_LOCAL_RELAY_ACTOR_MISSING');
  const email=runner.emailOf(run,'agent-relais');
  const {rows:[scope]}=await db.query(
    'SELECT u.relais_id, r.market_id FROM users u JOIN relais r ON r.id=u.relais_id WHERE u.id=$1 AND lower(u.email)=lower($2) AND u.role=$3',
    [actor.id,email,'agent_relais']);
  if(!scope||String(scope.relais_id)!==String(before.order.relais_id)||
     String(scope.market_id)!==String(before.order.market_id))
    throw Error('G3_LOCAL_RELAY_ACTOR_NOT_BOUND');
  const password=crypto.randomBytes(24).toString('base64url')+'Aa1!';
  process.stdout.write('::add-mask::'+password+'\n');
  const hash=await bcrypt.hash(password,10);
  const {rowCount}=await db.query(
    'UPDATE users SET password_hash=$1,account_activation_required=FALSE WHERE id=$2 AND lower(email)=lower($3)',
    [hash,actor.id,email]);
  if(rowCount!==1)throw Error('G3_LOCAL_E2E_CREDENTIAL_TARGET_MISMATCH');
  // Pickup requires explicit market assignment and capability membership;
  // fixture visibility alone is insufficient. Use G4/official canonical writers
  // exclusively on the PG16 target protected at the beginning of this script.
  const provision=require('./staging-e2e-provision');
  const delegation=require('../../services/market-delegation-service');
  const assignments=require('../../services/market-operator-provisioning');
  const {isE2eTestAccount}=require('../../services/simulation-visibility');
  const expectedCaps=provision.RELAY_AGENT_CAPABILITIES.slice().sort();
  if(JSON.stringify(expectedCaps)!==JSON.stringify(
    ['execution.parcel.collect','execution.parcel.receive']))
    throw Error('G3_LOCAL_RELAY_CAPABILITY_DOCTRINE_DRIFT');
  const grantClient=await db.getClient();
  let inTransaction=false;
  try {
    await grantClient.query('BEGIN');inTransaction=true;
    const {assignmentId}=await assignments.resolveOrCreateAssignment(grantClient,{
      marketId:before.order.market_id,marketCode:'KM',
    });
    if(!assignmentId)throw Error('G3_LOCAL_KM_ASSIGNMENT_NOT_ACTIVE');
    const {rows:ceiling}=await grantClient.query(
      'SELECT capability FROM assignment_capability_ceiling '+
      'WHERE assignment_id=$1::uuid AND revoked_at IS NULL '+
      'AND capability=ANY($2::text[]) ORDER BY capability',
      [assignmentId,expectedCaps]);
    if(JSON.stringify(ceiling.map(x=>x.capability))!==JSON.stringify(expectedCaps))
      throw Error('G3_LOCAL_RELAY_CAPABILITIES_NOT_IN_CEILING');
    await provision.ensureRelayAgentMembership(grantClient,{delegation},{
      userId:actor.id,marketCode:'KM',actorId:proof.fixture.users.admin.id,
    });
    await provision.markE2eTestAccount(grantClient,{
      userId:actor.id,actorId:proof.fixture.users.admin.id,
    });
    await grantClient.query('COMMIT');inTransaction=false;
  } catch(error) {
    if(inTransaction)await grantClient.query('ROLLBACK');
    throw error;
  } finally {grantClient.release();}
  // Independent SQL readback: only the two exact execution capabilities.
  const {rows:grants}=await db.query(
    "SELECT am.id, mc.capability FROM market_operating_assignments ma "+
    "JOIN assignment_memberships am ON am.assignment_id=ma.id AND am.status='ACTIVE' "+
    "JOIN membership_capabilities mc ON mc.membership_id=am.id AND mc.revoked_at IS NULL "+
    "WHERE ma.market_id=$1::uuid AND ma.status='ACTIVE' AND am.user_id=$2::uuid "+
    "ORDER BY mc.capability",
    [before.order.market_id,actor.id]);
  if(!grants.length||new Set(grants.map(x=>x.id)).size!==1||
     JSON.stringify(grants.map(x=>x.capability))!==JSON.stringify(expectedCaps))
    throw Error('G3_LOCAL_RELAY_MEMBERSHIP_PROOF_FAILED');
  if(!await isE2eTestAccount(actor.id))
    throw Error('G3_LOCAL_E2E_ACTOR_VISIBILITY_NOT_REGISTERED');
  fs.appendFileSync(process.env.GITHUB_ENV,[
    'HTTP_RUNNER_RUN8='+run,
    'E2E_AGENT_RELAIS_EMAIL='+email,
    'E2E_AGENT_RELAIS_PASSWORD='+password
  ].join('\n')+'\n',{mode:0o600});
  fs.mkdirSync(OUT,{recursive:true});
  const manifest={schema:'g3-isolated-chromium-prepared/1',
    mode:'EPHEMERAL_PG16_LOCALHOST_ONLY',staging_go:false,
    run,market:'KM',reference,order_id:orderId,relay_id:before.order.relais_id,
    steps:proof.steps.map(x=>({n:x.n,status:x.status})),
    zero_external_effects:true,chromium_proven:false};
  fs.writeFileSync(FILE,JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({verdict:'PREPARED_LOCAL_ONLY',run,market:'KM',orders:1,steps:2}));
}
main().catch(e=>{console.error('G3_LOCAL_PREP_REFUSED:'+String(e.message).slice(0,200));process.exitCode=2;})
  .finally(()=>db.pool?.end?.());
