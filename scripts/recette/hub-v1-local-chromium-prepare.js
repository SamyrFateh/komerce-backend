#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-local-chromium-prepare
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Prepare fresh four-order G2 proof only on disposable PG16, then handoff to real localhost Chromium.
 * @db-read orders, purchase_orders, purchase_lines, v_purchase_line_progress
 * @db-write users, dashboard_global_access_grants (ephemeral only), plus canonical Hub V1 service writers
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
    staging_go:false,chromium_proven:false};
  fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(FILE,JSON.stringify(state,null,2)+'\n');
  process.stdout.write(JSON.stringify({verdict:'PREPARED_LOCAL_ONLY',run,orders:orders.length,pos:pos.length,steps:7})+'\n');
}
main().catch(e=>{console.error('HUB_LOCAL_CHROMIUM_PREP_REFUSED:'+String(e.message).slice(0,180));process.exitCode=2})
 .finally(()=>db.pool?.end?.());
