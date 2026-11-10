#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-staging-transactional-preflight
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Refuser toute recette Hub V1 sur staging tant que les barrières d'isolation ne sont pas démontrées.
 * @db-read orders, product_suppliers, schema_migrations, users
 * @db-write none
 * @db-txn READ ONLY
 */
'use strict';

const fs=require('fs');
const path=require('path');
const { confirmTarget }=require('./target-guard');

const PREFIX='E2E-HUB-V1-';
const SCOPE='E2E-HUB-V1';
const REQUIRED_MIGRATIONS=[
  '391_hub_sku_physical_codes.sql',
  '392_hub_order_bag_ownership.sql',
  '393_hub_order_bag_scan_evidence.sql',
  '394_hub_packed_bag_box_link.sql',
  '395_product_suppliers_unique_active_priority.sql',
  '396_parcel_ref_seq_realign.sql',
];

// Staging is a disposable recette environment. Explicit owner approval
// replaces premature cleanup/runner-completion certification, never the
// runtime SHA, DB fingerprint, or external-payment safety requirements.
function disposableStagingAuthorized(env=process.env) {
  return env.HUB_V1_STAGING_DISPOSABLE_MODE==='1' &&
    env.KOMERCE_ENV==='staging' &&
    env.KOMERCE_TARGET_ENV==='staging' &&
    env.NODE_ENV==='test' &&
    env.EXPECTED_RAILWAY_ENVIRONMENT==='staging' &&
    env.KOMERCE_DISABLE_CRONS==='true' &&
    env.HUB_V1_E2E_APPLY_MODE==='approved' &&
    String(env.STAGING_BASE_URL||'').replace(/\/$/,'')==='https://komerce-backend-production.up.railway.app' &&
    env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend' &&
    ['issues','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) &&
    Boolean(env.GITHUB_REPOSITORY_OWNER) &&
    env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER;
}
function sourceGates(root=process.cwd(),env=process.env) {
  const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
  const checkout=read('services/order-checkout-service.js');
  const notifications=read('services/order-post-commit-hooks.js');
  const purchasing=read('services/purchasing-engagement-service.js');
  const payment=read('services/hub-v1-fixture-payment.js');
  const paymentDbTest=read('tests/integration/hub-v1-fixture-payment-postgres.test.js');
  const certWorkflow=read('.github/workflows/hub-v1-certification-dual-proof.yml');
  return [
    {
      id:'DEDICATED_ATOMIC_CHECKOUT_SCOPE',
      pass:checkout.includes("'E2E-HUB-V1'") &&
        checkout.includes('assignOrderSimulationScope(client') &&
        checkout.includes("await client.query('COMMIT')"),
      detail:'Une commande E2E-HUB-V1 doit recevoir son simulation_scope AVANT COMMIT via checkout canonique',
    },
    {
      id:'SIMULATED_CHECKOUT_HAS_NO_EXTERNAL_HOOKS',
      pass:notifications.includes('if (order && order.simulation_scope != null) return;'),
      detail:'Ni SMS, email, partage, fidélité ou révélation de code sur checkout simulé',
    },
    {
      id:'SIMULATED_PO_NO_PROVIDER_OR_NOTIFICATION',
      pass:purchasing.includes('SIMULATED_PO_AUTO_ORDER_FORBIDDEN') &&
           purchasing.includes('PURCHASE_ORDER_SIMULATION_SCOPE_MIXED') &&
           purchasing.includes('simulation_no_notification'),
      detail:'Aucune commande fournisseur API, notification ou PO mixte réel/simulation',
    },
    {
      id:'SIMULATED_CUSTOMER_PAYMENT_PROVIDER_BYPASS_VERIFIED',
      // Couverture de code + preuve PG16 incluse dans la campagne obligatoire :
      // ceci ne prétend jamais qu'un paiement a été exécuté sur staging.
      pass:payment.includes("env.KOMERCE_ENV!=='staging'") &&
        payment.includes("env.NODE_ENV!=='test'") &&
        payment.includes("env.HUB_V1_E2E_APPLY_MODE!=='approved'") &&
        payment.includes("order.simulation_scope!=='E2E-HUB-V1'") &&
        payment.includes("order.payment_mode!=='cash_relais'") &&
        payment.includes('cashPaidAt:false') &&
        payment.includes('source:\'hub_v1_fixture\',dbClient:client') &&
        payment.includes("await client.query('COMMIT')") &&
        paymentDbTest.includes('cash_paid_at:null,stripe_payment_id:null') &&
        paymentDbTest.includes('SELECT count(*)::int AS n FROM cash_collections') &&
        paymentDbTest.includes('idempotent_replay') &&
        certWorkflow.includes('tests/integration/hub-v1-fixture-payment-postgres.test.js'),
      detail:'Service interne sans PSP/caisse, source simulée, rollback et test PG16 obligatoirement exécuté en CI ; ce gate source ne certifie pas le staging',
    },
    {
      id:'STAGING_DISPOSABLE_DATA_MODE_CONFIRMED',
      pass:disposableStagingAuthorized(env),
      detail:'Données staging jetables, mode de recette explicitement activé par le propriétaire ; reset existant après campagne',
    },
    {
      id:'STAGING_EXISTING_RUNNER_OWNER_AUTHORIZED',
      pass:disposableStagingAuthorized(env),
      detail:'Exécution du runner métier existant uniquement sur staging par le propriétaire ; les 13 étapes restent à prouver',
    },
  ];
}

// `run` (RUN8 hex) : l'unicite porte sur le RUN8 de CETTE fixture ; les fixtures anterieures sont immuables (HOLD_IMMUTABLE_PROOFS_RETAINED).
// Sans run, la garde reste stricte (aucune commande E2E-HUB-V1 preexistante).
async function databaseGates(client, run) {
  await client.query('BEGIN READ ONLY');
  try {
    const query=async(sql,params=[]) => (await client.query(sql,params)).rows;
    const migrations=await query(
      'SELECT filename FROM public.schema_migrations WHERE filename = ANY($1::text[])',
      [REQUIRED_MIGRATIONS]
    );
    const [existing]=await query(
      'SELECT COUNT(*)::int AS n FROM public.orders WHERE reference LIKE $1',
      [PREFIX+(/^[A-F0-9]{8}$/.test(String(run||'')) ? run : '')+'%']
    );
    const [duplicates]=await query(
      "SELECT COUNT(*)::int AS n FROM (SELECT product_id,priority FROM public.product_suppliers " +
      "WHERE is_active=TRUE AND deleted_at IS NULL GROUP BY product_id,priority HAVING COUNT(*)>1) d"
    );
    const roles=await query(
      "SELECT role::text AS role, COUNT(*)::int AS n FROM public.users " +
      "WHERE role::text IN ('admin','agent_hub','agent_relais','market_operator') GROUP BY role"
    );
    const byRole=Object.fromEntries(roles.map(x=>[x.role,x.n]));
    const applied=new Set(migrations.map(m=>m.filename));
    return [
      {id:'MIGRATIONS_391_396',pass:REQUIRED_MIGRATIONS.every(m=>applied.has(m)),observed:applied.size},
      {id:'NEW_FIXTURE_REFERENCE_PREFIX_UNUSED',pass:existing.n===0,observed:existing.n},
      {id:'NO_DUPLICATE_SUPPLIER_PRIORITY',pass:duplicates.n===0,observed:duplicates.n},
      {id:'HUB_AND_RELAY_ROLES_EXIST',pass:(byRole.agent_hub||0)>0&&(byRole.agent_relais||0)>0,observed:byRole},
    ];
  } finally {
    await client.query('ROLLBACK');
  }
}

async function assess({ db, fetchImpl=fetch, env=process.env, root=process.cwd() }={}) {
  if(env.KOMERCE_ENV!=='staging'||env.KOMERCE_TARGET_ENV!=='staging')
    throw Error('STAGING_ONLY');
  const expected=String(env.E2E_EXPECTED_DEPLOY_SHA||'');
  if(!/^[a-f0-9]{40}$/i.test(expected))throw Error('PINNED_SHA_REQUIRED');
  const target=await confirmTarget({db,fetchImpl,env});
  if(!target.confirmed)throw Error('STAGING_FINGERPRINT_NOT_CONFIRMED');
  const base=String(env.STAGING_BASE_URL||'').replace(/\/$/,'');
  const response=await fetchImpl(base+'/health/version');
  if(!response.ok)throw Error('STAGING_RUNTIME_SHA_UNAVAILABLE');
  const version=await response.json();
  const observed=String(version.commit||version.sha||'');
  if(observed.toLowerCase()!==expected.toLowerCase())throw Error('STAGING_RUNTIME_SHA_DRIFT');
  const client=await db.getClient();
  let dbChecks;
  try{dbChecks=await databaseGates(client,env.HUB_V1_CERTIFICATION_RUN);}finally{client.release();}
  const checks=[...dbChecks,...sourceGates(root,env)];
  return {
    mode:'READ_ONLY',
    scope:SCOPE,
    runtime_sha:observed.slice(0,12),
    verdict:checks.every(c=>c.pass)?'READY_FOR_EXPLICIT_APPLY_REVIEW':'HOLD_NO_STAGING_WRITES',
    checks,
    never_claims:'13 steps executed or business GO',
  };
}
async function main() {
  const db=require('../../db');
  try{
    const report=await assess({db});
    const dir=path.join('test-results','hub-v1-cert');
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'transactional-preflight.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
    if(report.verdict!=='READY_FOR_EXPLICIT_APPLY_REVIEW')process.exitCode=2;
  }finally{if(db.pool?.end)await db.pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('REFUS: '+String(e.message));process.exitCode=2});
module.exports={sourceGates,disposableStagingAuthorized,databaseGates,assess,PREFIX,SCOPE,REQUIRED_MIGRATIONS};