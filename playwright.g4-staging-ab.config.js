'use strict';
/** Two fully independent Chromium sessions on Railway staging for KM G4 A/B. */
const {defineConfig}=require('@playwright/test');
const BASE='https://komerce-backend-production.up.railway.app';
if(process.env.KOMERCE_ENV!=='staging'||
   process.env.STAGING_BASE_URL!==BASE||
   process.env.HUB_V1_STAGING_DISPOSABLE_MODE!=='1'||
   !['KM','CM','CG'].includes(process.env.G4_MARKET))
  throw Error('G4_BROWSER_OFFICIAL_STAGING_ONLY');
module.exports=defineConfig({
 testDir:'tests/staging-clicks',
 testMatch:'g4-relay-ab-real-staging.spec.js',
 outputDir:'test-results/g4-staging/raw',
 timeout:240000,workers:1,retries:0,
 reporter:[['line'],['json',{outputFile:'test-results/g4-staging/playwright.json'}]],
 use:{baseURL:BASE,browserName:'chromium',headless:true,
  viewport:{width:1440,height:900},trace:'retain-on-failure',
  actionTimeout:16000,navigationTimeout:30000},
});
