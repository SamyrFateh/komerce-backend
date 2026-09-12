-- @migration 204_market_delegation_local_offer_manage_live.sql
-- @domain    market-delegation
-- @purpose   local_offer.manage devient réellement LIVE et immédiatement
--            utilisable par les responsables pays existants, sans élargir
--            les viewers. Même patron que la migration 203 (provider.manage)
--            : passer le registre en LIVE ne suffit pas — les assignments
--            déjà actifs et leurs managers déjà reconnus doivent recevoir
--            la capability explicitement, sinon "LIVE" reste théorique pour
--            tout le monde sauf les futurs assignments.

UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability = 'local_offer.manage';

-- Les anciens assignments doivent pouvoir déléguer la capability avant que
-- leur responsable la reçoive. Les ceilings futurs l'ont déjà via le template.
INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'local_offer.manage', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = 'local_offer.manage'
        AND acc.revoked_at IS NULL
   );

-- Même signal manager existant que la migration 203 : gestion équipe +
-- lecture réseau. On ne promeut jamais un viewer/agent simple et on ne
-- touche pas aux rôles globaux. La population éligible est volontairement
-- identique à celle de provider.manage — c'est le même "vrai manager pays"
-- qui reçoit les deux capacités de gestion locale.
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
  SELECT e.membership_id, 'local_offer.manage', e.user_id
    FROM eligible e
   WHERE NOT EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = e.membership_id
        AND mc.capability = 'local_offer.manage'
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
       'local_offer.manage',
       'CAPABILITY_GRANTED_BY_PROMOTION',
       NULL,
       jsonb_build_object('capability', 'local_offer.manage', 'source', 'migration-204'),
       NOW(),
       'migration-204'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;
