#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-market-isolation
 * @domain        market-delegation
 * @layer         tooling
 * @criticality   medium
 * @inputs        STAGING_BASE_URL, E2E_ADMIN_*, E2E_AGENT_RELAIS_*
 * @outputs       matrice croisee marche x acteur (statuts HTTP) et verdict d'isolation, sans secret
 * @depends       GET/POST /api/admin/workspaces/operations/market/:code (lecture et ecriture refusee sur reference inexistante)
 * @used-by       .github/workflows/staging-market-isolation.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      market_isolation_cross_check, read_only_probe_no_data_change
 * @impact-areas  staging, market-delegation, security
 * @version       2026-11
 *
 * Un agent relais est lie a UN relais, donc a UN marche. Croise KM, CM et CG : lecture du workspace Operations et geste
 * d'ecriture (collect sur une reference inexistante, jamais de donnee touchee) doivent etre refuses (403) hors du marche du
 * relais ; l'admin central (controle) lit les trois (la sonde d'ecriture collect est reservee au role relais). Verdict ISOLATION_PASS si exactement un marche repond 200 a l'agent
 * relais en lecture, que les deux autres repondent 403 en lecture ET en ecriture.
 */
const fs = require('fs');
const path = require('path');
const MARKETS = ['KM', 'CM', 'CG'];

async function isolation({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.KOMERCE_ENV !== 'staging') throw new Error('STAGING_ONLY');
  const base = String(env.STAGING_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\/komerce-backend-production\.up\.railway\.app$/.test(base)) throw new Error('BASE_URL_NOT_STAGING');
  const session = async (email, password) => {
    const r = await fetchImpl(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (r.status !== 200) throw new Error('LOGIN_FAILED');
    return { role: j.user && j.user.role, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  const call = async (s, method, url) => {
    const r = await fetchImpl(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie: s.cookie }, ...(method === 'POST' ? { body: JSON.stringify({ reason: 'scanner_unavailable' }) } : {}) });
    return r.status;
  };
  const actors = { admin: await session(env.E2E_ADMIN_EMAIL, env.E2E_ADMIN_PASSWORD), agent_relais: await session(env.E2E_AGENT_RELAIS_EMAIL, env.E2E_AGENT_RELAIS_PASSWORD) };
  const matrix = {};
  for (const [name, s] of Object.entries(actors)) {
    matrix[name] = { role: s.role };
    for (const m of MARKETS) {
      const ws = `/api/admin/workspaces/operations/market/${m}`;
      matrix[name][m] = { read: await call(s, 'GET', ws), write_probe: await call(s, 'POST', `${ws}/parcels/ISOLATION-PROBE-NONE/collect`) };
    }
  }
  const own = MARKETS.filter((m) => matrix.agent_relais[m].read === 200);
  const others = MARKETS.filter((m) => !own.includes(m));
  const relayOk = own.length === 1 && others.every((m) => matrix.agent_relais[m].read === 403 && matrix.agent_relais[m].write_probe === 403);
  const adminOk = MARKETS.every((m) => matrix.admin[m].read === 200) // l'ecriture collect est reservee au role relais (garde de role) : non significative pour l'admin;
  return { matrix, relay_home_market: own, verdict: relayOk && adminOk ? 'ISOLATION_PASS' : 'ISOLATION_FAIL' };
}

async function main() {
  const report = await isolation();
  fs.mkdirSync('test-results/market-isolation', { recursive: true });
  fs.writeFileSync(path.join('test-results/market-isolation', 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (report.verdict !== 'ISOLATION_PASS') process.exitCode = 1;
}
if (require.main === module) main().catch((e) => { console.error('REFUS: ' + String(e.message)); process.exitCode = 2; });
module.exports = { isolation };
