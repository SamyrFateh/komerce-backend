'use strict';
/** @komerce-arch-lite
 * @role g8-official-staging-chromium-config
 * @domain refunds
 * @layer e2e
 * @owner backend-core
 * @purpose Positive Chromium against already-deployed official Railway staging ONLY.
 * @impact-areas staging, refunds
 */
const {defineConfig}=require('@playwright/test');
const origin='https://komerce-backend-production.up.railway.app';
const e=process.env;
if(e.G8_STAGING_SYNTHETIC_APPROVED!=='1'||
   e.KOMERCE_ENV!=='staging'||e.KOMERCE_TARGET_ENV!=='staging'||
   e.NODE_ENV!=='test'||e.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'||
   e.STAGING_BASE_URL!==origin||
   !/^[A-F0-9]{8}$/.test(e.G8_RUN8||'')||
   !/^[0-9a-f]{40}$/i.test(String(e.E2E_EXPECTED_DEPLOY_SHA||''))||
   e.GITHUB_ACTOR!==e.GITHUB_REPOSITORY_OWNER)
 throw Error('G8_OFFICIAL_STAGING_CHROMIUM_NOT_AUTHORIZED');
module.exports=defineConfig({
 testDir:'tests/staging-clicks',testMatch:'g8-staging-positive.spec.js',
 timeout:180000,retries:0,workers:1,fullyParallel:false,
 outputDir:'test-results/g8-staging-positive/traces',
 reporter:[['line'],['json',{outputFile:'test-results/g8-staging-positive/playwright.json'}]],
 use:{baseURL:origin,browserName:'chromium',headless:true,
  video:'off',trace:'retain-on-failure',viewport:{width:1440,height:900},
  actionTimeout:20000,navigationTimeout:30000}
});
