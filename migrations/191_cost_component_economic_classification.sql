-- ============================================================
-- Migration 191 : classification economique canonique des charges
-- Date : 2026-09-08
--
-- Doctrine :
--   nature economique (variable/fixed) != perimetre d'allocation
--   (direct/mutualized). Les champs family historiques restent en place
--   pour compatibilite moteur et seront migres separement.
-- ============================================================

ALTER TABLE cost_components
  ADD COLUMN IF NOT EXISTS economic_nature TEXT;

ALTER TABLE cost_components
  ADD COLUMN IF NOT EXISTS allocation_perimeter TEXT NOT NULL DEFAULT 'direct';

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_economic_nature_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_economic_nature_check
  CHECK (economic_nature IS NULL OR economic_nature IN ('variable', 'fixed'));

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_allocation_perimeter_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_allocation_perimeter_check
  CHECK (allocation_perimeter IN ('direct', 'mutualized'));

-- Backfill conservateur depuis la nomenclature technique historique.
-- Les composants exceptionnels restent NULL : leur nature doit etre
-- qualifiee explicitement plutot qu'inventee par migration.
UPDATE cost_components
SET economic_nature = 'variable'
WHERE economic_nature IS NULL
  AND (
    family = 'landed_relay'
    OR (family = 'business' AND category <> 'fixed_overhead')
  );

UPDATE cost_components
SET economic_nature = 'fixed'
WHERE economic_nature IS NULL
  AND family = 'business'
  AND category = 'fixed_overhead';

COMMENT ON COLUMN cost_components.economic_nature IS
  'Nature economique canonique: variable ou fixed. NULL uniquement lorsque la nature doit encore etre qualifiee explicitement.';

COMMENT ON COLUMN cost_components.allocation_perimeter IS
  'Perimetre canonique: direct ou mutualized. Independent de la nature economique.';
