#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-e2e-identities-provisioner
 * @domain        infrastructure
 * @layer         script
 * @criticality   high
 * @inputs        --dry-run | --execute ; DATABASE_URL, KOMERCE_ENV=staging, STAGING_BASE_URL, EXPECTED_RAILWAY_ENVIRONMENT, KOMERCE_STAGING_RESET_DB_PIN, KOMERCE_STAGING_E2E_PROVISION_ACK, E2E_<PROFIL>_EMAIL/_PASSWORD
 * @outputs       rapport JSON sans secret (statuts par profil, relais, droits)
 * @depends       db.js, scripts/recette/target-guard.js, services/user-mutation-service.js, services/market-operator-provisioning.js, services/relais-mutation-service.js, services/hub-authorization-service.js
 * @used-by       .github/workflows/staging-e2e-provision.yml
 * @db-read       users, markets, relais, delegation
 * @db-write      users, relais, assignment/membership (writers canoniques), hub_authorization_grants, sourcing_global_access_grants (writer manquant, voir ci-dessous)
 * @db-txn        owned (une transaction ; dry-run = ROLLBACK)
 * @doctrine      staging_only_guard_before_any_write_dry_run_default_canonical_writers_idempotent_no_secret_in_output
 * @impact-areas  staging, recette, authorization
 * @version       2026-11
 *
 * Reconstruit les identités E2E de l'audit Chromium (mots de passe lus dans E2E_*_PASSWORD, jamais
 * affichés) + un relais actif par marché. Aucune donnée métier. Rejouable : met à jour sans dupliquer.
 * Le dry-run exécute exactement le même code dans une transaction annulée (rien n'est écrit).
 * Writers canoniques : createAdminUser / setUserPasswordHash, grantOperatorScope (délégation),
 * createRelais / setRelaisActive / assignAgentRelais, hub-authorization-service.grant.
 * WRITER MANQUANT : aucun service n'écrit sourcing_global_access_grants → fonction locale minimale
 * grantSourcingGlobalAuthority() (idempotente), à remplacer par un writer canonique.
 */

const ACK_VALUE = 'PROVISION-STAGING-E2E';
const MARKET_CODES = Object.freeze(['KM', 'CM', 'CG', 'DJ', 'YT']);
const HOME_MARKET = 'KM';
const PASSWORD_ROUNDS = 12;

// Un profil = un couple E2E_<PREFIX>_EMAIL / _PASSWORD. `optional` : profil sauté (avertissement) si absent.
const PROFILES = Object.freeze([
  { key: 'admin', prefix: 'ADMIN', role: 'admin', name: 'E2E Admin central', existingOnly: true },
  { key: 'market_operator', prefix: 'MARKET_OPERATOR', role: 'market_operator', name: 'E2E Responsable pays', scope: { market: HOME_MARKET, scopeRole: 'manager' } },
  { key: 'finance', prefix: 'FINANCE', role: 'finance', name: 'E2E Finance', scope: { market: HOME_MARKET, scopeRole: 'viewer' } },
  { key: 'sourcing', prefix: 'SOURCING', role: 'sourcing', name: 'E2E Sourcing', sourcingGrant: true },
  { key: 'agent_hub', prefix: 'AGENT_HUB', role: 'agent_hub', name: 'E2E Agent Hub' },
  { key: 'agent_relais', prefix: 'AGENT_RELAIS', role: 'agent_relais', name: 'E2E Agent Relais', relayMarket: HOME_MARKET },
  { key: 'agent_transitaire', prefix: 'AGENT_TRANSITAIRE', role: 'agent_transitaire', name: 'E2E Agent Transitaire', scope: { market: HOME_MARKET, scopeRole: 'viewer' } },
  { key: 'hub_director', prefix: 'HUB_DIRECTOR', role: 'agent_hub', name: 'E2E Responsable Hub', optional: true,
    hubGrants: ['purchase_commitment', 'supplier_payment'] },
]);

class ProvisionRefusal extends Error {
  constructor(code, detail) { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

function databasePin(databaseUrl) {
  try { const u = new URL(databaseUrl); return `${u.hostname}:${u.port || '5432'}${u.pathname}`; } catch { return null; }
}

/** Gardes PURES, évaluées avant toute connexion et toute écriture. */
function assertProvisionAllowed(mode, env = process.env) {
  if (!['dry-run', 'execute'].includes(mode)) throw new ProvisionRefusal('E2E_PROVISION_MODE_REQUIRED', 'passer exactement --dry-run ou --execute');
  if (env.NODE_ENV === 'production' || env.KOMERCE_ENV === 'production') throw new ProvisionRefusal('E2E_PROVISION_REFUSED_PRODUCTION');
  if (env.KOMERCE_ENV !== 'staging') throw new ProvisionRefusal('E2E_PROVISION_REFUSED_NOT_STAGING', 'KOMERCE_ENV=staging requis');
  if (!env.DATABASE_URL) throw new ProvisionRefusal('E2E_PROVISION_DATABASE_URL_MISSING');
  if (!/^https:\/\//.test(String(env.STAGING_BASE_URL || ''))) throw new ProvisionRefusal('E2E_PROVISION_REFUSED_BASE_URL', 'STAGING_BASE_URL https requis');
  if (env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging') throw new ProvisionRefusal('E2E_PROVISION_REFUSED_ENV_PIN', 'EXPECTED_RAILWAY_ENVIRONMENT=staging requis');
  const pin = databasePin(env.DATABASE_URL);
  if (!pin || env.KOMERCE_STAGING_RESET_DB_PIN !== pin) throw new ProvisionRefusal('E2E_PROVISION_DATABASE_NOT_PINNED', 'KOMERCE_STAGING_RESET_DB_PIN doit égaler host:port/base de DATABASE_URL');
  if (mode === 'execute' && env.KOMERCE_STAGING_E2E_PROVISION_ACK !== ACK_VALUE) throw new ProvisionRefusal('E2E_PROVISION_ACK_MISSING', `KOMERCE_STAGING_E2E_PROVISION_ACK=${ACK_VALUE}`);
}

function passwordPolicyError(password) {
  return typeof password !== 'string' || password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password);
}

/** Lit les profils depuis l'environnement. Jamais de valeur dans les erreurs : seulement des NOMS de variables. */
function readProfiles(env = process.env) {
  const accounts = []; const skipped = []; const seen = new Set();
  for (const p of PROFILES) {
    const emailKey = `E2E_${p.prefix}_EMAIL`; const passKey = `E2E_${p.prefix}_PASSWORD`;
    const email = String(env[emailKey] || '').trim().toLowerCase(); const password = String(env[passKey] || '');
    if (!email || !password) {
      if (p.optional) { skipped.push({ profile: p.key, reason: `secrets absents : ${emailKey} / ${passKey}`, action: 'créer ces 2 secrets puis relancer' }); continue; }
      throw new ProvisionRefusal('E2E_SECRET_MISSING', [!email && emailKey, !password && passKey].filter(Boolean).join(', '));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProvisionRefusal('E2E_EMAIL_INVALID', emailKey);
    if (!p.existingOnly && passwordPolicyError(password)) throw new ProvisionRefusal('E2E_PASSWORD_POLICY', passKey);
    if (seen.has(email)) throw new ProvisionRefusal('E2E_EMAIL_DUPLICATED', emailKey);
    seen.add(email);
    accounts.push({ ...p, email, password });
  }
  return { accounts, skipped };
}

function defaultDeps() {
  /* eslint-disable global-require */
  return {
    bcrypt: require('bcryptjs'),
    users: require('../../services/user-mutation-service'),
    operators: require('../../services/market-operator-provisioning'),
    relais: require('../../services/relais-mutation-service'),
    hubAuth: require('../../services/hub-authorization-service'),
  };
}

// WRITER MANQUANT (voir en-tête) : autorité Sourcing globale, grant explicite distinct.
async function grantSourcingGlobalAuthority(client, { userId, grantedBy }) {
  const { rowCount } = await client.query(
    `INSERT INTO sourcing_global_access_grants (user_id, granted_by, reason)
     VALUES ($1::uuid, $2::uuid, 'e2e_provision')
     ON CONFLICT (user_id) DO UPDATE SET revoked_at = NULL, granted_by = EXCLUDED.granted_by
       WHERE sourcing_global_access_grants.revoked_at IS NOT NULL`, [userId, grantedBy]);
  return rowCount ? 'granted' : 'unchanged';
}

async function ensureUser(client, deps, account) {
  const { rows: [existing] } = await client.query(
    'SELECT id, role::text AS role, password_hash, account_activation_required FROM users WHERE lower(email) = lower($1)', [account.email]);
  if (existing) {
    if (existing.role !== account.role) throw new ProvisionRefusal('E2E_PROVISION_ROLE_MISMATCH', account.key);
    if (account.existingOnly) return { id: existing.id, user: 'unchanged', password: 'not_touched' };
    let password = 'unchanged';
    const same = existing.password_hash ? await deps.bcrypt.compare(account.password, existing.password_hash) : false;
    if (!same) {
      await deps.users.setUserPasswordHash(client, { userId: existing.id, passwordHash: await deps.bcrypt.hash(account.password, PASSWORD_ROUNDS) });
      password = 'updated';
    }
    return { id: existing.id, user: 'existing', password, activation_pending: existing.account_activation_required === true };
  }
  if (account.existingOnly) throw new ProvisionRefusal('E2E_PROVISION_ADMIN_MISSING', 'le compte admin E2E doit déjà exister');
  const { rows: [created] } = await deps.users.createAdminUser(client, {
    fullName: account.name, email: account.email, phone: null, role: account.role, currencyPref: 'KMF',
    passwordHash: await deps.bcrypt.hash(account.password, PASSWORD_ROUNDS),
  });
  return { id: created.id, user: 'created', password: 'set' };
}

async function ensureRelays(client, deps, actorId) {
  const out = {};
  for (const code of MARKET_CODES) {
    const { rows: [market] } = await client.query('SELECT id, is_active FROM markets WHERE code = $1', [code]);
    if (!market) throw new ProvisionRefusal('E2E_PROVISION_MARKET_MISSING', code);
    // Marché présent mais inactif (ex. DJ, migration 310 : préparé seulement) : jamais activé ici, relais non créé.
    if (market.is_active !== true) { out[code] = { status: 'skipped_market_inactive' }; continue; }
    const name = `E2E Relais ${code}`;
    const current = (await deps.relais.listRelais(client, { marketId: market.id })).find((r) => r.name === name);
    let relay = current; let status = 'unchanged';
    if (!current) {
      relay = await deps.relais.createRelais(client, { marketId: market.id, name, agentName: null, phone: '+000000000', address: `Point de recette ${code}`, zone: 'E2E' });
      status = 'created';
    } else if (current.is_active !== true) {
      await deps.relais.setRelaisActive(client, { marketId: market.id, relaisId: current.id, active: true });
      status = 'reactivated';
    }
    out[code] = { id: relay.id, status };
  }
  return out;
}

async function run({ db, mode, env = process.env, deps = defaultDeps(), guard } = {}) {
  assertProvisionAllowed(mode, env);
  const { accounts, skipped } = readProfiles(env);
  const confirmTarget = guard || require('./target-guard').confirmTarget;
  const target = await confirmTarget({ db, env });
  if (!target || target.confirmed !== true) throw new ProvisionRefusal('E2E_PROVISION_TARGET_NOT_CONFIRMED');

  const client = await db.getClient();
  const report = { mode, target_confirmed: true, profiles: [], relais: {}, skipped, warnings: skipped.map((s) => `${s.profile} sauté : ${s.reason}`) };
  const shim = { query: client.query.bind(client), withTransaction: (fn) => fn(client) };
  try {
    await client.query('BEGIN');
    const admin = accounts.find((a) => a.key === 'admin');
    const { rows: [adminRow] } = await client.query("SELECT id FROM users WHERE lower(email) = lower($1) AND role = 'admin'", [admin.email]);
    if (!adminRow) throw new ProvisionRefusal('E2E_PROVISION_ADMIN_MISSING', 'le compte admin E2E doit déjà exister');
    const actor = { id: adminRow.id, role: 'admin' };

    report.relais = await ensureRelays(client, deps, actor.id);
    for (const account of accounts) {
      const entry = { profile: account.key, role: account.role };
      const res = await ensureUser(client, deps, account);
      Object.assign(entry, { user: res.user, password: res.password });
      if (res.activation_pending) report.warnings.push(`${account.key} : activation en attente (compte invité) — non modifié`);
      if (account.scope) {
        const g = await deps.operators.grantOperatorScope(client, { userId: res.id, marketCode: account.scope.market, scopeRole: account.scope.scopeRole, grantedBy: actor.id });
        if (!['granted', 'replaced', 'unchanged'].includes(g.status)) throw new ProvisionRefusal('E2E_PROVISION_SCOPE_FAILED', `${account.key}:${g.status}`);
        entry.market_scope = { market: account.scope.market, role: account.scope.scopeRole, status: g.status };
      }
      if (account.relayMarket) {
        const a = await deps.users.assignAgentRelais(client, { userId: res.id, relaisId: report.relais[account.relayMarket].id });
        if (!['assigned', 'already'].includes(a.status)) throw new ProvisionRefusal('E2E_PROVISION_RELAY_ASSIGN_FAILED', `${account.key}:${a.status}`);
        entry.relais = { market: account.relayMarket, status: a.status };
      }
      if (account.hubGrants) {
        entry.hub_grants = {};
        for (const type of account.hubGrants) {
          const grant = await deps.hubAuth.grant({ userId: res.id, authorizationType: type, actor }, shim);
          entry.hub_grants[type] = grant.idempotent_replay ? 'unchanged' : 'granted';
        }
      }
      if (account.sourcingGrant) entry.sourcing_global_authority = await grantSourcingGlobalAuthority(client, { userId: res.id, grantedBy: actor.id });
      report.profiles.push(entry);
    }
    if (mode === 'execute') await client.query('COMMIT'); else await client.query('ROLLBACK');
    report.committed = mode === 'execute';
    return report;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* erreur d'origine conservée */ }
    throw err;
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

async function main() {
  const mode = process.argv.includes('--execute') ? 'execute' : process.argv.includes('--dry-run') ? 'dry-run' : null;
  assertProvisionAllowed(mode, process.env);
  const db = require('../../db');
  try {
    process.stdout.write(`${JSON.stringify(await run({ db, mode }), null, 2)}\n`);
  } finally {
    if (db.pool && db.pool.end) await db.pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`REFUS: ${e instanceof ProvisionRefusal ? e.message : (e.code || e.name || 'ERROR')}\n`); process.exit(1); });
}

module.exports = { ACK_VALUE, PROFILES, MARKET_CODES, ProvisionRefusal, assertProvisionAllowed, readProfiles, run, grantSourcingGlobalAuthority };
