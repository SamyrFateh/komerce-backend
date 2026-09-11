-- @migration 212_market_delegation_execution_ceiling.sql
-- @domain    market-delegation
-- @purpose   Rendre les capabilities EXECUTION réellement délégables aux
--            membres terrain sans les auto-accorder au manager pays.
--
-- Doctrine :
--   - EXECUTION est dans le ceiling du mandat marché, jamais implicite sur une
--     membership ;
--   - team.grant peut déléguer une capability EXECUTION LIVE du ceiling sans
--     que le manager doive l'exécuter lui-même ;
--   - aucune écriture users.role ; aucun fait métier terrain créé ici ;
--   - l'ouverture automatique du ceiling est auditée avec actor_user_id NULL.

WITH current_templates AS (
  SELECT id FROM ceiling_templates WHERE is_current = TRUE
)
INSERT INTO ceiling_template_capabilities (template_id, capability)
SELECT template.id, registry.capability
  FROM current_templates template
  JOIN capability_registry registry
    ON registry.class = 'EXECUTION'
   AND registry.authority_scope = 'MARKET'
   AND registry.delegation_mode = 'DELEGABLE'
   AND registry.status = 'LIVE'
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
  SELECT assignment.id, registry.capability, assignment.granted_by
    FROM market_operating_assignments assignment
   CROSS JOIN capability_registry registry
   WHERE assignment.status = 'ACTIVE'
     AND registry.class = 'EXECUTION'
     AND registry.authority_scope = 'MARKET'
     AND registry.delegation_mode = 'DELEGABLE'
     AND registry.status = 'LIVE'
     AND NOT EXISTS (
       SELECT 1
         FROM assignment_capability_ceiling existing
        WHERE existing.assignment_id = assignment.id
          AND existing.capability = registry.capability
          AND existing.revoked_at IS NULL
     )
  RETURNING assignment_id, capability
)
INSERT INTO market_delegation_audit (
  actor_user_id, assignment_id, membership_id, capability, action,
  payload_before, payload_after, occurred_at, correlation_id
)
SELECT NULL,
       inserted.assignment_id,
       NULL,
       inserted.capability,
       'EXECUTION_CEILING_OPENED_BY_MIGRATION',
       NULL,
       jsonb_build_object('source', 'migration-212', 'capability', inserted.capability),
       NOW(),
       'migration-212'
  FROM inserted;

-- Invariant volontaire : aucune membership n'est élargie automatiquement.
-- Les droits terrain sont accordés explicitement ensuite via team.grant.
