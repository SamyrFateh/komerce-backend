#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-cert-prereq-readonly
 * @domain        market
 * @layer         tooling
 * @criticality   medium
 * @inputs        DATABASE_URL (staging), STAGING_BASE_URL, E2E_EXPECTED_DEPLOY_SHA (optionnel)
 * @outputs       JSON par marche (lifecycle, readiness, parite, relais, scopes, catalogue) + gates globales
 * @depends       scripts/recette/target-guard.js, services/market-control-plane.js (getControlPlane, lecture seule)
 * @used-by       .github/workflows/staging-cert-prereq-readonly.yml
 * @db-read       markets, schema_migrations, currency_parities, market_delegation_audit, operator_market_scopes, relais, users,
 *                market_central_collection_modes, market_transport_sale_rates, product_market_price_drafts, product_market_exposure,
 *                local_stock, product_suppliers + tables lues par getControlPlane
 * @db-write      none
 * @db-txn        BEGIN READ ONLY ; SAVEPOINT par requete (une table absente est rapportee, jamais fatale)
 * @doctrine      staging_only, read_only, never_claims_business_go, no_secret_output
 * @impact-areas  staging, market-delegation, certification
 * @version       2026-11
 */
const fs = require('fs');
const path = require('path');
const { confirmTarget } = require('./target-guard');

const MARKETS = Object.freeze(['KM', 'CM', 'CG', 'YT', 'DJ']);

async function safe(client, label, sql, params = []) {
  await client.query('SAVEPOINT q');
  try {
    const { rows } = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT q');
    return { ok: true, rows };
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT q');
    return { ok: false, error: `${label}: ${e.code || ''} ${String(e.message).slice(0, 120)}` };
  }
}

function migrationFiles(root) {
  const dir = path.join(root, 'migrations');
  return fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
}

async function globalSection(client, root) {
  const files = migrationFiles(root);
  const applied = await safe(client, 'schema_migrations', 'SELECT filename FROM public.schema_migrations');
  const set = new Set((applied.rows || []).map((r) => r.filename));
  const missing = applied.ok ? files.filter((f) => !set.has(f)) : null;
  const parities = await safe(client, 'currency_parities', 'SELECT currency, eur_rate::text AS eur_rate, updated_at FROM currency_parities ORDER BY currency');
  const dup = await safe(client, 'dup_supplier_priority',
    'SELECT COUNT(*)::int AS n FROM (SELECT product_id,priority FROM product_suppliers WHERE is_active=TRUE AND deleted_at IS NULL GROUP BY 1,2 HAVING COUNT(*)>1) d');
  const roles = await safe(client, 'roles',
    "SELECT role::text AS role, COUNT(*)::int AS n FROM users WHERE role::text IN ('admin','agent_hub','agent_relais','market_operator','agent_transitaire','finance','sourcing') GROUP BY 1 ORDER BY 1");
  return {
    migrations: { repo_files: files.length, applied_known: set.size, missing_in_db: missing, error: applied.error || null },
    currency_parities: parities.ok ? parities.rows : parities.error,
    duplicate_supplier_priority: dup.ok ? dup.rows[0].n : dup.error,
    roles: roles.ok ? roles.rows : roles.error,
  };
}

async function marketSection(client, code, controlPlane) {
  const m = await safe(client, 'market', 'SELECT id, code, currency, minor_unit, is_active, lifecycle_status FROM markets WHERE code=$1', [code]);
  if (!m.ok || !m.rows[0]) return { code, present: false, error: m.error || 'MARKET_ABSENT' };
  const mk = m.rows[0];
  const q = (label, sql) => safe(client, label, sql, [mk.id]);
  const [par, audit, modes, rates, relais, scopes, drafts, expo, stock] = await Promise.all([
    safe(client, 'parity', 'SELECT eur_rate::text AS eur_rate FROM currency_parities WHERE currency=$1', [mk.currency]),
    q('lifecycle_audit', "SELECT occurred_at, correlation_id, payload_before->>'lifecycle_status' AS from_status, payload_after->>'lifecycle_status' AS to_status FROM market_delegation_audit WHERE market_id=$1 AND action='MARKET_LIFECYCLE_CHANGED' ORDER BY occurred_at DESC LIMIT 5"),
    q('central_collection_modes', 'SELECT payment_mode, evidence_ref IS NOT NULL AS has_evidence FROM market_central_collection_modes WHERE market_id=$1 AND revoked_at IS NULL'),
    q('transport_sale_rates', 'SELECT rate_key, currency FROM market_transport_sale_rates WHERE market_id=$1 AND revoked_at IS NULL'),
    q('relais', 'SELECT id, is_active FROM relais WHERE market_id=$1 ORDER BY created_at'),
    q('operator_scopes', "SELECT u.role::text AS user_role, s.role AS scope_role, COUNT(*)::int AS n FROM operator_market_scopes s JOIN users u ON u.id=s.user_id WHERE s.market_id=$1 AND s.revoked_at IS NULL GROUP BY 1,2"),
    q('price_drafts', 'SELECT status, COUNT(*)::int AS n FROM product_market_price_drafts WHERE market_id=$1 GROUP BY 1 ORDER BY 1'),
    q('exposure', 'SELECT commercial_exposure, COUNT(*)::int AS n FROM product_market_exposure WHERE market_id=$1 GROUP BY 1 ORDER BY 1'),
    q('local_stock', 'SELECT COUNT(*)::int AS n FROM local_stock WHERE market_id=$1'),
  ]);
  const val = (r) => (r.ok ? r.rows : { error: r.error });
  const cp = controlPlane && !controlPlane.error ? {
    readiness: controlPlane.readiness,
    gaps: controlPlane.gaps,
    payment_providers: controlPlane.paymentProviders,
    cash_policy: controlPlane.cashPolicy,
    relais_active: controlPlane.relaisActive,
    assignment: controlPlane.assignment ? { status: controlPlane.assignment.status, central_referent_set: Boolean(controlPlane.assignment.central_referent_user_id) } : null,
    team_size: (controlPlane.team || []).length,
    delivery_proof_proven: Boolean(controlPlane.deliveryProof && controlPlane.deliveryProof.proven),
  } : { error: controlPlane && controlPlane.error };
  const auditRows = audit.ok ? audit.rows : [];
  // Dernier evenement canonique (tri DESC) : un ACTIVE ancien ne valide pas un etat courant reecrit hors route.
  const toActive = auditRows.length > 0 && auditRows[0].to_status === 'ACTIVE';
  const ready = Boolean(cp.readiness && cp.readiness.ready_for_activation === true);
  const checks = {
    parity_present: par.ok && par.rows.length === 1,
    // ACTIVE sans trace d'une transition canonique : le passage a pu contourner POST /api/admin/markets/:code/lifecycle
    active_without_canonical_audit: mk.lifecycle_status === 'ACTIVE' && !toActive,
    active_but_not_ready: mk.lifecycle_status === 'ACTIVE' && !ready,
    active_flag_consistent: mk.is_active === (mk.lifecycle_status === 'ACTIVE' || mk.lifecycle_status === 'SUSPENDED'),
  };
  return {
    code, present: true, currency: mk.currency, minor_unit: mk.minor_unit, is_active: mk.is_active, lifecycle_status: mk.lifecycle_status,
    parity_eur_rate: par.ok ? (par.rows[0] || null) : par.error,
    control_plane: cp, lifecycle_audit_last5: val(audit), central_collection_modes: val(modes), transport_sale_rates: val(rates),
    relais: val(relais), operator_scopes_by_role: val(scopes), price_drafts_by_status: val(drafts), exposure: val(expo), local_stock_rows: val(stock),
    checks,
  };
}

