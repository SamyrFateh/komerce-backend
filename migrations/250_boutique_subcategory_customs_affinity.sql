-- @migration 250_boutique_subcategory_customs_affinity.sql
-- @domain    catalog,customs
-- @purpose   Chaque sous-catégorie boutique active peut déclarer une catégorie douanière de proximité.
--
-- Doctrine :
-- - le produit fournisseur réel reste prioritaire dans le classifieur dynamique ;
-- - cette affinité ne sert qu'en fallback lorsque le matching lexical ne tranche pas ;
-- - aucune clé métier n'est codée en dur dans le runtime scanner ;
-- - un produit accepté au catalogue ne doit plus rester sans catégorie Komerce.

ALTER TABLE boutique_subcategories
  ADD COLUMN IF NOT EXISTS customs_category_key TEXT;

ALTER TABLE boutique_subcategories
  DROP CONSTRAINT IF EXISTS boutique_subcategories_customs_category_fk;

ALTER TABLE boutique_subcategories
  ADD CONSTRAINT boutique_subcategories_customs_category_fk
  FOREIGN KEY (customs_category_key)
  REFERENCES customs_categories(key)
  ON UPDATE CASCADE
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_boutique_subcategories_customs_category
  ON boutique_subcategories(customs_category_key)
  WHERE customs_category_key IS NOT NULL;

-- Mapping canonique v2. Ces valeurs sont des DONNÉES administrables ;
-- le scanner ne contient aucune correspondance boutique -> douane.
UPDATE boutique_subcategories
SET customs_category_key = CASE
  WHEN category_key='Mode & Beauté' AND key IN ('Femme','Homme') THEN 'vetements'
  WHEN category_key='Mode & Beauté' AND key='Enfant' THEN 'enfants'
  WHEN category_key='Mode & Beauté' AND key='Beauté' THEN 'cosmetiques'

  WHEN category_key='Maison' AND key='Confort' THEN 'electro'
  WHEN category_key='Maison' AND key='Cuisine' THEN 'materiels'
  WHEN category_key='Maison' AND key='Déco' THEN 'mariage'
  WHEN category_key='Maison' AND key='Enfants' THEN 'enfants'

  WHEN category_key='Tech' AND key='Phones' THEN 'phones'
  WHEN category_key='Tech' AND key IN ('Audio','Montres') THEN 'electro'

  WHEN category_key='Bricolage' AND key IN ('Outillage','Electricité','Sécurité') THEN 'materiels'

  WHEN category_key='Créations personnelles' AND key='Cérémonie' THEN 'ceremonie'
  WHEN category_key='Créations personnelles' AND key IN ('Cadeau','Impression') THEN 'mariage'

  WHEN category_key='Auto' AND key IN ('Filtres','Freinage','Éclairage','Moto') THEN 'materiels'
  ELSE customs_category_key
END
WHERE is_active=TRUE;

-- Fail closed pour la taxonomie boutique v2 active :
-- chaque sous-catégorie active des piliers commerciaux doit avoir une affinité.
DO $$
DECLARE missing_count integer;
BEGIN
  SELECT COUNT(*)::int
    INTO missing_count
    FROM boutique_subcategories bs
    JOIN boutique_categories bc ON bc.key=bs.category_key
   WHERE bs.is_active=TRUE
     AND bc.is_active=TRUE
     AND bc.filter_type IS NULL
     AND bc.key <> 'all'
     AND bs.customs_category_key IS NULL;

  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'BOUTIQUE_SUBCATEGORY_CUSTOMS_AFFINITY_INCOMPLETE: % active subcategories unmapped', missing_count;
  END IF;
END $$;

COMMENT ON COLUMN boutique_subcategories.customs_category_key IS
  'Catégorie douanière/Komerce de proximité utilisée uniquement en fallback lorsque les signaux produit réels ne permettent pas un mapping lexical suffisamment fiable.';
