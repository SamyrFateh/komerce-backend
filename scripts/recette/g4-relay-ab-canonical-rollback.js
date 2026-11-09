#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          g4-relay-ab-canonical-identity-rollback-proof
 * @domain        auth-identity
 * @layer         tooling
 * @criticality   high
 * @inputs        disposable CI PostgreSQL 16, run8 hex
 * @outputs       sanitized two-relay/two-agent READBACK + ROLLBACK evidence
 * @depends       services/user-mutation-service.js, services/relais-mutation-service.js, scripts/recette/staging-e2e-provision.js
 * @used-by       tests/integration/g4-relay-ab-canonical-identity-rollback-postgres.test.js
 * @db-read       markets, relais, users, e2e_test_accounts
 * @db-write      none persistent; writers create disposable rows in a transaction ALWAYS rolled back
 * @db-txn        BEGIN, ROLLBACK only; no COMMIT
 * @doctrine      no_staging_mode, canonical_writers_only, two_independent_accounts, fail_closed
 * @impact-areas  g4, security, staging-safety, relay
 * @version       2026-11
 *
 * Proves that two independent users and relays can be prepared through the
 * SAME canonical domain writers as the real provisioner. It is NOT a
 * staging provisioner, NOT a browser test, and NEVER persists fixtures.
 */
const crypto = require('node:crypto');
const DB = 'postgresql://komerce:komerce@localhost:5432/komerce_test';
const RUN8 = /^[A-F0-9]{8}$/;
const LABELS = Object.freeze(['A','B']);

function assertDisposable(env=process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.NODE_ENV !== 'test' ||
      env.KOMERCE_DISABLE_CRONS !== 'true' || env.DATABASE_URL !== DB ||
      env.KOMERCE_ENV === 'staging' || env.KOMERCE_TARGET_ENV === 'staging' ||
      env.KOMERCE_ENV === 'production' || env.KOMERCE_TARGET_ENV === 'production') {
    throw Error('G4_EPHEMERAL_CI_ONLY_NO_STAGING');
  }
}
function fixtureNames(run8) {
  if (!RUN8.test(String(run8 || ''))) throw Error('G4_RUN8_HEX_REQUIRED');
  const root = 'E2E-G4-AB-' + run8;
  return LABELS.map(label=>({
    label,
    relaisName: root + '-RELAIS-' + label,
    email: 'e2e-g4-ab-' + run8.toLowerCase() + '-' + label.toLowerCase() + '@komerce.test',
  }));
}

