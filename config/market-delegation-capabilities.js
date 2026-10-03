'use strict';

// Effet de chaque capability, DÉCLARÉ une par une : READ ne modifie rien, ACT
// agit. L'effet n'est jamais déduit du nom (un test l'impose) : il décide de ce
// qu'un marché SUSPENDED laisse faire (READ oui, ACT non). Toute nouvelle
// capability doit être ajoutée ici, sinon le chargement échoue.
// À trancher en revue : pricing.simulate et hub.supervise sont déclarées ACT
// (refus par défaut en SUSPENDED) ; passer l'une en READ est un choix humain.
const EFFECTS = Object.freeze({
  'pricing.read': 'READ',
  'pricing.simulate': 'ACT',
  'pricing.cost_component.update': 'ACT',
  'pricing.cost_component.reset': 'ACT',
  'pricing.decide': 'ACT',
  'pricing.activate': 'ACT',
  'pricing.policy.set': 'ACT',
  'market.observation.record': 'ACT',
  'structure.event.record': 'ACT',
  'dashboard.market.read': 'READ',
  'decision_signal.manage': 'ACT',
  'operations.read': 'READ',
  'hub.supervise': 'ACT',
  'logistics.read': 'READ',
  'client.read': 'READ',
  'client.case.handle': 'ACT',
  'team.read': 'READ',
  'team.grant': 'ACT',
  'team.revoke': 'ACT',
  'team.invite': 'ACT',
  'network.read': 'READ',
  'network.create': 'ACT',
  'network.update': 'ACT',
  'network.suspend': 'ACT',
  'provider.manage': 'ACT',
  'market_config.read': 'READ',
  'market_config.update': 'ACT',
  'finance.read': 'READ',
  'finance.act': 'ACT',
  'settlement.receive': 'ACT',
  'catalog.expose': 'ACT',
  'catalog.read': 'READ',
  'local_offer.manage': 'ACT',
  'cash_control.policy.manage': 'ACT',
  'execution.order.mark_ordered': 'ACT',
  'execution.distribution.run': 'ACT',
  'execution.parcel.ship': 'ACT',
  'execution.inventory.assign': 'ACT',
  'execution.parcel.receive': 'ACT',
  'execution.parcel.collect': 'ACT',
  'execution.cash.confirm': 'ACT',
  'group_cost.allocate': 'ACT',
  'dashboard.global.read': 'READ',
  'user.role.set': 'ACT',
  'market.create': 'ACT',
});

// Capabilities dont l'exécution porte un montant (F3 du plan Control Plane).
// Les limites financières ne s'appliqueront qu'à elles (PR E).
const AMOUNT_BEARING = Object.freeze(['execution.cash.confirm', 'settlement.receive', 'finance.act']);

function declaredEffect(capability) {
  const effect = EFFECTS[capability];
  if (effect !== 'READ' && effect !== 'ACT') {
    throw new Error(`capability sans effet déclaré (READ|ACT) : ${capability}`);
  }
  return effect;
}

