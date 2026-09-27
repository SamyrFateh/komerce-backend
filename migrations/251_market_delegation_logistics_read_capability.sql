-- @migration 251_market_delegation_logistics_read_capability.sql
-- @domain    market-delegation
-- @purpose   Introduce logistics.read as a standalone LIVE read capability
--            for the transit/customs workspace (admin-shipping-customs-
--            workspace.js). Fixes a coherence gap: GET /market/:marketCode
--            there was gated only by role + operator_market_scopes, never by
--            an exact DELEGATION capability, because none existed for this
--            surface — the same class of gap operations.read closed
--            (LOT B), left open here for lack of a registry entry.
--            requireTransitAction/requireCustomsAction (mutations) are
--            untouched: they remain role-only and out of scope for
--            market_operator. Only the read surface is concerned.
--
-- This migration never touches transit or customs mutation authority.

INSERT INTO capability_registry (
  capability, class, domain, authority_scope, delegation_mode, requires_audit, status
) VALUES
  ('logistics.read','DELEGATION','operations','MARKET','DELEGABLE',FALSE,'LIVE')
ON CONFLICT (capability) DO UPDATE SET
  class = EXCLUDED.class,
  domain = EXCLUDED.domain,
  authority_scope = EXCLUDED.authority_scope,
  delegation_mode = EXCLUDED.delegation_mode,
  requires_audit = EXCLUDED.requires_audit,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Future assignments (created via createAssignment(), which seeds its
-- ceiling from the current template) get logistics.read automatically.
INSERT INTO ceiling_template_capabilities (template_id, capability)
SELECT ct.id, 'logistics.read'
  FROM ceiling_templates ct
 WHERE ct.is_current = TRUE
ON CONFLICT DO NOTHING;

-- Existing ACTIVE assignments need the ceiling raised explicitly — same
-- pattern as migrations 203/204/205/207/236.
INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'logistics.read', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = 'logistics.read'
        AND acc.revoked_at IS NULL
   );

-- Plain read right, universal like catalog.read (migration 236): grant to
-- every ACTIVE membership in an ACTIVE assignment, viewer or manager alike.
WITH inserted AS (
  INSERT INTO membership_capabilities (membership_id, capability, granted_by)
  SELECT am.id, 'logistics.read', am.granted_by
    FROM assignment_memberships am
    JOIN market_operating_assignments a ON a.id = am.assignment_id AND a.status = 'ACTIVE'
   WHERE am.status = 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1 FROM membership_capabilities mc
        WHERE mc.membership_id = am.id
          AND mc.capability = 'logistics.read'
          AND mc.revoked_at IS NULL
     )
  RETURNING membership_id
)
INSERT INTO market_delegation_audit (
  actor_user_id, assignment_id, membership_id, capability, action,
  payload_before, payload_after, occurred_at, correlation_id
)
SELECT NULL,
       am.assignment_id,
       am.id,
       'logistics.read',
       'CAPABILITY_GRANTED_BY_PROMOTION',
       NULL,
       jsonb_build_object('capability', 'logistics.read', 'source', 'migration-251'),
       NOW(),
       'migration-251'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;
