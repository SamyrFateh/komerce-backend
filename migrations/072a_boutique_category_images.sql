-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 072a: Boutique category images DB-driven
-- Objectif : permettre la mise à jour des images de catégories en production
-- sans modification du JS frontend.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE boutique_categories
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_alt TEXT;

UPDATE boutique_categories
   SET image_url = '/boutique/categories/all.jpg',
       image_alt = 'Tous les produits'
 WHERE key = 'all'
   AND image_url IS NULL;

UPDATE boutique_categories
   SET image_url = '/boutique/categories/soldes.jpg',
       image_alt = 'Promotions et soldes'
 WHERE key = 'Soldes'
   AND image_url IS NULL;

UPDATE boutique_categories
   SET image_url = '/boutique/categories/mode.jpg',
       image_alt = 'Mode et beauté'
 WHERE key = 'Mode & Beauté'
   AND image_url IS NULL;

UPDATE boutique_categories
   SET image_url = '/boutique/categories/tech.jpg',
       image_alt = 'Téléphones, accessoires et tech'
 WHERE key = 'Tech'
   AND image_url IS NULL;

UPDATE boutique_categories
   SET image_url = '/boutique/categories/enfant.jpg',
       image_alt = 'Univers enfant'
 WHERE key = 'Enfant'
   AND image_url IS NULL;

UPDATE boutique_categories
   SET image_url = '/boutique/categories/maison.jpg',
       image_alt = 'Maison et décoration'
 WHERE key = 'Maison'
   AND image_url IS NULL;

UPDATE boutique_categories
   SET image_url = '/boutique/categories/sport.jpg',
       image_alt = 'Sport et loisirs'
 WHERE key = 'Sport'
   AND image_url IS NULL;

UPDATE boutique_categories
   SET image_url = '/boutique/categories/sur-mesure.jpg',
       image_alt = 'Produits sur mesure'
 WHERE key = 'Sur-mesure'
   AND image_url IS NULL;

-- FIN migration 072
