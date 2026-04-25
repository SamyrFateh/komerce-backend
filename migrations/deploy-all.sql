-- ============================================================
-- KOMERCE — DÉPLOIEMENT BDD CONSOLIDÉ FINAL (avril 2026)
-- ============================================================
-- Ce fichier combine les migrations 045 + 046 + 047.
-- Idempotent : peut être exécuté plusieurs fois sans dommage.
--
-- À copier-coller dans Railway → Database → Query → Run
-- OU à appliquer via : psql $DATABASE_URL -f deploy-all.sql
-- ============================================================

SET client_encoding = 'UTF8';

-- ════════════════════════════════════════════════════════════
-- MIGRATION 045 — Moyennes d'allocation des couts
-- ════════════════════════════════════════════════════════════

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS avg_articles_per_order NUMERIC(6,2) NOT NULL DEFAULT 2.5;

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS avg_articles_per_parcel NUMERIC(6,2) NOT NULL DEFAULT 4.0;

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS avg_articles_per_shipment NUMERIC(8,2) NOT NULL DEFAULT 200.0;

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS avg_orders_per_month NUMERIC(8,2) NOT NULL DEFAULT 50.0;

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS allocation_confidence TEXT NOT NULL DEFAULT 'low'
  CHECK (allocation_confidence IN ('low','medium','high'));

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS allocation_calibrated_at TIMESTAMPTZ;

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS allocation_notes TEXT;

-- ════════════════════════════════════════════════════════════
-- MIGRATION 046 — Audit du levier de scenario
-- ════════════════════════════════════════════════════════════

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS scenario_id TEXT;

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS scenario_label TEXT;

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS levier TEXT;

CREATE INDEX IF NOT EXISTS idx_price_history_scenario
  ON price_history(scenario_id) WHERE scenario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_price_history_levier
  ON price_history(levier) WHERE levier IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- MIGRATION 047 — Calibrage transitaire et charges fixes
-- ════════════════════════════════════════════════════════════

-- 1. Transitaire : passer du % a un forfait kmf_per_shipment
UPDATE cost_components
   SET unit = 'kmf_per_shipment',
       default_value = 80000,
       confidence_level = 'low',
       data_source = 'default',
       last_calibration_at = NULL,
       calibration_notes = 'Estimation initiale en l''absence de facture. ' ||
                          'A recalibrer des reception du premier shipment reel. ' ||
                          'Fourchette estimee : 50 000 a 120 000 KMF par shipment.',
       updated_at = NOW()
 WHERE key = 'transitaire_pct';

UPDATE cost_components
   SET key = 'transitaire_kmf',
       label = 'Honoraires transitaire (forfait shipment)',
       description = 'Forfait fixe par shipment LCL. Couvre dossier douane, ' ||
                    'manutention port, formalites administratives. Divise par ' ||
                    'avg_articles_per_shipment pour imputation a l''article.'
 WHERE key = 'transitaire_pct';

-- 2. Charges fixes mensuelles
INSERT INTO charges (family, name, amount_kmf, is_recurring, recurrence_period, is_active, notes)
VALUES
  ('overhead', 'Loyer bureaux + hub Moroni',     200000, TRUE, 'monthly', TRUE,
   'Estimation initiale low confidence. A recalibrer avec factures reelles.'),
  ('overhead', 'Salaires equipe (founder + 1)',  800000, TRUE, 'monthly', TRUE,
   'Estimation phase pre-launch. Inclut founder remuneration + 1 employe.'),
  ('overhead', 'Outils SaaS (Stripe, Railway, etc.)', 100000, TRUE, 'monthly', TRUE,
   'Stripe processing + Railway hosting + outils annexes.'),
  ('overhead', 'Charges diverses (banque, comm.)', 100000, TRUE, 'monthly', TRUE,
   'Frais bancaires + communication + imprevus mensuels.')
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════
-- VERIFICATIONS
-- ════════════════════════════════════════════════════════════

SELECT
  avg_articles_per_order, avg_articles_per_parcel,
  avg_articles_per_shipment, avg_orders_per_month, allocation_confidence
FROM finance_config WHERE id = 1;

SELECT key, unit, default_value, confidence_level
  FROM cost_components
 WHERE key IN ('transitaire_kmf', 'transitaire_pct');

SELECT family, COUNT(*)::int AS nb_lignes, SUM(amount_kmf)::int AS total_kmf
  FROM charges
 WHERE is_active = TRUE AND recurrence_period = 'monthly'
 GROUP BY family;

-- ════════════════════════════════════════════════════════════
-- FIN DÉPLOIEMENT BDD
-- ════════════════════════════════════════════════════════════
