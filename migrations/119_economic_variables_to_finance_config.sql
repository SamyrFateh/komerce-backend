-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 119 — LOT 1A-4 : economic_variables -> finance_config
--
-- But : rendre finance_config seule source runtime des paramètres lus par
-- redistribute() et dashboard Ops, sans déplacer la valeur CURRENT.
--
-- Preflight réel 2026-08-18 :
--   orders_per_month         == objectif_commandes_mois   == 100
--   target_basket_avg        == target_panier_moyen_kmf   == 15000
--   hub_monthly_cost_aed     == hub_monthly_cost_aed      == 7000
--
-- Les 9 colonnes ci-dessous n'existaient pas encore dans finance_config.
-- Sur une DB déployée, elles sont initialisées depuis economic_variables avec
-- EXACTEMENT la priorité historique value_used > value_supposed > fallback.
-- Sur un environnement neuf où la table legacy n'existe pas encore au moment
-- du releaseCommand, les mêmes fallbacks CURRENT sont utilisés fail-safe.
-- Aucun UPDATE/DELETE de economic_variables.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS customs_rate_default_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS mix_rail_a               NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS mix_rail_b               NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS mix_rail_c               NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS mix_rail_d               NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS margin_rail_a            NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS margin_rail_b            NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS margin_rail_c            NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS margin_rail_d            NUMERIC(5,2);

DO $lot_1a4$
BEGIN
  IF to_regclass('public.economic_variables') IS NOT NULL THEN
    -- SQL dynamique volontaire : une référence statique à une table absente
    -- ferait échouer le parse d'un environnement neuf avant le IF.
    EXECUTE $legacy_copy$
      UPDATE finance_config
      SET customs_rate_default_pct = COALESCE(
            customs_rate_default_pct,
            (SELECT COALESCE(value_used, value_supposed)::numeric FROM economic_variables
              WHERE key = 'customs_rate_default_pct' AND is_active = TRUE LIMIT 1), 42),
          mix_rail_a = COALESCE(
            mix_rail_a,
            (SELECT COALESCE(value_used, value_supposed)::numeric FROM economic_variables
              WHERE key = 'mix_rail_a' AND is_active = TRUE LIMIT 1), 60),
          mix_rail_b = COALESCE(
            mix_rail_b,
            (SELECT COALESCE(value_used, value_supposed)::numeric FROM economic_variables
              WHERE key = 'mix_rail_b' AND is_active = TRUE LIMIT 1), 25),
          mix_rail_c = COALESCE(
            mix_rail_c,
            (SELECT COALESCE(value_used, value_supposed)::numeric FROM economic_variables
              WHERE key = 'mix_rail_c' AND is_active = TRUE LIMIT 1), 10),
          mix_rail_d = COALESCE(
            mix_rail_d,
            (SELECT COALESCE(value_used, value_supposed)::numeric FROM economic_variables
              WHERE key = 'mix_rail_d' AND is_active = TRUE LIMIT 1), 5),
          margin_rail_a = COALESCE(
            margin_rail_a,
            (SELECT COALESCE(value_used, value_supposed)::numeric FROM economic_variables
              WHERE key = 'margin_rail_a' AND is_active = TRUE LIMIT 1), 45),
          margin_rail_b = COALESCE(
            margin_rail_b,
            (SELECT COALESCE(value_used, value_supposed)::numeric FROM economic_variables
              WHERE key = 'margin_rail_b' AND is_active = TRUE LIMIT 1), 18),
          margin_rail_c = COALESCE(
            margin_rail_c,
            (SELECT COALESCE(value_used, value_supposed)::numeric FROM economic_variables
              WHERE key = 'margin_rail_c' AND is_active = TRUE LIMIT 1), 35),
          margin_rail_d = COALESCE(
            margin_rail_d,
            (SELECT COALESCE(value_used, value_supposed)::numeric FROM economic_variables
              WHERE key = 'margin_rail_d' AND is_active = TRUE LIMIT 1), 70)
      WHERE id = 1
    $legacy_copy$;
  ELSE
    UPDATE finance_config
    SET customs_rate_default_pct = COALESCE(customs_rate_default_pct, 42),
        mix_rail_a               = COALESCE(mix_rail_a, 60),
        mix_rail_b               = COALESCE(mix_rail_b, 25),
        mix_rail_c               = COALESCE(mix_rail_c, 10),
        mix_rail_d               = COALESCE(mix_rail_d, 5),
        margin_rail_a            = COALESCE(margin_rail_a, 45),
        margin_rail_b            = COALESCE(margin_rail_b, 18),
        margin_rail_c            = COALESCE(margin_rail_c, 35),
        margin_rail_d            = COALESCE(margin_rail_d, 70)
    WHERE id = 1;
  END IF;
END
$lot_1a4$;

ALTER TABLE finance_config
  ALTER COLUMN customs_rate_default_pct SET DEFAULT 42,
  ALTER COLUMN customs_rate_default_pct SET NOT NULL,
  ALTER COLUMN mix_rail_a SET DEFAULT 60,
  ALTER COLUMN mix_rail_a SET NOT NULL,
  ALTER COLUMN mix_rail_b SET DEFAULT 25,
  ALTER COLUMN mix_rail_b SET NOT NULL,
  ALTER COLUMN mix_rail_c SET DEFAULT 10,
  ALTER COLUMN mix_rail_c SET NOT NULL,
  ALTER COLUMN mix_rail_d SET DEFAULT 5,
  ALTER COLUMN mix_rail_d SET NOT NULL,
  ALTER COLUMN margin_rail_a SET DEFAULT 45,
  ALTER COLUMN margin_rail_a SET NOT NULL,
  ALTER COLUMN margin_rail_b SET DEFAULT 18,
  ALTER COLUMN margin_rail_b SET NOT NULL,
  ALTER COLUMN margin_rail_c SET DEFAULT 35,
  ALTER COLUMN margin_rail_c SET NOT NULL,
  ALTER COLUMN margin_rail_d SET DEFAULT 70,
  ALTER COLUMN margin_rail_d SET NOT NULL;

COMMENT ON COLUMN finance_config.customs_rate_default_pct IS
  'Fallback douane terrain Ops. Copié iso-CURRENT depuis economic_variables par migration 119.';
COMMENT ON COLUMN finance_config.mix_rail_a IS 'Mix CA Rail A — source runtime canonique depuis migration 119.';
COMMENT ON COLUMN finance_config.mix_rail_b IS 'Mix CA Rail B — source runtime canonique depuis migration 119.';
COMMENT ON COLUMN finance_config.mix_rail_c IS 'Mix CA Rail C — source runtime canonique depuis migration 119.';
COMMENT ON COLUMN finance_config.mix_rail_d IS 'Mix CA Rail D — source runtime canonique depuis migration 119.';
COMMENT ON COLUMN finance_config.margin_rail_a IS 'Marge Rail A — source runtime canonique depuis migration 119.';
COMMENT ON COLUMN finance_config.margin_rail_b IS 'Marge Rail B — source runtime canonique depuis migration 119.';
COMMENT ON COLUMN finance_config.margin_rail_c IS 'Marge Rail C — source runtime canonique depuis migration 119.';
COMMENT ON COLUMN finance_config.margin_rail_d IS 'Marge Rail D — source runtime canonique depuis migration 119.';
