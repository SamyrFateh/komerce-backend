-- @migration 290_boutique_object_taxonomy_terms.sql
-- @domain    catalog
-- @purpose   Objet fournisseur -> sous-categorie commerciale, distincte de la douane
-- Les correspondances sont des donnees administrables, sans valeur douaniere.
ALTER TABLE boutique_subcategories
  ADD COLUMN IF NOT EXISTS object_classification_terms JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE boutique_subcategories
  DROP CONSTRAINT IF EXISTS boutique_subcategories_object_classification_terms_object;
ALTER TABLE boutique_subcategories
  ADD CONSTRAINT boutique_subcategories_object_classification_terms_object
  CHECK (jsonb_typeof(object_classification_terms) = 'object');

-- Sous-categorie generique seulement si l'univers Auto est effectivement actif.
-- Pas d'affinite douaniere inventee. Migration additive, sans toucher aux anciennes lignes.
INSERT INTO boutique_subcategories
  (category_key, key, label, short_label, icon, display_order, is_active, object_classification_terms)
SELECT 'Auto', 'Accessoires', 'Accessoires automobiles', 'Accessoires', '🚗', 99, TRUE,
       '{"car neck pillow":12,"car headrest cushion":12,"car key case":12,"car key cover":12,"automotive key case":12,"car seat cushion":12}'::jsonb
WHERE EXISTS (SELECT 1 FROM boutique_categories WHERE key='Auto' AND is_active=TRUE)
ON CONFLICT (category_key, key) DO UPDATE
  SET object_classification_terms =
    boutique_subcategories.object_classification_terms
      || EXCLUDED.object_classification_terms;

COMMENT ON COLUMN boutique_subcategories.object_classification_terms IS
  'Indices stricts d objet pour la taxonomie commerciale, configurables en base; sans autorite de classement douanier.';
