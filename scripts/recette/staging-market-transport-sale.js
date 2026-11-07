#!/usr/bin/env node
'use strict';
/**
 * Staging only: public HTTP routes, no direct SQL, no customer payments.
 * Dry-run by default. Exact confirmation SET-RECETTE-TRANSPORT-CM or -CG.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_KM_KMF_PER_KG = Object.freeze({
  SEA_KMF_PER_KG_COMMERCIAL: '65',
  AIR_KMF_PER_KG_TAXABLE: '2500',
});
const KMF_PER_EUR = '491.96775';
const XAF_PER_EUR = '655.957';

function convertKmfToXaf4(kmf) {
  const n = BigInt(String(kmf));
  const numerator = n * 65595700n * 10000n;
  const denominator = 49196775n;
  let q = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && q % 2n)) q++;
  return (q / 10000n).toString() + '.' + (q % 10000n).toString().padStart(4, '0');
}
async function run({ env = process.env, fetchImpl = fetch } = {}) {
  const code = String(env.RECETTE_MARKET || '').toUpperCase();
  if (env.KOMERCE_ENV !== 'staging' || !['CM', 'CG'].includes(code)) throw new Error('STAGING_CM_CG_ONLY');
  const base = String(env.STAGING_BASE_URL || '').replace(/\/$/, '');
  if (base !== 'https://komerce-backend-production.up.railway.app') throw new Error('TARGET_NOT_STAGING');
  const apply = env.RECETTE_CONFIRMATION === `SET-RECETTE-TRANSPORT-${code}`;
  const login = await fetchImpl(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }),
  });
  const lj = await login.json().catch(() => ({}));
  if (login.status !== 200 || lj?.user?.role !== 'admin') throw new Error('ADMIN_LOGIN_FAILED');
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const call = async (method, url, body) => {
    const response = await fetchImpl(base + url, {
      method, headers: { 'content-type': 'application/json', origin: base,
        cookie, 'x-correlation-id': `recette-transport-${code}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  const control = await call('GET', `/api/admin/markets/${code}/control-plane`);
  if (control.status !== 200 || control.json?.market?.lifecycle_status !== 'ACTIVE') throw new Error('MARKET_NOT_ACTIVE');
  const km = await call('GET', '/api/admin/markets/KM/control-plane');
  if (km.status !== 200) throw new Error('KM_READBACK_FAILED');
  // Defaults are explicitly provisional; never infer live business_rules from an API that
  // does not expose them. Override only with separately verified values supplied to this workflow.
  const seaKmf = env.RECETTE_KM_SEA_PER_KG || DEFAULT_KM_KMF_PER_KG.SEA_KMF_PER_KG_COMMERCIAL;
  const airKmf = env.RECETTE_KM_AIR_PER_KG || DEFAULT_KM_KMF_PER_KG.AIR_KMF_PER_KG_TAXABLE;
  for (const v of [seaKmf, airKmf]) if (!/^\d{1,10}$/.test(String(v)) || !(Number(v) > 0)) throw new Error('KM_RATE_INVALID');
  const rates = [
    { key: 'SEA_KMF_PER_KG_COMMERCIAL', kmf: String(seaKmf) },
    { key: 'AIR_KMF_PER_KG_TAXABLE', kmf: String(airKmf) },
  ];
  const report = { market: code, applied: apply, provisional: true,
    basis: { rates: 'KM_DEFAULT_OR_OPERATOR_VERIFIED_OVERRIDE', kmf_per_eur: KMF_PER_EUR, xaf_per_eur: XAF_PER_EUR },
    rates: [], note: 'RECETTE seulement ; prix définitifs à fixer avant partenaires. Aérien non commercialisé.' };
  for (const item of rates) {
    const local = convertKmfToXaf4(item.kmf);
    const evidence = `RECETTE-TRANSPORT-${code}-2026-11-07`;
    const entry = { rate_key: item.key, source_kmf_per_kg: item.kmf, rate_per_kg: local, currency: 'XAF', evidence_ref: evidence };
    if (apply) {
      const response = await call('PUT', `/api/admin/markets/${code}/transport-sale-rates/${item.key}`, {
        rate_per_kg: local, currency: 'XAF', evidence_ref: evidence,
        reason: 'RECETTE provisoire - tarif KM converti via parités EUR; non validé pour vente partenaires',
      });
      entry.http = response.status;
      entry.result = response.json?.rate?.id || response.json?.code || null;
      if (response.status !== 200) {
        report.rates.push(entry);
        report.verdict = 'FAIL';
        return report;
      }
    }
    report.rates.push(entry);
  }
  if (apply) {
    const readback = await call('GET', `/api/admin/markets/${code}/transport-sale-rates`);
    report.readback_http = readback.status;
    report.readback = readback.json?.rates?.map(r => ({ key: r.rate_key, amount: r.rate_per_kg, currency: r.currency, evidence: r.evidence_ref }));
    const confirmed = readback.status === 200 && rates.every(r =>
      report.readback?.some(v => v.key === r.key && v.currency === 'XAF' &&
        Number(v.amount) === Number(convertKmfToXaf4(r.kmf)) && v.evidence.startsWith('RECETTE-TRANSPORT-')));
    report.verdict = confirmed ? 'PASS' : 'FAIL';
  } else report.verdict = 'DRY_RUN';
  return report;
}
async function main() {
  const report = await run();
  fs.mkdirSync('test-results/market-transport', { recursive: true });
  fs.writeFileSync(path.join('test-results/market-transport', 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (report.verdict === 'FAIL') process.exitCode = 1;
}
if (require.main === module) main().catch(e => { console.error('REFUS: ' + e.message); process.exitCode = 2; });
module.exports = { run, convertKmfToXaf4 };
