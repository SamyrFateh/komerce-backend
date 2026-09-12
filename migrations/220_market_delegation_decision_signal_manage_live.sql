-- @migration 220_market_delegation_decision_signal_manage_live.sql
-- @domain    market-delegation
-- @purpose   Make the lifecycle of market-scoped decision signals delegable
--            without granting global Action Center authority.

INSERT INTO capability_registry (
  capability, class, domain, authority_scope, delegation_mode, requires_audit, status
) VALUES (
  'decision_signal.manage','DELEGATION','pilotage','MARKET','DELEGABLE',TRUE,'LIVE'
)
ON CONFLICT (capability) DO UPDATE SET
  class = EXCLUDED.class,
  domain = EXCLUDED.domain,
  authority_scope = EXCLUDED.authority_scope,
  delegation_mode = EXCLUDED.delegation_mode,
  requires_audit = EXCLUDED.requires_audit,
  status = EXCLUDED.status,
  updated_at = NOW();

INSERT INTO ceiling_template_capabilities (template_id, capability)
SELECT id, 'decision_signal.manage'
  FROM ceiling_templates
 WHERE is_current = TRUE
ON CONFLICT DO NOTHING;

INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'decision_signal.manage', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = 'decision_signal.manage'
        AND acc.revoked_at IS NULL
   );

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
  SELECT e.membership_id, 'decision_signal.manage', e.user_id
    FROM eligible e
   WHERE NOT EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = e.membership_id
        AND mc.capability = 'decision_signal.manage'
        AND mc.revoked_at IS NULL
   )
  RETURNING membership_id
)
INSERT INTO market_delegation_audit (
  actor_user_id,
  assignment_id,
  membership_id,
  capability,
  action,
  payload_before,
  payload_after,
  occurred_at,
  correlation_id
)
SELECT NULL,
       am.assignment_id,
       am.id,
       'decision_signal.manage',
       'CAPABILITY_GRANTED_BY_PROMOTION',
       NULL,
       jsonb_build_object('capability', 'decision_signal.manage', 'source', 'migration-220'),
       NOW(),
       'migration-220'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;
