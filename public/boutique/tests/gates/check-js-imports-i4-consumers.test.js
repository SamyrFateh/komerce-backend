'use strict';
// Debt Zero regression fixture: consumer detection must stay semantic, not regex-noisy.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET = path.join(ROOT, 'js', 'b-boutique-wow-style.js');
const TEST_CONSUMER = path.join(ROOT, 'tests', 'unit', '__i4-test-consumer.test.js');
const DYNAMIC_CONSUMER = path.join(ROOT, 'js', '__i4-dynamic-consumer.js');
let original;

function runGate() {
  return spawnSync('node', [path.join(ROOT, 'scripts', 'check-js-imports.js')], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000,
  });
}

beforeEach(() => { original = fs.readFileSync(TARGET, 'utf8'); });
afterEach(() => {
  fs.writeFileSync(TARGET, original);
  for (const f of [TEST_CONSUMER, DYNAMIC_CONSUMER]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

test('require() Jest declaration consumes a named export for I-4', () => {
  fs.appendFileSync(TARGET, '\nexport function __i4_test_api() { return true; }\n');
  const req = 'requ' + 'ire';
  fs.writeFileSync(TEST_CONSUMER,
    `const { __i4_test_api } = ${req}('../../js/b-boutique-wow-style.js');\n` +
    `test('consumer', () => expect(__i4_test_api()).toBe(true));\n`);
  const r = runGate();
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).not.toMatch(/__i4_test_api/);
});

test('require() Jest assignment destructuring consumes a named export for I-4', () => {
  fs.appendFileSync(TARGET, '\nexport function __i4_assignment_api() { return true; }\n');
  const req = 'requ' + 'ire';
  fs.writeFileSync(TEST_CONSUMER,
    `let __i4_assignment_api; ({ __i4_assignment_api } = ${req}('../../js/b-boutique-wow-style.js'));\n` +
    `test('consumer', () => expect(__i4_assignment_api()).toBe(true));\n`);
  const r = runGate();
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).not.toMatch(/__i4_assignment_api/);
});

test('import() runtime consumes a namespace property for I-4', () => {
  fs.appendFileSync(TARGET, '\nexport function __i4_dynamic_api() { return true; }\n');
  const dyn = 'im' + 'port';
  fs.writeFileSync(DYNAMIC_CONSUMER,
    `${dyn}('./b-boutique-wow-style.js').then(mod => mod.__i4_dynamic_api());\n`);
  const r = runGate();
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).not.toMatch(/__i4_dynamic_api/);
});

test('a real b-* orphan remains an actionable I-4 finding', () => {
  fs.appendFileSync(TARGET, '\nexport function __i4_real_orphan() { return true; }\n');
  const r = runGate();
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).toMatch(/__i4_real_orphan/);
});
