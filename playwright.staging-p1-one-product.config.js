/**
 * @komerce-arch-lite
 * @role p1-one-real-product-functional-test-config
 * @domain catalog
 * @layer test-config
 * @owner backend-core
 * @purpose Separate low-cost, read-only staging P1 single product certification.
 * @impact-areas sourcing, catalog, market, boutique, staging-only
 */
'use strict';
const {defineConfig}=require('@playwright/test');
const ORIGIN='https://komerce-backend-production.up.railway.app';
if(process.env.E2E_STAGING_BASE_URL!==ORIGIN ||
   process.env.KOMERCE_ENV!=='staging' ||
   process.env.E2E_P1_20_HUMAN_MODE!=='read-only'){
  throw Error('P1_FUNCTIONAL_TARGET_REQUIRED');
}
module.exports=defineConfig({
  testDir:'./tests/staging-p1-20',
  testMatch:'real-p1-one-product.functional.spec.js',
  timeout:90000,
  workers:1,fullyParallel:false,retries:0,
  outputDir:'test-results/staging-p1-one-product/raw',
  reporter:[['list'],['html',{outputFolder:'test-results/staging-p1-one-product/html',open:'never'}]],
  projects:[
    {name:'P1-functional desktop',use:{viewport:{width:1440,height:900}}},
    {name:'P1-functional mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}
  ],
  use:{
    baseURL:ORIGIN,browserName:'chromium',locale:'fr-FR',headless:true,
    trace:'off', // no recorded authentication cookies
    screenshot:'only-on-failure',
    actionTimeout:12000,navigationTimeout:30000
  }
});
