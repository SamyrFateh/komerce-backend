-- @migration 200_market_delegation_relais_island_nullable.sql
-- @domain    market-delegation
-- @purpose   network.create doit fonctionner pour tout Market ID. relais.island
--            portait DEFAULT 'Anjouan' NOT NULL — un artefact mono-marché (KM) :
--            créer un relais hors KM via l'API aurait silencieusement hérité
--            d'une île comorienne. Rend island nullable ; aucune valeur par
--            défaut géographique n'est plus injectée.
--
--            Hors périmètre de cette migration : services/routing.js exige
--            island_code pour le routage inter-îles KM (ANJOUAN vs
--            GRANDE_COMORE/MOHELI) et lève une erreur s'il est absent. Ce
--            couplage est pré-existant et spécifique à KM ; il n'est pas
--            modifié ici. Un relais KM créé sans island_code restera
--            fonctionnellement incomplet pour le routage tant que ce chantier
--            séparé n'est pas traité. Voir feature card market-delegation,
--            section gaps.
--
--            Cutover capability : le backfill 197 n'accordait volontairement
--            que les DELEGATION capabilities déjà LIVE. Quand les mutations
--            network.* deviennent LIVE ici, les responsables pays existants
--            (team.grant + team.revoke + network.read) doivent les recevoir,
--            sinon le registre annoncerait une autonomie inexploitable.

ALTER TABLE relais ALTER COLUMN island DROP DEFAULT;
ALTER TABLE relais ALTER COLUMN island DROP NOT NULL;

COMMENT ON COLUMN relais.island IS
  'Île (nom lisible), pertinent uniquement pour les marchés à géographie insulaire (ex. KM). Nullable — aucune valeur par défaut géographique. Le routage inter-îles (services/routing.js) reste spécifique à KM et exige island_code pour les relais qui en dépendent.';
COMMENT ON COLUMN relais.island_code IS
  'Code île normalisé, consommé par services/routing.js pour le routage inter-îles KM. Nullable — non applicable hors marchés insulaires. Un relais créé sans île sur un marché qui en a besoin restera incomplet pour le routage tant que ce n''est pas renseigné explicitement.';

UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability IN ('network.create','network.update','network.suspend');

-- Ceinture de compatibilité : les assignments actifs créés avec d'anciens
-- ceilings doivent pouvoir porter les capabilities au moment où elles passent
-- LIVE. Un historique révoqué ne bloque pas une nouvelle ligne active car
-- l'unicité du ceiling est partielle sur revoked_at IS NULL.
INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, promoted.capability, NULL
  FROM market_operating_assignments a
 CROSS JOIN (VALUES
   ('network.create'::text),
   ('network.update'::text),
   ('network.suspend'::text)
 ) AS promoted(capability)
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = promoted.capability
        AND acc.revoked_at IS NULL
   );

-- Promotion des responsables pays existants uniquement. Les viewers ou agents
-- qui ne portent pas déjà la responsabilité d'équipe restent inchangés.
WITH eligible_memberships AS (
  SELECT am.id AS membership_id,
         am.assignment_id
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
promoted_capabilities AS (
  SELECT capability
    FROM (VALUES
      ('network.create'::text),
      ('network.update'::text),
      ('network.suspend'::text)
    ) AS caps(capability)
),
granted AS (
  INSERT INTO membership_capabilities
    (membership_id, capability, granted_by)
  SELECT eligible.membership_id,
         promoted.capability,
         NULL
    FROM eligible_memberships eligible
   CROSS JOIN promoted_capabilities promoted
    JOIN assignment_capability_ceiling ceiling
      ON ceiling.assignment_id = eligible.assignment_id
     AND ceiling.capability = promoted.capability
     AND ceiling.revoked_at IS NULL
   WHERE NOT EXISTS (
     SELECT 1
       FROM membership_capabilities existing
      WHERE existing.membership_id = eligible.membership_id
        AND existing.capability = promoted.capability
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
       jsonb_build_object('source', 'migration-200', 'reason', 'network capability promoted LIVE'),
       NOW(),
       'migration-200'
  FROM granted
  JOIN assignment_memberships am
    ON am.id = granted.membership_id;
