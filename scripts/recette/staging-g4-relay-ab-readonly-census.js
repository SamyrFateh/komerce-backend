#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-g4-relay-ab-readonly-census
 * @domain        market-delegation
 * @layer         tooling
 * @criticality   high
 * @inputs        guarded staging DATABASE_URL, STAGING_BASE_URL, E2E_EXPECTED_DEPLOY_SHA
 * @outputs       anonymized per-market E2E relay A/B readiness (NOT a G4 certificate)
 * @depends       scripts/recette/target-guard.js, /health/version
 * @used-by       .github/workflows/staging-g4-relay-ab-census.yml
 * @db-read       e2e_test_accounts, users, relais, markets, orders
 * @db-write      none
 * @db-txn        REPEATABLE READ READ ONLY; ROLLBACK
 * @doctrine      target_guard_before_read, no_identity_leak, two_independent_agents_required
 * @impact-areas  staging, security, market-delegation, relay
 * @version       2026-11
 */
const fs = require('fs');
const path = require('path');
const { confirmTarget } = require('./target-guard');
const BASE = 'https://komerce-backend-production.up.railway.app';
const MARKETS = Object.freeze(['KM', 'CM', 'CG']);
const OUTPUT = 'test-results/g4-relay-ab/readonly-census.json';

function check(env) {
  if (env.KOMERCE_ENV !== 'staging' || env.KOMERCE_TARGET_ENV !== 'staging' ||
      env.NODE_ENV !== 'test' || env.KOMERCE_DISABLE_CRONS !== 'true' ||
      env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging' ||
      env.STAGING_BASE_URL !== BASE) throw Error('STAGING_ONLY');
  if (env.G4_CENSUS_CONFIRMATION !== 'G4-READ-ONLY') throw Error('G4_READ_ONLY_ACK_REQUIRED');
  if (!/^[a-f0-9]{40}$/i.test(String(env.E2E_EXPECTED_DEPLOY_SHA || ''))) {
    throw Error('EXACT_RUNTIME_SHA_PIN_REQUIRED');
  }
}

function classify(rows) {
  const counts = Object.fromEntries(MARKETS.map(code => {
    const r = rows.find(item => item.code === code) || {};
    return [code, {
      dedicated_agents: Number(r.dedicated_agents || 0),
      distinct_active_relais: Number(r.distinct_active_relais || 0),
      relais_with_e2e_orders: Number(r.relais_with_e2e_orders || 0),
    }];
  }));
  const ready = MARKETS.filter(code => {
    const n = counts[code];
    return n.dedicated_agents >= 2 && n.distinct_active_relais >= 2 &&
      n.relais_with_e2e_orders >= 2;
  });
  return {
    counts,
    candidate_markets: ready,
    verdict: ready.length ? 'AB_CANDIDATES_PRESENT_ONLY' :
      'BLOCKED_MISSING_SAME_MARKET_TWO_RELAY_E2E_FIXTURES',
    certification: 'NOT_PROVEN',
  };
}

const SQL = [
  'WITH dedicated AS (',
  ' SELECT m.code, u.id AS user_id, u.relais_id',
  ' FROM e2e_test_accounts e',
  ' JOIN users u ON u.id=e.user_id AND u.role::text=\'agent_relais\'',
  ' JOIN relais r ON r.id=u.relais_id AND r.is_active IS TRUE',
  ' JOIN markets m ON m.id=r.market_id',
  ' WHERE m.code=ANY($1::text[])',
  '), per_relais AS (',
  ' SELECT d.code,d.relais_id,COUNT(DISTINCT d.user_id)::int AS agents,',
  ' COUNT(DISTINCT o.id)::int AS e2e_orders',
  ' FROM dedicated d LEFT JOIN orders o ON o.relais_id=d.relais_id',
  '   AND o.reference LIKE \'E2E-HUB-V1-%\'',
  ' GROUP BY d.code,d.relais_id',
  ')',
  'SELECT code, SUM(agents)::int AS dedicated_agents,',
  ' COUNT(*)::int AS distinct_active_relais,',
  ' COUNT(*) FILTER (WHERE e2e_orders>0)::int AS relais_with_e2e_orders',
  ' FROM per_relais GROUP BY code ORDER BY code',
].join('\n');

async function census({env=process.env, executor, fetchImpl=fetch} = {}) {
  check(env);
  const db = executor || require('../../db');
  const target = await confirmTarget({db, fetchImpl, env});
  if (!target.confirmed) throw Error('STAGING_FINGERPRINT_NOT_CONFIRMED');
  const response = await fetchImpl(BASE + '/health/version');
  if (!response.ok) throw Error('RUNTIME_SHA_UNAVAILABLE');
  const version = await response.json();
  const runtime = String(version.commit || '');
  if (runtime.toLowerCase() !== env.E2E_EXPECTED_DEPLOY_SHA.toLowerCase()) {
    throw Error('RUNTIME_SHA_MISMATCH');
  }
  const client = await db.getClient();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {rows} = await client.query(SQL, [MARKETS]);
    const result = classify(rows);
    await client.query('ROLLBACK');
    return {schema:'g4-relay-ab-readonly-census/1',target:'OFFICIAL_STAGING',
      runtime_sha:runtime,mode:'READ_ONLY',persistent_writes:0,...result};
  } catch(e) {
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally {
    client.release();
  }
}
async function main() {
  const db = require('../../db');
  let report;
  try {report = await census({executor:db});}
  catch(e) {
    report={schema:'g4-relay-ab-readonly-census/1',verdict:'BLOCKED',
      certification:'NOT_PROVEN',reason:String(e.code || e.message).slice(0,100),persistent_writes:0};
    process.exitCode=2;
  }
  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if (report.verdict === 'BLOCKED_MISSING_SAME_MARKET_TWO_RELAY_E2E_FIXTURES') process.exitCode=3;
  if (db.pool?.end) await db.pool.end();
}
if (require.main===module) main();
module.exports={check,classify,census,MARKETS,SQL};
