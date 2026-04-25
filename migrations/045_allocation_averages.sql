-- ============================================================
-- Migration 045 : Moyennes d'allocation des couts agreges
-- Date : avril 2026
--
-- DOCTRINE : Komerce engage des couts a 4 niveaux :
--   1. Par shipment (1 conteneur LCL Dubai-Moroni)
--   2. Par colis    (un sac/carton qui sort du hub)
--   3. Par commande (1 client = 1 commande Komerce)
--   4. Par article  (1 produit dans la commande)
--
-- Pour pricer un produit, on doit IMPUTER chaque cout au bon
-- niveau et le diviser par le nombre moyen d'articles a ce
-- niveau-la. Ces moyennes sont stockees ici.
--
-- Au demarrage : valeurs hypotheses (low confidence). Elles
-- seront recalibrees automatiquement quand on aura du volume
-- reel via le job analytics ou la vue economic_snapshots.
-- ============================================================

SET client_encoding = 'UTF8';

-- Moyennes d'allocation pour la division des couts agreges
ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS avg_articles_per_order NUMERIC(6,2) NOT NULL DEFAULT 2.5;

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS avg_articles_per_parcel NUMERIC(6,2) NOT NULL DEFAULT 4.0;

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS avg_articles_per_shipment NUMERIC(8,2) NOT NULL DEFAULT 200.0;

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS avg_orders_per_month NUMERIC(8,2) NOT NULL DEFAULT 50.0;

-- Confidence sur ces moyennes (low/medium/high)
ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS allocation_confidence TEXT NOT NULL DEFAULT 'low'
  CHECK (allocation_confidence IN ('low','medium','high'));

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS allocation_calibrated_at TIMESTAMPTZ;

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS allocation_notes TEXT;

-- Documentation inline
COMMENT ON COLUMN finance_config.avg_articles_per_order IS
  'Nombre moyen d''articles par commande client. Sert a diviser les couts kmf_per_order pour les imputer a l''article.';
COMMENT ON COLUMN finance_config.avg_articles_per_parcel IS
  'Nombre moyen d''articles par colis sortant du hub. Sert a diviser les couts kmf_per_parcel.';
COMMENT ON COLUMN finance_config.avg_articles_per_shipment IS
  'Nombre moyen d''articles dans un shipment LCL Dubai-Moroni. Sert a diviser les couts kmf_per_shipment.';
COMMENT ON COLUMN finance_config.avg_orders_per_month IS
  'Volume mensuel cible de commandes. Sert a diluer les charges_fixes_mensuelles_kmf.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 045 OK : moyennes d''allocation ajoutees';
  RAISE NOTICE '  Hypotheses initiales (low confidence) :';
  RAISE NOTICE '  - avg_articles_per_order    = 2.5';
  RAISE NOTICE '  - avg_articles_per_parcel   = 4.0';
  RAISE NOTICE '  - avg_articles_per_shipment = 200.0';
  RAISE NOTICE '  - avg_orders_per_month      = 50.0';
END $$;
