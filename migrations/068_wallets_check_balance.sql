-- Migration 068 — Contrainte CHECK balance_kmf >= 0 sur wallets
-- ═══════════════════════════════════════════════════════════════════════
-- Filet de sécurité DB contre les soldes négatifs.
-- Le guard applicatif existe déjà dans wallet-service.js ; cette contrainte
-- protège contre une requête SQL directe ou un bug contournant la couche app.
--
-- IDEMPOTENTE : le DO-block vérifie pg_constraint avant d'ajouter.
-- Remplace et annule migrations/068_check_balance_non_negative.sql
-- (qui utilisait ADD CONSTRAINT IF NOT EXISTS — syntaxe PostgreSQL inexistante).
--
-- NOT VALID : valide uniquement les nouvelles lignes, sans verrou full-table.
-- Cela permet une application en production sans downtime.
--
-- ── Étape 1 : appliquer ce fichier ──────────────────────────────────────────
--   psql $DATABASE_URL -f 068_wallets_check_balance.sql
--
-- ── Étape 2 : vérifier qu'aucun wallet n'est négatif ────────────────────────
--   SELECT id, user_id, balance_kmf FROM wallets WHERE balance_kmf < 0;
--   -- Doit retourner 0 ligne. Si des lignes apparaissent : corriger avant l'étape 3.
--
-- ── Étape 3 : valider la contrainte sur les lignes existantes ───────────────
--   ALTER TABLE wallets VALIDATE CONSTRAINT chk_balance_non_negative;
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname     = 'chk_balance_non_negative'
       AND conrelid    = 'wallets'::regclass
  ) THEN
    ALTER TABLE wallets
      ADD CONSTRAINT chk_balance_non_negative
      CHECK (balance_kmf >= 0)
      NOT VALID;

    RAISE NOTICE 'Migration 068 : contrainte chk_balance_non_negative ajoutée (NOT VALID).';
    RAISE NOTICE 'Étape suivante : vérifier SELECT ... WHERE balance_kmf < 0 ;';
    RAISE NOTICE 'Puis : ALTER TABLE wallets VALIDATE CONSTRAINT chk_balance_non_negative;';
  ELSE
    RAISE NOTICE 'Migration 068 : contrainte chk_balance_non_negative déjà présente — skip.';
  END IF;
END
$$;

COMMIT;
