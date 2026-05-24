-- Migration 068 — Contrainte CHECK balance wallet non-négative
-- ═══════════════════════════════════════════════════════════════════════
-- Contexte : le guard applicatif dans wallet-service.js protège en temps
-- normal, mais aucune contrainte DB ne bloque une requête directe ou un
-- bug applicatif. Cette migration ajoute le filet de sécurité niveau DB.
--
-- Idempotente : IF NOT EXISTS sur la contrainte.
-- À appliquer via le runner de startup-migrations ou manuellement.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE wallets
  ADD CONSTRAINT IF NOT EXISTS chk_balance_non_negative
  CHECK (balance_kmf >= 0);

-- Vérification post-migration : doit retourner 0 ligne
-- SELECT id, user_id, balance_kmf FROM wallets WHERE balance_kmf < 0;

COMMIT;
