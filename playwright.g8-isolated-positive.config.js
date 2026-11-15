'use strict';
/** Genuine G8 Chromium localhost PG16 only, no Railway. */
const {defineConfig}=require('@playwright/test');
require('./scripts/recette/hub-v1-certification-runner').assertEphemeralTarget(process.env.DATABASE_URL,[]);
if(process.env.G8_ISOLATED_LOCAL!=='1'||process.env.E2E_CLICKS_BASE_URL!=='http://localhost:3917'||
   process.env.KOMERCE_ENV!=='staging'||process.env.NODE_ENV!=='test'||
   process.env.STAGING_BASE_URL||process.env.E2E_STAGING_BASE_URL||
   !/^[a-f0-9]{40}$/i.test(String(process.env.E2E_EXPECTED_DEPLOY_SHA||'')))
 throw Error('G8_CHROMIUM_DISPOSABLE_PG16_ONLY');
module.exports=defineConfig({
 testDir:'tests/staging-clicks',testMatch:'g8-isolated-positive.spec.js',
 timeout:180000,retries:0,workers:1,fullyParallel:false,
 outputDir:'test-results/g8-positive-isolated/traces',
 reporter:[['line'],['json',{outputFile:'test-results/g8-positive-isolated/playwright.json'}]],
 use:{baseURL:'http://localhost:3917',browserName:'chromium',headless:true,
  video:'off',trace:'retain-on-failure',viewport:{width:1440,height:900},
  actionTimeout:15000,navigationTimeout:30000}
});
