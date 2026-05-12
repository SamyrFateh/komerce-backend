-- ═══════════════════════════════════════════════════════════════
-- KOMERCE — Migration catégories v2 (architecture comorienne)
-- Source de vérité : _FALLBACK_CATEGORIES dans shop-schema.js
--
-- À exécuter sur Railway via :
--   psql $DATABASE_URL -f migrate-categories-v2.sql
-- ou depuis le dashboard Railway → Query
--
-- SÉCURITÉ :
--   - Les produits existants sont préservés (on ne touche pas à boutique_products)
--   - Les db_keys garantissent la rétrocompat (ex: produits taggés 'Solaire'
--     continuent d'apparaître sous Maison via db_keys)
--   - Opération idempotente : ON CONFLICT DO UPDATE (safe à ré-exécuter)
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. CATÉGORIES PRINCIPALES ────────────────────────────────────────────────
-- On upsert par `key` (identifiant stable, jamais modifié côté code).
-- Les catégories disparues (Enfant & Famille, Solaire en pilier) sont
-- désactivées via show_in_rail = false plutôt que supprimées,
-- pour préserver l'historique produits.

-- Désactiver les anciens piliers qui n'existent plus en v2
UPDATE boutique_categories
SET show_in_rail = false, show_in_sections = false
WHERE key IN ('Enfant', 'Enfant & Famille', 'Solaire', 'Sport', 'Sur-mesure', 'Créations');

-- Upsert des 8 entrées v2
INSERT INTO boutique_categories
  (key, label, short_label, section_emoji, db_keys, filter_type, display_order, show_in_rail, show_in_sections)
VALUES
  -- Filtre transverse : Tout
  ('all',                    'Tout',                  'Tout',    '🔥', '{}',                              NULL,    0, true,  false),

  -- Filtre transverse : Soldes
  ('Soldes',                 'Soldes',                'Soldes',  '🏷️', '{}',                              'promo', 1, true,  true),

  -- Pilier 1 : Mode & Beauté
  ('Mode & Beauté',          'Mode & Beauté',         'Mode',    '👗', '{"Mode","Beauté","Sport","Enfant"}', NULL,  2, true,  true),

  -- Pilier 2 : Maison
  ('Maison',                 'Maison',                'Maison',  '🏠', '{"Maison","Solaire","Énergie","Jouets"}', NULL, 3, true, true),

  -- Pilier 3 : Tech
  ('Tech',                   'Tech',                  'Tech',    '📱', '{"Tech","Phones","Téléphonie"}',   NULL,    4, true,  true),

  -- Pilier 4 : Bricolage (nouveau)
  ('Bricolage',              'Bricolage',             'Bricol.', '🔧', '{"Bricolage","Quincaillerie"}',    NULL,    5, true,  true),

  -- Pilier 5 : Créations personnelles
  ('Créations personnelles', 'Personnalisé',          'Perso.',  '✨', '{"Sur-mesure","Créations","Personnalisé"}', NULL, 6, true, true),

  -- Pilier 6 : Auto (nouveau)
  ('Auto',                   'Auto & Moto',           'Auto',    '🔩', '{"Auto","Moto","Pièces"}',         NULL,    7, true,  true)

ON CONFLICT (key) DO UPDATE SET
  label            = EXCLUDED.label,
  short_label      = EXCLUDED.short_label,
  section_emoji    = EXCLUDED.section_emoji,
  db_keys          = EXCLUDED.db_keys,
  filter_type      = EXCLUDED.filter_type,
  display_order    = EXCLUDED.display_order,
  show_in_rail     = EXCLUDED.show_in_rail,
  show_in_sections = EXCLUDED.show_in_sections;


-- ── 2. SOUS-CATÉGORIES ────────────────────────────────────────────────────────
-- Supprimer les anciennes sous-catégories des piliers remplacés.
-- On supprime uniquement celles liées aux catégories qui changent de structure.

DELETE FROM boutique_subcategories
WHERE category_key IN (
  'Mode & Beauté', 'Maison', 'Tech',
  'Bricolage', 'Créations personnelles', 'Auto'
);

-- Insérer les sous-catégories v2

-- Mode & Beauté
INSERT INTO boutique_subcategories (category_key, key, label, short_label, icon, display_order) VALUES
  ('Mode & Beauté', 'Femme',  'Femme',              'Femme',  '👗', 1),
  ('Mode & Beauté', 'Homme',  'Homme',              'Homme',  '👔', 2),
  ('Mode & Beauté', 'Enfant', 'Enfant & Bébé',      'Enfant', '🍼', 3),
  ('Mode & Beauté', 'Beauté', 'Beauté & Bien-être', 'Beauté', '💄', 4);

-- Maison
INSERT INTO boutique_subcategories (category_key, key, label, short_label, icon, display_order) VALUES
  ('Maison', 'Confort',  'Confort & Énergie',  'Confort',  '🔋', 1),
  ('Maison', 'Cuisine',  'Cuisine',            'Cuisine',  '🍳', 2),
  ('Maison', 'Déco',     'Déco & Rangement',   'Déco',     '🖼️', 3),
  ('Maison', 'Enfants',  'Enfants & Scolaire', 'Enfants',  '🧸', 4);

-- Tech
INSERT INTO boutique_subcategories (category_key, key, label, short_label, icon, display_order) VALUES
  ('Tech', 'Phones',  'Téléphones',          'Tél.',   '📱', 1),
  ('Tech', 'Audio',   'Audio & Accessoires', 'Audio',  '🎧', 2),
  ('Tech', 'Montres', 'Montres & Gadgets',   'Montres','⌚', 3);

-- Bricolage
INSERT INTO boutique_subcategories (category_key, key, label, short_label, icon, display_order) VALUES
  ('Bricolage', 'Outillage',   'Outils & Fixation',       'Outils', '🔧', 1),
  ('Bricolage', 'Electricité', 'Électricité & Plomberie', 'Élec.',  '⚡', 2),
  ('Bricolage', 'Sécurité',    'Serrures & Sécurité',     'Sécu.',  '🔐', 3);

-- Créations personnelles
INSERT INTO boutique_subcategories (category_key, key, label, short_label, icon, display_order) VALUES
  ('Créations personnelles', 'Cérémonie',  'Tenues de cérémonie',  'Cérémo.', '👑', 1),
  ('Créations personnelles', 'Cadeau',     'Cadeaux personnalisés', 'Cadeau',  '🎁', 2),
  ('Créations personnelles', 'Impression', 'Impression & Design',  'Imprim.', '🖨️', 3);

-- Auto
INSERT INTO boutique_subcategories (category_key, key, label, short_label, icon, display_order) VALUES
  ('Auto', 'Filtres',   'Filtres & Entretien',    'Filtres', '🔧', 1),
  ('Auto', 'Freinage',  'Freinage & Sécurité',    'Frein.',  '🛑', 2),
  ('Auto', 'Éclairage', 'Éclairage & Électrique', 'Éclai.', '💡', 3),
  ('Auto', 'Moto',      'Moto',                   'Moto',    '🏍️', 4);


-- ── 3. VÉRIFICATION ──────────────────────────────────────────────────────────
-- À décommenter pour contrôle avant COMMIT :
-- SELECT key, label, display_order, show_in_rail FROM boutique_categories ORDER BY display_order;
-- SELECT category_key, key, label FROM boutique_subcategories ORDER BY category_key, display_order;

COMMIT;
