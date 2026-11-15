'use strict';
/** @komerce-arch
 * @role g8-staging-fixture-credentials-revocation
 * @domain refunds
 * @layer test-tooling
 * @criticality high
 * @inputs E2E-HUB-V1 RUN8 fixture manifest on verified official staging
 * @outputs scoped test credentials permanently disabled
 * @depends target-guard
 * @db-write users.password_hash and account_activation_required on four E2E users ONLY
 * @doctrine never_delete_evidence_no_real_accounts
 * @impact-areas staging, auth, refunds
 * @version 2026-11
 */
const fs=require('fs'),db=require('../../db');
const {confirmTarget}=require('./target-guard');
async function main(){
 const p='test-results/g8-staging-positive/prepare.json';
 if(!fs.existsSync(p)){console.log('G8_STAGING_CREDENTIAL_REVOKE_NO_MANIFEST');return;}
 const m=JSON.parse(fs.readFileSync(p,'utf8'));
 const run=process.env.HUB_V1_CERTIFICATION_RUN;
 if(m.kind!=='G8_OFFICIAL_STAGING_SYNTHETIC'||m.run!==run||
    m.deployed_sha!==process.env.E2E_EXPECTED_DEPLOY_SHA||
    m.scope!=='E2E-HUB-V1'||process.env.G8_STAGING_SYNTHETIC_APPROVED!=='1'||
    process.env.STAGING_BASE_URL!=='https://komerce-backend-production.up.railway.app'||
    process.env.GITHUB_ACTOR!==process.env.GITHUB_REPOSITORY_OWNER)
   throw Error('G8_CREDENTIALS_REVOKE_MANIFEST_INVALID');
 const check=await confirmTarget({db});
 if(check.confirmed!==true)throw Error('G8_CREDENTIALS_REVOKE_TARGET_INVALID');
 let count=0;
 for(const role of ['admin','relay','operator','reviewer']){
  const id=m.ids[role],email=m.emails[role];
  const prefix=role==='admin'||role==='relay'?'e2e-hub-v1-':'e2e-g8-';
  if(!/^[0-9a-f-]{36}$/i.test(id)||!email.startsWith(prefix)||
     !email.includes(run.toLowerCase())||!email.endsWith('@komerce.test'))
     throw Error('G8_CREDENTIAL_REVOKE_SCOPING_INVALID');
  const result=await db.query(
   "UPDATE users SET password_hash=NULL,account_activation_required=TRUE,credentials_changed_at=NOW() WHERE id=$1 AND lower(email)=lower($2)",
   [id,email]);
  if(result.rowCount!==1)throw Error('G8_REVOKE_ACCOUNT_MISSING:'+role);
  count++;
 }
 console.log(JSON.stringify({verdict:'G8_STAGING_E2E_CREDENTIALS_REVOKED',count,scope:'E2E-HUB-V1',realAccountsTouched:0}));
}
main().catch(e=>{console.error('G8_REVOKE_FAILURE:'+e.message);process.exitCode=2;})
 .finally(()=>db.pool?.end?.());
