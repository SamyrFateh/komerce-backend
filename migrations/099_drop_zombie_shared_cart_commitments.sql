-- ============================================================
-- Migration 099 : Re-drop shared_cart_commitments (table zombie)
-- Date : juillet 2026
--
-- CONTEXTE :
--   La migration 080 (juin 2026) a déprécié shared_cart_commitments au
--   profit de shared_cart_estimations (doctrine V4.1 — machine d'état).
--   Le 080 s'est exécuté avec succès (shared_cart_estimations existe en
--   prod) et a donc bien droppé shared_cart_commitments à ce moment-là,
--   après avoir d'abord retiré shared_cart_contributions.commitment_id
--   (sa section 5, seule dépendance qui bloquait le DROP TABLE).
--
--   RECONCILIATION_PROD.sql — écrit pour rattraper un dump antérieur à
--   071b/080/098 — a ensuite été rejoué sur une base où ces migrations
--   avaient DÉJÀ tourné en entier via scripts/migrate.js. Il a ressuscité
--   hors runner à la fois :
--     - la table shared_cart_commitments et son enum (section 3), et
--     - la colonne shared_cart_contributions.commitment_id + sa FK
--       (shared_cart_contributions_commitment_id_fkey), redonnant vie
--       exactement au drift que 080 avait déjà nettoyé une fois.
--
--   Résultat constaté sur le dump live (schema_railway.sql) : les deux
--   tables shared_cart_commitments ET shared_cart_estimations coexistent,
--   et la FK circulaire est de retour (shared_cart_commitments.contribution_id
--   -> contributions, contributions.commitment_id -> commitments). C'est un
--   résidu mort — aucun code actif ne la référence
--   (shared-cart-commitment-service.js et shared-cart-v4-settlement.js sont
--   orphelins, non importés par les routes).
--
-- CETTE MIGRATION :
--   Reproduit EXACTEMENT les étapes 5+6 de 080, dans le même ordre
--   (colonne/FK côté contributions d'abord, table+trigger+type ensuite) :
--   sans le DROP COLUMN préalable, PostgreSQL refuse le DROP TABLE avec
--   une erreur de dépendance sur shared_cart_contributions_commitment_id_fkey.
--   Garde-fou anti-donnees-actives identique à 080 (bloque si des
--   engagements "actifs" existent — ne devrait jamais se déclencher
--   puisque personne n'écrit plus dans cette table depuis 080, mais on ne
--   présume rien). RECONCILIATION_PROD.sql est archivé dans
--   migrations/_superseded/ pour qu'il ne soit plus jamais rejoué.
--
-- IDEMPOTENT via IF EXISTS / DO $$ garde-fou.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

-- ============================================================
-- 1. Retirer commitment_id de shared_cart_contributions
--    (colonne + FK ressuscitées par RECONCILIATION_PROD.sql — drift
--    non versionné, déjà nettoyé une fois par 080 section 5).
--    IF EXISTS absorbe silencieusement les envs sans cette colonne.
-- ============================================================

ALTER TABLE shared_cart_contributions
  DROP COLUMN IF EXISTS commitment_id;

-- ============================================================
-- 2. Dépréciation shared_cart_commitments (re-drop du zombie)
--
-- CONDITION : la table ne peut être droppée qu'après confirmation
-- qu'aucun engagement actif (pledged/locked_for_settlement/payment_pending)
-- n'existe en production.
-- ============================================================

DO $$
DECLARE
  active_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'shared_cart_commitments'
  ) THEN
    RAISE NOTICE 'Migration 099 — shared_cart_commitments déjà absente, rien à faire.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO active_count
  FROM shared_cart_commitments
  WHERE status NOT IN ('cancelled', 'not_honored', 'covered_by_creator', 'paid', 'withdrawn');

  IF active_count > 0 THEN
    RAISE EXCEPTION
      'Migration 099 bloquée : % ligne(s) active(s) dans shared_cart_commitments alors que '
      'cette table est censée être morte depuis 080. Investiguer avant de relancer — '
      'ne pas dropper des données actives à l''aveugle.',
      active_count;
  END IF;

  -- Supprimer le trigger avant le DROP pour éviter les erreurs de dépendance
  DROP TRIGGER IF EXISTS trg_shared_cart_commitments_updated ON shared_cart_commitments;

  DROP TABLE IF EXISTS shared_cart_commitments;

  -- Supprimer le type enum devenu orphelin
  DROP TYPE IF EXISTS shared_cart_commitment_status;

  RAISE NOTICE 'Migration 099 OK — shared_cart_commitments (zombie post-RECONCILIATION_PROD) re-droppée.';
END $$;