async function assess({ db, fetchImpl = fetch, env = process.env, root = process.cwd() } = {}) {
  if (env.KOMERCE_ENV !== 'staging' || env.KOMERCE_TARGET_ENV !== 'staging') throw new Error('STAGING_ONLY');
  const target = await confirmTarget({ db, fetchImpl, env });
  if (!target.confirmed) throw new Error('STAGING_FINGERPRINT_NOT_CONFIRMED');
  const base = String(env.STAGING_BASE_URL || '').replace(/\/$/, '');
  const vr = await fetchImpl(`${base}/health/version`);
  if (!vr.ok) throw new Error('STAGING_RUNTIME_SHA_UNAVAILABLE');
  const runtime = String((await vr.json()).commit || '');
  const expected = String(env.E2E_EXPECTED_DEPLOY_SHA || '');
  const { getControlPlane } = require('../../services/market-control-plane');
  const client = await db.getClient();
  try {
    await client.query('BEGIN READ ONLY');
    const glob = await globalSection(client, root);
    const markets = {};
    for (const code of MARKETS) {
      let cp;
      await client.query('SAVEPOINT cp');
      try { cp = await getControlPlane(client, code); await client.query('RELEASE SAVEPOINT cp'); }
      catch (e) { await client.query('ROLLBACK TO SAVEPOINT cp'); cp = { error: String(e.code || e.message).slice(0, 80) }; }
      markets[code] = await marketSection(client, code, cp);
    }
    await client.query('ROLLBACK');
    const gates = [
      { id: 'RUNTIME_SHA_MATCHES_EXPECTED', pass: expected ? runtime.toLowerCase() === expected.toLowerCase() : null, observed: runtime.slice(0, 12) },
      { id: 'ALL_REPO_MIGRATIONS_APPLIED', pass: glob.migrations.missing_in_db ? glob.migrations.missing_in_db.length === 0 : null, observed: glob.migrations.missing_in_db },
      { id: 'KM_ACTIVE', pass: markets.KM.lifecycle_status === 'ACTIVE' },
      { id: 'DJ_NOT_ACTIVE', pass: !markets.DJ.present ? null : markets.DJ.lifecycle_status !== 'ACTIVE' && markets.DJ.is_active === false },
      ...['CM', 'CG', 'YT'].map((c) => ({ id: `${c}_ACTIVE_IS_CANONICAL`, pass: markets[c].present ? !(markets[c].checks.active_without_canonical_audit || markets[c].checks.active_but_not_ready) : null, observed: markets[c].lifecycle_status })),
    ];
    return { mode: 'READ_ONLY', runtime_sha: runtime.slice(0, 12), expected_sha: expected.slice(0, 12) || null, global: glob, markets, gates,
      never_claims: 'business GO ; ce rapport ne prouve ni transaction ni livrabilite' };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connexion deja fermee */ }
    throw e;
  } finally { client.release(); }
}

async function main() {
  const db = require('../../db');
  try {
    const report = await assess({ db });
    const dir = path.join('test-results', 'cert-prereq');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prereq-readonly.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ gates: report.gates, markets: Object.fromEntries(Object.entries(report.markets).map(([k, v]) => [k, { lifecycle: v.lifecycle_status, checks: v.checks }])) }, null, 2));
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}

if (require.main === module) main().catch((e) => { console.error(`REFUS: ${String(e.message)}`); process.exitCode = 2; });
module.exports = { assess, MARKETS };
