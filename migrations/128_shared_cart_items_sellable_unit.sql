-- ============================================================
-- Migration 128 : Unité vendable canonique dans shared_cart_items
-- (GAP-07 — lot préalable au Lot 3, avant le CTA « Ajouter à la liste »)
-- Date : août 2026
--
-- CONTEXTE :
--   Le gap analysis GAP-07 a établi que shared_cart_items ne préserve
--   aujourd'hui que product_id + un snapshot d'affichage (nom/image/
--   catégorie/prix), sans jamais porter l'identité SKU ni la
--   combinaison de variante choisie. Pour un produit en
--   inventory_model = 'SKU', product_id seul n'identifie pas une unité
--   vendable — deux lignes du même produit avec des combinaisons
--   distinctes (ex. Chemise·Noir·M vs Chemise·Blanc·L) doivent rester
--   deux lignes distinctes et traçables jusqu'à product_skus.
--
--   Cette migration ajoute uniquement le schéma. Les writers
--   (services/shared-cart-creation.js, services/shared-cart-items-
--   service.js) sont mis à jour séparément (même lot préalable) pour
--   effectivement peupler ces colonnes via
--   services/product-admin-service.js:resolveSellableUnit().
--
-- CHOIX DE CONCEPTION (§7 du rapport GAP-07) :
--   sku_id                 → UUID nullable, FK product_skus(id),
--                             ON DELETE SET NULL. Nullable par nature :
--                             un produit LEGACY_VARIANTS ou sans variante
--                             n'a jamais de ligne product_skus associée,
--                             et un SKU supprimé après coup ne doit
--                             jamais faire disparaître une ligne de liste
--                             déjà partagée (l'historique reste lisible
--                             via variant_combo_snapshot ci-dessous).
--   variant_combo_snapshot → JSONB nullable. Contrairement à sku_id
--                             (référence vivante, peut devenir NULL),
--                             ce snapshot est une COPIE figée de la
--                             combinaison au moment de l'ajout — il ne
--                             change jamais après écriture, même si
--                             product_skus.variant_combo est modifié ou
--                             si le SKU est désactivé. C'est cette
--                             colonne, pas une jointure sur product_skus,
--                             que readers/renderer utilisent pour
--                             afficher « Noir · Taille M » sur une ligne
--                             historique.
--
--   Pas de sku_snapshot distinct (nom/prix/image du SKU) : ces valeurs
--   sont déjà intégralement couvertes par les colonnes existantes
--   product_name_snapshot / unit_price_kmf_snapshot /
--   product_image_snapshot / product_category_snapshot — dupliquer un
--   second snapshot ferait courir le risque de deux sources de vérité
--   divergentes pour la même valeur affichée. Seule la combinaison de
--   variante n'avait pas de foyer : c'est elle, et elle seule, que
--   variant_combo_snapshot couvre.
--
-- IDEMPOTENT via IF NOT EXISTS / DO $$ garde-fou.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

ALTER TABLE shared_cart_items
  ADD COLUMN IF NOT EXISTS sku_id UUID REFERENCES product_skus(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_combo_snapshot JSONB;

COMMENT ON COLUMN shared_cart_items.sku_id IS
  'Unité vendable canonique (GAP-07 §7) — FK vivante vers product_skus. '
  'NULL pour tout produit LEGACY_VARIANTS/sans variante, ou si le SKU a '
  'depuis été supprimé (ON DELETE SET NULL) : ne jamais recréer un SKU '
  'devinée depuis ce NULL, se référer à variant_combo_snapshot pour '
  'l''affichage historique.';

COMMENT ON COLUMN shared_cart_items.variant_combo_snapshot IS
  'Copie figée de la combinaison de variante au moment de l''ajout '
  '(GAP-07 §7/§11) — ne change plus jamais après écriture, même si '
  'product_skus.variant_combo est modifié ou si sku_id devient NULL. '
  'Source de vérité pour le renderer panier partagé (« Noir · Taille M »).';

-- Index utile aux lectures qui distinguent/regroupent par unité vendable
-- (ex. audit des lignes SKU d'une liste donnée).
CREATE INDEX IF NOT EXISTS idx_shared_cart_items_sku
  ON shared_cart_items (sku_id)
  WHERE sku_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'Migration 128 OK — shared_cart_items porte désormais sku_id + variant_combo_snapshot.';
END $$;
