#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-local-chromium-prepare
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Prepare fresh four-order G2 proof only on disposable PG16, then handoff to real localhost Chromium.
 * @db-read orders, purchase_orders, purchase_lines, v_purchase_line_progress
 * @db-write users (ephemeral credentials only), plus canonical Hub V1 service writers
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
  // Explicit bootstrap of dashboard authority for THIS disposable CI Admin.
  // An `admin` role alone never grants global dashboard access. Without this
  // actual row, the canonical app correctly redirects the isolated Admin to "/".
  // This fixture writer is guarded above by assertEphemeralTarget and GITHUB_ENV;
  // it MUST NOT be reused on Railway staging or any shared database.
  const admin=proof.fixture.users.admin;
  if(!admin || admin.role!=='admin')throw Error('G2_ISOLATED_ADMIN_ROLE_REQUIRED');
  const {rows:[adminIdentity]}=await db.query(
    "SELECT id,role::text AS role,email FROM users WHERE id=$1::uuid",[admin.id]);
  if(!adminIdentity || adminIdentity.role!=='admin' ||
     String(adminIdentity.email).toLowerCase()!==runner.emailOf(run,'admin').toLowerCase())
    throw Error('G2_ISOLATED_ADMIN_IDENTITY_MISMATCH');
  const {rows:[existing]}=await db.query(
    'SELECT COUNT(*)::int AS n FROM dashboard_global_access_grants '+
    'WHERE user_id=$1::uuid AND revoked_at IS NULL',[admin.id]);
  if(existing?.n!==0)throw Error('G2_ISOLATED_ADMIN_GRANT_ALREADY_EXISTS');
  const {rowCount}=await db.query(
    'INSERT INTO dashboard_global_access_grants(user_id,reason) VALUES($1::uuid,$2)',
    [admin.id,'E2E-HUB-V1-'+run+'-ISOLATED-CHROMIUM-EXPLICIT-DASHBOARD']);
  if(rowCount!==1)throw Error('G2_ISOLATED_ADMIN_GRANT_FAILED');
  const {hasDashboardGlobalAuthority}=require('../../middleware/require-dashboard-global-authority');
  const {resolveDashboardAdminContext}=require('../../services/dashboard-admin-context');
  if(!(await hasDashboardGlobalAuthority(admin.id)))
    throw Error('G2_ISOLATED_ADMIN_GRANT_READBACK_FAILED');
  const context=await resolveDashboardAdminContext({id:admin.id,role:'admin'});
  if(context.access.mode!=='global'||!context.access.allowedMarkets.includes('KM'))
    throw Error('G2_ISOLATED_ADMIN_DASHBOARD_CONTEXT_INVALID');
  for(const other of ['hub_agent','relay_agent','forwarder']){
    const account=proof.fixture.users[other];
    if(!account || await hasDashboardGlobalAuthority(account.id))
      throw Error('G2_ISOLATED_NONADMIN_GLOBAL_GRANT_FORBIDDEN:'+other);
  }
  // Only the isolated Admin receives an explicit global dashboard grant.
  // Hub, Relais and Transitaire retain their exact server-side role boundaries.
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
    staging_go:false,chromium_proven:false};
  fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(FILE,JSON.stringify(state,null,2)+'\n');
  process.stdout.write(JSON.stringify({verdict:'PREPARED_LOCAL_ONLY',run,orders:orders.length,pos:pos.length,steps:7})+'\n');
}
main().catch(e=>{console.error('HUB_LOCAL_CHROMIUM_PREP_REFUSED:'+String(e.message).slice(0,180));process.exitCode=2})
 .finally(()=>db.pool?.end?.());
