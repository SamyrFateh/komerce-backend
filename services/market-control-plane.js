/**
 * @komerce-arch
 * @role          market-control-plane-read-model
 * @domain        market-control-plane
 * @layer         service
 * @criticality   medium
 * @inputs        canonical market code (server-validated), read-only DB executor
 * @outputs       per-market control view (assignment, team, ceiling, payment, cash policy, relais) and gap report
 * @depends       services/routing.js, services/fx-authority.js, services/economic-cost-reference-service.js, services/market-commercial-price-service.js, services/market-payment-provider-config-service.js, db.js, services/market-delegation-service.js, services/market-delivery-proof-service.js
 * @used-by       routes/admin-market-control-plane.js
 * @db-read       market_settlements, disputes, orders, markets, currency_parities, carriers, capability_registry, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, market_payment_providers, market_cash_control_policies, relais, market_delivery_attestations
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
const { getDeliveryProof } = require('./market-delivery-proof-service');
const { isRelaisRoutable } = require('./routing');
const { convert, FxError, MINOR_UNITS } = require('./fx-authority');
const { getCostReferenceReadiness } = require('./economic-cost-reference-service');
const { getPricePreparation } = require('./market-commercial-price-service');
const { listCentralCollectionModes, paymentOptions } = require('./market-payment-provider-config-service');

const TEAM_GRANT = 'team.grant';

const GAP_MESSAGES = Object.freeze({
  MARKET_INACTIVE: 'Le marché est inactif (is_active = false).',
  NO_CURRENCY_PARITY: 'La devise du marché n’a pas de conversion ni de parité canonique disponible vers EUR : décision propriétaire requise.',
  NO_BUSINESS_TIMEZONE: 'Le fuseau horaire IANA du marché doit être renseigné avant ouverture.',
  INVALID_CURRENCY_UNIT: 'Le nombre de décimales du marché ne correspond pas à celui de la devise canonique.',
  NO_ASSIGNMENT: 'Aucune affectation d’exploitation n’existe pour ce marché.',
  ASSIGNMENT_NOT_ACTIVE: 'L’affectation d’exploitation n’est pas ACTIVE.',
  EMPTY_CEILING: 'Le plafond de capacités de l’affectation est vide.',
  NO_ACTIVE_MEMBERSHIP: 'Aucune personne active n’est rattachée à l’affectation.',
  NO_TEAM_GRANT_HOLDER: 'Personne ne détient team.grant : l’équipe locale ne peut plus évoluer.',
  NO_OPERATING_LEAD: 'Aucun responsable opérationnel actif n’est désigné.',
  NO_CENTRAL_REFERENT: 'Aucun référent central n’est désigné.',
  MISSING_AMOUNT_LIMIT: 'Au moins une capability financière du nouveau marché n’a pas de plafond explicite.',
  NO_PAYMENT_PROVIDER: 'Aucun moyen de paiement admissible : activer le cash au relais ou configurer un fournisseur de paiement.',
  NO_CASH_POLICY: 'Aucune politique de contrôle de caisse n’est définie.',
  NO_RELAIS: 'Aucun relais actif n’est rattaché au marché.',
  NO_ROUTABLE_RELAIS: 'Aucun relais actif ne possède une destination exploitable par le routage canonique. Compléter la ville/zone ou la destination du relais.',
  NO_PREPARED_PRICE: 'Aucun prix local positif préparé pour un produit actif dans la devise du marché.',
  NO_ECONOMIC_REFERENCES: 'Le référentiel économique initial du marché est incomplet.',
});

/** Pure : transforme un instantané en liste d'écarts ordonnée et stable. */
function computeGaps(snapshot) {
  const gaps = [];
  const add = code => gaps.push({ code, message: GAP_MESSAGES[code] });
  if (!snapshot.market.is_active) add('MARKET_INACTIVE');
  // Devise sans parité canonique vers EUR (currency_parities) : aucun total affichable ni conversion fiable.
  // Explicite `=== false` : un snapshot sans l'information ne fabrique pas d'écart.
  if ((snapshot.market.fx_ready ?? snapshot.market.has_currency_parity) === false) add('NO_CURRENCY_PARITY');
  if (snapshot.market.lifecycle_status === 'PROVISIONING' && snapshot.market.currency_unit_valid === false) add('INVALID_CURRENCY_UNIT');
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
  // A documented cash-only market does not require an electronic provider.
  const cashReady = snapshot.cashPolicy?.cash_enabled === true;
  const electronicReady = snapshot.paymentAvailability
    ? snapshot.paymentAvailability.some(mode => mode.ready)
    : snapshot.paymentProviders.some(provider => provider.is_enabled);
  if (!cashReady && !electronicReady) add('NO_PAYMENT_PROVIDER');
  if (!snapshot.cashPolicy) add('NO_CASH_POLICY');
  if (!snapshot.relaisActive) add('NO_RELAIS');
  // New-market preparation is evaluated only for an initialized market.
  // Existing active/suspended markets keep the established lifecycle rules.
  if(snapshot.market.lifecycle_status==='PROVISIONING' && snapshot.preparation){
    if(snapshot.market.business_timezone === null)add('NO_BUSINESS_TIMEZONE');
    // Existing relay/routing authority, not a freight-cost attestation.
    if(snapshot.relaisActive>0 && snapshot.preparation.routableRelays===0)add('NO_ROUTABLE_RELAIS');
    const prices=snapshot.preparation.prices;
    if(!prices || prices.drafts+prices.authorized+prices.active===0)add('NO_PREPARED_PRICE');
    if(snapshot.preparation.economic?.ready!==true){
      const missing=snapshot.preparation.economic?.missing||[];
      gaps.push({code:'NO_ECONOMIC_REFERENCES',message:GAP_MESSAGES.NO_ECONOMIC_REFERENCES+(missing.length?' '+missing.join(' ; '):'')});
    }
  }
  return gaps;
}

