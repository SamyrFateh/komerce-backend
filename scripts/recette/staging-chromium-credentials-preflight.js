#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch-lite
 * @role staging-chromium-secret-preflight
 * @domain dashboard
 * @layer tooling
 * @purpose Fail fast if GitHub Actions does not have all selected E2E identities.
 *
 * The output contains only secret VARIABLE NAMES, never values.
 * Account existence, permissions and real login are NOT checked here.
 */
const fs=require('fs');
const path=require('path');
const {selectedRoles}=require('../../tests/staging-canonical/role-selection');
const OUTPUT=path.resolve('test-results/staging-chromium/credentials-preflight.json');
function inspect(env=process.env) {
  const roles=selectedRoles(env.E2E_AUDIT_ROLES||'all');
  const missing=[];
  for(const role of roles) {
    const prefix='E2E_'+role.toUpperCase()+'_';
    for(const suffix of ['EMAIL','PASSWORD']){
      const key=prefix+suffix;
      if(!String(env[key]||'').trim())missing.push(key);
    }
  }
  // A targeted Hub Director proof uses the admin runner but authenticates two
  // distinct agent_hub identities. An exhaustive unfiltered run includes it too.
  const filter=String(env.E2E_CHROMIUM_SPEC_FILTER||'').trim();
  const directorIncluded=env.E2E_AUDIT_QUICK!=='1' &&
    (filter.includes('hub-director-readonly') ||
     (!filter && String(env.E2E_AUDIT_ROLES||'all').toLowerCase()==='all'));
  if(directorIncluded) {
    for(const prefix of ['E2E_HUB_DIRECTOR_','E2E_AGENT_HUB_']) {
      for(const suffix of ['EMAIL','PASSWORD']) {
        const key=prefix+suffix;
        if(!String(env[key]||'').trim() && !missing.includes(key))missing.push(key);
      }
    }
  }
  return {
    status:missing.length?'MISSING_GITHUB_ACTIONS_SECRETS':'CREDENTIAL_NAMES_CONFIGURED_LOGIN_UNVERIFIED',
    selected_roles:roles,
    missing_secret_names:missing,
    checked_at:new Date().toISOString(),
    note:'A nonempty secret does not prove correct credentials, active account, grants, or successful login.'
  };
}
function run(env=process.env) {
  const report=inspect(env);
  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log('[chromium-preflight] '+report.status);
  console.log('[chromium-preflight] profiles: '+report.selected_roles.join(', '));
  if(report.missing_secret_names.length) {
    console.error('[chromium-preflight] Missing GitHub Actions secret names: '+report.missing_secret_names.join(', '));
    process.exitCode=2;
  }
  return report;
}
if(require.main===module) {
  try{run();}
  catch(error) {
    console.error('[chromium-preflight] '+error.message);
    process.exitCode=2;
  }
}
module.exports={inspect,run};
