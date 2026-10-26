/**
 * @komerce-arch-lite
 * @role staging-p1-twenty-chromium-configuration
 * @domain catalog
 * @layer test-config
 * @owner backend-core
 * @purpose Real staging Playwright 20-product P1 proof, desktop/mobile, human-gated manual curation.
 * @impact-areas sourcing, catalog, market, pricing, boutique, staging-only
 */
'use strict';
const {defineConfig}=require('@playwright/test');
const HOST='https://komerce-backend-production.up.railway.app';
if(process.env.E2E_STAGING_BASE_URL!==HOST)throw Error('P1_20_STAGING_HOST_REQUIRED');
if(process.env.KOMERCE_ENV!=='staging')throw Error('P1_20_ENV_REQUIRED');
const interactive=process.env.E2E_P1_20_INTERACTIVE==='1';
module.exports=defineConfig({
  testDir:'./tests/staging-p1-20',
  testMatch:'real-p1-twenty.spec.js',
  timeout:interactive?15*60*1000:90*1000,
  workers:1,fullyParallel:false,retries:0,
  outputDir:'test-results/staging-p1-20/raw',
  reporter:[['list'],['html',{outputFolder:'test-results/staging-p1-20/html',open:'never'}]],
  projects:[
    {name:'P1-20 desktop',use:{viewport:{width:1440,height:900}}},
    {name:'P1-20 mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}
  ],
  use:{
    baseURL:HOST,browserName:'chromium',locale:'fr-FR',
    headless:!interactive,
    trace:'off', // browser traces could retain login/session cookies
    screenshot:'only-on-failure',
    actionTimeout:12000,navigationTimeout:25000
  }
});
