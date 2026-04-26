-- ============================================================
-- Migration 049 : pickup_secret_attempts (anti-brute-force)
-- Date : avril 2026
-- Version ASCII pure
--
-- OBJECTIF :
--   Ajouter les colonnes pickup_secret_attempts et pickup_secret_blocked_until
--   a la table orders pour :
--     1. Faire fonctionner routes/pickup-secret.js (qui les referencait sans
--        qu'elles existent en BDD = bug latent)
--     2. Activer le compteur d'echecs par-commande sur /scans/collect
--        (anti-brute-force du pickup_code 6 chiffres)
--
-- DOCTRINE :
--   Compteur PAR commande, pas par IP.
--   Apres 5 echecs sur la meme commande -> blocage 15 minutes.
--   Reset automatique au scan reussi.
--
-- IDEMPOTENT.
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- 1. Ajouter pickup_secret_attempts (compteur d'echecs)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'pickup_secret_attempts'
  ) THEN
    ALTER TABLE orders ADD COLUMN pickup_secret_attempts INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ============================================================
-- 2. Ajouter pickup_secret_blocked_until (timestamp de fin de blocage)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'pickup_secret_blocked_until'
  ) THEN
    ALTER TABLE orders ADD COLUMN pickup_secret_blocked_until TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================================
-- 3. Index pour requeter rapidement les commandes bloquees
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_pickup_blocked_until
  ON orders(pickup_secret_blocked_until)
  WHERE pickup_secret_blocked_until IS NOT NULL;

-- ============================================================
-- 4. Migration de donnees : initialiser les commandes existantes
--    (NOT NULL DEFAULT 0 deja gere les nouvelles, mais on assure
--    pour les rangees existantes en cas de schema partiel anterieur)
-- ============================================================
UPDATE orders SET pickup_secret_attempts = 0
  WHERE pickup_secret_attempts IS NULL;

-- ============================================================
-- FIN MIGRATION 049
-- ============================================================
