/** Native relay UI + DB proof — official Railway staging only, never local or production PSP. */
'use strict';
const {defineConfig}=require('@playwright/test');
const BASE='https://komerce-backend-production.up.railway.app';
if(process.env.E2E_STAGING_BASE_URL!==BASE)throw Error('LOCAL_NATIVE_STAGING_ONLY');
module.exports=defineConfig({
  testDir:'tests/staging-clicks',testMatch:'local-stock-native-clicks.spec.js',
  outputDir:'test-results/local-stock-native-clicks/raw',
  timeout:180000,retries:0,workers:1,fullyParallel:false,
  reporter:[['line'],['json',{outputFile:'test-results/local-stock-native-clicks/playwright.json'}]],
  use:{baseURL:BASE,browserName:'chromium',headless:true,video:'off',trace:'retain-on-failure',
    viewport:{width:1440,height:900},actionTimeout:15000,navigationTimeout:30000},
});
