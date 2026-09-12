'use strict';

const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { signAuthToken } = require('../../utils/auth-session');
const { CAPABILITIES } = require('../../config/market-delegation-capabilities');
const { projectAssignment } = require('../../services/market-scope-projector');
const { invalidateCurrencyParityCache } = require('../../utils/currency');
const { createCleanup, tag, uuid } = require('./e2eDbKit');

const READ_ONLY_CAPABILITIES = Object.freeze([
  'pricing.read',
  'pricing.simulate',
  'dashboard.market.read',
  'operations.read',
  'hub.supervise',
  'client.read',
  'team.read',
  'network.read',
  'market_config.read',
  'finance.read',
]);

const FIXED_CURRENCY_PARITIES = Object.freeze([
  ['EUR', 1, 'Référence — identité, pas un ancrage'],
  ['KMF', 491.96775, 'Ancrage comorien, garanti Trésor français, en vigueur depuis 1999'],
  ['XAF', 655.957, 'Franc CFA d’Afrique centrale (CEMAC), garanti Trésor français'],
]);

function randomMarketCode(excluded = new Set()) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const bytes = crypto.randomBytes(2);
    const code = String.fromCharCode(65 + (bytes[0] % 26), 65 + (bytes[1] % 26));
    if (!excluded.has(code)) return code;
  }
  throw new Error('Unable to allocate unique E2E market code');
}

function bearer(userId, role = 'client') {
  return `Bearer ${signAuthToken({ id: userId, role }, { method: 'e2e-market-autonomy' })}`;
}

async function ensureCapabilityRegistry(db, cleanup) {
  // Le snapshot Railway utilisé par les E2E porte le schéma du registre mais
  // pas nécessairement ses lignes de référence : les migrations historiques
  // déjà baselinées ne sont alors pas rejouées. Le fixture doit donc restaurer
  // la vérité exécutable complète du registre MARKET/LIVE, pas seulement les
  // capabilities DELEGATION dont il se sert pour fabriquer un manager.
  const registryCapabilities = CAPABILITIES.filter((entry) =>
    entry.status === 'LIVE' &&
    entry.authority_scope === 'MARKET' &&
    entry.delegation_mode === 'DELEGABLE'
  );
  const delegationCapabilities = registryCapabilities
    .filter((entry) => entry.class === 'DELEGATION')
    .map((entry) => entry.capability);

  const inserted = [];
  for (const row of registryCapabilities) {
    const { rows } = await db.query(
      `INSERT INTO capability_registry
        (capability, class, domain, authority_scope, delegation_mode, requires_audit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (capability) DO NOTHING
       RETURNING capability`,
      [row.capability, row.class, row.domain, row.authority_scope, row.delegation_mode, row.requires_audit, row.status]
    );
    if (rows[0]) inserted.push(rows[0].capability);
  }
  for (const capability of inserted) cleanup.track('capability_registry', 'capability', capability);

  // Important : créer un fixture manager ne lui donne toujours que les droits
  // DELEGATION. Les EXECUTION ne rentrent dans le ceiling qu'au travers de la
  // migration/du lifecycle qui les ouvre, et ne sont jamais auto-grantées.
  return delegationCapabilities;
}

async function ensureFixedCurrencyParities(db, cleanup) {
  const inserted = [];
  for (const [currency, eurRate, sourceNote] of FIXED_CURRENCY_PARITIES) {
    const { rows } = await db.query(
      `INSERT INTO currency_parities (currency, eur_rate, source_note)
       VALUES ($1,$2,$3)
       ON CONFLICT (currency) DO NOTHING
       RETURNING currency`,
      [currency, eurRate, sourceNote]
    );
    if (rows[0]) inserted.push(rows[0].currency);
  }
  invalidateCurrencyParityCache();
  for (const currency of inserted) cleanup.track('currency_parities', 'currency', currency);
}

