-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 116 — Modèle d'éligibilité Air : remplacement de air_excluded
--
-- Problème : air_excluded BOOLEAN DEFAULT false rendait tous les produits
-- historiques éligibles Air par défaut. Une absence de qualification ne doit
-- jamais signifier "éligible" (dangereux pour batteries, aérosols, fragiles…).
--
-- Nouveau modèle :
--   air_eligibility_status ENUM :
--     PENDING_REVIEW  — non qualifié, jamais sélectionnable (défaut)
--     ELIGIBLE        — qualifié et approuvé pour le fret aérien
--     EXCLUDED        — explicitement exclu avec raison documentée
--
--   air_exclusion_reason TEXT nullable — raison si EXCLUDED
--
-- Compatibilité :
--   - Les produits avec air_excluded=true → EXCLUDED
--   - Les produits avec air_excluded=false → PENDING_REVIEW (pas ELIGIBLE)
--   - La colonne air_excluded est conservée mais dépréciée (DROP dans 117)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'air_eligibility_status') THEN
    CREATE TYPE public.air_eligibility_status AS ENUM (
      'PENDING_REVIEW',
      'ELIGIBLE',
      'EXCLUDED'
    );
  END IF;
END $$;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS air_eligibility_status public.air_eligibility_status
    NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN IF NOT EXISTS air_exclusion_reason TEXT;

-- Migrer les données existantes
UPDATE products
  SET air_eligibility_status = 'EXCLUDED',
      air_exclusion_reason   = 'Exclusion explicite (air_excluded=true)'
  WHERE air_excluded = TRUE;

-- Les produits avec air_excluded=false restent PENDING_REVIEW (défaut correct)

COMMENT ON COLUMN products.air_eligibility_status IS
  'Qualification Air : PENDING_REVIEW (défaut, non sélectionnable), '
  'ELIGIBLE (approuvé pour fret aérien), EXCLUDED (interdit avec raison). '
  'Seul ELIGIBLE peut participer à AIR_EXPRESS quand le rail est PUBLIC.';

COMMENT ON COLUMN products.air_exclusion_reason IS
  'Raison de l''exclusion Air (batteries lithium, aérosols, fragile, surpoids...). '
  'Null si ELIGIBLE ou PENDING_REVIEW.';
