#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-market-suspend
 * @domain        market-delegation
 * @layer         tooling
 * @criticality   high
 * @inputs        STAGING_BASE_URL, E2E_ADMIN_EMAIL/PASSWORD, DATABASE_URL (lecture), SUSPEND_MARKETS, SUSPEND_APPLY, SUSPEND_CONFIRMATION
 * @outputs       JSON (HTTP, avant/apres, audit) sans secret
 * @depends       scripts/recette/target-guard.js, POST /api/admin/markets/:code/lifecycle (seul writer canonique)
 * @used-by       .github/workflows/staging-market-suspend.yml
 * @db-read       markets, market_delegation_audit
 * @db-write      aucune directe (ecriture uniquement par la route canonique)
 * @doctrine      canonical_lifecycle_only, KM_and_DJ_never_touched, staging_only
 * @impact-areas  staging, market-lifecycle
 * @version       2026-11
 */
const fs = require('fs');
const path = require('path');
const { confirmTarget } = require('./target-guard');
const ALLOWED = new Set(['CM', 'CG', 'YT']);
const CONFIRMATION = 'SUSPEND-CM-CG-YT';

function parseMarkets(raw) {
  const list = String(raw || 'CM,CG,YT').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const code of list) if (!ALLOWED.has(code)) throw new Error('MARKET_NOT_ALLOWED:' + code);
  return [...new Set(list)];
}

async function suspend({ db, env = process.env, fetchImpl = fetch, apply = false }) {
  if (env.KOMERCE_ENV !== 'staging' || env.KOMERCE_TARGET_ENV !== 'staging') throw new Error('STAGING_ONLY');
  const markets = parseMarkets(env.SUSPEND_MARKETS);
  const base = String(env.STAGING_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\/komerce-backend-production\.up\.railway\.app$/.test(base)) throw new Error('BASE_URL_NOT_STAGING');
  const target = await confirmTarget({ db, fetchImpl, env });
  if (!target.confirmed) throw new Error('STAGING_FINGERPRINT_NOT_CONFIRMED');

  const report = { apply, markets: [], writes: 0 };
  const read = async (code) => {
    const { rows: [m] } = await db.query('SELECT lifecycle_status, is_active FROM markets WHERE code=$1', [code]);
    const { rows: [a] } = await db.query(
      `SELECT a.occurred_at, a.correlation_id, a.payload_before->>'lifecycle_status' AS from_status, a.payload_after->>'lifecycle_status' AS to_status
         FROM market_delegation_audit a JOIN markets mk ON mk.id=a.market_id
        WHERE mk.code=$1 AND a.action='MARKET_LIFECYCLE_CHANGED' ORDER BY a.occurred_at DESC LIMIT 1`, [code]
    );
    return { lifecycle_status: m && m.lifecycle_status, is_active: m && m.is_active, last_lifecycle_audit: a || null };
  };

  const login = await fetchImpl(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }),
  });
  const loginJson = await login.json().catch(() => ({}));
  report.login = { status: login.status, role: loginJson && loginJson.user && loginJson.user.role };
  if (login.status !== 200 || report.login.role !== 'admin') throw new Error('ADMIN_LOGIN_FAILED');
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  for (const code of markets) {
    const row = { code, before: await read(code) };
    if (!apply) row.http = 'DRY_RUN';
    else if (row.before.lifecycle_status === 'SUSPENDED') row.http = 'SKIP_ALREADY_SUSPENDED';
    else {
      const r = await fetchImpl(`${base}/api/admin/markets/${code}/lifecycle`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie, 'x-correlation-id': 'cert-suspend-' + code },
        body: JSON.stringify({ status: 'SUSPENDED' }),
      });
      const j = await r.json().catch(() => ({}));
      row.http = r.status; row.code = j.code || j.error || null;
      if (r.status === 200) report.writes += 1;
    }
    row.after = await read(code);
    report.markets.push(row);
  }
  return report;
}

async function main() {
  const db = require('../../db');
  try {
    const apply = process.env.SUSPEND_APPLY === '1' && process.env.SUSPEND_CONFIRMATION === CONFIRMATION;
    const report = await suspend({ db, apply });
    fs.mkdirSync('test-results/market-suspend', { recursive: true });
    fs.writeFileSync(path.join('test-results/market-suspend', 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}
if (require.main === module) main().catch((e) => { console.error('REFUS: ' + String(e.message)); process.exitCode = 2; });
module.exports = { suspend, parseMarkets, CONFIRMATION };
