-- ============================================================
-- Migration 034: Customs Shipments & Per-Parcel Allocation
-- Date: avril 2026
--
-- OBJECTIF MÉTIER:
--   Un "envoi" = une cargaison Dubai→Comores pour laquelle tu payes un
--   montant TOTAL de douane (en groupage). On stocke cet envoi global et
--   on ventile automatiquement la douane sur les colis qu'il contient,
--   selon une méthode choisie (valeur CIF, poids, volume, mixte, manuel).
--
--   Le taux EFFECTIF TERRAIN (ex: 16.2%) est calculé automatiquement et
--   remplace le taux officiel théorique dans les calculs de marge réelle.
--
--   Un envoi peut être DÉSACTIVÉ : sa ventilation est retirée des colis
--   liés, et les marges des commandes sont recalculées. Utile quand les
--   taux de douane changent et qu'il faut repartir sur une base neuve
--   sans perdre l'historique.
--
-- TABLES CRÉÉES:
--   customs_shipments           — 1 ligne par cargaison dédouanée
--   customs_shipment_parcels    — ventilation calculée (shipment × parcel)
-- ============================================================

-- ── TABLE customs_shipments ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customs_shipments (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identification
  reference             TEXT          UNIQUE NOT NULL,
  shipment_date         DATE          NOT NULL,
  transitaire_name      TEXT,
  transport_mode        TEXT          CHECK (transport_mode IN ('sea', 'air', 'land')),

  -- Valeurs déclarées (saisies par l'opérateur)
  cif_value_kmf         NUMERIC(12,2) NOT NULL,
  customs_paid_kmf      NUMERIC(12,2) NOT NULL,
  freight_kmf           NUMERIC(12,2),
  total_weight_kg       NUMERIC(10,3),
  nb_parcels            INTEGER,

  -- Méthode de ventilation
  -- 'by_cif_value'  → par % valeur CIF du colis (défaut, douane ad valorem)
  -- 'by_weight'     → par % poids (fret aérien, tarif au kg)
  -- 'by_volume'     → par % volume (fret mer, tarif au m³) — requires parcel dims
  -- 'mixed'         → pondération CIF × α + poids × β (via allocation_config)
  -- 'manual'        → saisie manuelle ligne par ligne
  allocation_method     TEXT          NOT NULL DEFAULT 'by_cif_value'
                        CHECK (allocation_method IN ('by_cif_value', 'by_weight', 'by_volume', 'mixed', 'manual')),
  allocation_config     JSONB,

  -- Taux terrain calculé automatiquement (colonne générée, toujours à jour)
  effective_rate_pct    NUMERIC(6,2)  GENERATED ALWAYS AS
                        (CASE WHEN cif_value_kmf > 0
                              THEN ROUND((customs_paid_kmf / cif_value_kmf * 100)::numeric, 2)
                              ELSE 0 END) STORED,

  -- État (activation/désactivation)
  -- is_active = FALSE → les parts douane des colis liés sont RETIRÉES et
  -- les marges des commandes recalculées. L'envoi reste en historique.
  is_active             BOOLEAN       NOT NULL DEFAULT TRUE,
  deactivated_at        TIMESTAMPTZ,
  deactivated_reason    TEXT,

  -- Métadonnées
  notes                 TEXT,
  created_by            UUID          REFERENCES users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customs_ship_date ON customs_shipments(shipment_date DESC);
CREATE INDEX IF NOT EXISTS idx_customs_ship_active ON customs_shipments(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_customs_ship_ref ON customs_shipments(reference);

-- Trigger updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customs_shipments_updated') THEN
    CREATE TRIGGER trg_customs_shipments_updated
      BEFORE UPDATE ON customs_shipments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── TABLE customs_shipment_parcels ─────────────────────────────────────────
-- Ventilation calculée : 1 ligne par (envoi × colis)

CREATE TABLE IF NOT EXISTS customs_shipment_parcels (
  shipment_id           UUID          NOT NULL REFERENCES customs_shipments(id) ON DELETE CASCADE,
  parcel_id             UUID          NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,

  -- Valeurs du colis utilisées pour la ventilation (snapshot)
  parcel_cif_kmf        NUMERIC(12,2),
  parcel_weight_kg      NUMERIC(10,3),

  -- Résultat de la ventilation
  customs_share_kmf     NUMERIC(12,2),         -- part de douane attribuée à ce colis
  allocation_basis      TEXT,                  -- snapshot: 'by_cif_value', 'by_weight', ...
  manual_override       BOOLEAN       NOT NULL DEFAULT FALSE,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  PRIMARY KEY (shipment_id, parcel_id)
);

CREATE INDEX IF NOT EXISTS idx_csp_parcel ON customs_shipment_parcels(parcel_id);
CREATE INDEX IF NOT EXISTS idx_csp_shipment ON customs_shipment_parcels(shipment_id);

-- Trigger updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_csp_updated') THEN
    CREATE TRIGGER trg_csp_updated
      BEFORE UPDATE ON customs_shipment_parcels
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── VUE customs_effective_rate ──────────────────────────────────────────────
-- Taux effectif moyen sur 30 / 90 / 365 jours, pour nourrir finance.js.
-- Seuls les envois ACTIFS (is_active=true) sont pris en compte.

CREATE OR REPLACE VIEW customs_effective_rates AS
SELECT
  'last_30d' AS period,
  COUNT(*)   AS nb_shipments,
  COALESCE(SUM(cif_value_kmf), 0)       AS total_cif_kmf,
  COALESCE(SUM(customs_paid_kmf), 0)    AS total_customs_kmf,
  CASE WHEN COALESCE(SUM(cif_value_kmf), 0) > 0
       THEN ROUND((SUM(customs_paid_kmf) / SUM(cif_value_kmf) * 100)::numeric, 2)
       ELSE 0 END                        AS rate_pct
FROM customs_shipments
WHERE is_active = TRUE AND shipment_date >= CURRENT_DATE - INTERVAL '30 days'
UNION ALL
SELECT
  'last_90d',
  COUNT(*),
  COALESCE(SUM(cif_value_kmf), 0),
  COALESCE(SUM(customs_paid_kmf), 0),
  CASE WHEN COALESCE(SUM(cif_value_kmf), 0) > 0
       THEN ROUND((SUM(customs_paid_kmf) / SUM(cif_value_kmf) * 100)::numeric, 2)
       ELSE 0 END
FROM customs_shipments
WHERE is_active = TRUE AND shipment_date >= CURRENT_DATE - INTERVAL '90 days'
UNION ALL
SELECT
  'last_365d',
  COUNT(*),
  COALESCE(SUM(cif_value_kmf), 0),
  COALESCE(SUM(customs_paid_kmf), 0),
  CASE WHEN COALESCE(SUM(cif_value_kmf), 0) > 0
       THEN ROUND((SUM(customs_paid_kmf) / SUM(cif_value_kmf) * 100)::numeric, 2)
       ELSE 0 END
FROM customs_shipments
WHERE is_active = TRUE AND shipment_date >= CURRENT_DATE - INTERVAL '365 days';

-- ============================================================
-- FIN migration 034
-- ============================================================
