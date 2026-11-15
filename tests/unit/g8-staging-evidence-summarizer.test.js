'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief G8 staging Chromium archive accepts only exact role/SHA/OFF safety evidence.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/recette/summarize-staging-chromium.js'), 'utf8');
const EXPECTED = 'a'.repeat(40);

function summarize(proof, hasProof = true) {
  const root = path.resolve('test-results/staging-chromium');
  const dir = path.join(root, 'evidence');
  const file = path.join(dir, 'g8-refunds-readonly.json');
  const written = new Map();
  const fakeFs = {
    existsSync(name) { return name === dir || (name === file && hasProof); },
    readdirSync(name) { return name === dir ? ['g8-refunds-readonly.json'] : []; },
    mkdirSync() {},
    readFileSync(name) {
      if (name === file && hasProof) return JSON.stringify(proof);
      throw new Error('READ_UNEXPECTED:' + name);
    },
    writeFileSync(name, content) { written.set(name, content); }
  };
  const env = { E2E_CHROMIUM_SPEC_FILTER:'g8-refunds-readonly', E2E_EXPECTED_DEPLOY_SHA:EXPECTED };
  const result = { env, exitCode:0 };
  const logs = [];
  const context = {
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'path') return path;
      if (name === '../../tests/staging-canonical/matrix') return {markets:[],dimensions:[],processes:[]};
      throw new Error('UNEXPECTED_MODULE:'+name);
    },
    process: result,
    console: { log: s => logs.push(s) }
  };
  vm.runInNewContext(script, context, { timeout: 1000 });
  return { report:written.get(path.join(root, 'rapport.md')), result, logs };
}
const valid = {
  verdict:'G8_STAGING_DISABLED_UI_PASS', initialSha:EXPECTED, finalSha:EXPECTED,
  admin:true, relay:true, disabled:true, blockedWrites:0, jsErrors:0, realPayouts:0
};
describe('G8 staging redacted Chromium evidence summary', () => {
  test('PASS only for exact pinned SHA, authentic browser roles and financial OFF', () => {
    const r=summarize(valid);
    expect(r.result.exitCode).toBe(0);
    expect(r.report).toContain('Verdict securite des operations desactivees : PASS');
    expect(r.report).toContain('NOT_PROVEN');
    expect(r.report).not.toContain('GO financier');
  });
  test.each([
    ['wrong final SHA', {finalSha:'b'.repeat(40)}],
    ['missing admin', {admin:false}],
    ['missing relay', {relay:false}],
    ['flags activated', {disabled:false}],
    ['blocked mutation', {blockedWrites:1}],
    ['JavaScript error', {jsErrors:1}],
    ['real transfer', {realPayouts:1}],
    ['invalid declared verdict', {verdict:'PASS'}]
  ])('fails closed: %s', (_name, change) => {
    const r=summarize({...valid, ...change});
    expect(r.result.exitCode).toBe(2);
    expect(r.report).toContain('FAIL');
  });
  test('fails closed without an archived evidence file', () => {
    expect(() => summarize(valid, false)).toThrow('G8_READONLY_PROOF_MISSING');
  });
});
