'use strict';
/** Railway accepts only one preDeployCommand argv; don't rely on shell &&. */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
if(process.env.KOMERCE_RECETTE_ISOLATED!=='true' ||
   !String(process.env.DATABASE_URL||'').includes('.railway.internal:')){
  throw Error('RECETTE_PRIVATE_DB_REQUIRED');
}
for(const name of ['seed-isolated-reference-data.js','probe-authenticated-workspaces.js']){
  const script=path.resolve(__dirname,name);
  const p=spawnSync(process.execPath,[script],{
    env:process.env,stdio:'inherit',timeout:120000,
  });
  if(p.error || p.status!==0){
    console.error('RECETTE_PREDEPLOY_BLOCKED',name,p.error?.code||p.status);
    process.exit(1);
  }
}
console.log('RECETTE_PREDEPLOY_PASS: synthetic refs, login, three workspaces, payment firewall');