const CAPABILITIES = Object.freeze([
  ['pricing.read','DELEGATION','pricing','MARKET','DELEGABLE',false,'LIVE'],
  ['pricing.simulate','DELEGATION','pricing','MARKET','DELEGABLE',false,'LIVE'],
  ['pricing.cost_component.update','DELEGATION','pricing','MARKET','DELEGABLE',true,'LIVE'],
  ['pricing.cost_component.reset','DELEGATION','pricing','MARKET','DELEGABLE',true,'LIVE'],
  ['pricing.decide','DELEGATION','pricing','MARKET','DELEGABLE',true,'LIVE'],
  ['pricing.activate','DELEGATION','pricing','MARKET','DELEGABLE',true,'LIVE'],
  ['pricing.policy.set','DELEGATION','pricing','MARKET','DELEGABLE',true,'LIVE'],
  ['market.observation.record','DELEGATION','pricing','MARKET','DELEGABLE',true,'LIVE'],
  ['structure.event.record','DELEGATION','structure','MARKET','DELEGABLE',true,'LIVE'],
  ['dashboard.market.read','DELEGATION','pilotage','MARKET','DELEGABLE',false,'LIVE'],
  ['decision_signal.manage','DELEGATION','pilotage','MARKET','DELEGABLE',true,'LIVE'],
  ['operations.read','DELEGATION','operations','MARKET','DELEGABLE',false,'LIVE'],
  ['hub.supervise','DELEGATION','operations','MARKET','DELEGABLE',false,'LIVE'],
  // Lecture transit/douane (admin-shipping-customs-workspace.js) : jusqu'ici
  // gardée par rôle + operator_market_scopes hérités, jamais par une
  // capability exacte — même gap que operations.read avant LOT B, jamais
  // corrigé faute de capability dédiée. Les gestes transit/douane restent
  // hors périmètre (requireTransitAction/requireCustomsAction, non délégués
  // ici) ; seule la lecture du Workspace est concernée. Universelle comme
  // catalog.read/operations.read : viewer ou manager, lit son marché.
  ['logistics.read','DELEGATION','operations','MARKET','DELEGABLE',false,'LIVE'],
  ['client.read','DELEGATION','client','MARKET','DELEGABLE',false,'LIVE'],
  ['client.case.handle','DELEGATION','client','MARKET','DELEGABLE',true,'LIVE'],
  ['team.read','DELEGATION','team','MARKET','DELEGABLE',false,'LIVE'],
  ['team.grant','DELEGATION','team','MARKET','DELEGABLE',true,'LIVE'],
  ['team.revoke','DELEGATION','team','MARKET','DELEGABLE',true,'LIVE'],
  ['team.invite','DELEGATION','team','MARKET','DELEGABLE',true,'LIVE'],
  ['network.read','DELEGATION','network','MARKET','DELEGABLE',false,'LIVE'],
  ['network.create','DELEGATION','network','MARKET','DELEGABLE',true,'LIVE'],
  ['network.update','DELEGATION','network','MARKET','DELEGABLE',true,'LIVE'],
  ['network.suspend','DELEGATION','network','MARKET','DELEGABLE',true,'LIVE'],
  ['provider.manage','DELEGATION','network','MARKET','DELEGABLE',true,'LIVE'],
  ['market_config.read','DELEGATION','market-config','MARKET','DELEGABLE',false,'LIVE'],
  // Audit schéma (migration 135_markets_foundation.sql, jamais altérée) : hors
  // code/currency/minor_unit (réservés central) et is_active (même autorité que
  // market.create, doit rester central), il ne reste aucun champ de configuration
  // marché à déléguer. CENTRAL_ONLY/CENTRAL_HELD documente ce constat au lieu de
  // laisser un MISSING qui suggérerait un backlog de construction restant.
  ['market_config.update','DELEGATION','market-config','MARKET','CENTRAL_ONLY',true,'CENTRAL_HELD'],
  ['finance.read','DELEGATION','finance','MARKET','DELEGABLE',false,'LIVE'],
  ['finance.act','DELEGATION','finance','MARKET','DELEGABLE',true,'LIVE'],
  ['settlement.receive','DELEGATION','finance','MARKET','DELEGABLE',true,'LIVE'],
  ['catalog.expose','DELEGATION','commerce','MARKET','DELEGABLE',true,'LIVE'],
  ['catalog.read','DELEGATION','commerce','MARKET','DELEGABLE',false,'LIVE'],
  ['local_offer.manage','DELEGATION','commerce','MARKET','DELEGABLE',true,'LIVE'],
  ['cash_control.policy.manage','DELEGATION','finance','MARKET','DELEGABLE',true,'LIVE'],
  ['execution.order.mark_ordered','EXECUTION','operations','MARKET','DELEGABLE',true,'LIVE'],
  ['execution.distribution.run','EXECUTION','operations','MARKET','DELEGABLE',true,'LIVE'],
  ['execution.parcel.ship','EXECUTION','operations','MARKET','DELEGABLE',true,'LIVE'],
  ['execution.inventory.assign','EXECUTION','operations','MARKET','DELEGABLE',true,'LIVE'],
  ['execution.parcel.receive','EXECUTION','operations','MARKET','DELEGABLE',true,'LIVE'],
  ['execution.parcel.collect','EXECUTION','operations','MARKET','DELEGABLE',true,'LIVE'],
  ['execution.cash.confirm','EXECUTION','payments','MARKET','DELEGABLE',true,'LIVE'],
  ['group_cost.allocate','BOUNDARY','structure','GROUP','CENTRAL_ONLY',true,'LIVE'],
  ['dashboard.global.read','BOUNDARY','pilotage','GROUP','CENTRAL_ONLY',false,'LIVE'],
  ['user.role.set','BOUNDARY','team','GROUP','CENTRAL_ONLY',true,'LIVE'],
  ['market.create','BOUNDARY','market','GROUP','CENTRAL_ONLY',true,'MISSING'],
].map(([capability, className, domain, authorityScope, delegationMode, requiresAudit, status]) => Object.freeze({
  capability, class: className, domain, authority_scope: authorityScope,
  delegation_mode: delegationMode, requires_audit: requiresAudit, status,
  effect: declaredEffect(capability),
  amount_bearing: AMOUNT_BEARING.includes(capability),
})));

