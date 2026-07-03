-- @migration 098_catalog_refinery_foundation.sql
-- @domain    catalog
-- @purpose   Fondations raffinerie catalogue (K-1) : champs de cuisine source,
--            glossaire métier, exclusions douane/transport, overrides tracés.

-- ============================================================================
--  098_catalog_refinery_foundation.sql
--  Doctrine : DOCTRINE_CATALOGUE.md (§4 langue, §3 éligibilité, §5 rejouabilité)
--
--  PRINCIPE : la boutique ne lit QUE les champs publiés existants (name,
--  description, price_kmf, category, images...). Tout ce qui suit est de la
--  CUISINE — invisible du client par construction. Aucun champ boutique
--  n'est modifié ; la raffinerie remplira les champs publiés à l'étage ⑤.
--
--  APPLICATION SANS CONTRAINTE : colonnes nullables sur products, aucun
--  trigger, aucun CHECK sur les tables existantes. Les tables NEUVES portent
--  leurs propres garde-fous d'intégrité (CHECK/UNIQUE) — elles n'existaient
--  pas, rien ne peut casser.
--
--  Idempotente : IF NOT EXISTS / ON CONFLICT DO NOTHING partout.
-- ============================================================================

SET client_encoding = 'UTF8';

-- ── 1. Champs de cuisine sur products (doctrine §4 : la source ne se perd jamais)

ALTER TABLE products ADD COLUMN IF NOT EXISTS name_source text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS description_source text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS source_locale varchar(8);
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_source varchar(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS enrichment_version integer;

COMMENT ON COLUMN products.name_source IS
  'Titre ORIGINAL fournisseur (généralement EN, Dubaï). Conservé à vie : '
  'retraduction en masse + litiges fournisseur (la commande se passe en anglais). '
  'La boutique ne lit JAMAIS ce champ — elle lit name (FR).';
COMMENT ON COLUMN products.description_source IS
  'Description originale fournisseur. Même règle que name_source.';
COMMENT ON COLUMN products.source_locale IS
  'Langue de la donnée source (en, fr, ar...). NULL = inconnue (legacy).';
COMMENT ON COLUMN products.content_source IS
  'Qui a écrit les champs publiés : connector_raw | ai_enriched | manual. '
  'Backfill legacy = manual (fiches saisies à la main avant la raffinerie).';
COMMENT ON COLUMN products.enrichment_version IS
  'Version du prompt d''enrichissement ayant produit la fiche (doctrine §8 : '
  'le prompt est du code, versionné). NULL = jamais enrichie par IA.';

-- Backfill legacy : tout produit existant a été saisi manuellement.
UPDATE products SET content_source = 'manual' WHERE content_source IS NULL;

-- ── 2. Glossaire métier (doctrine §4 : la mémoire des corrections) ───────────
-- Injecté dans chaque appel d'enrichissement. Chaque retouche admin
-- récurrente devient une entrée : l'erreur ne se reproduit plus.

CREATE TABLE IF NOT EXISTS catalog_glossary (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_source text NOT NULL,             -- terme EN (ou marque à ne pas traduire)
  term_fr     text NOT NULL,             -- traduction imposée ('=' : ne pas traduire)
  note        text,                      -- contexte (ex : 'terme religieux, ne jamais adapter')
  is_active   boolean NOT NULL DEFAULT TRUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_glossary_term_key UNIQUE (term_source)
);

COMMENT ON TABLE catalog_glossary IS
  'Glossaire EN→FR injecté dans l''enrichissement IA (doctrine catalogue §4). '
  'term_fr = ''='' signifie : conserver tel quel (marques, noms propres).';

-- Amorce minimale — s'enrichit par l'usage, jamais par anticipation massive.
INSERT INTO catalog_glossary (term_source, term_fr, note) VALUES
  ('abaya',        '=',            'Vêtement — terme établi, ne pas traduire'),
  ('hijab',        '=',            'Terme établi, ne pas traduire'),
  ('oud',          'oud',          'Parfumerie — jamais « bois d''agar » en fiche client'),
  ('power bank',   'batterie externe', NULL),
  ('free size',    'taille unique', NULL)
ON CONFLICT (term_source) DO NOTHING;

-- ── 3. Exclusions : ce que Komerce peut recevoir (doctrine §3) ───────────────
-- Deux couches : absolute (douane/loi, définitif) et restricted (contrainte
-- transport, embarquement conditionné). Matching par mots-clés sur la donnée
-- SOURCE (EN), avant traduction — on ne raffine pas ce qu'on n'embarquera pas.
-- JAMAIS en dur dans le code (I-08). La liste démarre courte et honnête :
-- chaque refus douane réel l'enrichit.

CREATE TABLE IF NOT EXISTS catalog_exclusions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layer           varchar(12) NOT NULL,
  label           text NOT NULL,          -- affiché à l'admin comme excluded_reason
  keywords        text[] NOT NULL DEFAULT '{}',  -- matching insensible à la casse, donnée source
  categories      text[] NOT NULL DEFAULT '{}',  -- matching sur catégorie source/Komerce
  constraint_note text,                   -- restricted : la contrainte (ex : maritime uniquement)
  legal_note      text,                   -- base de la règle (douane, IATA, assurance...)
  is_active       boolean NOT NULL DEFAULT TRUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_exclusions_layer_check CHECK (layer IN ('absolute', 'restricted')),
  CONSTRAINT catalog_exclusions_label_key UNIQUE (label)
);

