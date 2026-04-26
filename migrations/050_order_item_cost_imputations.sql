-- ============================================================
-- Migration 050 : Snapshot economique par order_item
-- Date : avril 2026
-- Version ASCII pure
--
-- DOCTRINE :
--   Au moment de la creation d'une commande, on FIGE le coût
--   estimé tel que pricing-engine.recommend() le calcule.
--   Cette photographie est immuable : elle ne sera jamais
--   recalculee, jamais ecrasee, meme si les prix produits ou
--   la finance_config changent par la suite.
--
--   Pourquoi : sinon analyser une commande passee dans 6 mois
--   donnerait une estimation faussee par les changements de
--   taux/prix/charges intervenus depuis.
--
-- LIEN AVEC P4 :
--   order_item_cost_imputations  = verite estimee figee
--   order_item_real_cost_allocations = verite reelle reventilee
--
-- IDEMPOTENT.
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- Table principale
-- ============================================================
CREATE TABLE IF NOT EXISTS order_item_cost_imputations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lien commande / article
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id         UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id            UUID REFERENCES products(id) ON DELETE SET NULL,

  -- Snapshot vente
  quantity              INTEGER NOT NULL,
  sale_unit_price_kmf   NUMERIC(12,2) NOT NULL,
  sale_total_kmf        NUMERIC(12,2) NOT NULL,

  -- Coûts estimes (issus de pricing-engine.recommend)
  estimated_landed_relay_cost_kmf      NUMERIC(12,2),
  estimated_business_complete_cost_kmf NUMERIC(12,2),
  estimated_margin_kmf                 NUMERIC(12,2),
  estimated_margin_pct                 NUMERIC(6,2),

  -- Details immuables (JSONB)
  cost_breakdown         JSONB,         -- structure { landed_relay: {...}, business: {...} }
  allocations            JSONB,         -- tableau des allocations engagees / divisees / imputees
  allocation_averages    JSONB,         -- moyennes utilisees pour la division
  allocation_confidence  TEXT,          -- 'low' | 'medium' | 'high'
  data_quality           JSONB,         -- { confidence, missing_fields, sources }

  -- Source de l'estimation
  pricing_source         TEXT NOT NULL DEFAULT 'pricing-engine',
                                        -- 'pricing-engine' | 'manual' | 'fallback' | 'collective'

  -- Timestamps
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Contrainte d'unicite : 1 imputation par order_item
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_item_cost_imputations_order_item_id_unique'
  ) THEN
    ALTER TABLE order_item_cost_imputations
      ADD CONSTRAINT order_item_cost_imputations_order_item_id_unique
      UNIQUE (order_item_id);
  END IF;
END $$;

-- ============================================================
-- Index
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_oici_order      ON order_item_cost_imputations(order_id);
CREATE INDEX IF NOT EXISTS idx_oici_product    ON order_item_cost_imputations(product_id);
CREATE INDEX IF NOT EXISTS idx_oici_created_at ON order_item_cost_imputations(created_at);

-- ============================================================
-- FIN MIGRATION 050
-- ============================================================
