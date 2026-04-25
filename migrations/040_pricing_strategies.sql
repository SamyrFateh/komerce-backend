-- ============================================================
-- Migration 040 : Strategie de prix (Phase 3)
-- Date : avril 2026
-- Version ASCII pure pour psql Windows
--
-- OBJECTIF :
--   Permettre l'arbitrage du prix de vente avec :
--   - prix concurrents (saisie manuelle)
--   - strategie choisie par produit ou categorie
--   - historique des arbitrages (audit)
--
-- TABLES CREEES :
--   - competitor_prices : prix observes chez les concurrents
--   - pricing_strategies : strategie active par produit (override) ou categorie
--   - pricing_strategy_history : audit des changements de strategie
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- 1. competitor_prices : prix observes
-- ============================================================
-- Plusieurs prix possibles par produit/categorie, saisis manuellement
-- pour informer la strategie. Plus tard : scraper, marketplace API.
CREATE TABLE IF NOT EXISTS competitor_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,    -- nullable : prix par categorie
  category        TEXT,                                                 -- si pas de product_id, par categorie
  competitor_name TEXT NOT NULL,                                        -- ex : 'Coliexpress', 'KomerceConcurrent'
  price_kmf       INTEGER NOT NULL,
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          TEXT DEFAULT 'manual',                                -- manual | scrape | api
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,                        -- soft delete
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Au moins l'un des deux doit etre renseigne
  CONSTRAINT competitor_target_check CHECK (product_id IS NOT NULL OR category IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_competitor_prices_product ON competitor_prices(product_id, observed_at DESC) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_competitor_prices_category ON competitor_prices(category, observed_at DESC) WHERE is_active = TRUE AND category IS NOT NULL;

-- ============================================================
-- 2. pricing_strategies : strategie active par produit ou categorie
-- ============================================================
-- Une seule strategie active a la fois pour un produit ou une categorie.
-- product_id NULL = strategie par defaut de la categorie
CREATE TABLE IF NOT EXISTS pricing_strategies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,
  category        TEXT,                                                 -- categorie produit ('phones', etc.)
  strategy_type   TEXT NOT NULL,                                        -- mechanical | competitor_aligned | premium | loss_leader | manual
  strategy_value  NUMERIC,                                              -- offset utilise (ex : +10 pour premium 10%, -10 pour loss leader, prix manuel en KMF)
  applied_price_kmf INTEGER,                                            -- prix calcule au moment de l'application (snapshot)
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  applied_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT strategy_target_check CHECK (product_id IS NOT NULL OR category IS NOT NULL),
  CONSTRAINT strategy_type_valid CHECK (strategy_type IN ('mechanical', 'competitor_aligned', 'premium', 'loss_leader', 'manual'))
);

-- Index pour retrouver rapidement la strategie active d'un produit ou d'une categorie
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_strategies_product_active
  ON pricing_strategies(product_id) WHERE product_id IS NOT NULL AND is_active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_strategies_category_active
  ON pricing_strategies(category) WHERE product_id IS NULL AND category IS NOT NULL AND is_active = TRUE;

-- ============================================================
-- 3. pricing_strategy_history : audit (chaque application)
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing_strategy_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,
  category        TEXT,
  old_strategy_type TEXT,
  new_strategy_type TEXT NOT NULL,
  strategy_value  NUMERIC,
  old_price_kmf   INTEGER,
  new_price_kmf   INTEGER NOT NULL,
  reason          TEXT,
  applied_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_history_product ON pricing_strategy_history(product_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_history_category ON pricing_strategy_history(category, applied_at DESC);

-- ============================================================
-- VERIFICATIONS
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 040 OK : 3 tables creees (competitor_prices, pricing_strategies, pricing_strategy_history)';
END $$;
