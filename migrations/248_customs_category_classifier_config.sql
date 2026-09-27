-- @migration 248_customs_category_classifier_config.sql
-- @domain    customs
-- @purpose   Rendre la classification fournisseur dynamique depuis customs_categories
--
-- La Raffinerie ne doit connaître aucune clé de catégorie en dur.
-- classification_terms est la configuration pondérée utilisée pour rapprocher
-- un texte fournisseur d'une customs_categories active.
-- default_weight_kg remplace les poids par catégorie codés dans le scanner.

ALTER TABLE customs_categories
  ADD COLUMN IF NOT EXISTS classification_terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS default_weight_kg NUMERIC(8,3);

ALTER TABLE customs_categories
  DROP CONSTRAINT IF EXISTS customs_categories_classification_terms_object;

ALTER TABLE customs_categories
  ADD CONSTRAINT customs_categories_classification_terms_object
  CHECK (jsonb_typeof(classification_terms) = 'object');

ALTER TABLE customs_categories
  DROP CONSTRAINT IF EXISTS customs_categories_default_weight_positive;

ALTER TABLE customs_categories
  ADD CONSTRAINT customs_categories_default_weight_positive
  CHECK (default_weight_kg IS NULL OR default_weight_kg > 0);

-- Configuration initiale des catégories existantes. Ces termes sont des DONNÉES
-- administrables ; le runtime ne contient aucune liste de clés/termes métier.
UPDATE customs_categories
SET classification_terms = CASE key
  WHEN 'phones' THEN '{"phone":6,"smartphone":8,"mobile phone":8,"phone stand":7,"charging cable":5,"phone camera":7}'::jsonb
  WHEN 'vetements' THEN '{"dress":7,"blouse":7,"shirt":7,"polo":7,"pants":7,"trousers":7,"clothing":6,"clothes":6,"apparel":6,"jacket":6,"sneaker":6,"sneakers":6,"shoe":5,"shoes":5,"sandals":6,"robe":7,"chemise":7,"pantalon":7}'::jsonb
  WHEN 'ceremonie' THEN '{"evening dress":10,"formal suit":10,"wedding dress":12,"abaya":10,"ceremony":8,"ceremonie":8}'::jsonb
  WHEN 'electro' THEN '{"headphone":8,"headphones":8,"earphone":8,"earphones":8,"earbud":8,"earbuds":8,"headset":8,"speaker":7,"electronic":5,"electronics":5,"smartwatch":7,"smart watch":7,"lamp":4,"hair dryer":8}'::jsonb
  WHEN 'cosmetiques' THEN '{"cosmetic":8,"cosmetics":8,"beauty":6,"parfum":8,"perfume":8,"makeup":8,"skin care":9,"skincare":9,"facial cleansing":10,"cleansing brush":9,"nail":8,"uv nail lamp":11}'::jsonb
  WHEN 'mariage' THEN '{"gift":6,"wedding":7,"home decor":6,"decor":5,"decoration":5,"jewelry":7,"bijou":7,"vaisselle":6}'::jsonb
  WHEN 'enfants' THEN '{"kid":10,"kids":10,"child":10,"children":10,"baby":10,"toy":8,"toys":8,"school":8,"school bag":9,"backpack":5}'::jsonb
  WHEN 'materiels' THEN '{"tool":8,"tools":8,"power tool":10,"hand tool":10,"hardware":8,"wrench":9,"screwdriver":9,"padlock":9,"door lock":9,"brake":8,"air filter":8,"oil filter":8,"motorcycle":7,"kitchen utensil":8,"kitchenware":8}'::jsonb
  ELSE classification_terms
END
WHERE classification_terms = '{}'::jsonb;

UPDATE customs_categories
SET default_weight_kg = CASE key
  WHEN 'phones' THEN 0.300
  WHEN 'vetements' THEN 0.400
  WHEN 'ceremonie' THEN 0.500
  WHEN 'electro' THEN 1.000
  WHEN 'cosmetiques' THEN 0.200
  WHEN 'mariage' THEN 0.600
  WHEN 'enfants' THEN 0.500
  WHEN 'materiels' THEN 1.000
  ELSE default_weight_kg
END
WHERE default_weight_kg IS NULL;

COMMENT ON COLUMN customs_categories.classification_terms IS
  'Termes/phrases de classification fournisseur et poids associés. Configuration runtime dynamique ; aucune clé de catégorie ne doit être codée dans le classifieur.';

COMMENT ON COLUMN customs_categories.default_weight_kg IS
  'Poids logistique par défaut de la catégorie lorsque le fournisseur ne fournit pas de poids fiable.';
