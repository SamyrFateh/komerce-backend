'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief Hub G2 staging: canonical 8-character pickup secret and fail-closed Chromium wiring.
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('fixture code issuer is owner-guarded, canonical and has no stored clear text', () => {
  const source = read('scripts/recette/staging-e2e-pickup-secret-fixture.js');
  expect(() => new Function(source.replace(/^#![^\n]*\n/, ''))).not.toThrow();
  expect(source).toContain('PICKUP_FIXTURE_OWNER_ONLY');
  expect(source).toContain('PICKUP_FIXTURE_TARGET_GUARD');
  expect(source).toContain('PICKUP_FIXTURE_SUFFIX_NOT_ALLOWED');
  expect(source).toContain("['KOM-101', 'LOCAL']");
  expect(source).toContain('confirmTarget({ db, env })');
  expect(source).toContain('ensureSecretGenerated({');
  expect(source).toContain('PICKUP_FIXTURE_SECRET_ALREADY_ISSUED');
  expect(source).toContain('::add-mask::');
  expect(source).toContain('HUB_PICKUP_CODE_IMPORT');
  expect(source).toContain('HUB_PICKUP_CODE_LOCAL');
  expect(source).not.toMatch(/UPDATE\s+orders\s+SET/i);
});

test('staging workflow issues two run-owned secrets after HOLD and before real browser', () => {
  const yml = read('.github/workflows/hub-v1-clicks-staging.yml');
  const pin = yml.indexOf('node scripts/recette/resolve-staging-deploy-pin.js');
  const hold = yml.indexOf('node scripts/recette/hub-v1-staging-transactional-preflight.js');
  const importCode = yml.indexOf('PICKUP_FIXTURE_SUFFIX=KOM-101');
  const localCode = yml.indexOf('PICKUP_FIXTURE_SUFFIX=LOCAL');
  const chromium = yml.indexOf('Clics Chromium');
  expect(pin).toBeGreaterThan(0);
  expect(hold).toBeGreaterThan(pin);
  expect(importCode).toBeGreaterThan(hold);
  expect(localCode).toBeGreaterThan(importCode);
  expect(chromium).toBeGreaterThan(localCode);
  expect(yml).toContain("github.event.issue.user.login == github.repository_owner");
});

test('Chromium pickup uses actual code UI and detects invalid and duplicate handoffs', () => {
  const src = read('tests/staging-clicks/hub-v1-clicks.spec.js');
  expect(() => new Function(src)).not.toThrow();
  expect(src).toContain('[data-pickup-code-input]');
  expect(src).toContain('[data-pickup-code-confirm]');
  expect(src).toContain('POST /api/scans/collect');
  expect(src).toContain('relay:bad-full-code');
  expect(src).toContain('relay:double-collect');
  expect(src).toContain("parcelStatus(imp.reference)");
  expect(src).toContain("parcelStatus(ref)");
  expect(src).toContain("key: 'local:direct-receipt'");
  expect(src).toContain("route: 'POST /api/orders/:id/local-relay-receipt'");
  expect(src).not.toContain("rowButton(page, imp.reference, 'Remis au client')");
  expect((src.match(/^\s*test\('/gm) || []).length).toBe(10);
});
