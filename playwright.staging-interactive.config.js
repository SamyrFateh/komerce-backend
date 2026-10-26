/**
 * @komerce-arch-lite
 * @role staging-interactive-local-playwright-config
 * @domain dashboard
 * @layer test-config
 * @owner backend-core
 * @purpose Interactive read-only Chromium from the user's computer against Railway staging.
 * @impact-areas dashboard, staging-only
 */
'use strict';
const {defineConfig}=require('@playwright/test');
const {ALL_ROLES}=require('./tests/staging-canonical/role-selection');
const {DOMAINS}=require('./tests/staging-interactive/domain-catalog');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const baseURL=process.env.E2E_STAGING_BASE_URL||ORIGIN;
if(new URL(baseURL).origin!==ORIGIN)throw Error('STAGING_ORIGIN_REQUIRED');
const role=process.env.E2E_INTERACTIVE_ROLE||'admin';
if(!ALL_ROLES.includes(role))throw Error('UNKNOWN_E2E_ROLE');
const domain=process.env.E2E_INTERACTIVE_DOMAIN||'all';
if(domain!=='all'&&!Object.prototype.hasOwnProperty.call(DOMAINS,domain))
  throw Error('UNKNOWN_E2E_DOMAIN');
const device=process.env.E2E_INTERACTIVE_DEVICE||'desktop';
if(!['desktop','mobile','both'].includes(device))throw Error('UNKNOWN_E2E_DEVICE');
const devices=device==='both'?['desktop','mobile']:[device];

module.exports=defineConfig({
  testDir:'./tests/staging-interactive',
  testMatch:'*.spec.js',
  outputDir:'test-results/staging-interactive/raw',
  timeout:90000,retries:0,workers:1,fullyParallel:false,
  reporter:[['list'],['html',{outputFolder:'test-results/staging-interactive/html',open:'never'}]],
  projects:devices.map(viewport=>({
    name:role+'-'+viewport,
    use:viewport==='mobile'
      ? {viewport:{width:390,height:844},isMobile:true,hasTouch:true}
      : {viewport:{width:1440,height:900}}
  })),
  use:{
    baseURL,browserName:'chromium',
    headless:process.env.E2E_INTERACTIVE_HEADLESS==='1',
    trace:'off', // local interactive traces may retain credential/API details
    screenshot:'only-on-failure',
    actionTimeout:10000,navigationTimeout:20000,
    locale:'fr-FR',
  },
});
