-- ============================================================
-- Migration 126 : Éradication de l'îlot collective (Lot 1 — Boutique First)
-- Date : août 2026
--
-- CONTEXTE :
--   Le moteur « Panier Événement Collectif » est mort en amont de cette
--   migration : routes/collective-workspaces.js est un tombstone 410
--   depuis le 2026-05-26, routes/admin-collective-repairs.js n'était
--   monté nulle part dans server.js, et aucun fichier hors de l'îlot
--   collective-* ne l'importait (vérifié par grep exhaustif sur le
--   dépôt). La doctrine Boutique First fait du panier partagé un
--   contexte de la boutique, jamais un moteur autonome ; ce moteur-ci
--   n'a plus aucune raison d'exister.
--
--   Environnement : staging intégral, aucune contrainte de compatibilité
--   avec une production existante. Aucune conservation « pour données
--   historiques » — application stricte de la doctrine.
--
-- PÉRIMÈTRE : 7 tables, toutes les FK sont internes à l'îlot (vérifié :
--   aucune table hors collective_* ne référence ces tables).
--
-- ORDRE (respecte les dépendances FK) :
--   1. collective_payment_tokens        (FK -> sessions)
--   2. collective_payment_sessions      (FK -> workspaces, ON DELETE RESTRICT)
--   3. collective_stock_reservations    (FK -> workspaces)
--   4. collective_workspace_contributions (FK -> workspaces)
--   5. collective_workspace_events      (FK -> workspaces)
--   6. collective_workspace_items       (FK -> workspaces)
--   7. collective_workspaces
--
-- IDEMPOTENT via IF EXISTS.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

DO $$
BEGIN
  RAISE NOTICE 'Migration 126 — début éradication îlot collective.';
END $$;

DROP TABLE IF EXISTS collective_payment_tokens;
DROP TABLE IF EXISTS collective_payment_sessions;
DROP TABLE IF EXISTS collective_stock_reservations;
DROP TABLE IF EXISTS collective_workspace_contributions;
DROP TABLE IF EXISTS collective_workspace_events;
DROP TABLE IF EXISTS collective_workspace_items;
DROP TABLE IF EXISTS collective_workspaces;

-- Types énumérés orphelins liés à l'îlot (noms vérifiés dans schema_railway.sql)
DROP TYPE IF EXISTS collective_contribution_status;
DROP TYPE IF EXISTS collective_session_status;
DROP TYPE IF EXISTS collective_token_status;
DROP TYPE IF EXISTS collective_workspace_status;

DO $$
BEGIN
  RAISE NOTICE 'Migration 126 OK — 7 tables collective_* et types associés supprimés.';
END $$;
