#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-market-transport-sale-rates
 * @domain        logistics
 * @layer         tooling
 * @criticality   high
 * @inputs        STAGING_BASE_URL, DATABASE_URL, E2E_ADMIN_*, SALE_RATE_MARKET, SALE_RATE_CONFIRMATION
 * @outputs       evidence report per market, actual KM rates and governed EUR pivot conversion
 * @depends       services/fx-authority.js, official authenticated admin market routes
 * @used-by       .github/workflows/staging-market-transport-sale-rates.yml
 * @db-read       business_rules, currency_parities (via fx-authority)
 * @db-write      none (official HTTP routes only)
 * @db-txn        none (each HTTP versioned write is atomic)
 * @doctrine      staging_only, provisional_RECETTE, current_KM_rates_as_source, explicit_confirm, no_SQL_writes
 * @impact-areas  staging, pricing, checkout, certification
 * @version       2026-11
 */
const fs = require('fs');
const path = require('path');

const KEYS = ['SEA_KMF_PER_KG_COMMERCIAL', 'AIR_KMF_PER_KG_TAXABLE'];
const BASE = 'https://komerce-backend-production.up.railway.app';

function permitted(env) {
  if (env.KOMERCE_ENV !== 'staging' || env.NODE_ENV === 'production') throw new Error('STAGING_ONLY');
  if (String(env.STAGING_BASE_URL || '').replace(/\/$/, '') !== BASE) throw new Error('BASE_URL_NOT_STAGING');
  const market = String(env.SALE_RATE_MARKET || '').toUpperCase();
  if (!['CM', 'CG'].includes(market)) throw new Error('MARKET_NOT_ALLOWED');
  const apply = env.SALE_RATE_CONFIRMATION === `APPLY-RECETTE-TRANSPORT-${market}`;
  if (env.SALE_RATE_APPLY === '1' && !apply) throw new Error('CONFIRMATION_REQUIRED');
  return { market, apply: env.SALE_RATE_APPLY === '1' && apply };
}

function fourDecimals(amountText, fx) {
  const { n, d } = fx.parseDecimal(amountText);
  const q = fx.roundHalfEven(n, d, 4);
  if (q <= 0n) throw new Error('CONVERSION_NON_POSITIVE');
  return `${q / 10000n}.${(q % 10000n).toString().padStart(4, '0')}`;
}

async function run({ env = process.env, fetchImpl = fetch, db = null, fx = null } = {}) {
  const { market, apply } = permitted(env);
  const executor = db || require('../../db');
  const authority = fx || require('../../services/fx-authority');
  const { rows } = await executor.query(
    `SELECT key, value FROM business_rules WHERE key = ANY($1::text[])`, [KEYS]
  );
  if (rows.length !== 2) throw new Error('KM_BUSINESS_RULES_INCOMPLETE');
  const baselines = [];
  for (const key of KEYS) {
    const row = rows.find(r => r.key === key);
    if (!row) throw new Error('KM_RATE_MISSING:' + key);
    const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    const kmf = String(val && val.value);
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(kmf) || !(Number(kmf) > 0)) throw new Error('KM_RATE_INVALID:' + key);
    const converted = await authority.convert({ amount: kmf, from: 'KMF', to: 'XAF', round: false, client: executor });
    baselines.push({ key, kmf_per_kg: kmf, xaf_per_kg: fourDecimals(converted.amount_text, authority),
      fx_legs: converted.legs.map(l => ({ pair: l.pair, rate: l.rate, source: l.source, id: l.id })) });
  }

  const report = { market, apply, source: 'live staging business_rules + fx-authority EUR pivot',
    nature: 'RECETTE — prix de VENTE simulé, pas coût du corridor, pas tarif partenaire',
    tariff_lines: baselines, steps: [] };

  if (!apply) { report.verdict = 'DRY_RUN_READY'; return report; }
  const login = await fetchImpl(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }),
  });
  const auth = await login.json().catch(() => ({}));
  if (login.status !== 200 || auth.user?.role !== 'admin') throw new Error('ADMIN_LOGIN_FAILED');
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const call = async (method, uri, payload) => {
    const response = await fetchImpl(BASE + uri, { method, headers: { origin: BASE, cookie, 'content-type': 'application/json',
      'x-correlation-id': `recette-transport-${market}` }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  };
  const endpoint = `/api/admin/markets/${market}/transport-sale-rates`;
  const previous = await call('GET', endpoint);
  if (previous.status !== 200 || previous.json.currency !== 'XAF') throw new Error('MARKET_CURRENCY_READBACK_FAILED');
  for (const row of previous.json.rates || []) {
    if (!String(row.evidence_ref || '').startsWith('RECETTE-')) throw new Error('REFUSE_OVERWRITE_REAL_TARIFF');
  }
  const date = new Date().toISOString().slice(0, 10);
  const evidence = `RECETTE-VENTE-TRANSPORT-${market}-${date}`;
  for (const line of baselines) {
    const reply = await call('PUT', `${endpoint}/${line.key}`, {
      rate_per_kg: line.xaf_per_kg, currency: 'XAF', evidence_ref: evidence,
      reason: 'RECETTE staging : équivalent du tarif KM courant converti en XAF par fx-authority (non commercial)',
    });
    report.steps.push({ rate_key: line.key, status: reply.status, code: reply.json.code || null,
      changed: reply.json.changed === true });
    if (![200, 201].includes(reply.status)) { report.verdict = 'REFUSED_WRITE'; return report; }
  }
  const after = await call('GET', endpoint);
  const verified = after.status === 200 && baselines.every(line =>
    (after.json.rates || []).some(rate => rate.rate_key === line.key &&
      Number(rate.rate_per_kg) === Number(line.xaf_per_kg) && rate.currency === 'XAF' && rate.evidence_ref === evidence));
  report.readback = { status: after.status, matched: verified, evidence_ref: evidence };
  report.verdict = verified ? 'TARIFFS_APPLIED_AND_VERIFIED' : 'READBACK_FAILED';
  return report;
}

async function main() {
  const report = await run();
  const directory = 'test-results/market-transport-sale';
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!['DRY_RUN_READY', 'TARIFFS_APPLIED_AND_VERIFIED'].includes(report.verdict)) process.exitCode = 1;
}

if (require.main === module) main().catch(e => { console.error('REFUS: ' + String(e.message).slice(0, 200)); process.exitCode = 2; });
module.exports = { run, permitted, fourDecimals };
