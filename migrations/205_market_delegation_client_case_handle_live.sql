-- @migration 205_market_delegation_client_case_handle_live.sql
-- @domain    market-delegation
-- @purpose   client.case.handle devient réellement LIVE et immédiatement
--            utilisable par les responsables pays existants, sans élargir
--            les viewers. Même patron que les migrations 203
--            (provider.manage) et 204 (local_offer.manage) : passer le
--            registre en LIVE ne suffit pas — les assignments déjà actifs
--            et leurs managers déjà reconnus doivent recevoir la
--            capability explicitement.
--
--            client.case.handle ne porte AUCUNE autorité sur
--            disputes.refund_kmf / disputes.refund_eur — le remboursement
--            reste une vérité financière irréversible, jamais déléguée
--            (voir services/dispute-mutation-service.js). Cette migration
--            ne touche donc que capability_registry, assignment_capability_
--            ceiling et membership_capabilities ; elle n'écrit jamais dans
--            disputes.

UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability = 'client.case.handle';

-- Les anciens assignments doivent pouvoir déléguer la capability avant que
-- leur responsable la reçoive. Les ceilings futurs l'ont déjà via le template.
INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'client.case.handle', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = 'client.case.handle'
        AND acc.revoked_at IS NULL
   );

-- Même signal manager existant que les migrations 203/204 : gestion équipe +
-- lecture réseau. On ne promeut jamais un viewer/agent simple et on ne
-- touche pas aux rôles globaux.
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
  SELECT e.membership_id, 'client.case.handle', e.user_id
    FROM eligible e
   WHERE NOT EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = e.membership_id
        AND mc.capability = 'client.case.handle'
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
       'client.case.handle',
       'CAPABILITY_GRANTED_BY_PROMOTION',
       NULL,
       jsonb_build_object('capability', 'client.case.handle', 'source', 'migration-205'),
       NOW(),
       'migration-205'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;
