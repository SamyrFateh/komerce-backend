/**
 * @komerce-arch
 * @role          market-control-plane-read-model
 * @domain        market-control-plane
 * @layer         service
 * @criticality   medium
 * @inputs        canonical market code (server-validated), read-only DB executor
 * @outputs       per-market control view (assignment, team, ceiling, payment, cash policy, relais) and gap report
 * @depends       db.js, services/market-delegation-service.js
 * @used-by       routes/admin-market-control-plane.js
 * @db-read       markets, capability_registry, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, market_payment_providers, market_cash_control_policies, relais
 * @db-write      none
 * @db-txn        none
 * @doctrine      control_plane_is_read_only, gaps_are_reported_never_repaired, no_second_authorization_engine
 * @impact-areas  market-delegation, market, dashboard, authorization
 * @version       2026-10-v1
 */
'use strict';

/**
 * Vue Control Plane d'un marché : ce qui existe, ce qui manque. Lecture seule :
 * aucune écriture, aucune décision d'autorisation (le moteur reste celui de
 * market-delegation). Les écarts sont signalés, jamais réparés ici ; ils servent
 * de référence de non-régression aux PR suivantes du chantier.
 */

const { delegationError, normalizeMarketCode } = require('./market-delegation-service');

const TEAM_GRANT = 'team.grant';

const GAP_MESSAGES = Object.freeze({
  MARKET_INACTIVE: 'Le marché est inactif (is_active = false).',
  NO_ASSIGNMENT: 'Aucune affectation d’exploitation n’existe pour ce marché.',
  ASSIGNMENT_NOT_ACTIVE: 'L’affectation d’exploitation n’est pas ACTIVE.',
  EMPTY_CEILING: 'Le plafond de capacités de l’affectation est vide.',
  NO_ACTIVE_MEMBERSHIP: 'Aucune personne active n’est rattachée à l’affectation.',
  NO_TEAM_GRANT_HOLDER: 'Personne ne détient team.grant : l’équipe locale ne peut plus évoluer.',
  NO_OPERATING_LEAD: 'Aucun responsable opérationnel actif n’est désigné.',
  NO_CENTRAL_REFERENT: 'Aucun référent central n’est désigné.',
  MISSING_AMOUNT_LIMIT: 'Au moins une capability financière du nouveau marché n’a pas de plafond explicite.',
  NO_PAYMENT_PROVIDER: 'Aucun fournisseur de paiement activé pour ce marché.',
  NO_CASH_POLICY: 'Aucune politique de contrôle de caisse n’est définie.',
  NO_RELAIS: 'Aucun relais actif n’est rattaché au marché.',
});

/** Pure : transforme un instantané en liste d'écarts ordonnée et stable. */
function computeGaps(snapshot) {
  const gaps = [];
  const add = code => gaps.push({ code, message: GAP_MESSAGES[code] });
  if (!snapshot.market.is_active) add('MARKET_INACTIVE');
  if (!snapshot.assignment) {
    add('NO_ASSIGNMENT');
  } else {
    if (snapshot.assignment.status !== 'ACTIVE') add('ASSIGNMENT_NOT_ACTIVE');
    if (!snapshot.assignment.central_referent_user_id) add('NO_CENTRAL_REFERENT');
    if (!snapshot.ceiling.length) add('EMPTY_CEILING');
    if (snapshot.market.lifecycle_status === 'PROVISIONING' &&
        snapshot.ceiling.some(cap => cap.amount_bearing && cap.limit_amount == null)) add('MISSING_AMOUNT_LIMIT');
    if (!snapshot.team.length) add('NO_ACTIVE_MEMBERSHIP');
    else {
      if (!snapshot.team.some(member => member.capabilities.includes(TEAM_GRANT))) add('NO_TEAM_GRANT_HOLDER');
      if (!snapshot.team.some(member => member.is_operating_lead)) add('NO_OPERATING_LEAD');
    }
  }
  if (!snapshot.paymentProviders.some(provider => provider.is_enabled)) add('NO_PAYMENT_PROVIDER');
  if (!snapshot.cashPolicy) add('NO_CASH_POLICY');
  if (!snapshot.relaisActive) add('NO_RELAIS');
  return gaps;
}

