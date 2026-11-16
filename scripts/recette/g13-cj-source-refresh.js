#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g13-cj-targeted-source-refresh
 * @domain sourcing
 * @layer tooling
 * @owner backend-core
 * @purpose Exact owner-only staging CJ source refresh, canary before batch; canonical API writes and SQL read-only proofs.
 * @db-read sourcing_candidates
 * @db-write none (authorized Sourcing API only)
 * @impact-areas sourcing, supplier-integration, catalog
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const BASE = 'https://komerce-backend-production.up.railway.app';
const OUT = path.resolve('test-results/g13-cj-source-refresh/report.json');
const CANDIDATES = Object.freeze([
  { candidate_ref: 'KSC-000524', supplier_product_id: '2601060946311626300', purpose: 'Enfant / school backpack' },
  { candidate_ref: 'KSC-000515', supplier_product_id: '2601040212471629500', purpose: 'Enfant / construction toy' },
  { candidate_ref: 'KSC-000619', supplier_product_id: '2605040701161608500', purpose: 'Enfant / insulated bottle' },
  { candidate_ref: 'KSC-000623', supplier_product_id: '2606180903171639400', purpose: 'Enfant / straw bottle' },
  { candidate_ref: 'KSC-000688', supplier_product_id: '1775800548592193536', purpose: 'Bricolage / scissors' },
  { candidate_ref: 'KSC-000725', supplier_product_id: '1377142388740460544', purpose: 'Creations personnelles / personalized necklace' },
]);
function selectScope(scope) {
  if (scope === 'canary') return CANDIDATES.slice(0, 1);
  if (scope === 'batch') return CANDIDATES.slice(1);
  throw new Error('G13_CJ_REFRESH_SCOPE_REFUSED');
}
function guard(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER
      || env.KOMERCE_ENV !== 'staging' || env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging'
      || env.STAGING_BASE_URL !== BASE
      || !String(env.PGOPTIONS || '').includes('default_transaction_read_only=on')
      || !/^\d{5,20}$/.test(env.GITHUB_RUN_ID || '')
      || !env.E2E_ADMIN_EMAIL || !env.E2E_ADMIN_PASSWORD) throw new Error('G13_CJ_REFRESH_GUARD_REFUSED');
  return selectScope(env.G13_CJ_REFRESH_SCOPE);
}
async function ro(sql, params = []) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='15000ms'");
    return (await client.query(sql, params)).rows;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
const SQL = [
  'SELECT sc.candidate_ref, sc.supplier_product_id, sc.state, sc.product_id,',
  "UPPER(sc.scan_result->>'sourcing_decision') AS decision,",
  "(SELECT COUNT(*)::int FROM jsonb_array_elements(",
  "CASE WHEN jsonb_typeof(sc.normalized_source_contract->'sellable_units')='array'",
  "THEN sc.normalized_source_contract->'sellable_units' ELSE '[]'::jsonb END",
  ") unit WHERE COALESCE((unit->>'is_active')::boolean,TRUE)",
  "AND NULLIF(BTRIM(unit->>'supplier_sku'),'') IS NOT NULL",
  "AND NULLIF(BTRIM(unit->>'supplier_unit_ref'),'') IS NOT NULL",
  "AND jsonb_typeof(unit->'supplier_order_identity')='object'",
  "AND (unit->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'",
  "AND (unit->>'stock_available')::numeric > 0) AS active_exact_stocked",
  'FROM sourcing_candidates sc WHERE sc.candidate_ref=$1',
  "AND LOWER(sc.supplier_name)='cjdropshipping' AND sc.supplier_product_id=$2",
  'ORDER BY sc.updated_at DESC LIMIT 1',
].join(' ');
async function auth(env) {
  const response = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }),
  });
  if (!response.ok) throw new Error('ADMIN_LOGIN_HTTP_' + response.status);
  const cookie = response.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
  const me = await fetch(BASE + '/api/auth/me', { headers: { cookie, origin: BASE } });
  const actor = await me.json().catch(() => ({}));
  if (!me.ok || (actor?.role || actor?.user?.role) !== 'admin') throw new Error('ADMIN_ROLE_NOT_PROVEN');
  return cookie;
}
async function refresh(candidate, cookie) {
  const response = await fetch(BASE + '/api/admin/workspaces/sourcing/imports', {
    method: 'POST', headers: { cookie, origin: BASE, 'content-type': 'application/json' },
    body: JSON.stringify({
      source_type: 'api', supplier_id: 'cj', supplier_name: 'CJdropshipping',
      platform: 'cj', product_ids: [candidate.supplier_product_id],
    }),
  });
  const body = await response.json().catch(() => ({}));
  return { http_status: response.status, ok: response.ok, code: body.code || body.error || null,
    result: body.status || null, imported: body.total_imported ?? body.imported ?? null };
}
async function main(env = process.env) {
  const report = { schema: 'g13-cj-source-refresh/1', scope: env.G13_CJ_REFRESH_SCOPE || null,
    run_id: env.GITHUB_RUN_ID || null, verdict: 'NOT_PROVEN', entries: [] };
  const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n'); };
  try {
    const scope = guard(env);
    const target = await confirmTarget({ db, env });
    if (!target.confirmed) throw new Error('TARGET_NOT_CONFIRMED');
    report.db_fingerprint = target.fingerprint;
    const cookie = await auth(env);
    for (const wanted of scope) {
      const [before] = await ro(SQL, [wanted.candidate_ref, wanted.supplier_product_id]);
      const item = { ...wanted, before_active_exact_stocked: Number(before?.active_exact_stocked || 0),
        candidate_state_before: before?.state || null, sourcing_decision_before: before?.decision || null };
      report.entries.push(item);
      if (!before || before.product_id || before.state !== 'scanned' || before.decision !== 'TEST') {
        item.verdict = 'PRECONDITION_REFUSED'; save(); continue;
      }
      if (item.before_active_exact_stocked > 0) { item.verdict = 'ALREADY_SOURCE_READY'; save(); continue; }
      const api = await refresh(wanted, cookie);
      item.api = api;
      const [after] = await ro(SQL, [wanted.candidate_ref, wanted.supplier_product_id]);
      item.after_active_exact_stocked = Number(after?.active_exact_stocked || 0);
      item.sourcing_decision_after = after?.decision || null;
      item.verdict = api.ok && item.after_active_exact_stocked > 0 && after?.decision === 'TEST'
        ? 'SOURCE_V2_ACTIVE_UNITS_PROVEN_NOT_PUBLISHED' : 'SOURCE_REFRESH_NOT_READY';
      save();
    }
    const valid = report.entries.filter(x => ['ALREADY_SOURCE_READY','SOURCE_V2_ACTIVE_UNITS_PROVEN_NOT_PUBLISHED'].includes(x.verdict));
    report.ready = valid.length;
    report.verdict = valid.length === scope.length ? 'SOURCE_READY_NOT_G13_GO' : 'SOURCE_PARTIAL_NOT_G13_GO';
    if (valid.length !== scope.length) process.exitCode = 2;
  } catch (error) {
    report.verdict = 'BLOCKED';
    report.error = String(error.code || error.message || error).slice(0, 240);
    process.exitCode = 2;
  } finally {
    save();
    await db.pool.end().catch(() => {});
    console.log(JSON.stringify({ verdict: report.verdict, scope: report.scope, ready: report.ready || 0,
      entries: report.entries.length, error: report.error || null }));
  }
}
if (require.main === module) main();
module.exports = { CANDIDATES, selectScope, guard };
