-- ============================================================
-- Migration 037b: Pricing Components + Risk Provisions
-- Date: avril 2026
-- Version ASCII pure (sans emoji dans commentaires) pour psql Windows CP1252
--
-- OBJECTIF METIER:
--   Rendre le module Pricing pleinement extensible avec 2 nouvelles tables.
--
--   1. pricing_components : variables de cout par commande (Niveau 1)
--   2. risk_provisions    : provisions risques en pourcentage (Niveau 3)
--
--   Politique CRUD :
--     - Toggle is_active sur chaque ligne
--     - Soft delete par defaut, hard delete via ?force=true
--     - is_editable / is_deletable pour proteger les composants systeme
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- 1. Table pricing_components (Niveau 1 - variables par commande)
-- ============================================================

CREATE TABLE IF NOT EXISTS pricing_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT,
  category TEXT NOT NULL,
  default_value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'all',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_editable BOOLEAN NOT NULL DEFAULT TRUE,
  is_deletable BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 100,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_components_active
  ON pricing_components(is_active, category, display_order);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pricing_components_updated') THEN
    CREATE TRIGGER trg_pricing_components_updated
      BEFORE UPDATE ON pricing_components
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. Table risk_provisions (Niveau 3 - provisions pourcentage)
-- ============================================================

CREATE TABLE IF NOT EXISTS risk_provisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT,
  rate_pct NUMERIC NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'all',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_editable BOOLEAN NOT NULL DEFAULT TRUE,
  is_deletable BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 100,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_provisions_active
  ON risk_provisions(is_active, display_order);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_risk_provisions_updated') THEN
    CREATE TRIGGER trg_risk_provisions_updated
      BEFORE UPDATE ON risk_provisions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 3. Enrichir charges (Niveau 2) - emoji + display_order + flags
-- ============================================================

ALTER TABLE charges ADD COLUMN IF NOT EXISTS emoji TEXT;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 100;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS is_editable BOOLEAN DEFAULT TRUE;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS is_deletable BOOLEAN DEFAULT TRUE;

-- ============================================================
-- 4. Seed pricing_components (composants systeme)
-- ============================================================

