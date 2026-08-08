-- ============================================================
-- Migration 129 : Règle V1 — 1 liste OPEN par organisateur
-- Date : 2026-08
--
-- CONTEXTE :
--   Choix produit volontaire (arbitrage 2026-08) : tant que les listes
--   partagées ne sont pas nommables, un organisateur ne peut posséder
--   qu'une seule liste en état OPEN. Cela réduit les possibilités et
--   gagne en lisibilité.
--
-- MÉCANISME :
--   Index unique partiel — concurrent-safe par construction. PostgreSQL
--   garantit l'unicité y compris sous deux INSERT simultanés (le second
--   reçoit une violation de contrainte, pas une race condition).
--
-- RÉVERSIBILITÉ :
--   La règle est provisoire : elle disparaîtra quand les listes
--   deviendront nommables (DROP INDEX suffit). Aucune donnée n'est
--   modifiée ici.
--
-- PRÉCONDITION :
--   Vérifier qu'aucun organisateur ne possède déjà deux listes OPEN
--   avant d'appliquer cette migration :
--
--     SELECT organizer_user_id, count(*) AS open_lists
--       FROM shared_carts WHERE status = 'open'
--      GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC;
--
--   Si des lignes remontent, résoudre avant d'appliquer (UPDATE status).
--
-- IDEMPOTENT via IF NOT EXISTS.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname   = 'shared_carts_one_open_per_organizer'
  ) THEN
    CREATE UNIQUE INDEX shared_carts_one_open_per_organizer
      ON shared_carts (organizer_user_id)
      WHERE status = 'open';

    RAISE NOTICE 'Migration 129 OK — index shared_carts_one_open_per_organizer posé.';
  ELSE
    RAISE NOTICE 'Migration 129 déjà appliquée — index shared_carts_one_open_per_organizer existant.';
  END IF;
END $$;
