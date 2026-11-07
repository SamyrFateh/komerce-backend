#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-market-activate
 * @domain        market-delegation
 * @layer         tooling
 * @criticality   high
 * @inputs        STAGING_BASE_URL, E2E_ADMIN_EMAIL/PASSWORD, ACTIVATE_MARKET (CM|CG), ACTIVATE_APPLY, ACTIVATE_CONFIRMATION
 * @outputs       JSON (readiness avant/apres, transporteur, attestation, lifecycle) sans secret
 * @depends       routes canoniques uniquement : GET control-plane, POST /api/carriers, POST delivery-attestations, POST lifecycle
 * @used-by       .github/workflows/staging-market-activate.yml
 * @db-read       none
 * @db-write      none (ecritures uniquement par les routes canoniques ; audit MARKET_LIFECYCLE_CHANGED)
 * @db-txn        none
 * @doctrine      official_reopening_only_readiness_then_attestation_then_lifecycle, recette_provisional_values_marked, YT_and_DJ_never_touched
 * @impact-areas  staging, market-lifecycle
 * @version       2026-11
 *
 * Reouverture officielle d'un marche de recette (CM, CG) : readiness VERT exige (sinon arret sans rien ecrire), puis
 * transporteur dedie au corridor + attestation de livrabilite (valeurs PROVISOIRES de recette, a remplacer avant
 * l'ouverture aux partenaires), puis transition lifecycle ACTIVE. Aucun SQL, aucun seed.
 */
const fs = require('fs');
const path = require('path');

// VALEURS PROVISOIRES DE RECETTE : l'utilisateur n'a pas encore les vraies valeurs. A remplacer avant l'ouverture aux partenaires.
const CORRIDORS = Object.freeze({
  CM: { carrier: 'RECETTE — Maritime Dubaï→Douala', origin: 'Hub Dubaï', mode: 'SEA', freight_rate: 1500, rate_currency: 'XAF', rate_unit: 'PER_KG', transit_days: 35 },
  CG: { carrier: 'RECETTE — Maritime Dubaï→Pointe-Noire', origin: 'Hub Dubaï', mode: 'SEA', freight_rate: 1700, rate_currency: 'XAF', rate_unit: 'PER_KG', transit_days: 40 },
});
const VALID_DAYS = 90;

async function activate({ env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  if (env.KOMERCE_ENV !== 'staging') throw new Error('STAGING_ONLY');
  const base = String(env.STAGING_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\/komerce-backend-production\.up\.railway\.app$/.test(base)) throw new Error('BASE_URL_NOT_STAGING');
  const code = String(env.ACTIVATE_MARKET || '').toUpperCase();
  const corridor = CORRIDORS[code];
  if (!corridor) throw new Error('MARKET_NOT_ALLOWED:' + code);
  const apply = env.ACTIVATE_APPLY === '1' && env.ACTIVATE_CONFIRMATION === `ACTIVATE-RECETTE-${code}`;

  const login = await fetchImpl(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }),
  });
  const lj = await login.json().catch(() => ({}));
  if (login.status !== 200 || !lj.user || lj.user.role !== 'admin') throw new Error('ADMIN_LOGIN_FAILED');
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const call = async (method, url, body, corr) => {
    const r = await fetchImpl(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie, ...(corr ? { 'x-correlation-id': corr } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  const report = { market: code, apply, provisional_values: { ...corridor, note: 'PROVISOIRE RECETTE : a remplacer avant ouverture aux partenaires' }, steps: [] };
  const cp = (await call('GET', `/api/admin/markets/${code}/control-plane`)).json;
  report.before = { lifecycle_status: cp.market.lifecycle_status, readiness: cp.readiness, gaps: cp.gaps, delivery_proof: cp.deliveryProof };
  if (!cp.readiness || !cp.readiness.ready_for_activation) { report.result = 'READINESS_NOT_GREEN_NO_WRITE'; return report; }
  if (cp.market.lifecycle_status === 'ACTIVE') { report.result = 'ALREADY_ACTIVE'; return report; }
  if (!apply) { report.result = 'DRY_RUN_READY'; return report; }

  const date = now.toISOString().slice(0, 10);
  const evidence = `RECETTE-PROVISOIRE-${code}-${date}`;
  const carriers = (await call('GET', '/api/carriers')).json;
  let carrier = ((carriers && carriers.data) || []).find((c) => c.name === corridor.carrier);
  if (!carrier) {
    const r = await call('POST', '/api/carriers', { name: corridor.carrier, type: 'maritime', avg_transit_days: corridor.transit_days, notes: `PROVISOIRE RECETTE (${evidence}) : a remplacer avant ouverture aux partenaires` });
    report.steps.push({ step: 'carrier:create', http: r.status });
    if (r.status !== 201) { report.result = 'CARRIER_CREATE_FAILED'; return report; }
    carrier = r.json;
  } else report.steps.push({ step: 'carrier:create', http: 'EXISTS' });

  const proof = cp.deliveryProof || {};
  if (proof.proven && proof.attestation && String(proof.attestation.evidence_ref || '').startsWith(`RECETTE-PROVISOIRE-${code}-`)) report.steps.push({ step: 'attestation', http: 'EXISTS' });
  else {
    const r = await call('POST', `/api/admin/markets/${code}/delivery-attestations`, {
      carrier_id: carrier.id, mode: corridor.mode, origin_ref: corridor.origin, freight_rate: corridor.freight_rate, rate_currency: corridor.rate_currency,
      rate_unit: corridor.rate_unit, transit_days: corridor.transit_days, evidence_ref: evidence, valid_until: new Date(now.getTime() + VALID_DAYS * 86400000).toISOString(),
    }, `cert-attest-${code}`);
    report.steps.push({ step: 'attestation', http: r.status, code: r.json && (r.json.code || r.json.error) || null });
    if (r.status !== 201) { report.result = 'ATTESTATION_FAILED'; return report; }
  }
  const lc = await call('POST', `/api/admin/markets/${code}/lifecycle`, { status: 'ACTIVE' }, `cert-activate-${code}`);
  report.steps.push({ step: 'lifecycle:ACTIVE', http: lc.status, code: lc.json && (lc.json.code || lc.json.error) || null });
  const after = (await call('GET', `/api/admin/markets/${code}/control-plane`)).json;
  report.after = { lifecycle_status: after.market.lifecycle_status, readiness: after.readiness, delivery_proof: after.deliveryProof && { proven: after.deliveryProof.proven, basis: after.deliveryProof.basis } };
  report.result = lc.status === 200 && after.market.lifecycle_status === 'ACTIVE' ? 'ACTIVATED' : 'ACTIVATION_FAILED';
  return report;
}

async function main() {
  const report = await activate();
  fs.mkdirSync('test-results/market-activate', { recursive: true });
  fs.writeFileSync(path.join('test-results/market-activate', 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (/FAILED/.test(report.result)) process.exitCode = 1;
}
if (require.main === module) main().catch((e) => { console.error('REFUS: ' + String(e.message)); process.exitCode = 2; });
module.exports = { activate, CORRIDORS };
