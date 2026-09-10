-- @migration 201_market_network_promotion_agent_optional.sql
-- @domain    market-delegation
-- @purpose   Follow-up immutable du LOT réseau après migration 200 :
--            1) permettre de créer un relais avant d'affecter une personne ;
--            2) promouvoir network.create/update/suspend vers les responsables
--               pays existants sans élargir les viewers/agents simples.
--
-- Doctrine :
--   - un relais est d'abord un point opérationnel du Market ID ; son agent peut
--     être affecté plus tard ;
--   - une capability devenue LIVE doit être réellement exerçable par les
--     responsables pays déjà en place ;
--   - la promotion reste bornée par le ceiling MARKET/DELEGABLE et est auditée.

ALTER TABLE relais ALTER COLUMN agent_name DROP NOT NULL;

COMMENT ON COLUMN relais.agent_name IS
  'Nom de l''agent actuellement affecté au relais. Nullable : le point relais peut être créé avant l''affectation d''une personne.';

-- Ceinture de compatibilité : les assignments actifs doivent porter les
-- capabilities réseau désormais LIVE. Une ligne précédemment révoquée n'est
-- jamais réactivée silencieusement : on crée seulement une nouvelle ligne active.
INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, registry.capability, a.granted_by
  FROM market_operating_assignments a
  CROSS JOIN capability_registry registry
 WHERE a.status = 'ACTIVE'
   AND registry.capability IN ('network.create','network.update','network.suspend')
   AND registry.class = 'DELEGATION'
   AND registry.authority_scope = 'MARKET'
   AND registry.delegation_mode = 'DELEGABLE'
   AND registry.status = 'LIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = registry.capability
        AND acc.revoked_at IS NULL
   );

-- Responsable pays existant : la membership porte déjà la responsabilité de
-- délégation équipe et la lecture réseau. Ce signal exclut les viewers et les
-- agents terrain. On lui donne les mutations réseau maintenant devenues LIVE.
WITH eligible_memberships AS (
  SELECT am.id AS membership_id,
         am.assignment_id,
         am.user_id
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
),
granted AS (
  INSERT INTO membership_capabilities (membership_id, capability, granted_by)
  SELECT eligible.membership_id,
         registry.capability,
         eligible.user_id
    FROM eligible_memberships eligible
    JOIN assignment_capability_ceiling ceiling
      ON ceiling.assignment_id = eligible.assignment_id
     AND ceiling.revoked_at IS NULL
    JOIN capability_registry registry
      ON registry.capability = ceiling.capability
   WHERE registry.capability IN ('network.create','network.update','network.suspend')
     AND registry.class = 'DELEGATION'
     AND registry.authority_scope = 'MARKET'
     AND registry.delegation_mode = 'DELEGABLE'
     AND registry.status = 'LIVE'
     AND NOT EXISTS (
       SELECT 1 FROM membership_capabilities existing
        WHERE existing.membership_id = eligible.membership_id
          AND existing.capability = registry.capability
          AND existing.revoked_at IS NULL
     )
  RETURNING membership_id, capability
)
INSERT INTO market_delegation_audit
  (actor_user_id, assignment_id, membership_id, capability, action,
   payload_before, payload_after, occurred_at, correlation_id)
SELECT NULL,
       am.assignment_id,
       granted.membership_id,
       granted.capability,
       'CAPABILITY_GRANTED_BY_PROMOTION',
       NULL,
       jsonb_build_object('source', 'migration-201', 'capability', granted.capability),
       NOW(),
       'migration-201'
  FROM granted
  JOIN assignment_memberships am ON am.id = granted.membership_id;
