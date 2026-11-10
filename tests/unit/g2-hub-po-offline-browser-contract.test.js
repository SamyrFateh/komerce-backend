/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const spec=fs.readFileSync(path.join(ROOT,'tests/g2-hub-po-browser/canonical-hub-po-clicks.spec.js'),'utf8');
const config=fs.readFileSync(path.join(ROOT,'playwright.g2-hub-po-isolated.config.js'),'utf8');
const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/g2-hub-po-chromium-isolated.yml'),'utf8');

test('real canonical module is loaded into Chromium; all network blocked and no secrets used',()=>{
  expect(spec).toContain('hub-live-cockpit.js');
  expect(spec).toContain('await page.addScriptTag({ content: SCRIPT })');
  expect(spec).toContain("return route.abort('blockedbyclient')");
  expect(spec).toContain("await page.goto('about:blank')");
  expect(spec).toContain("server_write:'NONE'");
  expect(spec).toContain("verdict:'UI_CLICK_CAPTURE_ONLY'");
  expect(spec).not.toMatch(/process\.env\.(?:DATABASE_URL|E2E_\w*PASSWORD|RAILWAY_DATABASE_URL|STRIPE_SECRET_KEY)/);
  expect(spec).not.toMatch(/page\.request\.(?:post|put|delete|patch)|request\.(?:post|put|delete|patch)/);
});

test('workflow is owner-only with no staging secrets or database service',()=>{
  expect(workflow).toContain("github.event.issue.user.login == github.repository_owner");
  expect(workflow).toContain("github.actor == github.repository_owner");
  expect(workflow).toContain('playwright.g2-hub-po-isolated.config.js');
  expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
  expect(workflow).not.toContain('DATABASE_URL:');
  expect(workflow).not.toContain('STAGING_BASE_URL:');
  expect(workflow).not.toContain('services:');
  expect(config).toContain("baseURL:'about:blank'");
  expect(config).toContain("viewport:{width:1440,height:900}");
  expect(config).toContain("trace:'off',screenshot:'off',video:'off'");
});

test('coverage includes preparation, commitment, submission, sent, confirmation, payment and read-only refusal',()=>{
  for(const key of [
    "'/api/purchasing/po/prepare'",
    "'/authorize-commitment'",
    "'/submit'",
    "'/sent'",
    "'/confirm'",
    "'/authorize-payment'",
    "readOnly:true",
  ])expect(spec).toContain(key);
  const tests=(spec.match(/\ntest\('/g)||[]).length;
  expect(tests).toBe(7);
});
