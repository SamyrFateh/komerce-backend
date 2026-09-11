-- @migration 212_market_delegation_execution_ceiling.sql
-- @domain    market-delegation
-- @purpose   Rendre les capabilities EXECUTION réellement délégables aux
--            équipes terrain sans les auto-accorder au responsable pays.
--
-- Doctrine :
-- - EXECUTION reste distinct de DELEGATION : superviser un marché ne donne
--   jamais implicitement le droit d'exécuter une opération physique ;
-- - le ceiling d'un assignment peut contenir les capabilities EXECUTION
--   MARKET/DELEGABLE/LIVE afin qu'un détenteur de team.grant les délègue ;
-- - aucune membership existante ne reçoit un droit terrain par cette migration.

-- Futurs assignments : le template courant connaît désormais les droits
-- terrain explicitement délégables.
INSERT INTO ceiling_template_capabilities (template_id, capability)
SELECT ct.id, cr.capability
  FROM ceiling_templates ct
  JOIN capability_registry cr
    ON cr.class = 'EXECUTION'
   AND cr.authority_scope = 'MARKET'
   AND cr.delegation_mode = 'DELEGABLE'
   AND cr.status = 'LIVE'
 WHERE ct.is_current = TRUE
ON CONFLICT DO NOTHING;

-- Assignments déjà actifs : même ceiling potentiel, sans aucun auto-grant.
WITH execution_caps AS (
  SELECT capability
    FROM capability_registry
   WHERE class = 'EXECUTION'
     AND authority_scope = 'MARKET'
     AND delegation_mode = 'DELEGABLE'
     AND status = 'LIVE'
), inserted AS (
  INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
  SELECT a.id, ec.capability, a.granted_by
    FROM market_operating_assignments a
   CROSS JOIN execution_caps ec
   WHERE a.status = 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1
         FROM assignment_capability_ceiling acc
        WHERE acc.assignment_id = a.id
          AND acc.capability = ec.capability
          AND acc.revoked_at IS NULL
     )
  RETURNING assignment_id, capability
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
       i.assignment_id,
       NULL,
       i.capability,
       'CEILING_CAPABILITY_ADDED_BY_PROMOTION',
       NULL,
       jsonb_build_object('capability', i.capability, 'source', 'migration-212', 'auto_grant', false),
       NOW(),
       'migration-212'
  FROM inserted i;

-- Invariant volontaire : aucune écriture dans membership_capabilities ici.
-- Le terrain n'obtient un droit qu'après une délégation explicite par l'équipe.