async function prove({ db, env=process.env, run8, userWriter, relayWriter,
                      markE2e, bcrypt }={}) {
  assertDisposable(env);
  const actors=fixtureNames(run8);
  if (!db || typeof db.getClient!=='function') throw Error('G4_DB_REQUIRED');
  // The same wrappers used in the official staging E2E provisioner.
  const users=userWriter||require('../../services/user-mutation-service');
  const relays=relayWriter||require('../../services/relais-mutation-service');
  const mark=markE2e||require('./staging-e2e-provision').markE2eTestAccount;
  const hash=bcrypt||require('bcryptjs');
  const client=await db.getClient();
  let opened=false;
  let report;
  try {
    await client.query('BEGIN');opened=true;
    const {rows:[market]}=await client.query(
      "SELECT id FROM markets WHERE code='KM' AND is_active=TRUE");
    if(!market?.id)throw Error('G4_KM_ACTIVE_MARKET_REQUIRED');
    // Fail before any writer if this RUN8 already owns even one identity/relay.
    const {rows:[collision]}=await client.query(
      'SELECT (SELECT COUNT(*)::int FROM users WHERE lower(email)=ANY($1::text[])) AS agents,'+
      ' (SELECT COUNT(*)::int FROM relais WHERE name=ANY($2::text[])) AS relais',
      [actors.map(a=>a.email),actors.map(a=>a.relaisName)]
    );
    if(Number(collision.agents)!==0||Number(collision.relais)!==0)
      throw Error('G4_FIXTURE_RUN8_COLLISION');
    // A single disposable admin actor provides explicit audit provenance.
    const token=crypto.randomBytes(32).toString('base64url');
    const {rows:[admin]}=await users.createAdminUser(client,{
      fullName:'G4 ephemeral authority '+run8,
      email:'e2e-g4-ab-'+run8.toLowerCase()+'-actor@komerce.test',
      phone:null,role:'admin',currencyPref:'KMF',
      passwordHash:await hash.hash(token,10),
    });
    if(!admin?.id)throw Error('G4_EPHEMERAL_ACTOR_NOT_CREATED');
    const facts=[];
    for(const a of actors){
      const relais=await relays.createRelais(client,{
        marketId:market.id,name:a.relaisName,agentName:null,
        phone:'+000000000',address:'CI ephemeral G4 '+run8,zone:'E2E-G4',
      });
      if(!relais?.id)throw Error('G4_RELAY_CANONICAL_WRITER_FAILED');
      const {rows:[agent]}=await users.createAdminUser(client,{
        fullName:'G4 ephemeral relay '+a.label+' '+run8,
        email:a.email,phone:null,role:'agent_relais',
        currencyPref:'KMF',
        passwordHash:await hash.hash(crypto.randomBytes(32).toString('base64url'),10),
      });
      if(!agent?.id)throw Error('G4_AGENT_CANONICAL_WRITER_FAILED');
      const marker=await mark(client,{userId:agent.id,actorId:admin.id});
      if(marker!=='marked')throw Error('G4_E2E_MARKER_WRITER_FAILED');
      const assign=await users.assignAgentRelais(client,{userId:agent.id,relaisId:relais.id});
      if(assign.status!=='assigned')throw Error('G4_RELAY_ASSIGN_WRITER_FAILED');
      facts.push({label:a.label,userId:agent.id,relaisId:relais.id});
    }
    const {rows:actual}=await client.query(
      "SELECT u.id AS user_id,u.relais_id,r.market_id,u.role::text AS role,"+
      " r.is_active,(e.user_id IS NOT NULL) AS e2e "+
      " FROM users u JOIN relais r ON r.id=u.relais_id "+
      " LEFT JOIN e2e_test_accounts e ON e.user_id=u.id "+
      " WHERE u.id=ANY($1::uuid[]) ORDER BY u.id",
      [facts.map(x=>x.userId)]
    );
    if(actual.length!==2||new Set(actual.map(x=>String(x.user_id))).size!==2 ||
       new Set(actual.map(x=>String(x.relais_id))).size!==2 ||
       actual.some(x=>x.role!=='agent_relais'||x.is_active!==true||
         x.e2e!==true||String(x.market_id)!==String(market.id)) ||
       facts.some(f=>!actual.some(x=>String(x.user_id)===String(f.userId)&&
         String(x.relais_id)===String(f.relaisId))))
      throw Error('G4_AB_CANONICAL_READBACK_MISMATCH');
    report={schema:'g4-canonical-relay-ab-rollback/1',
      run8,mode:'EPHEMERAL_ONLY_ROLLBACK',
      dedicated_agents:2,distinct_relais:2,market:'KM',
      role:'agent_relais',e2e_markers:2,
      per_actor_readback:facts.map(({label})=>({label,role:'agent_relais',
        active_relais:true,e2e_marker:true})),
      membership:'NOT_PROVEN',order_fixtures:'NOT_CREATED',
      chromium:'NOT_RUN',staging:'NOT_MODIFIED',
      certification:'NOT_PROVEN',committed:false};
  } finally {
    if(opened)await client.query('ROLLBACK');
    client.release();
  }
  // Independent post-rollback readback: no owned E2E account or relay survives.
  const {rows:[remaining]}=await db.query(
    'SELECT (SELECT COUNT(*)::int FROM users WHERE lower(email)=ANY($1::text[])) AS agents,'+
    ' (SELECT COUNT(*)::int FROM relais WHERE name=ANY($2::text[])) AS relais',
    [actors.map(a=>a.email),actors.map(a=>a.relaisName)]
  );
  if(Number(remaining.agents)!==0||Number(remaining.relais)!==0)
    throw Error('G4_ROLLBACK_POSTCONDITION_FAILED');
  report.post_rollback={agents:0,relais:0};
  return report;
}
async function main(){
  assertDisposable(process.env);
  const run8=String(process.env.G4_RUN8||'').toUpperCase();
  fixtureNames(run8);
  const db=require('../../db');
  try{
    const report=await prove({db,run8});
    process.stdout.write(JSON.stringify(report)+'\n');
  }finally{await db.pool.end();}
}
if(require.main===module)main().catch(e=>{
  process.stderr.write('G4_CANONICAL_ROLLBACK_REFUSED:'+String(e.code||e.message).slice(0,120)+'\n');
  process.exitCode=2;
});
module.exports={assertDisposable,fixtureNames,prove,DB};
