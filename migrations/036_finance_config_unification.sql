-- ============================================================
-- Migration 036: Unification source de vérité (Étape 0 audit)
-- Date: avril 2026
--
-- OBJECTIF MÉTIER:
--   Centraliser TOUS les paramètres financiers/business dans `finance_config`
--   et créer la table `customs_categories` pour sortir les 8 catégories du JS.
--
--   Avant cette migration, on avait 5 sources parallèles pour des paramètres
--   identiques (taux EUR/KMF, marge cible, coût hub...) qui divergeaient
--   silencieusement. Cette migration consolide.
--
-- POLITIQUE :
--   - finance_config = SEULE source de vérité pour le runtime
--   - exchange_rates = devient pure historique (audit)
--   - economic_variables = legacy en lecture seule (gardé pour redistribute)
--   - business_rules = règles fonctionnelles (max qty, durées, anti-fraude)
-- ============================================================

-- ── Enrichissement finance_config (singleton) ───────────────────────────────
-- Ajout des colonnes manquantes pour rassembler tous les paramètres business

-- Taux de change (sortis de exchange_rates)
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS taux_aed_kmf NUMERIC(10,2) NOT NULL DEFAULT 138.00;

-- Pricing : fret et frais paiement
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS fret_eur_per_m3 INT NOT NULL DEFAULT 180;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS frais_stripe_pct NUMERIC(5,2) NOT NULL DEFAULT 2.5;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS frais_stripe_fixed_kmf INT NOT NULL DEFAULT 150;

-- Coûts opérationnels supplémentaires
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS commission_relais_standard_kmf INT NOT NULL DEFAULT 500;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS commission_relais_showroom_kmf INT NOT NULL DEFAULT 750;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS transitaire_pct NUMERIC(5,2) NOT NULL DEFAULT 2.0;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS transitaire_fixed_kmf INT NOT NULL DEFAULT 450;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS portuaires_kmf INT NOT NULL DEFAULT 1200;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS commission_agent_pct NUMERIC(5,2) NOT NULL DEFAULT 5.0;

-- Hub
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS hub_monthly_cost_aed INT NOT NULL DEFAULT 7000;

-- Seuils Vue Santé (étaient en dur dans le JS)
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS sante_seuil_cash_retard_pct NUMERIC(5,2) NOT NULL DEFAULT 15.00;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS sante_seuil_pipeline_block_pct NUMERIC(5,2) NOT NULL DEFAULT 15.00;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS sante_seuil_vip_kmf INT NOT NULL DEFAULT 200000;
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS sante_seuil_atrisk_ltv_kmf INT NOT NULL DEFAULT 500000;

-- ⭐ NOUVEAU : aligner la cible marge brute sur la décision business (40%)
-- Avant : DEFAULT 30%. Après audit, on passe à 40%.
-- On ne modifie pas la valeur EXISTANTE en base (au cas où elle a été ajustée
-- manuellement). Mais on change le DEFAULT pour les futurs INSERT.
ALTER TABLE finance_config ALTER COLUMN target_marge_brute_pct SET DEFAULT 40.00;

-- Mise à jour de la valeur actuelle UNIQUEMENT si elle est encore au défaut historique 30%
UPDATE finance_config
   SET target_marge_brute_pct = 40.00
 WHERE id = 1
   AND target_marge_brute_pct = 30.00;

-- Synchroniser taux EUR/KMF avec la dernière valeur de exchange_rates si dispo
-- (au cas où finance_config aurait une valeur obsolète)
UPDATE finance_config fc
   SET taux_change_eur_kmf = (
     SELECT eur_kmf FROM exchange_rates
      WHERE eur_kmf IS NOT NULL
      ORDER BY valid_from DESC LIMIT 1
   )
 WHERE fc.id = 1
   AND EXISTS (SELECT 1 FROM exchange_rates WHERE eur_kmf IS NOT NULL);

UPDATE finance_config fc
   SET taux_aed_kmf = (
     SELECT aed_kmf FROM exchange_rates
      WHERE aed_kmf IS NOT NULL
      ORDER BY valid_from DESC LIMIT 1
   )
 WHERE fc.id = 1
   AND EXISTS (SELECT 1 FROM exchange_rates WHERE aed_kmf IS NOT NULL);

