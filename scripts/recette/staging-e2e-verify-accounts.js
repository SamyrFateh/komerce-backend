'use strict';
/**
 * @role          staging-e2e-accounts-verifier
 * @purpose       Verification LECTURE SEULE apres reprovisionnement : chaque compte E2E attendu existe, avec son role, son perimetre de marche, son relais, ses autorisations Hub et son autorite Sourcing. Echec si un compte manque.
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging, KOMERCE_STAGING_RESET_DB_PIN, E2E_PROVISION_EXTRA_MARKETS, E2E_<PROFIL>_EMAIL
 * @db-read       users, assignment_memberships, market_operating_assignments, markets, hub_authorization_grants, sourcing_global_access_grants, e2e_test_accounts
 * @db-write      none
 * Aucune valeur de secret affichee : seuls des noms de profils et de marches sortent.
 */
const { PROFILES, ProvisionRefusal, assertProvisionAllowed } = require('./staging-e2e-provision');

const HOME_MARKET = 'KM';

/** Attendus par profil, derives de PROFILES (une seule source de verite) + marches supplementaires. */
function expectedFor(profile, extraMarkets) {
  const markets = [];
  if (profile.scope) markets.push(profile.scope.market);
  if (profile.relayMarket) markets.push(profile.relayMarket);
  if (profile.key === 'market_operator' || profile.relayMarket) markets.push(...extraMarkets);
  return [...new Set(markets)];
}

async function verifyAccounts({ db, env = process.env }) {
  const extra = String(env.E2E_PROVISION_EXTRA_MARKETS || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const failures = []; const accounts = [];
  for (const p of PROFILES) {
    const email = String(env[`E2E_${p.prefix}_EMAIL`] || '').trim().toLowerCase();
    const entry = { profile: p.key, role: p.role, ok: true, problems: [] };
    const fail = (why) => { entry.ok = false; entry.problems.push(why); };
    if (!email) { fail('secret email absent'); accounts.push(entry); failures.push(p.key); continue; }
    const { rows: [u] } = await db.query('SELECT id, role::text AS role, relais_id FROM users WHERE lower(email) = lower($1)', [email]);
    if (!u) { fail('compte absent'); accounts.push(entry); failures.push(p.key); continue; }
    if (u.role !== p.role) fail(`role ${u.role} != ${p.role}`);
    if (!p.existingOnly) {
      const { rows: mk } = await db.query('SELECT 1 FROM e2e_test_accounts WHERE user_id = $1::uuid', [u.id]);
      if (!mk.length) fail('marqueur e2e_test_accounts absent');
    }
    const wanted = expectedFor(p, extra);
    if (wanted.length) {
      const { rows } = await db.query(
        `SELECT DISTINCT m.code FROM assignment_memberships am
           JOIN market_operating_assignments a ON a.id = am.assignment_id AND a.status = 'ACTIVE'
           JOIN markets m ON m.id = a.market_id
          WHERE am.user_id = $1::uuid AND am.status = 'ACTIVE'`, [u.id]);
      const have = new Set(rows.map((r) => r.code));
      for (const code of wanted) if (!have.has(code)) fail(`perimetre marche ${code} absent`);
      entry.markets = wanted.filter((c) => have.has(c));
    }
    if (p.key === 'market_operator' && extra.length) {
      const { rows } = await db.query(
        `SELECT DISTINCT m.code FROM assignment_memberships am
           JOIN market_operating_assignments a ON a.id = am.assignment_id AND a.status = 'ACTIVE'
           JOIN markets m ON m.id = a.market_id
          WHERE am.user_id = $1::uuid AND am.status = 'ACTIVE' AND am.is_operating_lead = true`, [u.id]);
      const leads = new Set(rows.map((r) => r.code));
      for (const code of extra) if (!leads.has(code)) fail(`responsable d'exploitation ${code} absent`);
    }
    if (p.relayMarket && !u.relais_id) fail('relais non affecte');
    if (p.hubGrants) {
      for (const type of p.hubGrants) {
        const { rows } = await db.query('SELECT 1 FROM hub_authorization_grants WHERE user_id = $1::uuid AND authorization_type = $2 AND revoked_at IS NULL', [u.id, type]);
        if (!rows.length) fail(`autorisation Hub ${type} absente`);
      }
    }
    if (p.sourcingGrant) {
      const { rows } = await db.query('SELECT 1 FROM sourcing_global_access_grants WHERE user_id = $1::uuid AND revoked_at IS NULL', [u.id]);
      if (!rows.length) fail('autorite Sourcing globale absente');
    }
    if (!entry.ok) failures.push(p.key);
    accounts.push(entry);
  }
  return { checked: accounts.length, failures, ok: failures.length === 0, accounts };
}

async function main() {
  assertProvisionAllowed('dry-run', process.env);
  const db = require('../../db');
  try {
    const report = await verifyAccounts({ db });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) { process.stderr.write(`REFUS: E2E_ACCOUNTS_INCOMPLETE ${report.failures.join(',')}\n`); process.exitCode = 1; }
  } finally {
    if (db.pool && db.pool.end) await db.pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`REFUS: ${e instanceof ProvisionRefusal ? e.message : (e.code || e.name || 'ERROR')}\n`); process.exit(1); });
}

module.exports = { verifyAccounts, expectedFor, HOME_MARKET };
