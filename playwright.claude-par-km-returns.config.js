/** Certification Chromium parallele Claude KM retours/SAV — staging officiel uniquement. */
'use strict';
const {defineConfig}=require('@playwright/test');
const BASE='https://komerce-backend-production.up.railway.app';
if(process.env.E2E_STAGING_BASE_URL!==BASE)throw Error('CLAUDE_PAR_STAGING_ONLY');
module.exports=defineConfig({
  testDir:'tests/staging-clicks',testMatch:'claude-par-km-returns.spec.js',
  outputDir:'test-results/claude-par-km-returns/raw',
  timeout:1500000,retries:0,workers:1,fullyParallel:false,
  reporter:[['line'],['json',{outputFile:'test-results/claude-par-km-returns/playwright.json'}]],
  use:{baseURL:BASE,browserName:'chromium',headless:true,video:'off',trace:'retain-on-failure',
    viewport:{width:1440,height:900},actionTimeout:20000,navigationTimeout:30000},
});
