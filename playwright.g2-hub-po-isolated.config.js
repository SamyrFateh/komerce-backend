/**
 * @komerce-arch-lite
 * @role g2-hub-po-offline-real-chromium
 * @domain dashboard
 * @layer test-config
 * @purpose True Chromium browser, controlled in-memory Hub PO data; no HTTP or DB.
 */
'use strict';
const { defineConfig } = require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests/g2-hub-po-browser',
  testMatch:'*.spec.js',
  timeout:30000,
  retries:0,
  workers:1,
  fullyParallel:false,
  reporter:[['line'],['json',{outputFile:'test-results/g2-hub-po-chromium-isolated/playwright.json'}]],
  use:{
    browserName:'chromium',headless:true,
    viewport:{width:1440,height:900},
    baseURL:'about:blank',
    trace:'off',screenshot:'off',video:'off',
    actionTimeout:8000,navigationTimeout:8000,
  },
});
