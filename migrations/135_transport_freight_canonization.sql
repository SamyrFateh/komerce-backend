-- @migration 135_transport_freight_canonization.sql
-- @domain    economic-engine, logistics
-- @purpose   LOT 1B-1 — freight DEDICATED au moteur transport-rails
--
-- Correction de vérité (ADR-013) :
--   - le coût SEA quitte finance_config comme vérité runtime et devient une
--     POLICY rail explicite : SEA_EUR_PER_M3_COST ;
--   - aucune valeur n'est inventée : la valeur initiale est copiée depuis
--     finance_config.fret_eur_per_m3 ;
--   - les lignes cost_components.category='freight' restent conservées pour
--     forensics, mais sont désactivées et ne peuvent plus être réactivées ;
--   - le vieux pricing_components fret maritime est lui aussi désactivé.
--
-- AIR_KMF_PER_KG_COST n'est PAS créé ici : AIR_EXPRESS reste
-- INTERNAL/PENDING/DISABLED tant qu'un coût réel n'est pas calibré.

SET client_encoding = 'UTF8';

-- 1. Coût SEA canonique : copie de la vérité CURRENT, jamais une constante.
INSERT INTO business_rules (
  category, key, value, value_type, label_fr, description, min_value, max_value
)
SELECT
  'logistics',
  'SEA_EUR_PER_M3_COST',
  jsonb_build_object('value', fret_eur_per_m3),
  'number',
  'Coût fret maritime SEA (EUR/m³ W/M)',
  'Coût interne SEA_STANDARD par m³ taxable W/M. Valeur initiale copiée depuis finance_config.fret_eur_per_m3 par LOT 1B-1. Distincte du prix commercial SEA_KMF_PER_KG_COMMERCIAL.',
  1,
  10000
FROM finance_config
WHERE id = 1
  AND fret_eur_per_m3 IS NOT NULL
  AND fret_eur_per_m3 > 0
ON CONFLICT (key) DO NOTHING;

-- Fail closed : la migration ne doit pas fabriquer un coût si la source CURRENT
-- était absente/invalide.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM business_rules
     WHERE key = 'SEA_EUR_PER_M3_COST'
       AND is_active = TRUE
       AND COALESCE((value->>'value')::numeric, 0) > 0
  ) THEN
    RAISE EXCEPTION 'LOT 1B-1: SEA_EUR_PER_M3_COST absent/invalide — impossible de canoniser le fret SEA sans coût réel';
  END IF;
END $$;

-- 2. Les anciens composants freight restent lisibles mais ne valorisent plus.
UPDATE cost_components
   SET is_active = FALSE,
       is_editable = FALSE,
       notes = CONCAT_WS(E'\n', NULLIF(notes, ''),
         'LOT 1B-1: désactivé — freight est DEDICATED à transport-rails (ADR-013).'),
       updated_at = NOW()
 WHERE category = 'freight'
   AND (is_active = TRUE OR is_editable = TRUE);

-- Ratchet DB : impossible de réactiver une valorisation freight générique.
ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_no_active_dedicated_freight;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_no_active_dedicated_freight
  CHECK (NOT (category = 'freight' AND is_active = TRUE));

-- 3. Ancienne projection pricing_components : forensic seulement.
UPDATE pricing_components
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE category = 'transit'
   AND key = 'fret_maritime_eur_m3'
   AND is_active = TRUE;

DO $$
BEGIN
  RAISE NOTICE 'Migration 135 OK — SEA freight DEDICATED, cost_components freight non valorisant';
END $$;
