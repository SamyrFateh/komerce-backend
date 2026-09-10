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
  ['structure.event.record','DELEGATION','structure','MARKET','DELEGABLE',true,'IMPLEMENTED_PENDING_MERGE'],
  ['dashboard.market.read','DELEGATION','pilotage','MARKET','DELEGABLE',false,'LIVE'],
  ['operations.read','DELEGATION','operations','MARKET','DELEGABLE',false,'LIVE'],
  ['hub.supervise','DELEGATION','operations','MARKET','DELEGABLE',false,'LIVE'],
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
  ['market_config.update','DELEGATION','market-config','MARKET','DELEGABLE',true,'MISSING'],
  ['finance.read','DELEGATION','finance','MARKET','DELEGABLE',false,'LIVE'],
  ['finance.act','DELEGATION','finance','MARKET','DELEGABLE',true,'LIVE'],
  ['settlement.receive','DELEGATION','finance','MARKET','DELEGABLE',true,'LIVE'],
  ['catalog.expose','DELEGATION','commerce','MARKET','DELEGABLE',true,'LIVE'],
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

function autonomyStats(rows = CAPABILITIES) {
  const delegation = rows.filter(row => row.class === 'DELEGATION');
  const live = delegation.filter(row => row.status === 'LIVE');
  return { live: live.length, total: delegation.length, rate: delegation.length ? live.length / delegation.length : 0 };
}

module.exports = { CAPABILITIES, autonomyStats };
