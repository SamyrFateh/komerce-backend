-- 372 — L7 : journal des mouvements de garde et des ajustements de coûts d'expédition.
-- Les espèces entre détenteurs ne sont PAS une recette; un avoir de fret n'est PAS une nouvelle dépense.
-- Les faits restent sous l'autorité de cash_custody_movements et des writers expédition.
ALTER TABLE public.financial_movements DROP CONSTRAINT IF EXISTS chk_fm_direction;
ALTER TABLE public.financial_movements
  ADD CONSTRAINT chk_fm_direction
  CHECK (direction IN ('inflow','outflow','cost','custody','cost_reversal'));
COMMENT ON COLUMN public.financial_movements.direction IS
  'inflow/outflow = économique ou trésorerie; cost = coût physique; cost_reversal = avoir de coût; custody = changement de détention, jamais revenu.';
