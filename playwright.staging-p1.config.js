/** @komerce-arch-lite @role staging-p1-browser-config @domain catalog @layer test-config @owner backend-core @impact-areas sourcing,catalog,e2e-certification */
'use strict';
const {defineConfig}=require('@playwright/test');
const host='https://komerce-backend-production.up.railway.app';
if(process.env.E2E_STAGING_BASE_URL&&process.env.E2E_STAGING_BASE_URL!==host)throw Error('P1_HOST_NOT_ALLOWED');
module.exports=defineConfig({
 testDir:'tests/staging-p1',testMatch:'*.spec.js',timeout:120000,retries:0,workers:1,
 outputDir:'test-results/staging-p1/raw',
 reporter:[['line'],['html',{outputFolder:'test-results/staging-p1/html',open:'never'}]],
 projects:[{name:'p1-desktop',use:{viewport:{width:1440,height:900}}},
 {name:'p1-mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
 use:{baseURL:host,browserName:'chromium',headless:true,trace:'on',screenshot:'on',actionTimeout:12000}
});
