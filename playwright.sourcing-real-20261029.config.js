'use strict';const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'tests/journey-sourcing-20261029',testMatch:'sourcing-real.spec.js',
 workers:1,retries:0,timeout:180000,
 projects:[{name:'desktop-1440',use:{viewport:{width:1440,height:900},browserName:'chromium'}}],
 use:{headless:true,navigationTimeout:22000,actionTimeout:12000},
 reporter:[['line']],
});