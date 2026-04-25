-- ============================================================
-- Migration 036b: Seed customs_categories (correctif encoding)
-- Date: avril 2026
--
-- CONTEXTE: La migration 036 a passé toutes les ALTER TABLE et CREATE TABLE,
-- mais le seed INSERT a échoué sur les outils psql Windows (CP1252) à cause
-- des emojis UTF-8 dans les chaînes label.
--
-- SOLUTION: stocker les emojis uniquement dans la colonne `emoji` (et pas
-- dans `label`), puis les outils ont moins de chances de buter sur l'encoding
-- car les chaînes restent ASCII-friendly. On peut aussi utiliser \x escapes
-- mais les CHAR(15) UTF-8 sont mal gérés par certains terminaux Windows.
--
-- USAGE:
--   psql $DATABASE_URL -f migrations/036b_seed_customs_categories.sql
--
-- Si erreur similaire persiste, exécuter manuellement par bloc dans pgAdmin
-- ou DBeaver (qui gèrent l'UTF-8 nativement).
-- ============================================================

-- Force le client psql en UTF-8 même sur Windows (au cas où)
SET client_encoding = 'UTF8';

-- Insérer les 8 catégories (idempotent : ON CONFLICT DO NOTHING)
-- Les emojis sont DANS la colonne emoji, pas dans label.

INSERT INTO customs_categories (
  key, label, sub_label, emoji,
  douane_pct, tva_pct, taxe_add_pct,
  default_dim_l_cm, default_dim_w_cm, default_dim_h_cm,
  sh_code, hint, default_margin_pct, display_order
) VALUES
  ('phones',
   'Telephones et accessoires',
   'Samsung, Itel, Realme milieu de gamme',
   E'\U0001F4F1',
   10, 10, 0,
   17, 12, 11,
   'SH 8517.12',
   'Telephones 10 pourcent - SH 8517.12',
   30.00, 1),

  ('vetements',
   'Vetements, Wax et Dentelles',
   'Tissus Wax, dentelles, abayas africanisees',
   E'\U0001F457',
   20, 10, 2.5,
   25, 22, 10,
   'SH 61xx/62xx',
   'Textiles 20 pourcent + parafiscale 2.5 pourcent - SH 61xx/62xx',
   45.00, 2),

  ('ceremonie',
   'Tenues ceremonie (abayas)',
   'Tissu + confection - tailles S a XXL',
   E'\U0001F483',
   20, 10, 2.5,
   30, 25, 11,
   'SH 61xx',
   'Textiles 20 pourcent + parafiscale 2.5 pourcent - SH 61xx',
   55.00, 3),

  ('electro',
   'Electromenager compact',
   'Fer, mixeur, mini-frigo, plaque, seche-cheveux',
   E'\U0001F3E0',
   15, 10, 0,
   35, 30, 16,
   'SH 84xx/85xx',
   'Electromenager 15 pourcent - SH 84xx/85xx',
   32.00, 4),

  ('cosmetiques',
   'Cosmetiques et Parfums',
   'Soins peau, parfums importes UAE, re-marques',
   E'\U0001F484',
   20, 10, 1,
   20, 15, 11,
   'SH 33xx',
   'Cosmetiques 20 pourcent + taxe hygiene 1 pourcent - SH 33xx',
   50.00, 5),

  ('mariage',
   'Mariage et Cadeaux de fete',
   'Vaisselle, decor, bijoux fantaisie',
   E'\U0001F48D',
   15, 10, 0,
   30, 25, 12,
   'SH 63xx/71xx',
   'Mariage et Deco 15 pourcent - SH 63xx/71xx',
   55.00, 6),

  ('enfants',
   'Enfants',
   'Jouets, vetements enfants, accessoires scolaires',
   E'\U0001F9F8',
   10, 10, 0,
   25, 20, 9,
   'SH 9503',
   'Jouets 10 pourcent (SH 9503)',
   32.00, 7),

  ('materiels',
   'Petits Materiels',
   'Outillage, quincaillerie, serrures, robinetterie',
   E'\U0001F527',
   15, 10, 0,
   30, 20, 15,
   'SH 82xx/73xx',
   'SH 82xx/73xx - taux 15 pourcent douane',
   35.00, 8)

ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Optionnel : si tu veux les vrais labels avec accents et emojis
-- exécute ces UPDATE depuis pgAdmin/DBeaver (qui gèrent UTF-8) :
-- ============================================================
--
-- UPDATE customs_categories SET label = 'Téléphones & accessoires'           WHERE key = 'phones';
-- UPDATE customs_categories SET label = 'Vêtements, Wax & Dentelles'         WHERE key = 'vetements';
-- UPDATE customs_categories SET label = 'Tenues cérémonie (abayas)'          WHERE key = 'ceremonie';
-- UPDATE customs_categories SET label = 'Électroménager compact'             WHERE key = 'electro';
-- UPDATE customs_categories SET label = 'Cosmétiques & Parfums'              WHERE key = 'cosmetiques';
-- UPDATE customs_categories SET label = 'Mariage & Cadeaux de fête'          WHERE key = 'mariage';
-- UPDATE customs_categories SET sub_label = 'Tissus Wax, dentelles, abayas africanisées' WHERE key = 'vetements';
-- UPDATE customs_categories SET sub_label = 'Tissu + confection · tailles S→XXL'         WHERE key = 'ceremonie';
-- ... etc.
--
-- ============================================================
-- Vérification post-migration :
-- ============================================================
-- SELECT key, emoji, label, douane_pct, tva_pct, default_margin_pct
--   FROM customs_categories
--  ORDER BY display_order;
-- ============================================================