INSERT INTO pricing_components (
  key, label, emoji, category, default_value, unit, applies_to,
  is_active, is_editable, is_deletable, display_order, notes
) VALUES
  -- Sourcing
  ('agent_fee_pct', 'Commission agent achat', E'\U0001F91D', 'sourcing',
    5.0, 'pct', 'all', TRUE, TRUE, FALSE, 10,
    'Commission de l agent qui achete pour nous a Dubai'),
  ('embarquement_aed', 'Embarquement Deira', E'\U0001F4E6', 'sourcing',
    3.0, 'aed', 'all', TRUE, TRUE, FALSE, 20,
    'Frais d embarquement physique au Deira City Centre'),
  ('transport_deira_hub_kmf', 'Transport Deira a Hub', E'\U0001F69A', 'sourcing',
    500, 'kmf', 'all', TRUE, TRUE, FALSE, 30,
    'Trajet Deira City Centre vers le hub Komerce a Dubai'),

  -- Transit
  ('fret_maritime_eur_m3', 'Fret maritime', E'\U0001F6A2', 'transit',
    180, 'kmf_per_m3', 'all', TRUE, TRUE, FALSE, 10,
    'Cout du fret maritime Dubai vers Comores en EUR par metre cube'),
  ('couverture_assurance_pct', 'Couverture assurance', E'\U0001F6E1', 'transit',
    0.5, 'pct', 'all', FALSE, TRUE, FALSE, 20,
    'Assurance optionnelle - desactivee par defaut'),

  -- Douane
  ('transitaire_pct', 'Commission transitaire', E'\U0001F4DD', 'douane',
    2.0, 'pct', 'all', TRUE, TRUE, FALSE, 10,
    'Commission du transitaire pour le dedouanement (pourcentage sur valeur CIF)'),
  ('transitaire_fixed_kmf', 'Frais fixes transitaire', E'\U0001F4DD', 'douane',
    450, 'kmf', 'all', TRUE, TRUE, FALSE, 20,
    'Frais fixes par envoi du transitaire'),
  ('frais_portuaires_kmf', 'Frais portuaires', E'\U0001F3D7', 'douane',
    1200, 'kmf', 'all', TRUE, TRUE, FALSE, 30,
    'Frais de manutention et stockage portuaires'),

  -- Hub
  ('hub_controle_kmf', 'Controle qualite hub', E'\U00002705', 'hub',
    200, 'kmf', 'all', TRUE, TRUE, FALSE, 10,
    'Cout par commande pour controle qualite au hub'),
  ('hub_etiquette_kmf', 'Etiquetage hub', E'\U0001F3F7', 'hub',
    50, 'kmf', 'all', TRUE, TRUE, FALSE, 20,
    'Cout par commande pour etiquetage au hub'),
  ('hub_sms_kmf', 'SMS notification', E'\U0001F4F1', 'hub',
    100, 'kmf', 'all', TRUE, TRUE, FALSE, 30,
    'Cout SMS de notification client'),

  -- Distribution
  ('transport_relais_kmf', 'Transport hub a relais', E'\U0001F4E6', 'distribution',
    840, 'kmf', 'all', TRUE, TRUE, FALSE, 10,
    'Transport du colis du hub Comores vers le relais final'),
  ('commission_relais_kmf', 'Commission relais', E'\U0001F4B0', 'distribution',
    500, 'kmf', 'all', TRUE, TRUE, FALSE, 20,
    'Commission versee au relais pour la remise au client'),

  -- Paiement
  ('stripe_pct', 'Frais Stripe', E'\U0001F4B3', 'paiement',
    2.5, 'pct', 'channel:diaspora', TRUE, TRUE, FALSE, 10,
    'Frais Stripe en pourcentage sur les paiements diaspora'),
  ('stripe_fixed_kmf', 'Frais Stripe fixes', E'\U0001F4B3', 'paiement',
    150, 'kmf', 'channel:diaspora', TRUE, TRUE, FALSE, 20,
    'Frais Stripe fixes par transaction')

ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. Seed risk_provisions (5 provisions starter)
-- ============================================================

INSERT INTO risk_provisions (
  key, label, emoji, rate_pct, applies_to,
  is_active, is_editable, is_deletable, display_order, notes
) VALUES
  ('returns', 'Retours produits defectueux', E'\U000021A9', 1.5, 'all',
    TRUE, TRUE, FALSE, 10,
    'Provision pour retours de produits defectueux ou non conformes'),

  ('unpaid_cash', 'Impayes cash relais', E'\U0001F4B5', 3.0, 'channel:cash_relais',
    TRUE, TRUE, FALSE, 20,
    'Provision pour commandes payees en cash au relais mais non encaissees'),

  ('damage_transit', 'Casse en transit', E'\U0001F4E6', 0.8, 'all',
    TRUE, TRUE, FALSE, 30,
    'Provision pour casse pendant le transport maritime ou terrestre'),

  ('damage_storage', 'Casse stockage hub', E'\U0001F3E2', 0.3, 'all',
    FALSE, TRUE, FALSE, 40,
    'Provision pour casse pendant le stockage au hub - desactivee par defaut'),

  ('compensation', 'Compensations qualite', E'\U0001F381', 0.5, 'all',
    TRUE, TRUE, FALSE, 50,
    'Provision pour gestes commerciaux compensant problemes ou retards')

ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- FIN migration 037b
-- ============================================================
-- Verification post-migration :
-- SELECT category, COUNT(*) AS nb, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) AS actifs
--   FROM pricing_components GROUP BY category ORDER BY category;
-- SELECT key, label, rate_pct, is_active FROM risk_provisions ORDER BY display_order;
-- ============================================================
