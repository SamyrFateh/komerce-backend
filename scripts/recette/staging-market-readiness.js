#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-market-readiness
 * @domain        market-delegation
 * @layer         tooling
 * @criticality   medium
 * @inputs        STAGING_BASE_URL, E2E_ADMIN_EMAIL/PASSWORD, READINESS_MARKETS
 * @outputs       JSON (control-plane : gaps, readiness, equipe, attestation) sans secret
 * @depends       GET /api/admin/markets/:code/control-plane (lecture seule), POST /api/auth/login
 * @used-by       .github/workflows/staging-market-readiness.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      read_only_readiness_before_reopening, staging_only
 * @impact-areas  staging, market-lifecycle
 * @version       2026-11
 */
const fs = require('fs');
const path = require('path');
const ALLOWED = new Set(['KM', 'CM', 'CG', 'YT']);

async function readiness({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.KOMERCE_ENV !== 'staging') throw new Error('STAGING_ONLY');
  const base = String(env.STAGING_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\/komerce-backend-production\.up\.railway\.app$/.test(base)) throw new Error('BASE_URL_NOT_STAGING');
  const markets = String(env.READINESS_MARKETS || 'CM,CG').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const m of markets) if (!ALLOWED.has(m)) throw new Error('MARKET_NOT_ALLOWED:' + m);
  const login = await fetchImpl(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }),
  });
  const lj = await login.json().catch(() => ({}));
  if (login.status !== 200 || !lj.user || lj.user.role !== 'admin') throw new Error('ADMIN_LOGIN_FAILED');
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const out = { markets: [] };
  for (const code of markets) {
    const r = await fetchImpl(`${base}/api/admin/markets/${code}/control-plane`, { headers: { cookie, origin: base } });
    out.markets.push({ code, http: r.status, view: await r.json().catch(() => null) });
  }
  return out;
}

async function main() {
  const report = await readiness();
  fs.mkdirSync('test-results/market-readiness', { recursive: true });
  fs.writeFileSync(path.join('test-results/market-readiness', 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
if (require.main === module) main().catch((e) => { console.error('REFUS: ' + String(e.message)); process.exitCode = 2; });
module.exports = { readiness };