async function insertUser(db, cleanup, { role = 'client', label }) {
  const id = uuid();
  const email = `${tag(label)}@komerce.test`;
  const phone = `+2693${Math.floor(Math.random() * 9000000 + 1000000)}`;
  await db.query(
    `INSERT INTO users (id, full_name, email, phone, role)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, `E2E ${label}`, email, phone, role]
  );
  cleanup.track('users', 'id', id);
  return { id, email, phone, role, token: bearer(id, role) };
}

async function insertMarket(db, cleanup, { code, label, currency = 'XAF', minorUnit = 0 }) {
  const id = uuid();
  await db.query(
    `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
     VALUES ($1,$2,$3,$4,$5,TRUE)`,
    [id, code, `E2E ${label}`, currency, minorUnit]
  );
  cleanup.track('markets', 'id', id);
  return { id, code, currency, minor_unit: minorUnit };
}

async function insertAssignment(db, cleanup, { marketId, grantedBy }) {
  const id = uuid();
  await db.query(
    `INSERT INTO market_operating_assignments (id, market_id, status, granted_by)
     VALUES ($1,$2,'ACTIVE',$3)`,
    [id, marketId, grantedBy]
  );
  cleanup.track('market_operating_assignments', 'id', id);
  return { id, market_id: marketId };
}

async function installCeiling(db, cleanup, { assignmentId, capabilities, grantedBy }) {
  for (const capability of capabilities) {
    const id = uuid();
    await db.query(
      `INSERT INTO assignment_capability_ceiling (id, assignment_id, capability, granted_by)
       VALUES ($1,$2,$3,$4)`,
      [id, assignmentId, capability, grantedBy]
    );
    cleanup.track('assignment_capability_ceiling', 'id', id);
  }
}

async function insertMembership(db, cleanup, { assignmentId, userId, capabilities, grantedBy }) {
  const id = uuid();
  await db.query(
    `INSERT INTO assignment_memberships (id, assignment_id, user_id, status, granted_by)
     VALUES ($1,$2,$3,'ACTIVE',$4)`,
    [id, assignmentId, userId, grantedBy]
  );
  cleanup.track('assignment_memberships', 'id', id);

  for (const capability of capabilities) {
    const grantId = uuid();
    await db.query(
      `INSERT INTO membership_capabilities (id, membership_id, capability, granted_by)
       VALUES ($1,$2,$3,$4)`,
      [grantId, id, capability, grantedBy]
    );
    cleanup.track('membership_capabilities', 'id', grantId);
  }
  return { id, assignment_id: assignmentId, user_id: userId, capabilities: [...capabilities] };
}

async function createMarketDelegationFixture(db) {
  const cleanup = createCleanup(db);
  const liveCapabilities = await ensureCapabilityRegistry(db, cleanup);
  await ensureFixedCurrencyParities(db, cleanup);

  const used = new Set(['KM', 'YT', 'CM', 'CG']);
  const codeA = randomMarketCode(used); used.add(codeA);
  const codeB = randomMarketCode(used);

  const marketA = await insertMarket(db, cleanup, { code: codeA, label: 'Market A' });
  const marketB = await insertMarket(db, cleanup, { code: codeB, label: 'Market B' });

  const central = await insertUser(db, cleanup, { role: 'admin', label: 'Central Admin' });
  const managerA = await insertUser(db, cleanup, { role: 'client', label: 'Manager A' });
  const viewerA = await insertUser(db, cleanup, { role: 'client', label: 'Viewer A' });
  const managerB = await insertUser(db, cleanup, { role: 'client', label: 'Manager B' });
  const outsider = await insertUser(db, cleanup, { role: 'client', label: 'Outsider' });

  const assignmentA = await insertAssignment(db, cleanup, { marketId: marketA.id, grantedBy: central.id });
  const assignmentB = await insertAssignment(db, cleanup, { marketId: marketB.id, grantedBy: central.id });

  await installCeiling(db, cleanup, { assignmentId: assignmentA.id, capabilities: liveCapabilities, grantedBy: central.id });
  await installCeiling(db, cleanup, { assignmentId: assignmentB.id, capabilities: liveCapabilities, grantedBy: central.id });

  const managerAMembership = await insertMembership(db, cleanup, {
    assignmentId: assignmentA.id,
    userId: managerA.id,
    capabilities: liveCapabilities,
    grantedBy: central.id,
  });
  const viewerAMembership = await insertMembership(db, cleanup, {
    assignmentId: assignmentA.id,
    userId: viewerA.id,
    capabilities: READ_ONLY_CAPABILITIES.filter((capability) => liveCapabilities.includes(capability)),
    grantedBy: managerA.id,
  });
  const managerBMembership = await insertMembership(db, cleanup, {
    assignmentId: assignmentB.id,
    userId: managerB.id,
    capabilities: liveCapabilities,
    grantedBy: central.id,
  });

  // Les routes legacy canonisées (dashboards, Pricing, workspaces) consomment
  // operator_market_scopes. On projette donc réellement les memberships :
  // manager complet -> manager, baseline lecture complète -> viewer.
  cleanup.trackSql('DELETE FROM operator_market_scopes WHERE market_id IN ($1,$2)', [marketA.id, marketB.id]);
  cleanup.trackSql('DELETE FROM market_team_invitations WHERE assignment_id IN ($1,$2)', [assignmentA.id, assignmentB.id]);
  cleanup.trackSql('DELETE FROM market_delegation_audit WHERE assignment_id IN ($1,$2)', [assignmentA.id, assignmentB.id]);
  cleanup.trackSql('DELETE FROM market_cash_control_policies WHERE assignment_id IN ($1,$2)', [assignmentA.id, assignmentB.id]);
  await projectAssignment(db, assignmentA.id);
  await projectAssignment(db, assignmentB.id);

  return {
    cleanup,
    liveCapabilities,
    marketA,
    marketB,
    assignmentA,
    assignmentB,
    central,
    managerA,
    viewerA,
    managerB,
    outsider,
    managerAMembership,
    viewerAMembership,
    managerBMembership,
  };
}

function makeApp(routerPaths) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  for (const { mount = '/api/market-delegation', modulePath } of routerPaths) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    app.use(mount, require(modulePath));
  }
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
  });
  return app;
}

module.exports = {
  READ_ONLY_CAPABILITIES,
  FIXED_CURRENCY_PARITIES,
  bearer,
  createMarketDelegationFixture,
  makeApp,
  uuid,
  tag,
};