'use strict';
const {defineConfig}=require('@playwright/test');
const role=process.env.E2E_ROLE||'admin';
if(!['admin','sourcing'].includes(role))throw Error('Unexpected role for UI acceptance');
module.exports=defineConfig({
  testDir:'tests/staging-sourcing-catalog-v5',
  testMatch:'read-only.spec.js',
  timeout:180000,
  workers:1,retries:0,fullyParallel:false,
  projects:[
    {name:'desktop',use:{viewport:{width:1440,height:900}}},
    {name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  ],
  use:{browserName:'chromium',headless:true,actionTimeout:12000,navigationTimeout:30000},
  reporter:[['line'],['json',{outputFile:'test-results/sourcing-catalog-staging/playwright-'+role+'.json'}]],
});
