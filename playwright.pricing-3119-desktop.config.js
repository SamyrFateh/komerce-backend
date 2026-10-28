'use strict';
const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'tests/pricing-3119-acceptance',testMatch:'real-atelier-desktop.spec.js',
 workers:1,retries:0,timeout:210000,
 projects:[{name:'desktop-1440',use:{viewport:{width:1440,height:900}}}],
 use:{browserName:'chromium',headless:true,actionTimeout:12000,navigationTimeout:25000},
 reporter:[['line']]
});
