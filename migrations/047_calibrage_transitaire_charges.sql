-- ============================================================
-- Migration 047 : Calibrage transitaire et charges fixes
-- Date : avril 2026 (corrigee)
-- 
-- VERSION CORRIGEE : noms de colonnes alignes sur 043_cost_components.sql
--   - confidence (pas confidence_level)
--   - source     (pas data_source)
--   - notes      (pas calibration_notes)
--   - pas de last_calibration_at
-- ============================================================

SET client_encoding = 'UTF8';

-- ════════════════════════════════════════════════════════════
-- 1. TRANSITAIRE : passer du % a un forfait kmf_per_shipment
-- ════════════════════════════════════════════════════════════

UPDATE cost_components
   SET unit = 'kmf_per_shipment',
       default_value = 80000,
       confidence = 'low',
       source = 'default',
       notes = 'Estimation initiale en l''absence de facture. ' ||
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

-- ════════════════════════════════════════════════════════════
-- 2. CHARGES FIXES MENSUELLES
-- ════════════════════════════════════════════════════════════

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

SELECT key, unit, default_value, confidence
  FROM cost_components
 WHERE key IN ('transitaire_kmf', 'transitaire_pct');

SELECT family, COUNT(*)::int AS nb_lignes, SUM(amount_kmf)::int AS total_kmf
  FROM charges
 WHERE is_active = TRUE AND recurrence_period = 'monthly'
 GROUP BY family;

DO $$
BEGIN
  RAISE NOTICE 'Migration 047 OK : transitaire calibre + charges fixes inserees';
END $$;