const PLATFORM_BLOCKERS = new Set(['NO_CENTRAL_REFERENT','EMPTY_CEILING','MISSING_AMOUNT_LIMIT','NO_PAYMENT_PROVIDER','NO_CASH_POLICY']);
const OPERATIONS_BLOCKERS = new Set(['NO_ASSIGNMENT','ASSIGNMENT_NOT_ACTIVE','NO_ACTIVE_MEMBERSHIP','NO_TEAM_GRANT_HOLDER','NO_OPERATING_LEAD','NO_RELAIS']);

function readinessFromGaps(gaps) {
  const platform = gaps.filter(gap => PLATFORM_BLOCKERS.has(gap.code));
  const operations = gaps.filter(gap => OPERATIONS_BLOCKERS.has(gap.code));
  return {
    platform: { ready: platform.length === 0, blockers: platform },
    operations: { ready: operations.length === 0, blockers: operations },
    ready_for_activation: platform.length === 0 && operations.length === 0,
  };
}

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw delegationError('EXECUTOR_REQUIRED', 'Exécuteur SQL requis.', 500);
  }
  return executor;
}

async function listMarkets(executor) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT m.code, m.name, m.currency, m.is_active, m.lifecycle_status,
            a.status AS assignment_status,
            (SELECT COUNT(*)::int FROM assignment_memberships am
              WHERE am.assignment_id = a.id AND am.status = 'ACTIVE') AS active_members
       FROM markets m
       LEFT JOIN LATERAL (
         SELECT id, status FROM market_operating_assignments
          WHERE market_id = m.id
          ORDER BY (status = 'ACTIVE') DESC, created_at DESC
          LIMIT 1
       ) a ON TRUE
      ORDER BY m.code`
  );
  return rows;
}

async function getControlPlane(executor, marketCode) {
  const db = requireExecutor(executor);
  const code = normalizeMarketCode(marketCode);
  if (!code) throw delegationError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);

  const market = (await db.query(
    'SELECT id, code, name, currency, minor_unit, is_active, lifecycle_status, storefront_texts FROM markets WHERE code = $1', [code]
  )).rows[0];
  if (!market) throw delegationError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);

  const assignment = (await db.query(
    `SELECT id, status, effective_from, effective_until, central_referent_user_id
       FROM market_operating_assignments
      WHERE market_id = $1
      ORDER BY (status = 'ACTIVE') DESC, created_at DESC
      LIMIT 1`, [market.id]
  )).rows[0] || null;

  let ceiling = [];
  let team = [];
  if (assignment) {
    ceiling = (await db.query(
      `SELECT acc.capability, cr.amount_bearing, acc.limit_amount
         FROM assignment_capability_ceiling acc
         JOIN capability_registry cr ON cr.capability=acc.capability
        WHERE acc.assignment_id = $1 AND acc.revoked_at IS NULL
        ORDER BY acc.capability`, [assignment.id]
    )).rows;
    const members = (await db.query(
      `SELECT am.id AS membership_id, am.user_id, am.is_operating_lead,
              COALESCE(ARRAY_AGG(mc.capability ORDER BY mc.capability)
                       FILTER (WHERE mc.capability IS NOT NULL), '{}') AS capabilities
         FROM assignment_memberships am
         LEFT JOIN membership_capabilities mc
                ON mc.membership_id = am.id AND mc.revoked_at IS NULL
        WHERE am.assignment_id = $1 AND am.status = 'ACTIVE'
        GROUP BY am.id, am.user_id
        ORDER BY am.granted_at`, [assignment.id]
    )).rows;
    team = members.map(row => ({
      membership_id: row.membership_id, user_id: row.user_id,
      is_operating_lead: row.is_operating_lead, capabilities: row.capabilities,
    }));
  }

  const paymentProviders = (await db.query(
    `SELECT provider, currency, is_enabled, priority FROM market_payment_providers
      WHERE market_id = $1 ORDER BY priority, provider`, [market.id]
  )).rows;
  const cashPolicy = (await db.query(
    'SELECT cash_enabled, confirmation_mode FROM market_cash_control_policies WHERE market_id = $1', [market.id]
  )).rows[0] || null;
  const relaisActive = (await db.query(
    'SELECT COUNT(*)::int AS n FROM relais WHERE market_id = $1 AND is_active', [market.id]
  )).rows[0].n;

  const snapshot = { market, assignment, ceiling, team, paymentProviders, cashPolicy, relaisActive };
  const gaps = computeGaps(snapshot);
  return { ...snapshot, gaps, readiness: readinessFromGaps(gaps) };
}

module.exports = { GAP_MESSAGES, computeGaps, readinessFromGaps, getControlPlane, listMarkets };
