/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const o = require('../../scripts/recette/hub-h1-h9-readonly-oracles');

const sql = fs.readFileSync(path.join(__dirname, '../../scripts/recette/sql/hub-h1-h9-readonly.sql'), 'utf8');

test('les oracles couvrent H1 à H9 avec H5 double (H5a, H5b)', () => {
  expect(o.parseOracles(sql).map(x => x.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5a', 'H5b', 'H6', 'H7', 'H8', 'H9']);
});

test('chaque oracle est un SELECT unique, sans mutation ni verrou', () => {
  const oracles = o.parseOracles(sql);
  expect(() => o.assertReadOnlySql(oracles)).not.toThrow();
  expect(() => o.assertReadOnlySql([{ id: 'X', sql: "SELECT 1; DELETE FROM orders" }])).toThrow(/NOT_READ_ONLY/);
  expect(() => o.assertReadOnlySql([{ id: 'X', sql: 'SELECT id FROM orders FOR UPDATE' }])).toThrow(/NOT_READ_ONLY/);
  expect(() => o.assertReadOnlySql([{ id: 'X', sql: 'UPDATE orders SET status = 1' }])).toThrow(/NOT_READ_ONLY/);
});

test('verdicts : 0 ligne = PASS ; lignes = FAIL ou à rapprocher ; erreur jamais PASS', () => {
  expect(o.verdictOf('H1', 0)).toBe('PASS');
  expect(o.verdictOf('H4', 2)).toBe('FAIL');
  expect(o.verdictOf('H8', 1)).toBe('FAIL_TO_RECONCILE');
  expect(o.summarize([{ verdict: 'PASS' }, { verdict: 'NOT_PROVEN' }])).toBe('NOT_PROVEN');
  expect(o.summarize([{ verdict: 'FAIL_TO_RECONCILE' }, { verdict: 'FAIL' }])).toBe('FAIL');
  expect(o.summarize([{ verdict: 'PASS' }])).toBe('PASS');
});

test('barrière de SHA : absent ou différent = pas de preuve', () => {
  expect(o.expectedSha({})).toBeNull();
  expect(o.expectedSha({ HUB_EXPECTED_SHA: 'abc1234' })).toBe('abc1234');
  expect(o.shaMatches('abc1234', 'abc1234def5678')).toBe(true);
  expect(o.shaMatches('abc1234', 'fff0000')).toBe(false);
  expect(o.shaMatches('abc1234', null)).toBe(false);
});

test('le workflow ne donne le secret base qu\'après la barrière SHA et reste limité à la branche dédiée', () => {
  const wf = fs.readFileSync(path.join(__dirname, '../../.github/workflows/hub-h1-h9-staging-readonly-oracles.yml'), 'utf8');
  expect(wf).toMatch(/branches: \[cert\/gpt-h1-h9-postmerge-20261114\]/);
  const before = wf.slice(0, wf.indexOf('Run oracles'));
  expect(before).not.toMatch(/RAILWAY_DATABASE_URL/);
  expect(wf).toMatch(/steps\.gate\.outputs\.go == 'true'/);
});
