-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 113 — Colonne air_excluded sur products
--
-- Logique : opt-out.
--   air_excluded = false (défaut) → produit éligible à la livraison aérienne
--   air_excluded = true            → produit forcé en maritime uniquement
--
-- Cas typiques d'exclusion :
--   - Produits volumineux/lourds (coût air prohibitif)
--   - Matières dangereuses (batteries lithium, aérosols, parfums)
--   - Produits fragiles dont l'emballage air n'est pas validé hub
--
-- Pas d'index : colonne booléenne, requêtes unitaires (fiche produit).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS air_excluded boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN products.air_excluded IS
  'Opt-out livraison aérienne. false (défaut) = éligible AIR_EXPRESS. '
  'true = maritime uniquement (volume, matières dangereuses, fragile non-validé). '
  'Source unique pour buildDeliveryOptions() dans catalog-product-detail.js.';
