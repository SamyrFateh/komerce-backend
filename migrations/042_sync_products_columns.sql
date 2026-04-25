-- ============================================================
-- Migration 042 : Sync doublons sur products (LOT I)
-- Date : avril 2026
-- Version ASCII pure
--
-- OBJECTIF :
--   La table products a accumule des colonnes en doublon :
--     - cost_kmf (initial) vs cost_price_kmf (ajoute plus tard)
--     - weight_kg NUMERIC (initial) vs weight_g INTEGER (ajoute plus tard)
--
--   Les routes pricing/sourcing-scanner utilisent cost_kmf + weight_kg.
--   La route sourcing-engine et la vue ct-views-sourcing utilisent
--   cost_price_kmf + weight_g.
--
--   Resultat : un produit cree d'un cote n'est pas vu de l'autre.
--
-- STRATEGIE :
--   1. Synchroniser les donnees existantes : copier les valeurs dans
--      les colonnes manquantes pour que toutes les lignes soient coherentes.
--   2. Ne PAS dropper les anciennes colonnes (rupture trop large).
--   3. Code mis a jour pour ecrire les 2 colonnes en parallele.
--
-- IDEMPOTENT : peut etre rejouee plusieurs fois sans dommage.
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- 1. Synchroniser cost_kmf <-> cost_price_kmf
-- ============================================================

-- Si cost_kmf vide mais cost_price_kmf rempli, copier
UPDATE products
   SET cost_kmf = cost_price_kmf
 WHERE cost_kmf IS NULL
   AND cost_price_kmf IS NOT NULL;

-- Si cost_price_kmf vide mais cost_kmf rempli, copier
UPDATE products
   SET cost_price_kmf = cost_kmf
 WHERE cost_price_kmf IS NULL
   AND cost_kmf IS NOT NULL;

-- ============================================================
-- 2. Synchroniser weight_kg <-> weight_g
-- ============================================================
-- Conversion : weight_g = ROUND(weight_kg * 1000)
--              weight_kg = weight_g / 1000.0

-- Si weight_kg vide mais weight_g rempli, copier (avec conversion)
UPDATE products
   SET weight_kg = ROUND((weight_g::NUMERIC / 1000.0)::NUMERIC, 2)
 WHERE weight_kg IS NULL
   AND weight_g IS NOT NULL
   AND weight_g > 0;

-- Si weight_g vide mais weight_kg rempli, copier (avec conversion)
UPDATE products
   SET weight_g = ROUND(weight_kg * 1000)
 WHERE weight_g IS NULL
   AND weight_kg IS NOT NULL
   AND weight_kg > 0;

-- ============================================================
-- 3. Verification
-- ============================================================
DO $$
DECLARE
  unsynced_cost INTEGER;
  unsynced_weight INTEGER;
  total_products INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_products FROM products;

  SELECT COUNT(*) INTO unsynced_cost
    FROM products
   WHERE (cost_kmf IS NULL) <> (cost_price_kmf IS NULL);

  SELECT COUNT(*) INTO unsynced_weight
    FROM products
   WHERE (weight_kg IS NULL) <> (weight_g IS NULL);

  RAISE NOTICE 'Migration 042 OK';
  RAISE NOTICE '  Produits totaux : %', total_products;
  RAISE NOTICE '  Couts encore desynchronises : %', unsynced_cost;
  RAISE NOTICE '  Poids encore desynchronises : %', unsynced_weight;

  IF unsynced_cost > 0 THEN
    RAISE NOTICE '  -> Lignes avec un seul des deux remplis : normales si cree avant migration';
  END IF;
END $$;
