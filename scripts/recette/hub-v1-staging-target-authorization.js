'use strict';
/**
 * Autorisation d'une SEULE campagne transactionnelle sur Railway staging officiel.
 * Refus avant toute écriture si la base, le SHA déployé ou un référentiel nécessaire diverge.
 * La campagne conserve ses preuves : aucun DELETE.
 */
const { assess } = require('./hub-v1-staging-transactional-preflight');
const BASE = 'https://komerce-backend-production.up.railway.app';
const RUN = /^[A-Z0-9]{8}$/;
const REQUIRED_CHECKS = Object.freeze([
  'MIGRATIONS_391_396','NEW_FIXTURE_REFERENCE_PREFIX_UNUSED',
  'NO_DUPLICATE_SUPPLIER_PRIORITY','HUB_AND_RELAY_ROLES_EXIST',
  'DEDICATED_ATOMIC_CHECKOUT_SCOPE','SIMULATED_CHECKOUT_HAS_NO_EXTERNAL_HOOKS',
  'SIMULATED_PO_NO_PROVIDER_OR_NOTIFICATION',
  'SIMULATED_CUSTOMER_PAYMENT_PROVIDER_BYPASS_VERIFIED',
  'STAGING_DISPOSABLE_DATA_MODE_CONFIRMED',
  'STAGING_EXISTING_RUNNER_OWNER_AUTHORIZED',
]);
function assertApproval({run,env=process.env}={}) {
  if (!RUN.test(String(run||'')) || env.HUB_V1_CERTIFICATION_RUN!==run)
    throw Error('STAGING_RUN8_NOT_EXPLICITLY_APPROVED');
  if (env.KOMERCE_ENV!=='staging' || env.KOMERCE_TARGET_ENV!=='staging' ||
      env.NODE_ENV!=='test' || env.HUB_V1_E2E_APPLY_MODE!=='approved' ||
      env.KOMERCE_DISABLE_CRONS!=='true' || env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging')
    throw Error('STAGING_RUNTIME_GUARD_NOT_SATISFIED');
  if (String(env.STAGING_BASE_URL||'').replace(/\/$/,'')!==BASE)
    throw Error('STAGING_OFFICIAL_URL_REQUIRED');
  if (!/^[a-f0-9]{40}$/i.test(String(env.E2E_EXPECTED_DEPLOY_SHA||'')))
    throw Error('STAGING_EXACT_DEPLOY_SHA_REQUIRED');
}
async function checkSharedBaselines(db, {
  resolveFx = require('../../services/fx-chain-service').resolveObservation,
} = {}) {
  const client=await db.getClient();
  try {
    await client.query('BEGIN READ ONLY');
    const {rows:[market]}=await client.query(
      "SELECT id FROM markets WHERE code='KM' AND lifecycle_status='ACTIVE'");
    if (!market) throw Error('STAGING_MARKET_KM_NOT_ACTIVE');
    // La fixture crée son propre relais actif sur KM avant son checkout.
    // Pas de condition de contrat, attestation ou historique transporteur.
    // L'autorité FX reste réelle, sans taux fictif sur staging.
    const observation=await resolveFx({client});
    if (!observation?.id) throw Error('STAGING_FX_AUTHORITY_NOT_PROVEN');
    return {fx_authority:observation.source_label,delivery_condition:'ACTIVE_RELAIS_AT_CHECKOUT'};
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
  }
}
async function authorizeOfficialStaging({db,run,env=process.env,assessImpl=assess,baselineImpl=checkSharedBaselines}={}) {
  assertApproval({run,env});
  if (!db || typeof db.getClient!=='function')throw Error('STAGING_DB_EXECUTOR_MISSING');
  const check=await assessImpl({db,env});
  if (!Array.isArray(check?.checks) || check.mode!=='READ_ONLY' ||
      check.checks.length!==REQUIRED_CHECKS.length)
    throw Error('STAGING_PREFLIGHT_SHAPE_NOT_REVIEWED');
  // On ne valide pas fictivement une certification de nettoyage future : la
  // permission de données jetables est propre au staging et au propriétaire.
  // Les dix conditions réelles, notamment SHA, DB et isolement PSP, restent obligatoires.
  if (check.verdict!=='READY_FOR_EXPLICIT_APPLY_REVIEW')
    throw Error('STAGING_PREFLIGHT_HOLD_BLOCKS_ALL_WRITES');
  const ids=new Set(check.checks.map((c)=>c.id));
  if (ids.size!==REQUIRED_CHECKS.length ||
      REQUIRED_CHECKS.some((id)=>!ids.has(id)) ||
      check.checks.some((c)=>c.pass!==true))
    throw Error('STAGING_PREFLIGHT_UNEXPECTED_FAILURE');
  await baselineImpl(db);
  const parsed=new URL(String(env.DATABASE_URL||''));
  if (['localhost','127.0.0.1','::1','[::1]'].includes(parsed.hostname))
    throw Error('STAGING_REMOTE_DATABASE_REQUIRED');
  return { host:'official-railway-staging', database:decodeURIComponent(parsed.pathname.slice(1)), mode:'STAGING_OFFICIAL' };
}
module.exports={ assertApproval,checkSharedBaselines,authorizeOfficialStaging };
