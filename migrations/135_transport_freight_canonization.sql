-- @migration 135_transport_freight_canonization.sql
-- @domain    economic-engine, logistics
-- @purpose   LOT 1B-1 â€” freight DEDICATED au moteur transport-rails
--
-- Correction de vÃ©ritÃ© (ADR-013) :
--   - le coÃ»t SEA quitte finance_config comme vÃ©ritÃ© runtime et devient une
--     POLICY rail explicite : SEA_EUR_PER_M3_COST ;
--   - aucune valeur n'est inventÃ©e : la valeur initiale est copiÃ©e depuis
--     finance_config.fret_eur_per_m3 ;
--   - les lignes cost_components.category='freight' restent conservÃ©es pour
--     forensics, mais sont dÃ©sactivÃ©es et ne peuvent plus Ãªtre rÃ©activÃ©es ;
--   - le vieux pricing_components fret maritime est lui aussi dÃ©sactivÃ©.
--
-- AIR_KMF_PER_KG_COST n'est PAS crÃ©Ã© ici : AIR_EXPRESS reste
-- INTERNAL/PENDING/DISABLED tant qu'un coÃ»t rÃ©el n'est pas calibrÃ©.

SET client_encoding = 'UTF8';

-- 1. CoÃ»t SEA canonique : copie de la vÃ©ritÃ© CURRENT, jamais une constante.
INSERT INTO business_rules (
  category, key, value, value_type, label_fr, description, min_value, max_value
)
SELECT
  'logistics',
  'SEA_EUR_PER_M3_COST',
  jsonb_build_object('value', fret_eur_per_m3),
  'number',
  'CoÃ»t fret maritime SEA (EUR/mÂ³ W/M)',
  'CoÃ»t interne SEA_STANDARD par mÂ³ taxable W/M. Valeur initiale copiÃ©e depuis finance_config.fret_eur_per_m3 par LOT 1B-1. Distincte du prix commercial SEA_KMF_PER_KG_COMMERCIAL.',
  1,
  10000
FROM finance_config
WHERE id = 1
  AND fret_eur_per_m3 IS NOT NULL
  AND fret_eur_per_m3 > 0
ON CONFLICT (key) DO NOTHING;

-- Fail closed : la migration ne doit pas fabriquer un coÃ»t si la source CURRENT
-- Ã©tait absente/invalide.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM business_rules
     WHERE key = 'SEA_EUR_PER_M3_COST'
       AND is_active = TRUE
       AND COALESCE((value->>'value')::numeric, 0) > 0
  ) THEN
    RAISE EXCEPTION 'LOT 1B-1: SEA_EUR_PER_M3_COST absent/invalide â€” impossible de canoniser le fret SEA sans coÃ»t rÃ©el';
  END IF;
END $$;

-- 2. Les anciens composants freight restent lisibles mais ne valorisent plus.
UPDATE cost_components
   SET is_active = FALSE,
       is_editable = FALSE,
       notes = CONCAT_WS(E'\n', NULLIF(notes, ''),
         'LOT 1B-1: dÃ©sactivÃ© â€” freight est DEDICATED Ã  transport-rails (ADR-013).'),
       updated_at = NOW()
 WHERE category = 'freight'
   AND (is_active = TRUE OR is_editable = TRUE);

-- Ratchet DB : impossible de rÃ©activer une valorisation freight gÃ©nÃ©rique.
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
  RAISE NOTICE 'Migration 135 OK â€” SEA freight DEDICATED, cost_components freight non valorisant';
END $$;
