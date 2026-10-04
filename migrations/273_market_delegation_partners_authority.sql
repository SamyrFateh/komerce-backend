-- @migration 273_market_delegation_partners_authority.sql
-- @domain    market-delegation
-- @purpose   D8 Market Control Plane: replace the legacy operator_market_scopes
--            authority of routes/admin/partners.js with semantic capabilities.
--            partners.read preserves viewer+manager read access; partners.manage
--            preserves manager-only mutation access. provider.manage is not reused.
--
-- Human review required: this changes authorization and backfills capabilities.

INSERT INTO capability_registry (
  capability, class, domain, authority_scope, delegation_mode,
  requires_audit, status, effect, amount_bearing
) VALUES
  ('partners.read','DELEGATION','partners','MARKET','DELEGABLE',FALSE,'LIVE','READ',FALSE),
  ('partners.manage','DELEGATION','partners','MARKET','DELEGABLE',TRUE,'LIVE','ACT',FALSE)
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
SELECT ct.id, c.capability
  FROM ceiling_templates ct
 CROSS JOIN (VALUES ('partners.read'::text), ('partners.manage'::text)) AS c(capability)
 WHERE ct.is_current = TRUE
ON CONFLICT DO NOTHING;

INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, c.capability, a.granted_by
  FROM market_operating_assignments a
 CROSS JOIN (VALUES ('partners.read'::text), ('partners.manage'::text)) AS c(capability)
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = c.capability
        AND acc.revoked_at IS NULL
   );

-- Legacy viewer/manager parity: every active membership keeps read access.
WITH inserted AS (
  INSERT INTO membership_capabilities (membership_id, capability, granted_by)
  SELECT am.id, 'partners.read', am.granted_by
    FROM assignment_memberships am
    JOIN market_operating_assignments a ON a.id = am.assignment_id AND a.status = 'ACTIVE'
   WHERE am.status = 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1 FROM membership_capabilities mc
        WHERE mc.membership_id = am.id
          AND mc.capability = 'partners.read'
          AND mc.revoked_at IS NULL
     )
  RETURNING membership_id
)
INSERT INTO market_delegation_audit (
  actor_user_id, assignment_id, membership_id, capability, action,
  payload_before, payload_after, occurred_at, correlation_id
)
SELECT NULL, am.assignment_id, am.id, 'partners.read',
       'CAPABILITY_GRANTED_BY_PROMOTION', NULL,
       jsonb_build_object('capability','partners.read','source','migration-273'),
       NOW(), 'migration-273'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;

-- Legacy manager parity: only memberships already carrying the canonical
-- manager signal receive mutation authority. Viewers are never promoted.
WITH eligible AS (
  SELECT am.id AS membership_id, am.assignment_id, am.user_id
    FROM assignment_memberships am
   WHERE am.status = 'ACTIVE'
     AND EXISTS (
       SELECT 1 FROM membership_capabilities mc
        WHERE mc.membership_id = am.id
          AND mc.capability = 'team.grant'
          AND mc.revoked_at IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM membership_capabilities mc
        WHERE mc.membership_id = am.id
          AND mc.capability = 'team.revoke'
          AND mc.revoked_at IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM membership_capabilities mc
        WHERE mc.membership_id = am.id
          AND mc.capability = 'network.read'
          AND mc.revoked_at IS NULL
     )
), inserted AS (
  INSERT INTO membership_capabilities (membership_id, capability, granted_by)
  SELECT e.membership_id, 'partners.manage', e.user_id
    FROM eligible e
   WHERE NOT EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = e.membership_id
        AND mc.capability = 'partners.manage'
        AND mc.revoked_at IS NULL
   )
  RETURNING membership_id
)
INSERT INTO market_delegation_audit (
  actor_user_id, assignment_id, membership_id, capability, action,
  payload_before, payload_after, occurred_at, correlation_id
)
SELECT NULL, am.assignment_id, am.id, 'partners.manage',
       'CAPABILITY_GRANTED_BY_PROMOTION', NULL,
       jsonb_build_object('capability','partners.manage','source','migration-273'),
       NOW(), 'migration-273'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;
