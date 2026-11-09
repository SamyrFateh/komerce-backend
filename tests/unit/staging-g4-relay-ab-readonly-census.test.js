'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const { check, classify, SQL } = require('../../scripts/recette/staging-g4-relay-ab-readonly-census');

const env = () => ({
  KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',NODE_ENV:'test',
  KOMERCE_DISABLE_CRONS:'true',EXPECTED_RAILWAY_ENVIRONMENT:'staging',
  STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
  G4_CENSUS_CONFIRMATION:'G4-READ-ONLY',
  E2E_EXPECTED_DEPLOY_SHA:'a'.repeat(40),
});

test('fails closed outside the pinned official staging target', () => {
  expect(() => check(env())).not.toThrow();
  for(const [k,v] of [
    ['KOMERCE_ENV','production'],['KOMERCE_TARGET_ENV','production'],
    ['NODE_ENV','production'],['KOMERCE_DISABLE_CRONS','false'],
    ['EXPECTED_RAILWAY_ENVIRONMENT','production'],
    ['STAGING_BASE_URL','https://example.org'],
    ['G4_CENSUS_CONFIRMATION','WRITES_ALLOWED'],
    ['E2E_EXPECTED_DEPLOY_SHA',''],
  ]) expect(() => check({...env(),[k]:v})).toThrow();
});

test('one E2E agent cannot certify two distinct relay identities', () => {
  const r=classify([{code:'KM',dedicated_agents:1,distinct_active_relais:1,relais_with_e2e_orders:1}]);
  expect(r.candidate_markets).toEqual([]);
  expect(r.verdict).toMatch(/^BLOCKED_/);
  expect(r.certification).toBe('NOT_PROVEN');
});

test('two agents at same relay are not an A/B test', () => {
  const r=classify([{code:'KM',dedicated_agents:2,distinct_active_relais:1,relais_with_e2e_orders:1}]);
  expect(r.candidate_markets).toEqual([]);
});

test('two relays with E2E dossiers are only candidates, never a certification PASS', () => {
  const r=classify([{code:'KM',dedicated_agents:2,distinct_active_relais:2,relais_with_e2e_orders:2}]);
  expect(r.verdict).toBe('AB_CANDIDATES_PRESENT_ONLY');
  expect(r.certification).toBe('NOT_PROVEN');
});

test('source and workflow constrain read-only access and avoid customer data exports', () => {
  const source=fs.readFileSync(path.join(__dirname,'../../scripts/recette/staging-g4-relay-ab-readonly-census.js'),'utf8');
  const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/staging-g4-relay-ab-census.yml'),'utf8');
  expect(source).toMatch(/REPEATABLE READ READ ONLY/);
  expect(source).toMatch(/confirmTarget/);
  expect(source).toMatch(/E2E_EXPECTED_DEPLOY_SHA/);
  expect(SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  expect(workflow).toMatch(/github\.event\.issue\.user\.login == github\.repository_owner/);
  expect(workflow).toMatch(/ref: main/);
  expect(workflow).toMatch(/resolve-staging-deploy-pin/);
  expect(workflow).toMatch(/target-guard/);
});