COMMENT ON TABLE catalog_exclusions IS
  'Éligibilité « ce que Komerce peut recevoir » (doctrine catalogue §3). '
  'absolute = jamais, définitif. restricted = embarquement contraint '
  '(constraint_note). Étage ③ de la raffinerie, avant traduction.';

INSERT INTO catalog_exclusions (layer, label, keywords, categories, constraint_note, legal_note) VALUES
  -- Couche 1 : interdits absolus
  ('absolute',   'Armes et imitations',
     ARRAY['weapon','gun','pistol','rifle','knife','taser','airsoft','bb gun'],
     ARRAY[]::text[], NULL, 'Douane Comores — prohibition'),
  ('absolute',   'Munitions et explosifs',
     ARRAY['ammunition','ammo','explosive','firework','fireworks'],
     ARRAY[]::text[], NULL, 'Douane Comores — prohibition'),
  ('absolute',   'Stupéfiants et accessoires',
     ARRAY['cannabis','cbd','vape juice','narcotic','drug paraphernalia'],
     ARRAY[]::text[], NULL, 'Loi comorienne'),
  ('absolute',   'Contrefaçons manifestes',
     ARRAY['replica','copy of','aaa quality','mirror quality','1:1 quality'],
     ARRAY[]::text[], NULL, 'Douane + risque saisie totale du conteneur'),
  -- Couche 2 : restreints conditionnels
  ('restricted', 'Batteries lithium seules',
     ARRAY['power bank','lithium battery','battery pack','18650'],
     ARRAY[]::text[],
     'Maritime uniquement — jamais dans le rail aérien',
     'IATA DGR — batteries lithium hors équipement'),
  ('restricted', 'Aérosols et liquides pressurisés',
     ARRAY['aerosol','spray can','butane','compressed'],
     ARRAY[]::text[],
     'Maritime uniquement, quantités limitées par colis',
     'IATA DGR / IMDG'),
  ('restricted', 'Parfums et liquides inflammables',
     ARRAY['perfume','eau de parfum','cologne','nail polish'],
     ARRAY[]::text[],
     'Maritime uniquement — volume limité par colis',
     'IATA DGR classe 3'),
  ('restricted', 'Périssables',
     ARRAY['fresh food','frozen','perishable'],
     ARRAY[]::text[],
     'Exclu tant qu''aucune chaîne du froid — réévaluer si module épicerie',
     'Contrainte opérationnelle Komerce')
ON CONFLICT (label) DO NOTHING;

-- ── 4. Overrides tracés champ par champ (doctrine §5 : rejouabilité) ─────────
-- La fiche n'est jamais la source : le pipeline l'est. Une retouche manuelle
-- se pose ICI, et se réapplique après chaque re-raffinage. Le CRUD admin
-- devient l'éditeur de cette table, pas de la fiche.

CREATE TABLE IF NOT EXISTS catalog_field_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field_name  varchar(50) NOT NULL,      -- champ publié concerné (name, description, emoji...)
  field_value text NOT NULL,             -- la valeur imposée
  reason      text,                      -- pourquoi (mémoire du solo-dev dans 6 mois)
  set_by      uuid,                      -- admin auteur
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_field_overrides_key UNIQUE (product_id, field_name)
);

COMMENT ON TABLE catalog_field_overrides IS
  'Retouches manuelles par champ, réappliquées après chaque re-raffinage '
  '(doctrine catalogue §5). Dernier override par champ gagne (UNIQUE). '
  'L''édition directe de la fiche générée est interdite par doctrine.';

CREATE INDEX IF NOT EXISTS idx_catalog_overrides_product
  ON catalog_field_overrides(product_id);

-- ── 5. Clés business_rules (doctrine §9) ─────────────────────────────────────

INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES
  ('catalog', 'CATALOG_ENRICH_CONFIDENCE_MIN', '{"value": 0.8}', 'number',
   'Confiance minimale enrichissement IA',
   'Sous ce score : fiche marquée needs_review au lieu de suivre le flux. CONFIANCE BASSE : à calibrer sur les 50 premières fiches.',
   0, 1),
  ('catalog', 'CATALOG_AUTOPUBLISH_PRICE_DELTA_PCT', '{"value": 10}', 'number',
   'Delta prix max auto-publiable (%)',
   'Mise à jour d''une fiche déjà approuvée : au-delà de cette variation de prix, review humaine obligatoire (doctrine §6).',
   0, 100),
  ('catalog', 'CATALOG_MAX_VALUE_KMF', '{"value": 500000}', 'number',
   'Plafond valeur unitaire catalogue (KMF)',
   'Couche restreints : au-delà, review systématique (assurance, risque). CONFIANCE BASSE : à calibrer avec la réponse assurance transitaire.',
   0, 10000000)
ON CONFLICT (key) DO NOTHING;

-- ── Vérification post-migration (lecture seule) ──────────────────────────────
-- SELECT count(*) FROM catalog_exclusions WHERE is_active;            -- attendu : 8
-- SELECT count(*) FROM catalog_glossary WHERE is_active;              -- attendu : 5
-- SELECT count(*) FROM products WHERE content_source IS NULL;         -- attendu : 0
-- SELECT key FROM business_rules WHERE category = 'catalog';          -- 3 clés + cap existant

DO $$
BEGIN
  RAISE NOTICE 'Migration 098 OK : fondations raffinerie catalogue (cuisine invisible boutique, 0 contrainte sur l''existant)';
END $$;
