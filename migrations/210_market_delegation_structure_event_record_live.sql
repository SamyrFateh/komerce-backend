-- @migration 210_market_delegation_structure_event_record_live.sql
-- @domain    market-delegation
-- @purpose   structure.event.record devient réellement LIVE et immédiatement
--            utilisable par les responsables pays existants, sans élargir
--            les viewers. Même patron que les migrations
--            203/204/205/207/209.
--
--            Cette migration ne touche jamais economic_structure_cost_events
--            — elle ne fait qu'ouvrir le droit d'agir (ceiling/memberships),
--            jamais un fait économique lui-même. La vérité N3 reste
--            exclusivement écrite via
--            services/pricing-period-structure.js::recordStructureCostEvent(),
--            jamais par cette migration.

UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability = 'structure.event.record';

-- Les anciens assignments doivent pouvoir déléguer la capability avant que
-- leur responsable la reçoive. Les ceilings futurs l'ont déjà via le template.
INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'structure.event.record', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = 'structure.event.record'
        AND acc.revoked_at IS NULL
   );

-- Même signal manager que les migrations 203/204/205/207/209, désormais un
-- patron doctrinal établi sur cinq précédents : gestion équipe + lecture
-- réseau. On ne promeut jamais un viewer/agent simple et on ne touche pas
-- aux rôles globaux. actor_user_id = NULL pour ces promotions automatiques,
-- comme dans toutes les migrations précédentes de cette famille.
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
  SELECT e.membership_id, 'structure.event.record', e.user_id
    FROM eligible e
   WHERE NOT EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = e.membership_id
        AND mc.capability = 'structure.event.record'
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
       'structure.event.record',
       'CAPABILITY_GRANTED_BY_PROMOTION',
       NULL,
       jsonb_build_object('capability', 'structure.event.record', 'source', 'migration-210'),
       NOW(),
       'migration-210'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;
