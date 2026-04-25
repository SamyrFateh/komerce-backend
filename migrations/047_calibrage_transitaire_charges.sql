-- ============================================================
-- Migration 047 : Calibrage transitaire et charges fixes
-- Date : avril 2026
-- 
-- DOCTRINE : Le moteur doit avoir des valeurs initiales coherentes
-- meme si elles sont marquees low confidence. C'est mieux que des
-- defaults arbitraires qui restent silencieux.
-- 
-- Choix faits par le designer en l'absence d'infos precises :
--   - transitaire : forfait par shipment (plus realiste qu'un %)
--                   80 000 KMF par container LCL
--   - charges fixes mensuelles : 1 200 000 KMF/mois (estimation
--     startup phase pre-launch : loyer 200k + salaire 800k +
--     SaaS 100k + divers 100k)
-- 
-- Tous marques confidence='low' et calibrated_at=NULL pour qu'on
-- sache que ces valeurs doivent etre revues quand les vraies
-- factures arriveront.
-- ============================================================

SET client_encoding = 'UTF8';

-- ════════════════════════════════════════════════════════════
-- 1. TRANSITAIRE : passer du % a un forfait kmf_per_shipment
-- ════════════════════════════════════════════════════════════
-- Logique doctrine : le transitaire facture par shipment, pas
-- par % de la valeur cargaison. Donc kmf_per_shipment cohere
-- avec l'imputation Phase 3a (divisee par 200 articles moyens).
-- 
-- Avant : transitaire_pct = 3% du CIF (default, medium)
-- Apres : transitaire_kmf = 80 000 KMF par shipment (default, low)

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

-- Renommer le composant pour refleter le changement d'unite
UPDATE cost_components
   SET key = 'transitaire_kmf',
       label = 'Honoraires transitaire (forfait shipment)',
       description = 'Forfait fixe par shipment LCL. Couvre dossier douane, ' ||
                    'manutention port, formalites administratives. Divise par ' ||
                    'avg_articles_per_shipment pour imputation a l''article.'
 WHERE key = 'transitaire_pct';

-- ════════════════════════════════════════════════════════════
-- 2. CHARGES FIXES MENSUELLES : insertion dans la table charges
-- ════════════════════════════════════════════════════════════
-- Ces charges ne vont PAS dans cost_components (qui sont des couts
-- variables). Elles vont dans la table `charges` dediee, qui est
-- ensuite agreggee par computeFixedCostAllocation() dans le moteur.
-- 
-- On insere 4 lignes mensuelles (loyer, salaire, SaaS, divers).
-- ON CONFLICT pour idempotence.

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

-- Doit retourner : transitaire_kmf, kmf_per_shipment, 80000, 'low'
SELECT key, unit, default_value, confidence_level
  FROM cost_components
 WHERE key IN ('transitaire_kmf', 'transitaire_pct');

-- Doit retourner : 4 lignes overhead avec total = 1 200 000 KMF
SELECT family, COUNT(*)::int AS nb_lignes, SUM(amount_kmf)::int AS total_kmf
  FROM charges
 WHERE is_active = TRUE
   AND recurrence_period = 'monthly'
 GROUP BY family;

DO $$
BEGIN
  RAISE NOTICE 'Migration 047 OK : transitaire calibre + charges fixes inserees';
  RAISE NOTICE '  transitaire = 80 000 KMF / shipment (low confidence)';
  RAISE NOTICE '  charges fixes mensuelles = 1 200 000 KMF (low confidence)';
  RAISE NOTICE '  Imputees a l''article via avg_orders_per_month et avg_articles_per_order';
END $$;
