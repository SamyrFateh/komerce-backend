/**
 * @komerce-arch
 * @role          recette-claude-par-cm-cg-provisioning
 * @domain        recette
 * @layer         script
 * @criticality   low
 * @inputs        env CLAUDE_PAR_<MARKET>_<ROLE>_EMAIL/_PASSWORD, E2E_ADMIN_EMAIL, DATABASE_URL (staging)
 * @outputs       rapport JSON sans secret
 * @depends       db.js, scripts/recette/target-guard.js, scripts/recette/staging-e2e-provision.js, services/user-mutation-service.js, services/market-operator-provisioning.js, services/relais-mutation-service.js
 * @db-write      users, e2e_test_accounts, relais, assignment_memberships (writers canoniques uniquement)
 * @db-txn        single_transaction_rollback_on_refusal
 * @doctrine      recette_isolated_fixtures, canonical_writers_only
 * @version       2026-11
 */
'use strict';

// Certification parallèle Claude : comptes dédiés CM et CG + un relais dédié par marché.
// N'écrit QUE des objets "CLAUDE-PAR" : aucun compte, relais ou responsable d'exploitation existant n'est modifié.
// Le responsable pays reçoit une délégation "manager" sans devenir responsable d'exploitation (pas de déplacement du lead existant).

const bcrypt = require('bcryptjs');
const db = require('../../../db');
const users = require('../../../services/user-mutation-service');
const operators = require('../../../services/market-operator-provisioning');
const relais = require('../../../services/relais-mutation-service');
const delegation = require('../../../services/market-delegation-service');
const projector = require('../../../services/market-scope-projector');
const { markE2eTestAccount, ensureRelayAgentMembership } = require('../staging-e2e-provision');

const MARKETS = ['CM', 'CG'];
const ROLES = [
  { slug: 'market-operator', role: 'market_operator', scope: 'manager' },
  { slug: 'finance', role: 'finance', scope: 'viewer' },
  { slug: 'agent-transitaire', role: 'agent_transitaire', scope: 'viewer' },
  { slug: 'agent-relais', role: 'agent_relais', relay: true },
];

function envKey(code, slug, suffix) { return `CLAUDE_PAR_${code}_${slug.replace(/-/g, '_').toUpperCase()}_${suffix}`; }

async function ensureUser(client, { email, role, password, name, currency }) {
  const { rows: [u] } = await client.query('SELECT id, role::text AS role FROM users WHERE lower(email) = lower($1)', [email]);
  const hash = await bcrypt.hash(password, 12);
  if (u) {
    if (u.role !== role) throw new Error(`ROLE_MISMATCH ${email}`);
    await users.setUserPasswordHash(client, { userId: u.id, passwordHash: hash });
    return { id: u.id, user: 'existing' };
  }
  const { rows: [c] } = await users.createAdminUser(client, { fullName: name, email, phone: null, role, currencyPref: currency, passwordHash: hash });
  return { id: c.id, user: 'created' };
}

async function main() {
  if (process.env.KOMERCE_ENV !== 'staging') throw new Error('STAGING_ONLY');
  const client = await db.pool.connect();
  const report = { markets: {} };
  try {
    await client.query('BEGIN');
    const { rows: [admin] } = await client.query("SELECT id FROM users WHERE lower(email) = lower($1) AND role = 'admin'", [process.env.E2E_ADMIN_EMAIL]);
    if (!admin) throw new Error('ADMIN_MISSING');
    for (const code of MARKETS) {
      const { rows: [market] } = await client.query('SELECT id, currency, is_active FROM markets WHERE code = $1', [code]);
      if (!market || market.is_active !== true) throw new Error(`MARKET_INACTIVE ${code}`);
      await delegation.resolveActiveAssignmentByMarketCode(client, code); // refus net si le marché n'a pas d'assignment actif
      const name = `CLAUDE-PAR Relais ${code}`;
      let relay = (await relais.listRelais(client, { marketId: market.id })).find((r) => r.name === name);
      let relayStatus = 'unchanged';
      if (!relay) {
        relay = await relais.createRelais(client, { marketId: market.id, marketCode: code, name, agentName: null, phone: '+000000000',
          address: `Point de recette Claude ${code}`, zone: 'E2E' });
        relayStatus = 'created';
      }
      const entry = { relay: { name, id: relay.id, status: relayStatus }, accounts: [] };
      for (const r of ROLES) {
        const email = process.env[envKey(code, r.slug, 'EMAIL')];
        const password = process.env[envKey(code, r.slug, 'PASSWORD')];
        if (!email || !password) throw new Error(`CREDS_MISSING ${code} ${r.slug}`);
        const res = await ensureUser(client, { email, role: r.role, password, name: `CLAUDE-PAR ${r.slug} ${code}`, currency: market.currency });
        const a = { email, role: r.role, user: res.user, marker: await markE2eTestAccount(client, { userId: res.id, actorId: admin.id }) };
        if (r.scope === 'manager') {
          // Même voie que ensureMarketOperatorLead (staging-e2e-provision) : capacités manager bornées par le plafond du
          // marché (limites finies obligatoires), SANS devenir responsable d'exploitation.
          const { assignment_id: assignmentId } = await delegation.resolveActiveAssignmentByMarketCode(client, code);
          const capabilities = await operators.targetCapabilitiesForScope(client, { assignmentId, scope: 'manager' });
          const { rows: limited } = await client.query(
            'SELECT capability, limit_amount FROM assignment_capability_ceiling WHERE assignment_id = $1::uuid AND revoked_at IS NULL AND limit_amount IS NOT NULL', [assignmentId]);
          const capabilityLimits = Object.fromEntries(limited.filter((l) => capabilities.includes(l.capability)).map((l) => [l.capability, Number(l.limit_amount)]));
          await delegation.addMembership(client, { assignmentId, userId: res.id, actorUserId: admin.id, capabilities, capabilityLimits, actorIsCentral: true });
          await projector.projectAssignment(client, assignmentId);
          a.scope = { role: 'manager', capabilities: capabilities.length, operating_lead: 'not_assigned' };
        } else if (r.scope) {
          const g = await operators.grantOperatorScope(client, { userId: res.id, marketCode: code, scopeRole: r.scope, grantedBy: admin.id });
          a.scope = { role: r.scope, status: g.status };
        }
        if (r.relay) {
          const s = await users.assignAgentRelais(client, { userId: res.id, relaisId: relay.id });
          if (!['assigned', 'already'].includes(s.status)) throw new Error(`ASSIGN_${s.status}`);
          a.relay = s.status;
          a.membership = await ensureRelayAgentMembership(client, { delegation }, { userId: res.id, marketCode: code, actorId: admin.id });
        }
        entry.accounts.push(a);
      }
      report.markets[code] = entry;
    }
    await client.query('COMMIT');
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('REFUS', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
