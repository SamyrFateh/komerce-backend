'use strict';
/**
 * Autorisation d'une SEULE campagne transactionnelle sur Railway staging officiel.
 * Refus avant toute écriture si la base, le SHA déployé ou un référentiel nécessaire diverge.
 * La campagne conserve ses preuves : aucun DELETE.
 */
const { assess } = require('./hub-v1-staging-transactional-preflight');
const BASE = 'https://komerce-backend-production.up.railway.app';
const RUN = /^[A-Z0-9]{8}$/;
const EXCEPTIONS = new Set([
  'STAGING_FIXTURE_OWNERSHIP_AND_CLEANUP_CERTIFIED',
  'STAGING_E2E_CROSS_SERVICE_RUNNER_REVIEWED',
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
async function checkSharedBaselines(db) {
  const client=await db.getClient();
  try {
    await client.query('BEGIN READ ONLY');
    const {rows:[row]}=await client.query(
      `SELECT
        EXISTS (SELECT 1 FROM fx_rate_observations
                WHERE approved_by IS NOT NULL AND as_of>NOW()-INTERVAL '5 days') AS approved_fx,
        EXISTS (SELECT 1 FROM market_delivery_attestations a
                JOIN markets m ON m.id=a.market_id
                WHERE m.code='KM' AND m.lifecycle_status='ACTIVE'
                  AND a.revoked_at IS NULL AND a.valid_until>NOW()) AS delivery_attested`);
    if (!row?.approved_fx || !row?.delivery_attested)
      throw Error('STAGING_SHARED_COMMERCIAL_BASELINE_MISSING');
    return { approved_fx:true, delivery_attested:true };
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
  }
}
async function authorizeOfficialStaging({db,run,env=process.env,assessImpl=assess,baselineImpl=checkSharedBaselines}={}) {
  assertApproval({run,env});
  if (!db || typeof db.getClient!=='function')throw Error('STAGING_DB_EXECUTOR_MISSING');
  const check=await assessImpl({db,env});
  if (!Array.isArray(check?.checks) || check.checks.length!==10 || check.mode!=='READ_ONLY' ||
      check.verdict!=='HOLD_NO_STAGING_WRITES')
    throw Error('STAGING_PREFLIGHT_SHAPE_NOT_REVIEWED');
  const ids=new Set(check.checks.map((c)=>c.id));
  if (ids.size!==10 || [...EXCEPTIONS].some((id)=>!ids.has(id)) ||
      check.checks.some((c)=>!c.pass&&!EXCEPTIONS.has(c.id)) ||
      check.checks.some((c)=>EXCEPTIONS.has(c.id)&&c.pass))
    throw Error('STAGING_PREFLIGHT_UNEXPECTED_FAILURE');
  // Deux portes générales restent volontairement HOLD : leur remplacement ici
  // est un protocole de recette explicitement autorisé, pas une certification du nettoyage.
  // Il n'autorise JAMAIS le DELETE des tables de preuves.
  await baselineImpl(db);
  const parsed=new URL(String(env.DATABASE_URL||''));
  if (['localhost','127.0.0.1','::1','[::1]'].includes(parsed.hostname))
    throw Error('STAGING_REMOTE_DATABASE_REQUIRED');
  return { host:'official-railway-staging', database:decodeURIComponent(parsed.pathname.slice(1)), mode:'STAGING_OFFICIAL' };
}
module.exports={ assertApproval,checkSharedBaselines,authorizeOfficialStaging };