const PLATFORM_BLOCKERS = new Set(['NO_BUSINESS_TIMEZONE','INVALID_CURRENCY_UNIT','NO_CURRENCY_PARITY','NO_CENTRAL_REFERENT','EMPTY_CEILING','MISSING_AMOUNT_LIMIT','NO_PAYMENT_PROVIDER','NO_CASH_POLICY','NO_ECONOMIC_REFERENCES']);
const OPERATIONS_BLOCKERS = new Set(['NO_ASSIGNMENT','ASSIGNMENT_NOT_ACTIVE','NO_ACTIVE_MEMBERSHIP','NO_TEAM_GRANT_HOLDER','NO_OPERATING_LEAD','NO_RELAIS','NO_ROUTABLE_RELAIS','NO_PREPARED_PRICE']);

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
    `SELECT m.code, m.name, m.currency, m.minor_unit, m.business_timezone, m.is_active, m.lifecycle_status,
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

async function resolveCurrencyReadiness(executor, currency, minorUnit) {
  const validUnit = Object.prototype.hasOwnProperty.call(MINOR_UNITS,currency) &&
    Number(minorUnit) === MINOR_UNITS[currency];
  try {
    const quote = await convert({amount:1,from:'EUR',to:currency,client:executor,round:false});
    return {fx_ready:quote.amount > 0, currency_unit_valid:validUnit};
  } catch(error) {
    // Infrastructure failures remain failures; only the canonical FX domain
    // refusal is turned into an explicit readiness gap.
    if (!(error instanceof FxError)) throw error;
    return {fx_ready:false,currency_unit_valid:validUnit,fx_reason:error.code};
  }
}

async function countRoutableRelays(executor,market) {
  const {rows}=await executor.query(
    'SELECT id,name,island,island_code,zone FROM relais WHERE market_id=$1 AND is_active',[market.id]);
  return rows.filter(relay=>isRelaisRoutable(relay,{marketCode:market.code})).length;
}

async function getControlPlane(executor, marketCode) {
  const db = requireExecutor(executor);
  const code = normalizeMarketCode(marketCode);
  if (!code) throw delegationError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);

  const market = (await db.query(
    `SELECT id, code, name, currency, minor_unit, is_active, lifecycle_status, storefront_texts, business_timezone,
            EXISTS (SELECT 1 FROM currency_parities cp WHERE cp.currency = markets.currency) AS has_currency_parity
       FROM markets WHERE code = $1`, [code]
  )).rows[0];
  if (!market) throw delegationError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  Object.assign(market, await resolveCurrencyReadiness(db,market.currency,market.minor_unit));

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

  const deliveryProof = await getDeliveryProof(db, market.id);
  const centralCollectionModes = await listCentralCollectionModes(db, market.id);
  const options = paymentOptions();
  const paymentAvailability = [
    ...centralCollectionModes.map(mode => ({
      mode: mode.payment_mode,
      ready: options.central.some(option => option.mode === mode.payment_mode && option.configured),
    })),
    // Use the same first enabled provider as the checkout runtime.
    ...paymentProviders.filter(provider => provider.is_enabled).slice(0, 1).map(provider => ({
      mode: 'mobile_money', provider: provider.provider,
      ready: provider.currency === market.currency && options.mobile.some(option =>
        option.provider === provider.provider && option.market_code === market.code && option.configured),
    })),
  ];
  const snapshot = { market, assignment, ceiling, team, paymentProviders, cashPolicy, relaisActive, deliveryProof, centralCollectionModes, paymentAvailability };
  if(market.lifecycle_status==='PROVISIONING' && assignment?.status==='ACTIVE'){
    const [economic,prices,routableRelays]=await Promise.all([getCostReferenceReadiness(db,market.id),getPricePreparation(db,market),countRoutableRelays(db,market)]);
    snapshot.preparation={economic,prices,routableRelays};
  }
  const gaps = computeGaps(snapshot);
  // Choix du transporteur pour l'attestation de livrabilité : fourni uniquement quand la preuve manque
  // (aucune nouvelle route, l'écran de gestion des marchés ne lit que /api/admin/markets).
  const carriers = (!deliveryProof || !deliveryProof.proven)
    ? (await db.query('SELECT id, name FROM carriers WHERE is_active = TRUE ORDER BY name')).rows
    : [];
  return { ...snapshot, carriers, gaps, readiness: readinessFromGaps(gaps) };
}

/**
 * Projection de sortie d'un mandat (lecture seule) : ce qui reste ouvert avant de terminer
 * l'exploitation d'un marché. Bloquant = argent encore dû (règlements non reçus).
 * Non couvert : le cash détenu sur le terrain (pas de statut de dépôt exploitable par marché).
 */
async function getExitReadiness(executor, marketCode) {
  const db = requireExecutor(executor);
  const code = normalizeMarketCode(marketCode);
  if (!code) throw delegationError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);
  const market = (await db.query('SELECT id, code FROM markets WHERE code = $1', [code])).rows[0];
  if (!market) throw delegationError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);

  const assignment = (await db.query(
    `SELECT id, status FROM market_operating_assignments
      WHERE market_id = $1 AND status IN ('ACTIVE','SUSPENDED')
      ORDER BY (status = 'ACTIVE') DESC, created_at DESC LIMIT 1`, [market.id]
  )).rows[0] || null;

  const settlements = (await db.query(
    `SELECT currency, COUNT(*)::int AS n, SUM(amount)::text AS amount
       FROM market_settlements
      WHERE market_id = $1 AND status <> 'RECEIVED'
      GROUP BY currency ORDER BY currency`, [market.id]
  )).rows;
  const members = assignment ? Number((await db.query(
    `SELECT COUNT(*)::int AS n FROM assignment_memberships WHERE assignment_id = $1 AND status = 'ACTIVE'`, [assignment.id]
  )).rows[0].n) : 0;
  const disputes = Number((await db.query(
    `SELECT COUNT(*)::int AS n FROM disputes d JOIN orders o ON o.id = d.order_id
      WHERE o.market_id = $1 AND d.status IN ('open','processing')`, [market.id]
  )).rows[0].n);

  const openSettlements = settlements.reduce((sum, row) => sum + row.n, 0);
  const blockers = openSettlements > 0 ? ['OPEN_SETTLEMENTS'] : [];
  return {
    market_code: market.code,
    assignment,
    open_settlements: { count: openSettlements, by_currency: settlements.map(row => ({ currency: row.currency, count: row.n, amount: row.amount })) },
    active_members: members,
    open_disputes: disputes,
    blockers,
    ready_to_end: Boolean(assignment) && blockers.length === 0,
    not_covered: ['field_cash_held'],
  };
}

// Projection for the authenticated operating lead only. The caller has
// already resolved a canonical active membership; compare the exact scope
// again against the current control-plane snapshot before exposing any item.
async function getPreparationChecklist(executor, authorization) {
  if (authorization?.lifecycle_status !== 'PROVISIONING' || !authorization.membership_id ||
      !authorization.capabilities?.includes('team.read')) return null;
  const control = await getControlPlane(executor, authorization.market_code);
  if (control.market.lifecycle_status !== 'PROVISIONING' || control.market.id !== authorization.market_id ||
      control.assignment?.id !== authorization.assignment_id || control.assignment.status !== 'ACTIVE' ||
      !control.team.some(member => member.membership_id === authorization.membership_id && member.is_operating_lead)) return null;
  function item(id, label, codes, owner) {
    const blockers = control.gaps.filter(gap => codes.includes(gap.code)).map(gap => gap.message);
    return { id, label, owner, status: blockers.length ? 'blocked' : 'ready', blockers };
  }
  return {
    items: [
      item('identity','Identité, devise, fuseau et mandat',['NO_BUSINESS_TIMEZONE','NO_CURRENCY_PARITY','INVALID_CURRENCY_UNIT','NO_ASSIGNMENT','ASSIGNMENT_NOT_ACTIVE','NO_CENTRAL_REFERENT','EMPTY_CEILING','MISSING_AMOUNT_LIMIT'],'central'),
      item('team','Équipe locale',['NO_ACTIVE_MEMBERSHIP','NO_TEAM_GRANT_HOLDER','NO_OPERATING_LEAD'],'market'),
      item('network','Réseau de relais et destination livrable',['NO_RELAIS','NO_ROUTABLE_RELAIS'],'market'),
      item('payments','Moyens de paiement',['NO_PAYMENT_PROVIDER','NO_CASH_POLICY'],'central'),
      item('commerce','Préparation des prix locaux (brouillons uniquement avant ouverture)',['NO_PREPARED_PRICE'],'market'),
      item('economic','Raccordement des centres et familles de coûts',['NO_ECONOMIC_REFERENCES'],'central'),
    ],
  };
}

module.exports = { GAP_MESSAGES, computeGaps, readinessFromGaps, getControlPlane, getExitReadiness, listMarkets, getPreparationChecklist, resolveCurrencyReadiness, countRoutableRelays };
