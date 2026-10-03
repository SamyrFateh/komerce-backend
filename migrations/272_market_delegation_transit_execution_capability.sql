-- @migration 272_market_delegation_transit_execution_capability.sql
-- @domain    market-delegation
-- @purpose   D1 Market Control Plane: make transit confirmation an explicit
--            market-delegated EXECUTION capability. No existing membership
--            is auto-granted: transit authority must be assigned deliberately.
--
-- Human review required: this changes authority and intentionally fails closed
-- for legacy agent_transitaire accounts until they receive a market membership.

INSERT INTO capability_registry (
  capability, class, domain, authority_scope, delegation_mode,
  requires_audit, status, effect, amount_bearing
) VALUES (
  'execution.transit.confirm','EXECUTION','operations','MARKET','DELEGABLE',
  TRUE,'LIVE','ACT',FALSE
)
ON CONFLICT (capability) DO UPDATE SET
  class = EXCLUDED.class,
  domain = EXCLUDED.domain,
  authority_scope = EXCLUDED.authority_scope,
  delegation_mode = EXCLUDED.delegation_mode,
  requires_audit = EXCLUDED.requires_audit,
  status = EXCLUDED.status,
  effect = EXCLUDED.effect,
  amount_bearing = EXCLUDED.amount_bearing,
  updated_at = NOW();

INSERT INTO ceiling_template_capabilities (template_id, capability)
SELECT ct.id, 'execution.transit.confirm'
  FROM ceiling_templates ct
 WHERE ct.is_current = TRUE
ON CONFLICT DO NOTHING;

INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'execution.transit.confirm', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = 'execution.transit.confirm'
        AND acc.revoked_at IS NULL
   );
