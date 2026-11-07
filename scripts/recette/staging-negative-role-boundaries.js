#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-negative-role-boundaries
 * @domain        market-delegation
 * @layer         tooling
 * @criticality   high
 * @inputs        staging base URL, E2E admin/hub/transitaire/relay identities
 * @outputs       fail-closed HTTP status matrix, no personal data
 * @depends       existing authentication and canonical Hub / admin role guards
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      staging_only, no_real_writes, real_roles, deny_cross_authority
 */
const fs = require('fs');
const path = require('path');
const BASE = 'https://komerce-backend-production.up.railway.app';
const ABSENT_ORDER = '00000000-0000-4000-8000-000000000000';
const ACTORS = Object.freeze([
  { name: 'admin', role: 'admin', prefix: 'ADMIN' },
  { name: 'hub', role: 'agent_hub', prefix: 'AGENT_HUB' },
  { name: 'transitaire', role: 'agent_transitaire', prefix: 'AGENT_TRANSITAIRE' },
  { name: 'relais', role: 'agent_relais', prefix: 'AGENT_RELAIS' },
]);
const PROBES = Object.freeze([
  { name: 'hub_dashboard', method: 'GET', path: '/api/hub-dash/dashboard', admin: 200, hub: 200, transitaire: 403, relais: 403 },
  { name: 'hub_queue', method: 'GET', path: '/api/hub-dash/queue', admin: 200, hub: 200, transitaire: 403, relais: 403 },
  { name: 'hub_start_prep_absent', method: 'POST', path: '/api/hub-dash/orders/' + ABSENT_ORDER + '/start-prep', admin: 404, hub: 404, transitaire: 403, relais: 403 },
  { name: 'hub_backorder_absent', method: 'POST', path: '/api/hub-dash/orders/' + ABSENT_ORDER + '/backorder', admin: 404, hub: 404, transitaire: 403, relais: 403 },
  { name: 'hub_ship_absent', method: 'POST', path: '/api/admin/workspaces/operations/market/CG/parcels/ISOLATION-PROBE-NONEXISTENT/ship', admin: 404, hub: 404, transitaire: 403, relais: 403 },
  { name: 'market_control_plane', method: 'GET', path: '/api/admin/markets/CG/control-plane', admin: 200, hub: 403, transitaire: 403, relais: 403 },
  { name: 'market_transport_sale_rates', method: 'GET', path: '/api/admin/markets/CG/transport-sale-rates', admin: 200, hub: 403, transitaire: 403, relais: 403 },
  // Only non-admin actors: admin never calls the mutation route in this campaign.
  { name: 'forbidden_transport_price_write', method: 'PUT', path: '/api/admin/markets/CG/transport-sale-rates/SEA_KMF_PER_KG_COMMERCIAL', hub: 403, transitaire: 403, relais: 403 },
]);
function assertAllowed(env) {
  if (env.KOMERCE_ENV !== 'staging' || env.NODE_ENV === 'production') throw new Error('STAGING_ONLY');
  if (env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging') throw new Error('EXPECTED_STAGING_ENV_REQUIRED');
  if (String(env.STAGING_BASE_URL || '').replace(/\/$/, '') !== BASE) throw new Error('STAGING_HOST_MISMATCH');
  if (env.NEGATIVE_ROLE_CONFIRMATION !== 'CERTIFY-ROLE-REFUSALS') throw new Error('EXACT_CONFIRMATION_REQUIRED');
  return true;
}
async function login(fetchImpl, env, actor) {
  const email = env['E2E_' + actor.prefix + '_EMAIL'];
  const password = env['E2E_' + actor.prefix + '_PASSWORD'];
  if (!email || !password) throw new Error('CREDENTIALS_MISSING_' + actor.name);
  const response = await fetchImpl(BASE + '/api/auth/login', {
    method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await response.json().catch(() => ({}));
  if (response.status !== 200 || json.user?.role !== actor.role) throw new Error('ROLE_LOGIN_MISMATCH_' + actor.name);
  const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('SESSION_COOKIE_MISSING_' + actor.name);
  return cookie;
}
async function run({ env = process.env, fetchImpl = fetch } = {}) {
  assertAllowed(env);
  const sessions = {};
  for (const actor of ACTORS) sessions[actor.name] = await login(fetchImpl, env, actor);
  const probes = [];
  for (const probe of PROBES) for (const actor of ACTORS) {
    if (!Object.prototype.hasOwnProperty.call(probe, actor.name)) continue;
    const response = await fetchImpl(BASE + probe.path, {
      method: probe.method,
      headers: { origin: BASE, cookie: sessions[actor.name], 'content-type': 'application/json' },
      ...(probe.method === 'POST' || probe.method === 'PUT'
        ? { body: JSON.stringify({ reason: 'RECETTE_NO_OBJECT', confirmation: false }) } : {}),
    });
    const got = response.status, expected = probe[actor.name];
    probes.push({ probe: probe.name, role: actor.name, expected, observed: got,
      verdict: got === expected ? 'PASS' : 'FAIL' });
  }
  const failures = probes.filter(p => p.verdict !== 'PASS');
  return {
    schema: 'staging-negative-role-boundaries/1',
    target: 'OFFICIAL_STAGING',
    verdict: failures.length ? 'ROLE_BOUNDARY_FAIL' : 'ROLE_BOUNDARY_PASS',
    checks: probes.length, passed: probes.length - failures.length,
    violations: failures, probes,
    guarantee: 'all writes are forbidden by role or use nonexistent object references; no order, shipment, tariff or payment created',
  };
}
async function main() {
  const report = await run();
  const dir = 'test-results/negative-role-boundaries';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (report.verdict !== 'ROLE_BOUNDARY_PASS') process.exitCode = 1;
}
if (require.main === module) main().catch(e => { console.error('REFUS: ' + String(e.code || e.message).slice(0,180)); process.exitCode = 2; });
module.exports = { assertAllowed, run, ACTORS, PROBES };
