#!/usr/bin/env node
'use strict';
/**
 * L10 — préparation d'identités E2E internes via POST /api/admin/users,
 * exclusivement en Staging prouvé. Dry-run par défaut, sans mot de passe.
 * Configurer `KOMERCE_E2E_IDENTITIES_JSON` avec [{full_name,email,role,market_codes?}].
 * --apply + KOMERCE_E2E_IDENTITIES_APPLY=1 autorisent les invitations.
 * Les agents relais restent sans rattachement physique jusqu'au writer canonique de relais.
 * Aucun secret ni jeton d'invitation affiché.
 */
const { confirmTarget } = require('./target-guard');

const ROLES = new Set(['admin', 'agent_hub', 'market_operator', 'agent_relais']);
const MARKET_CODES = new Set(['KM', 'CM', 'CG', 'DJ', 'YT']);

function parseAccounts(raw) {
  let entries;
  try { entries = JSON.parse(String(raw || '[]')); }
  catch { throw new Error('E2E_IDENTITIES_JSON_INVALID'); }
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 15)
    throw new Error('E2E_IDENTITIES_COUNT_INVALID');
  const seen = new Set();
  return entries.map((account) => {
    const { full_name, email, role } = account || {};
    const markets = account?.market_codes;
    if (!ROLES.has(role) || typeof full_name !== 'string' || full_name.trim().length < 2 ||
        typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      throw new Error('E2E_IDENTITY_FIELDS_INVALID');
    if (seen.has(email.toLowerCase())) throw new Error('E2E_IDENTITY_EMAIL_DUPLICATED');
    seen.add(email.toLowerCase());
    if (role === 'market_operator') {
      if (!Array.isArray(markets) || markets.length < 1 || markets.length > 5 ||
          markets.some(m => !MARKET_CODES.has(m)) || new Set(markets).size !== markets.length)
        throw new Error('E2E_IDENTITY_MARKET_SCOPE_INVALID');
    } else if (markets !== undefined) throw new Error('E2E_NON_MARKET_OPERATOR_SCOPE_FORBIDDEN');
    return { full_name: full_name.trim(), email: email.toLowerCase(), role,
      ...(role === 'market_operator' ? { market_codes: markets } : {}), invite: true };
  });
}

async function run({ db, env = process.env, fetchImpl = fetch, guard = confirmTarget, apply = false } = {}) {
  const accounts = parseAccounts(env.KOMERCE_E2E_IDENTITIES_JSON);
  const target = await guard({ db, env, fetchImpl });
  if (target.confirmed !== true) throw new Error('STAGING_TARGET_NOT_CONFIRMED');
  const base = String(env.STAGING_BASE_URL || '').replace(/\/$/, '');
  if (!apply) return { mode: 'dry-run', count: accounts.length,
    roles: accounts.reduce((o, a) => ({ ...o, [a.role]: (o[a.role] || 0) + 1 }), {}) };
  if (env.KOMERCE_E2E_IDENTITIES_APPLY !== '1') throw new Error('E2E_IDENTITIES_APPLY_CONFIRMATION_REQUIRED');
  const token = String(env.KOMERCE_STAGING_ADMIN_TOKEN || '');
  if (!token) throw new Error('STAGING_ADMIN_TOKEN_REQUIRED');
  const results = [];
  for (const account of accounts) {
    const res = await fetchImpl(base + '/api/admin/users', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`E2E_INVITATION_REJECTED_${res.status}_${data.code || 'UNKNOWN'}`);
      err.status = res.status;
      throw err;
    }
    if (!data.id || data.account_activation_required !== true)
      throw new Error('E2E_INVITATION_POSTCONDITION_FAILED');
    results.push({ id: data.id, role: account.role,
      markets: account.market_codes || [], pending_activation: true, invitation_sent: Boolean(data.invitation_sent) });
  }
  return { mode: 'invited', count: results.length, accounts: results };
}

async function main() {
  const db = require('../../db');
  try { process.stdout.write(JSON.stringify(await run({ db, apply: process.argv.includes('--apply') }), null, 2) + '\n'); }
  finally { await db.pool?.end(); }
}
if (require.main === module) main().catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });
module.exports = { run, parseAccounts };
