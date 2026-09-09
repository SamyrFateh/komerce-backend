-- @migration 193_market_delegation_capability_registry.sql
-- @domain    market-delegation
-- @purpose   Executable capability registry for delegated Market ID authority.

CREATE TABLE IF NOT EXISTS capability_registry (
  capability TEXT PRIMARY KEY,
  class TEXT NOT NULL CHECK (class IN ('DELEGATION', 'EXECUTION', 'BOUNDARY')),
  domain TEXT NOT NULL CHECK (char_length(btrim(domain)) > 0),
  authority_scope TEXT NOT NULL CHECK (authority_scope IN ('MARKET', 'GROUP')),
  delegation_mode TEXT NOT NULL CHECK (delegation_mode IN ('DELEGABLE', 'CENTRAL_ONLY')),
  requires_audit BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('LIVE','IMPLEMENTED_PENDING_MERGE','CENTRAL_HELD','READ_ONLY','MISSING')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT capability_registry_group_central_only CHECK (
    authority_scope <> 'GROUP' OR delegation_mode = 'CENTRAL_ONLY'
  )
);

INSERT INTO capability_registry (
  capability, class, domain, authority_scope, delegation_mode, requires_audit, status
) VALUES
  ('pricing.read','DELEGATION','pricing','MARKET','DELEGABLE',FALSE,'LIVE'),
  ('pricing.simulate','DELEGATION','pricing','MARKET','DELEGABLE',FALSE,'LIVE'),
  ('pricing.cost_component.update','DELEGATION','pricing','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('pricing.cost_component.reset','DELEGATION','pricing','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('pricing.decide','DELEGATION','pricing','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('pricing.activate','DELEGATION','pricing','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('pricing.policy.set','DELEGATION','pricing','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('market.observation.record','DELEGATION','pricing','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('structure.event.record','DELEGATION','structure','MARKET','DELEGABLE',TRUE,'IMPLEMENTED_PENDING_MERGE'),
  ('dashboard.market.read','DELEGATION','pilotage','MARKET','DELEGABLE',FALSE,'LIVE'),
  ('operations.read','DELEGATION','operations','MARKET','DELEGABLE',FALSE,'LIVE'),
  ('hub.supervise','DELEGATION','operations','MARKET','DELEGABLE',FALSE,'LIVE'),
  ('client.read','DELEGATION','client','MARKET','DELEGABLE',FALSE,'LIVE'),
  ('client.case.handle','DELEGATION','client','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('team.read','DELEGATION','team','MARKET','DELEGABLE',FALSE,'CENTRAL_HELD'),
  ('team.grant','DELEGATION','team','MARKET','DELEGABLE',TRUE,'CENTRAL_HELD'),
  ('team.revoke','DELEGATION','team','MARKET','DELEGABLE',TRUE,'CENTRAL_HELD'),
  ('team.invite','DELEGATION','team','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('network.read','DELEGATION','network','MARKET','DELEGABLE',FALSE,'LIVE'),
  ('network.create','DELEGATION','network','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('network.update','DELEGATION','network','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('network.suspend','DELEGATION','network','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('provider.manage','DELEGATION','network','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('market_config.read','DELEGATION','market-config','MARKET','DELEGABLE',FALSE,'LIVE'),
  ('market_config.update','DELEGATION','market-config','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('finance.read','DELEGATION','finance','MARKET','DELEGABLE',FALSE,'LIVE'),
  ('finance.act','DELEGATION','finance','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('settlement.receive','DELEGATION','finance','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('catalog.expose','DELEGATION','commerce','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('local_offer.manage','DELEGATION','commerce','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('cash_control.policy.manage','DELEGATION','finance','MARKET','DELEGABLE',TRUE,'MISSING'),
  ('execution.order.mark_ordered','EXECUTION','operations','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('execution.distribution.run','EXECUTION','operations','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('execution.parcel.ship','EXECUTION','operations','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('execution.inventory.assign','EXECUTION','operations','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('execution.parcel.receive','EXECUTION','operations','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('execution.parcel.collect','EXECUTION','operations','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('execution.cash.confirm','EXECUTION','payments','MARKET','DELEGABLE',TRUE,'LIVE'),
  ('group_cost.allocate','BOUNDARY','structure','GROUP','CENTRAL_ONLY',TRUE,'LIVE'),
  ('dashboard.global.read','BOUNDARY','pilotage','GROUP','CENTRAL_ONLY',FALSE,'LIVE'),
  ('user.role.set','BOUNDARY','team','GROUP','CENTRAL_ONLY',TRUE,'LIVE'),
  ('market.create','BOUNDARY','market','GROUP','CENTRAL_ONLY',TRUE,'MISSING')
ON CONFLICT (capability) DO UPDATE SET
  class = EXCLUDED.class,
  domain = EXCLUDED.domain,
  authority_scope = EXCLUDED.authority_scope,
  delegation_mode = EXCLUDED.delegation_mode,
  requires_audit = EXCLUDED.requires_audit,
  status = EXCLUDED.status,
  updated_at = NOW();

COMMENT ON TABLE capability_registry IS
  'Executable market-delegation registry. Only class DELEGATION belongs to the autonomy KPI denominator.';