// Le KPI d'autonomie ne mesure que les capabilities MARKET réellement
// DELEGABLE : une capability `class = DELEGATION` mais `delegation_mode =
// CENTRAL_ONLY` (ex. market_config.update, cf. migration 246) documente une
// non-délégation volontaire et ne doit pas faire baisser le taux — elle
// n'appartient tout simplement pas au dénominateur.
function autonomyDenominator(rows = CAPABILITIES) {
  return rows.filter(row => (
    row.class === 'DELEGATION'
    && row.authority_scope === 'MARKET'
    && row.delegation_mode === 'DELEGABLE'
  ));
}

function autonomyStats(rows = CAPABILITIES) {
  const delegable = autonomyDenominator(rows);
  const live = delegable.filter(row => row.status === 'LIVE');
  return { live: live.length, total: delegable.length, rate: delegable.length ? live.length / delegable.length : 0 };
}

// Autorité centrale : cinq domaines où l'accès central n'est JAMAIS impliqué par le rôle
// admin mais par une autorisation explicite, révocable, dans une table `*_global_access_grants`
// (doctrine « admin_role_never_implies_canonical_* »). Le SQL de lecture reste dans chaque
// middleware `require-<domaine>-global-authority.js` : ce registre ne fait que les déclarer.
const CENTRAL_AUTHORITY = Object.freeze({
  dashboard: Object.freeze({ table: 'dashboard_global_access_grants', guard: 'middleware/require-dashboard-global-authority.js' }),
  catalog: Object.freeze({ table: 'catalog_global_access_grants', guard: 'middleware/require-catalog-global-authority.js' }),
  decision_signal: Object.freeze({ table: 'decision_signal_global_access_grants', guard: 'middleware/require-decision-signal-global-authority.js' }),
  pricing: Object.freeze({ table: 'pricing_global_access_grants', guard: 'middleware/require-pricing-global-authority.js' }),
  sourcing: Object.freeze({ table: 'sourcing_global_access_grants', guard: 'middleware/require-sourcing-global-authority.js' }),
});

// Chaque capability de groupe ou CENTRAL_ONLY déclare sa table d'autorisation centrale, ou null
// quand le code ne la fait appliquer par aucune table à ce jour (le registre la liste, aucune
// route ne la consomme : c'est un constat, pas une décision). Toute nouvelle capability de
// groupe doit être ajoutée ici, sinon le chargement échoue.
const GROUP_CAPABILITY_AUTHORITY = Object.freeze({
  'dashboard.global.read': 'dashboard',
  'group_cost.allocate': null,
  'user.role.set': null,
  'market.create': null,
  'market_config.update': null,
});

function centralAuthorityFor(capability) {
  const domain = GROUP_CAPABILITY_AUTHORITY[capability];
  return domain ? { domain, ...CENTRAL_AUTHORITY[domain] } : null;
}

(function assertGroupCapabilitiesDeclared() {
  const central = CAPABILITIES.filter(row => row.authority_scope === 'GROUP' || row.delegation_mode === 'CENTRAL_ONLY');
  for (const row of central) {
    if (!Object.prototype.hasOwnProperty.call(GROUP_CAPABILITY_AUTHORITY, row.capability)) {
      throw new Error(`capability de groupe sans autorité centrale déclarée (domaine ou null) : ${row.capability}`);
    }
  }
  for (const [capability, domain] of Object.entries(GROUP_CAPABILITY_AUTHORITY)) {
    if (!central.some(row => row.capability === capability)) throw new Error(`autorité centrale déclarée pour une capability non centrale : ${capability}`);
    if (domain !== null && !CENTRAL_AUTHORITY[domain]) throw new Error(`domaine d'autorité centrale inconnu : ${domain}`);
  }
}());

module.exports = {
  CAPABILITIES, EFFECTS, AMOUNT_BEARING, CENTRAL_AUTHORITY, GROUP_CAPABILITY_AUTHORITY,
  centralAuthorityFor, autonomyStats, autonomyDenominator,
};
