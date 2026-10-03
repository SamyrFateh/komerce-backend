-- @migration 268_market_delegation_template_central_only_cleanup.sql
-- @domain    market-delegation
-- @purpose   Keep ceiling templates aligned with the executable capability registry.
--            Migration 246 moved market_config.update to CENTRAL_ONLY/CENTRAL_HELD
--            but left it in ceiling_template_capabilities. New assignments then
--            failed the DB guard while seeding their ceiling.

-- A CENTRAL_ONLY capability must never be proposed to a market assignment.
DELETE FROM ceiling_template_capabilities ctc
USING capability_registry cr
WHERE ctc.capability = cr.capability
  AND (
    cr.authority_scope <> 'MARKET'
    OR cr.delegation_mode <> 'DELEGABLE'
  );

-- Existing active ceilings must also stop carrying capabilities that are no
-- longer delegable. Revocation preserves history instead of deleting it.
UPDATE assignment_capability_ceiling acc
   SET revoked_at = COALESCE(acc.revoked_at, NOW()),
       revoked_by = COALESCE(acc.revoked_by, acc.granted_by)
  FROM capability_registry cr
 WHERE acc.capability = cr.capability
   AND acc.revoked_at IS NULL
   AND (
     cr.authority_scope <> 'MARKET'
     OR cr.delegation_mode <> 'DELEGABLE'
   );

-- Same invariant for active member grants. This is defensive for assignments
-- created before a capability was moved back to central authority.
UPDATE membership_capabilities mc
   SET revoked_at = COALESCE(mc.revoked_at, NOW()),
       revoked_by = COALESCE(mc.revoked_by, mc.granted_by)
  FROM capability_registry cr
 WHERE mc.capability = cr.capability
   AND mc.revoked_at IS NULL
   AND (
     cr.authority_scope <> 'MARKET'
     OR cr.delegation_mode <> 'DELEGABLE'
   );
