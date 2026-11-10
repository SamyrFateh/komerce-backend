/**
 * Real G3 Chromium against isolated localhost/PG16 only; never Railway.
 * Reuses the official G3 browser gesture assertions without mocked APIs.
 */
'use strict';
const {defineConfig}=require('@playwright/test');
const {assertEphemeralTarget}=require('./scripts/recette/hub-v1-certification-runner');
const LOCAL='http://localhost:3917';
assertEphemeralTarget(process.env.DATABASE_URL,[]);
if(process.env.G3_ISOLATED_LOCAL!=='1'||
   process.env.E2E_CLICKS_BASE_URL!==LOCAL||
   process.env.KOMERCE_ENV!=='test'||process.env.NODE_ENV!=='test'||
   process.env.KOMERCE_TARGET_ENV==='staging'||
   process.env.E2E_STAGING_BASE_URL||process.env.STAGING_BASE_URL||
   !/^[a-f0-9]{40}$/i.test(String(process.env.E2E_EXPECTED_DEPLOY_SHA||'')))
  throw Error('G3_LOCAL_CHROMIUM_DISPOSABLE_TARGET_ONLY');
module.exports=defineConfig({
  testDir:'tests/staging-clicks',
  testMatch:'local-stock-native-clicks.spec.js',
  outputDir:'test-results/local-stock-native-clicks/raw',
  timeout:180000,retries:0,workers:1,fullyParallel:false,
  reporter:[['line'],['json',{outputFile:'test-results/local-stock-native-clicks/playwright.json'}]],
  use:{baseURL:LOCAL,browserName:'chromium',headless:true,video:'off',trace:'retain-on-failure',
    viewport:{width:1440,height:900},actionTimeout:15000,navigationTimeout:30000}
});
