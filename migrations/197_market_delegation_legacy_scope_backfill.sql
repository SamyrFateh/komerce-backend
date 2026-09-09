-- @migration 197_market_delegation_legacy_scope_backfill.sql
-- @domain    market-delegation
-- @purpose   Adopt active legacy operator_market_scopes into Market Operating Assignments and memberships without granting future capabilities.
--
-- Doctrine:
--   - one ACTIVE Market Operating Assignment per Market ID;
--   - legacy manager -> currently LIVE DELEGATION capabilities inside the assignment ceiling;
--   - legacy viewer -> conservative read-only whitelist only;
--   - MISSING / future capabilities are never granted by this backfill;
--   - existing memberships are never expanded by this migration;
--   - operator_market_scopes stays the compatibility read model and is merely attributed to the adopted membership.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ceiling_templates WHERE is_current = TRUE) THEN
    RAISE EXCEPTION 'market delegation backfill requires one current ceiling template';
  END IF;
END;
$$;

-- 1) Create an ACTIVE assignment only for legacy markets that do not already
-- have one, then populate its ceiling from the current default template.
WITH legacy_markets AS (
  SELECT oms.market_id,
         MIN(oms.granted_at) AS first_granted_at
    FROM operator_market_scopes oms
   WHERE oms.revoked_at IS NULL
   GROUP BY oms.market_id
),
created_assignments AS (
  INSERT INTO market_operating_assignments
    (market_id, status, effective_from, granted_by, granted_at)
  SELECT lm.market_id,
         'ACTIVE',
         lm.first_granted_at,
         NULL,
         lm.first_granted_at
    FROM legacy_markets lm
   WHERE NOT EXISTS (
     SELECT 1
       FROM market_operating_assignments a
      WHERE a.market_id = lm.market_id
        AND a.status = 'ACTIVE'
   )
  RETURNING id, market_id
),
current_template AS (
  SELECT id
    FROM ceiling_templates
   WHERE is_current = TRUE
   LIMIT 1
)
INSERT INTO assignment_capability_ceiling
  (assignment_id, capability, granted_by)
SELECT ca.id,
       ctc.capability,
       NULL
  FROM created_assignments ca
 CROSS JOIN current_template ct
  JOIN ceiling_template_capabilities ctc
    ON ctc.template_id = ct.id;

-- 2) Create memberships only when the legacy user/market pair has not already
-- been adopted. Existing memberships are intentionally left untouched.
-- Then grant a conservative compatibility set bounded by the actual ceiling.
WITH active_legacy AS (
  SELECT oms.id AS legacy_scope_id,
         oms.user_id,
         oms.market_id,
         oms.role AS legacy_role,
         oms.granted_at,
         oms.granted_by
    FROM operator_market_scopes oms
   WHERE oms.revoked_at IS NULL
),
created_memberships AS (
  INSERT INTO assignment_memberships
    (assignment_id, user_id, status, granted_by, granted_at)
  SELECT a.id,
         legacy.user_id,
         'ACTIVE',
         legacy.granted_by,
         legacy.granted_at
    FROM active_legacy legacy
    JOIN market_operating_assignments a
      ON a.market_id = legacy.market_id
     AND a.status = 'ACTIVE'
   WHERE NOT EXISTS (
     SELECT 1
       FROM assignment_memberships am
      WHERE am.assignment_id = a.id
        AND am.user_id = legacy.user_id
        AND am.status = 'ACTIVE'
   )
  RETURNING id, assignment_id, user_id, granted_at, granted_by
),
created_with_legacy_role AS (
  SELECT membership.id AS membership_id,
         membership.assignment_id,
         membership.user_id,
         membership.granted_at,
         membership.granted_by,
         legacy.legacy_role
    FROM created_memberships membership
    JOIN market_operating_assignments a
      ON a.id = membership.assignment_id
    JOIN active_legacy legacy
      ON legacy.market_id = a.market_id
     AND legacy.user_id = membership.user_id
)
INSERT INTO membership_capabilities
  (membership_id, capability, granted_by, granted_at)
SELECT adopted.membership_id,
       registry.capability,
       adopted.granted_by,
       adopted.granted_at
  FROM created_with_legacy_role adopted
  JOIN assignment_capability_ceiling ceiling
    ON ceiling.assignment_id = adopted.assignment_id
   AND ceiling.revoked_at IS NULL
  JOIN capability_registry registry
    ON registry.capability = ceiling.capability
 WHERE registry.class = 'DELEGATION'
   AND registry.authority_scope = 'MARKET'
   AND registry.delegation_mode = 'DELEGABLE'
   AND registry.status = 'LIVE'
   AND (
     adopted.legacy_role = 'manager'
     OR (
       adopted.legacy_role = 'viewer'
       AND registry.capability = ANY (ARRAY[
         'pricing.read',
         'pricing.simulate',
         'dashboard.market.read',
         'operations.read',
         'client.read',
         'network.read',
         'market_config.read',
         'finance.read'
       ]::text[])
     )
   );

-- 3) Attribute each active legacy read-model row to the active membership now
-- representing the same user × market authority. No role is rewritten here.
UPDATE operator_market_scopes oms
   SET projected_from_membership_id = am.id
  FROM market_operating_assignments a
  JOIN assignment_memberships am
    ON am.assignment_id = a.id
   AND am.status = 'ACTIVE'
 WHERE oms.revoked_at IS NULL
   AND oms.market_id = a.market_id
   AND a.status = 'ACTIVE'
   AND oms.user_id = am.user_id
   AND oms.projected_from_membership_id IS NULL;

-- 4) Record adoption in the delegation audit without pretending a human actor
-- performed the migration. Re-running the SQL manually remains idempotent for
-- the audit rows because legacy_scope_id + correlation_id are checked.
INSERT INTO market_delegation_audit
  (actor_user_id, assignment_id, membership_id, capability, action,
   payload_before, payload_after, occurred_at, correlation_id)
SELECT NULL,
       a.id,
       am.id,
       NULL,
       'LEGACY_SCOPE_BACKFILLED',
       NULL,
       jsonb_build_object(
         'legacy_scope_id', oms.id,
         'legacy_role', oms.role,
         'market_id', oms.market_id,
         'user_id', oms.user_id
       ),
       NOW(),
       'migration-197'
  FROM operator_market_scopes oms
  JOIN market_operating_assignments a
    ON a.market_id = oms.market_id
   AND a.status = 'ACTIVE'
  JOIN assignment_memberships am
    ON am.assignment_id = a.id
   AND am.user_id = oms.user_id
   AND am.status = 'ACTIVE'
 WHERE oms.revoked_at IS NULL
   AND oms.projected_from_membership_id = am.id
   AND NOT EXISTS (
     SELECT 1
       FROM market_delegation_audit audit
      WHERE audit.action = 'LEGACY_SCOPE_BACKFILLED'
        AND audit.correlation_id = 'migration-197'
        AND audit.payload_after->>'legacy_scope_id' = oms.id::text
   );
