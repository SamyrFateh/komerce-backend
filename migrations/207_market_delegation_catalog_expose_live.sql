-- @migration 207_market_delegation_catalog_expose_live.sql
-- @domain    market-delegation
-- @purpose   catalog.expose devient réellement LIVE et immédiatement
--            utilisable par les responsables pays existants, sans élargir
--            les viewers. Même patron que les migrations 203/204/205.
--
--            Séparation stricte et volontaire d'avec la migration 206 : le
--            snapshot (quels produits sont déjà exposés) et l'activation de
--            la capability (qui peut désormais changer l'exposition) sont
--            deux décisions distinctes. Cette migration NE TOUCHE JAMAIS
--            product_market_exposure — elle ne fait qu'ouvrir le droit
--            d'agir, jamais l'exposition elle-même. Toute exposition déjà
--            en place vient exclusivement de la migration 206, exécutée
--            avant celle-ci et jamais rejouée ici.

UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability = 'catalog.expose';

-- Les anciens assignments doivent pouvoir déléguer la capability avant que
-- leur responsable la reçoive. Les ceilings futurs l'ont déjà via le template.
INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'catalog.expose', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = 'catalog.expose'
        AND acc.revoked_at IS NULL
   );

-- Même signal manager existant que les migrations 203/204/205 : gestion
-- équipe + lecture réseau. On ne promeut jamais un viewer/agent simple et
-- on ne touche pas aux rôles globaux.
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
  SELECT e.membership_id, 'catalog.expose', e.user_id
    FROM eligible e
   WHERE NOT EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = e.membership_id
        AND mc.capability = 'catalog.expose'
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
       'catalog.expose',
       'CAPABILITY_GRANTED_BY_PROMOTION',
       NULL,
       jsonb_build_object('capability', 'catalog.expose', 'source', 'migration-207'),
       NOW(),
       'migration-207'
  FROM inserted i
  JOIN assignment_memberships am ON am.id = i.membership_id;
