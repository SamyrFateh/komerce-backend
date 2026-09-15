-- @migration 237_market_delegation_reonboard_backfill.sql
-- @domain    market-delegation
-- @purpose   Close a provisioning gap discovered during the transparence
--            opérateur validation: createAssignment()/addMembership() have
--            no automated caller anywhere in the app (verified: zero call
--            sites outside services/market-delegation-service.js and the
--            one-off migrations 197/207). scripts/provision-market-operator.js
--            only writes operator_market_scopes — it never created the
--            matching market_operating_assignments / assignment_memberships
--            row. Every market_operator provisioned since migration 197 ran
--            has therefore been locked out of every market-delegation-gated
--            surface (Catalogue included), with a guaranteed 403 on click.
--
--            This migration re-runs the exact adoption logic of 197 —
--            idempotent by construction (WHERE NOT EXISTS), so it only
--            touches operator_market_scopes rows that 197 (or a later
--            re-run of this file) never adopted. It additionally grants
--            catalog.read to viewers, per migration 236.
--
--            Going forward, scripts/provision-market-operator.js is fixed
--            (same PR) to create the assignment/membership at provisioning
--            time, so this backfill should not need a third re-run absent a
--            new onboarding path bypassing that script.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ceiling_templates WHERE is_current = TRUE) THEN
    RAISE EXCEPTION 'market delegation reonboard backfill requires one current ceiling template';
  END IF;
END;
$$;

-- 1) Create an ACTIVE assignment for any legacy market still missing one.
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

-- 2) Create memberships for any user/market pair not yet adopted (this is
-- the actual fix: catches every operator provisioned since 197, whether
-- their market already had an assignment or not).
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
         'finance.read',
         'catalog.read'
       ]::text[])
     )
   );

-- 3) Attribute each newly-adopted legacy read-model row to its membership.
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

-- 4) Audit trail, idempotent on re-run.
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
       'migration-237'
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
        AND audit.correlation_id = 'migration-237'
        AND audit.payload_after->>'legacy_scope_id' = oms.id::text
   );
