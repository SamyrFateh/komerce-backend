'use strict';
const {defineConfig}=require('@playwright/test');
const role=process.env.E2E_ROLE||'admin';
const roles=new Set(['admin','market_operator','finance','sourcing','agent_hub','agent_relais','agent_transitaire']);
if(!roles.has(role))throw Error('Unexpected audit role '+role);
const baseURL='https://komerce-backend-production.up.railway.app';
module.exports=defineConfig({
 testDir:'tests/staging-dashboard-journeys',testMatch:'*.spec.js',
 workers:1,retries:0,fullyParallel:false,timeout:540000,
 projects:[
  {name:role+'-desktop',use:{viewport:{width:1440,height:900}}},
  {name:role+'-mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
 ],
 outputDir:'test-results/real-dashboard-journeys/raw',
 reporter:[['line'],['json',{outputFile:'test-results/real-dashboard-journeys/playwright-'+role+'.json'}]],
 use:{baseURL,browserName:'chromium',headless:true,trace:'on-first-retry',
  actionTimeout:9500,navigationTimeout:21000}
});
