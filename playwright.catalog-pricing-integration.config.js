'use strict';
const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests/e2e',
  testMatch:'pricing-atelier-views.spec.js',
  fullyParallel:false,
  timeout:45000,
  expect:{timeout:10000},
  workers:1,
  retries:0,
  reporter:'list',
  use:{browserName:'chromium',headless:true,trace:'retain-on-failure',
    screenshot:'only-on-failure'},
  outputDir:'test-results/catalog-pricing-integrated',
});