-- ── Nouvelle table customs_categories ──────────────────────────────────────
-- Sortir les 8 catégories en dur du JS pour permettre l'édition sans déploiement.
CREATE TABLE IF NOT EXISTS customs_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,           -- 'phones', 'vetements', etc. (utilisé dans products.category)
  label TEXT NOT NULL,                -- "📱 Téléphones & accessoires"
  sub_label TEXT,                     -- "Samsung, Itel, Realme milieu de gamme"
  emoji TEXT,
  douane_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  tva_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
  taxe_add_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  default_dim_l_cm INT,
  default_dim_w_cm INT,
  default_dim_h_cm INT,
  sh_code TEXT,                       -- Code douanier (SH 8517.12 etc.)
  hint TEXT,                          -- Note d'aide affichée dans le pricing
  default_margin_pct NUMERIC(5,2),    -- Cible marge spécifique (NULL = utiliser globale)
  display_order INT DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customs_categories_key ON customs_categories(key) WHERE is_active = TRUE;

-- Trigger updated_at (réutilise la fonction set_updated_at déjà définie)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customs_categories_updated') THEN
    CREATE TRIGGER trg_customs_categories_updated
      BEFORE UPDATE ON customs_categories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── Seed des 8 catégories actuelles (idempotent — ON CONFLICT DO NOTHING) ──
-- Reprise des valeurs telles qu'elles étaient en dur dans ct-views-pricing.js
INSERT INTO customs_categories (key, label, sub_label, emoji, douane_pct, tva_pct, taxe_add_pct,
                                default_dim_l_cm, default_dim_w_cm, default_dim_h_cm,
                                sh_code, hint, default_margin_pct, display_order)
VALUES
  ('phones', 'Téléphones & accessoires', 'Samsung, Itel, Realme milieu de gamme', '📱',
    10, 10, 0, 17, 12, 11, 'SH 8517.12',
    'Téléphones 10% — SH 8517.12', 30.00, 1),

  ('vetements', 'Vêtements, Wax & Dentelles', 'Tissus Wax, dentelles, abayas africanisées', '👗',
    20, 10, 2.5, 25, 22, 10, 'SH 61xx/62xx',
    'Textiles 20% + parafiscale 2,5% — SH 61xx/62xx', 45.00, 2),

  ('ceremonie', 'Tenues cérémonie (abayas)', 'Tissu + confection · tailles S→XXL', '💃',
    20, 10, 2.5, 30, 25, 11, 'SH 61xx',
    'Textiles 20% + parafiscale 2,5% — SH 61xx', 55.00, 3),

  ('electro', 'Électroménager compact', 'Fer, mixeur, mini-frigo, plaque, sèche-cheveux', '🏠',
    15, 10, 0, 35, 30, 16, 'SH 84xx/85xx',
    'Électroménager 15% — SH 84xx/85xx', 32.00, 4),

  ('cosmetiques', 'Cosmétiques & Parfums', 'Soins peau, parfums importés UAE, re-marqués', '💄',
    20, 10, 1, 20, 15, 11, 'SH 33xx',
    'Cosmétiques 20% + taxe hygiène 1% — SH 33xx', 50.00, 5),

  ('mariage', 'Mariage & Cadeaux de fête', 'Vaisselle, décor, bijoux fantaisie', '💍',
    15, 10, 0, 30, 25, 12, 'SH 63xx/71xx',
    'Mariage/Déco 15% — SH 63xx/71xx', 55.00, 6),

  ('enfants', 'Enfants', 'Jouets, vêtements enfants, accessoires scolaires', '🧸',
    10, 10, 0, 25, 20, 9, 'SH 9503',
    'Jouets 10% (SH 9503)', 32.00, 7),

  ('materiels', 'Petits Matériels', 'Outillage, quincaillerie, serrures, robinetterie', '🔧',
    15, 10, 0, 30, 20, 15, 'SH 82xx/73xx',
    'SH 82xx/73xx — taux 15% douane', 35.00, 8)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- FIN migration 036
-- ============================================================
