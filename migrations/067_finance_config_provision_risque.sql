-- Migration 067 — finance_config.provision_risque_pct (PATCH P1-6)
--
-- Externalise le coefficient de provision risque mensuel (auparavant
-- hardcodé à 1% dans cost-allocation.js, violation I-08).
-- L'admin peut désormais ajuster ce taux via le Control Tower.

ALTER TABLE finance_config
  ADD COLUMN IF NOT EXISTS provision_risque_pct NUMERIC(6,4) NOT NULL DEFAULT 0.01;

COMMENT ON COLUMN finance_config.provision_risque_pct IS
  'Taux de provision risque mensuel appliqué au CA (ex: 0.01 = 1%). '
  'Configurable via Control Tower > Paramètres économiques.';
