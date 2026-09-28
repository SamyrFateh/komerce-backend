-- KOMERCE — Canonical subcategory imagery
-- One stable, versioned visual per canonical subcategory.
-- Assets are committed under public/boutique/categories/subcutouts and are
-- independent from supplier/product ingestion.

BEGIN;

ALTER TABLE boutique_subcategories
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS image_alt text;

WITH canonical(category_key, subcategory_key, image_url, image_alt) AS (
  VALUES
    ('Mode & Beauté','Femme','/boutique/categories/subcutouts/sub-mode-femme-v1.webp','Mode femme'),
    ('Mode & Beauté','Homme','/boutique/categories/subcutouts/sub-mode-homme-v1.webp','Mode homme'),
    ('Mode & Beauté','Enfant','/boutique/categories/subcutouts/sub-mode-enfant-v1.webp','Mode enfant et bébé'),
    ('Mode & Beauté','Beauté','/boutique/categories/subcutouts/sub-mode-beaute-v1.webp','Beauté et bien-être'),
    ('Maison','Confort','/boutique/categories/subcutouts/sub-maison-confort-v1.webp','Confort et énergie'),
    ('Maison','Cuisine','/boutique/categories/subcutouts/sub-maison-cuisine-v1.webp','Cuisine'),
    ('Maison','Déco','/boutique/categories/subcutouts/sub-maison-deco-v1.webp','Décoration et rangement'),
    ('Maison','Enfants','/boutique/categories/subcutouts/sub-maison-enfants-v1.webp','Enfants et scolaire'),
    ('Tech','Phones','/boutique/categories/subcutouts/sub-tech-phones-v1.webp','Téléphones'),
    ('Tech','Ordi','/boutique/categories/subcutouts/sub-tech-ordi-v1.webp','Ordinateurs'),
    ('Tech','Audio','/boutique/categories/subcutouts/sub-tech-audio-v1.webp','Audio et accessoires'),
    ('Tech','Montres','/boutique/categories/subcutouts/sub-tech-montres-v1.webp','Montres et gadgets'),
    ('Tech','Gaming','/boutique/categories/subcutouts/sub-tech-gaming-v1.webp','Gaming'),
    ('Bricolage','Outillage','/boutique/categories/subcutouts/sub-brico-outillage-v1.webp','Outils et fixation'),
    ('Bricolage','Electricité','/boutique/categories/subcutouts/sub-brico-electricite-v1.webp','Électricité et plomberie'),
    ('Bricolage','Sécurité','/boutique/categories/subcutouts/sub-brico-securite-v1.webp','Serrures et sécurité'),
    ('Créations personnelles','Cérémonie','/boutique/categories/subcutouts/sub-perso-ceremonie-v1.webp','Tenues de cérémonie'),
    ('Créations personnelles','Cadeau','/boutique/categories/subcutouts/sub-perso-cadeau-v1.webp','Cadeaux personnalisés'),
    ('Créations personnelles','Impression','/boutique/categories/subcutouts/sub-perso-impression-v1.webp','Impression et design'),
    ('Auto','Filtres','/boutique/categories/subcutouts/sub-auto-filtres-v1.webp','Filtres et entretien'),
    ('Auto','Freinage','/boutique/categories/subcutouts/sub-auto-freinage-v1.webp','Freinage et sécurité'),
    ('Auto','Éclairage','/boutique/categories/subcutouts/sub-auto-eclairage-v1.webp','Éclairage et électrique'),
    ('Auto','Moto','/boutique/categories/subcutouts/sub-auto-moto-v1.webp','Moto')
)
UPDATE boutique_subcategories bs
SET image_url = canonical.image_url,
    image_alt = canonical.image_alt
FROM canonical
WHERE bs.category_key = canonical.category_key
  AND bs.key = canonical.subcategory_key;

COMMIT;
