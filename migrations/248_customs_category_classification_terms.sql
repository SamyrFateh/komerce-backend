-- @migration 248_customs_category_classification_terms.sql
-- @domain    customs
-- @purpose   Rendre la classification fournisseur dynamique et pilotée par customs_categories.
--
-- La logique applicative ne contient plus de liste de catégories métier.
-- Chaque catégorie douanière active expose ses propres termes de classification.
-- Ajouter/renommer/désactiver une catégorie ou modifier ses termes ne nécessite
-- aucun déploiement du scanner.

ALTER TABLE customs_categories
  ADD COLUMN IF NOT EXISTS classification_terms TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN customs_categories.classification_terms IS
  'Termes/expressions de reconnaissance fournisseur utilisés par la Raffinerie. Donnée métier administrable, jamais règle JS codée en dur.';

UPDATE customs_categories
SET classification_terms = CASE key
  WHEN 'phones' THEN ARRAY['phone','mobile phone','smartphone','telephone']
  WHEN 'vetements' THEN ARRAY['clothing','cloth','dress','shirt','blouse','polo','pants','trousers','cargo pants','fashion','textile','fabric','shoe','shoes','sneaker','sneakers','sandals','bag','crossbody bag','women','woman','men','man','femme','homme']
  WHEN 'ceremonie' THEN ARRAY['evening dress','formal suit','ceremony','ceremonie','abaya','wedding dress']
  WHEN 'electro' THEN ARRAY['electronics','electronic','headphone','headphones','earphone','earphones','earbud','earbuds','headset','tws','speaker','smartwatch','watch','appliance']
  WHEN 'cosmetiques' THEN ARRAY['cosmetic','cosmetics','beauty','beaute','perfume','parfum','makeup','maquillage','skin care','skincare','facial','nail','nails']
  WHEN 'mariage' THEN ARRAY['wedding','gift','cadeau','home decor','deco','jewelry','bijou','vaisselle']
  WHEN 'enfants' THEN ARRAY['kids','kid','children','child','baby','toy','toys','school bag','school supplies','enfant']
  WHEN 'materiels' THEN ARRAY['power tool','hand tool','tool','tools','hardware','padlock','door lock','brake','filter','motorcycle','headlight','kitchenware','utensil','outillage','quincaillerie']
  ELSE classification_terms
END
WHERE cardinality(classification_terms) = 0;
