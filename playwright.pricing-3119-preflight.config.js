'use strict';
const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'tests/pricing-3119-acceptance',
  testMatch:'live-pricing-preflight.spec.js',
  workers:1,retries:0,
  timeout:120000,
  projects:[{name:'desktop-1440',use:{viewport:{width:1440,height:900}}}],
  use:{browserName:'chromium',headless:true,actionTimeout:13000,navigationTimeout:16000},
  reporter:[['line']],
});
