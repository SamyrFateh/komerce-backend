/**
 * @komerce-arch-lite
 * @role canonical-chromium-staging-config
 * @domain dashboard
 * @layer test-config
 * @owner backend-core
 * @purpose Chromium réel sur staging (ni mocks, ni serveur local).
 * @impact-areas dashboard, market, staging-only
 */
'use strict';
const { defineConfig } = require('@playwright/test');
const {selectedRoles}=require('./tests/staging-canonical/role-selection');
const selected=selectedRoles(process.env.E2E_AUDIT_ROLES||'all');
const baseURL=process.env.E2E_STAGING_BASE_URL||'https://komerce-backend-production.up.railway.app';
if(new URL(baseURL).origin!=='https://komerce-backend-production.up.railway.app') throw Error('Staging host only');
module.exports=defineConfig({
 testDir:'./tests/staging-canonical',testMatch:'*.spec.js',
 outputDir:'test-results/staging-chromium/raw',
 timeout:900000,retries:0,workers:1,fullyParallel:false,
 reporter:[['line'],['html',{outputFolder:'test-results/staging-chromium/html',open:'never'}],
 ['json',{outputFile:'test-results/staging-chromium/playwright.json'}]],
 projects:selected.flatMap(role=>[
 {name:role+'-desktop',use:{viewport:{width:1440,height:900}}},
 {name:role+'-mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}]),
 use:{baseURL,browserName:'chromium',headless:true,trace:'on',screenshot:'only-on-failure',
 actionTimeout:10000,navigationTimeout:20000}
});
