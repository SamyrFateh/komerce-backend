-- @migration 209_market_delegation_settlement_live.sql
-- @domain    market-delegation
-- @purpose   Rendre finance.act et settlement.receive réellement utilisables
--            par les responsables pays existants, sans leur donner aucune
--            autorité sur amount/currency ni sur le passage central PAID.
--            Le lifecycle financier reste propriété de settlement.

UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability IN ('finance.act', 'settlement.receive');

INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, caps.capability, a.granted_by
  FROM market_operating_assignments a
 CROSS JOIN (VALUES ('finance.act'), ('settlement.receive')) AS caps(capability)
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = caps.capability
        AND acc.revoked_at IS NULL
   );

-- Signal manager : gestion équipe + lecture finance. finance.read existe déjà
-- dans le socle de lecture délégué ; on ne promeut donc pas un viewer qui ne
-- possède pas les capacités de gestion d'équipe.
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
          AND mc.capability = 'finance.read'
          AND mc.revoked_at IS NULL
     )
), candidates AS (
  SELECT e.membership_id, e.assignment_id, e.user_id, caps.capability
    FROM eligible e
   CROSS JOIN (VALUES ('finance.act'), ('settlement.receive')) AS caps(capability)
), inserted AS (
  INSERT INTO membership_capabilities (membership_id, capability, granted_by)
  SELECT c.membership_id, c.capability, c.user_id
    FROM candidates c
   WHERE NOT EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = c.membership_id
        AND mc.capability = c.capability
        AND mc.revoked_at IS NULL
   )
  RETURNING membership_id, capability
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
       i.capability,
       'CAPABILITY_GRANTED_BY_PROMOTION',
       NULL,
       jsonb_build_object('capability', i.capability, 'source', 'migration-209'),
       NOW(),
       'migration-209'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;

-- Invariant volontaire : cette migration de délégation ne crée ni ne modifie
-- aucune ligne de market_settlements. L'activation d'un droit n'est jamais un
-- événement financier.
