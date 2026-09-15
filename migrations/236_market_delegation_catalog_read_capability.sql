-- @migration 236_market_delegation_catalog_read_capability.sql
-- @domain    market-delegation
-- @purpose   Introduce catalog.read as a standalone LIVE read capability,
--            distinct from catalog.expose (write). Fixes a coherence gap:
--            GET .../catalog/exposure required catalog.expose, so a
--            market_operator with a viewer-only operator_market_scopes role
--            could never read the catalog at all (migration 207 explicitly
--            never promotes viewers to catalog.expose, by design — that part
--            is correct and untouched here). catalog.read is universal by
--            doctrine: transparence DANS le scope means viewer already reads
--            everything else in-market, so it must read the catalog too.
--
-- This migration NEVER touches catalog.expose or product_market_exposure —
-- it only opens a read right. Write authority is unchanged.

INSERT INTO capability_registry (
  capability, class, domain, authority_scope, delegation_mode, requires_audit, status
) VALUES
  ('catalog.read','DELEGATION','commerce','MARKET','DELEGABLE',FALSE,'LIVE')
ON CONFLICT (capability) DO UPDATE SET
  class = EXCLUDED.class,
  domain = EXCLUDED.domain,
  authority_scope = EXCLUDED.authority_scope,
  delegation_mode = EXCLUDED.delegation_mode,
  requires_audit = EXCLUDED.requires_audit,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Future assignments (created via createAssignment(), which seeds its
-- ceiling from the current template) get catalog.read automatically.
INSERT INTO ceiling_template_capabilities (template_id, capability)
SELECT ct.id, 'catalog.read'
  FROM ceiling_templates ct
 WHERE ct.is_current = TRUE
ON CONFLICT DO NOTHING;

-- Existing ACTIVE assignments need the ceiling raised explicitly — same
-- pattern as migrations 203/204/205/207.
INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'catalog.read', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = 'catalog.read'
        AND acc.revoked_at IS NULL
   );

-- Unlike 207 (write authority, manager-only promotion signal), catalog.read
-- is a plain read right: grant it to every ACTIVE membership in an ACTIVE
-- assignment, viewer or manager alike. This is the one deliberate difference
-- from the 203/204/205/207 pattern, and it is intentional.
WITH inserted AS (
  INSERT INTO membership_capabilities (membership_id, capability, granted_by)
  SELECT am.id, 'catalog.read', am.granted_by
    FROM assignment_memberships am
    JOIN market_operating_assignments a ON a.id = am.assignment_id AND a.status = 'ACTIVE'
   WHERE am.status = 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1 FROM membership_capabilities mc
        WHERE mc.membership_id = am.id
          AND mc.capability = 'catalog.read'
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
       'catalog.read',
       'CAPABILITY_GRANTED_BY_PROMOTION',
       NULL,
       jsonb_build_object('capability', 'catalog.read', 'source', 'migration-236'),
       NOW(),
       'migration-236'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;
