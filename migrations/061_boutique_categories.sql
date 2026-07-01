-- @migration 061_boutique_categories.sql
-- @domain    catalog
-- @purpose   Tables boutique_categories et boutique_subcategories
-- @added-header 2026-07-01 (audit gouvernance)

-- ─────────────────────────────────────────────────────────────────────────────
-- LOT 10 — Catégories boutique comme source de vérité unique
--
-- Crée boutique_categories et boutique_subcategories.
-- Les helpers JS (shop-schema.js) fetchent GET /api/categories au boot.
-- L'admin peut gérer les catégories via /api/admin/boutique-categories.
--
-- Design:
--   boutique_categories.db_keys TEXT[]  → valeurs de products.category qui
--     correspondent à ce groupe d'affichage.
--     Ex: key='Mode & Beauté' → db_keys=['Mode','Beauté']
--   boutique_categories.filter_type TEXT → NULL=normal, 'promo'=Soldes
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Table boutique_categories ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boutique_categories (
  key            TEXT PRIMARY KEY,
  label          TEXT        NOT NULL,
  short_label    TEXT,
  section_emoji  TEXT        NOT NULL DEFAULT '📦',
  icon_svg       TEXT,
  db_keys        TEXT[]      NOT NULL DEFAULT '{}',
  filter_type    TEXT        DEFAULT NULL,   -- NULL | 'promo'
  display_order  INT         NOT NULL DEFAULT 99,
  show_in_rail   BOOLEAN     NOT NULL DEFAULT TRUE,
  show_in_sections BOOLEAN   NOT NULL DEFAULT TRUE,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Table boutique_subcategories ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boutique_subcategories (
  id             SERIAL      PRIMARY KEY,
  category_key   TEXT        NOT NULL REFERENCES boutique_categories(key) ON DELETE CASCADE,
  key            TEXT        NOT NULL,
  label          TEXT        NOT NULL,
  short_label    TEXT,
  icon           TEXT        NOT NULL DEFAULT '✨',
  display_order  INT         NOT NULL DEFAULT 99,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  UNIQUE (category_key, key)
);

-- ── Seed boutique_categories ──────────────────────────────────────────────────
INSERT INTO boutique_categories
  (key, label, short_label, section_emoji, icon_svg, db_keys, filter_type, display_order, show_in_rail, show_in_sections)
VALUES
  (
    'all', 'Tout', 'Tout', '🔥', NULL,
    '{}', NULL, 0, TRUE, FALSE
  ),
  (
    'Soldes', 'Soldes', 'Soldes', '🏷️',
    '<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    '{}', 'promo', 1, TRUE, TRUE
  ),
  (
    'Mode & Beauté', 'Mode & Beauté', 'Mode', '👗',
    '<svg viewBox="0 0 24 24"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>',
    ARRAY['Mode', 'Beauté'], NULL, 2, TRUE, TRUE
  ),
  (
    'Tech', 'Tech', 'Tech', '📱',
    '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
    ARRAY['Tech'], NULL, 3, TRUE, TRUE
  ),
  (
    'Enfant', 'Enfant', 'Enfant', '🧒',
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="5"/><path d="M12 12v10M7 22h10"/></svg>',
    ARRAY['Enfant'], NULL, 4, TRUE, TRUE
  ),
  (
    'Maison', 'Maison', 'Maison', '🏠',
    '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    ARRAY['Maison'], NULL, 5, TRUE, TRUE
  ),
  (
    'Sport', 'Sport', 'Sport', '⚽',
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M6.5 6.5 17.5 17.5M4 12h.01M20 12h.01M12 4v.01M12 20v.01"/></svg>',
    ARRAY['Sport'], NULL, 6, TRUE, TRUE
  ),
  (
    'Sur-mesure', 'Sur-mesure', 'Pour vous...', '✨',
    '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
    ARRAY['Sur-mesure'], NULL, 7, TRUE, TRUE
  )
ON CONFLICT (key) DO NOTHING;

-- ── Seed boutique_subcategories ───────────────────────────────────────────────
INSERT INTO boutique_subcategories
  (category_key, key, label, short_label, icon, display_order)
VALUES
  -- Mode & Beauté — Mode
  ('Mode & Beauté', 'Femme',      'Femme',      'Femme',    '👗',  1),
  ('Mode & Beauté', 'Homme',      'Homme',      'Homme',    '👔',  2),
  ('Mode & Beauté', 'Hijab',      'Hijab',      'Hijab',    '🧕',  3),
  ('Mode & Beauté', 'Boubou',     'Boubou',     'Boubou',   '👘',  4),
  ('Mode & Beauté', 'Shoes',      'Shoes',      'Shoes',    '👟',  5),
  -- Mode & Beauté — Beauté
  ('Mode & Beauté', 'Parfums',    'Parfum',     'Parfum',   '🌸',  6),
  ('Mode & Beauté', 'Soins',      'Soin',       'Soin',     '🧴',  7),
  ('Mode & Beauté', 'Cheveux',    'Cheveux',    'Cheveux',  '💇',  8),
  ('Mode & Beauté', 'Maquillage', 'Maquil.',    'Maquil.',  '💄',  9),
  ('Mode & Beauté', 'Ongles',     'Ongles',     'Ongles',   '💅', 10),
  -- Tech
  ('Tech', 'Phones',   'Tél.',      'Tél.',      '📱', 1),
  ('Tech', 'Ordi',     'Ordi',      'Ordi',      '💻', 2),
  ('Tech', 'Audio',    'Audio',     'Audio',     '🎧', 3),
  ('Tech', 'Montres',  'Montres',   'Montres',   '⌚', 4),
  ('Tech', 'Gaming',   'Gaming',    'Gaming',    '🎮', 5),
  -- Enfant
  ('Enfant', 'Bébé',    'Bébé',    'Bébé',    '🍼', 1),
  ('Enfant', 'Garçon',  'Garçon',  'Garçon',  '👦', 2),
  ('Enfant', 'Fille',   'Fille',   'Fille',   '👧', 3),
  ('Enfant', 'Jouets',  'Jouets',  'Jouets',  '🧸', 4),
  ('Enfant', 'École',   'École',   'École',   '📚', 5),
  -- Maison
  ('Maison', 'Cuisine',   'Cuisine',  'Cuisine',  '🍳', 1),
  ('Maison', 'Salon',     'Salon',    'Salon',    '🛋', 2),
  ('Maison', 'Chambre',   'Chambre',  'Chambre',  '🛏', 3),
  ('Maison', 'Déco',      'Déco',     'Déco',     '🖼', 4),
  ('Maison', 'Rangement', 'Rangem.',  'Rangem.',  '📦', 5),
  -- Sport
  ('Sport', 'Foot',     'Foot',     'Foot',     '⚽', 1),
  ('Sport', 'Fitness',  'Fitness',  'Fitness',  '💪', 2),
  ('Sport', 'Natation', 'Natation', 'Natation', '🏊', 3),
  ('Sport', 'Yoga',     'Yoga',     'Yoga',     '🧘', 4),
  ('Sport', 'Outdoor',  'Outdoor',  'Outdoor',  '🏕', 5),
  -- Sur-mesure
  ('Sur-mesure', 'Couture',  'Couture',  'Couture',  '🧵', 1),
  ('Sur-mesure', 'Design',   'Design',   'Design',   '✏️',  2),
  ('Sur-mesure', 'Mesure',   'Mesure',   'Mesure',   '📏', 3),
  ('Sur-mesure', 'Broderie', 'Broderie', 'Broderie', '🪡', 4),
  ('Sur-mesure', 'Premium',  'Premium',  'Premium',  '⭐', 5)
ON CONFLICT (category_key, key) DO NOTHING;
