-- ============================================================
-- Migration 041 : Scanner Catalogue Fournisseur (LOT D)
-- Date : avril 2026
-- Version ASCII pure pour psql Windows
--
-- OBJECTIF :
--   Permettre l'ingestion d'un catalogue fournisseur brut
--   (CSV ou saisie manuelle), sa normalisation Komerce,
--   son scan via pricing-engine, et la transformation en
--   produit boutique APRES validation admin.
--
--   Pipeline :
--     CSV/manuel  ->  supplier_catalog_imports  (1 ligne par import)
--                ->  sourcing_candidates        (1 ligne par produit candidat)
--                ->  scan via pricing-engine    (calcule prix + decision)
--                ->  decision admin             (importer / watchlist / rejeter)
--                ->  products                   (uniquement apres validation)
--
-- TABLES CREEES :
--   - supplier_catalog_imports   : un import = un fichier ou batch saisi
--   - sourcing_candidates        : un candidat sourcing par article fournisseur
--   - sourcing_candidate_events  : audit (changements d'etat, scans, corrections)
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- 1. supplier_catalog_imports
-- ============================================================
-- Un import groupe N candidats. Permet de tracer la source.
CREATE TABLE IF NOT EXISTS supplier_catalog_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name   TEXT NOT NULL,                  -- 'Noon', 'Dragon Mart shop X', 'Manual'
  source_type     TEXT NOT NULL DEFAULT 'manual'  -- 'csv' | 'manual' | 'api' (futur)
                  CHECK (source_type IN ('csv', 'manual', 'api')),
  source_filename TEXT,                            -- nom du fichier CSV si source='csv'
  notes           TEXT,
  total_items     INTEGER NOT NULL DEFAULT 0,     -- nb candidats produits par cet import
  imported_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sci_supplier ON supplier_catalog_imports(supplier_name, imported_at DESC);

-- ============================================================
-- 2. sourcing_candidates
-- ============================================================
-- Un candidat sourcing : produit fournisseur en cours d'evaluation.
-- N'EST PAS un produit boutique. Devient produit uniquement apres
-- import explicite par admin (state -> 'imported_to_catalog').
CREATE TABLE IF NOT EXISTS sourcing_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lien import / fournisseur
  import_id       UUID REFERENCES supplier_catalog_imports(id) ON DELETE SET NULL,
  supplier_name   TEXT NOT NULL,
  supplier_product_id TEXT,                       -- ref interne fournisseur

  -- Champs bruts (depuis CSV / saisie)
  product_name    TEXT NOT NULL,
  supplier_category TEXT,                         -- categorie selon le fournisseur
  purchase_price  NUMERIC(12,2),
  currency        TEXT DEFAULT 'AED',             -- 'AED' | 'EUR' | 'USD' | 'KMF'
  image_url       TEXT,
  product_url     TEXT,
  description     TEXT,
  stock_available INTEGER,
  min_order_qty   INTEGER,
  supplier_delay_days INTEGER,
  weight_kg       NUMERIC(8,3),                   -- poids fourni si dispo
  dim_l_cm        NUMERIC(6,1),
  dim_w_cm        NUMERIC(6,1),
  dim_h_cm        NUMERIC(6,1),

  -- Champs normalises Komerce
  komerce_category TEXT,                          -- mappee sur customs_categories.key
  estimated_weight_kg NUMERIC(8,3),               -- estime si pas fourni
  estimated_volume_m3 NUMERIC(8,5),
  purchase_price_kmf  INTEGER,                    -- converti en KMF (snapshot)
  target_margin_pct   NUMERIC(5,2),               -- marge cible appliquee

  -- Sources des donnees (doctrine §6 : indiquer la source)
  -- JSONB : { weight: 'supplier'|'estimated'|'category'|'manual'|'missing', ... }
  data_sources    JSONB DEFAULT '{}'::jsonb,

  -- Resultat du scan (snapshot du dernier scan via pricing-engine)
  -- Stocke pour eviter re-scan a chaque affichage liste.
  scan_result     JSONB,                          -- objet recommend complet
  scan_at         TIMESTAMPTZ,
  confidence      TEXT DEFAULT 'low'              -- low | medium | high
                  CHECK (confidence IN ('low', 'medium', 'high')),

  -- Etat du candidat (pipeline)
  state           TEXT NOT NULL DEFAULT 'raw_imported'
                  CHECK (state IN (
                    'raw_imported',       -- vient juste d'arriver (CSV/manuel)
                    'normalized',         -- normalise (cat Komerce, KMF, poids estime)
                    'scanned',             -- scanne via pricing-engine
                    'test_ready',          -- pret a etre teste en boutique
                    'watchlist',           -- a surveiller, pas encore decide
                    'imported_to_catalog', -- import comme produit Komerce
                    'rejected',            -- rejete par admin
                    'archived'             -- mis de cote (vieux, plus pertinent)
                  )),

  -- Lien produit Komerce (si imported_to_catalog)
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,

  -- Notes admin
  notes           TEXT,
  rejected_reason TEXT,

  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sc_state ON sourcing_candidates(state);
CREATE INDEX IF NOT EXISTS idx_sc_supplier ON sourcing_candidates(supplier_name);
CREATE INDEX IF NOT EXISTS idx_sc_import ON sourcing_candidates(import_id);
CREATE INDEX IF NOT EXISTS idx_sc_decision ON sourcing_candidates((scan_result->>'sourcing_decision')) WHERE scan_result IS NOT NULL;

-- Trigger updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sc_updated') THEN
    CREATE OR REPLACE FUNCTION sc_set_updated() RETURNS TRIGGER AS $body$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $body$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_sc_updated BEFORE UPDATE ON sourcing_candidates
      FOR EACH ROW EXECUTE FUNCTION sc_set_updated();
  END IF;
END $$;

-- ============================================================
-- 3. sourcing_candidate_events
-- ============================================================
-- Audit : changements d'etat, scans, corrections de donnees.
CREATE TABLE IF NOT EXISTS sourcing_candidate_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID NOT NULL REFERENCES sourcing_candidates(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL                    -- 'scan' | 'state_change' | 'data_correction' | 'note_added' | 'imported' | 'rejected'
                  CHECK (event_type IN ('scan', 'state_change', 'data_correction', 'note_added', 'imported', 'rejected')),
  old_state       TEXT,
  new_state       TEXT,
  changes         JSONB,                            -- diff des champs modifies
  result          JSONB,                            -- pour 'scan' : snapshot du scan
  notes           TEXT,
  triggered_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sce_candidate ON sourcing_candidate_events(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sce_type ON sourcing_candidate_events(event_type);

-- ============================================================
-- VERIFICATIONS
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 041 OK : 3 tables creees (supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events)';
END $$;
