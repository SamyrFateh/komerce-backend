'use strict';

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

module.exports = { CAPABILITIES, autonomyStats, autonomyDenominator };
