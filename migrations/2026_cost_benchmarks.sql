-- ════════════════════════════════════════════════════════════════════════════
-- Migration : cost_benchmarks
-- Benchmarks de surcharge par famille de coût (doctrine ALLOCATION §6).
-- Tant que la table est vide, le diagnostic de surcharge reste HEURISTIQUE
-- (seuils globaux, confiance basse). Dès qu'une ligne existe pour une famille,
-- son diagnostic devient CALIBRÉ (confiance haute) pour cette famille.
--
-- expected_share_pct : part attendue du CDR pour cette famille (en %).
-- warn_ratio / alert_ratio : multiplicateurs de la part attendue.
--   part réelle > expected × warn_ratio  → « à surveiller »
--   part réelle > expected × alert_ratio → « surcharge »
-- category : 'all' (défaut, tous produits) ou une clé de customs_categories.
--   Une ligne catégorie-spécifique l'emporte sur 'all'.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cost_benchmarks (
  id                 SERIAL PRIMARY KEY,
  category           TEXT          NOT NULL DEFAULT 'all',
  cost_family        TEXT          NOT NULL,
  expected_share_pct NUMERIC(6,2)  NOT NULL,
  warn_ratio         NUMERIC(5,2)  NOT NULL DEFAULT 1.30,
  alert_ratio        NUMERIC(5,2)  NOT NULL DEFAULT 1.60,
  is_active          BOOLEAN       NOT NULL DEFAULT TRUE,
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT cost_benchmarks_unique UNIQUE (category, cost_family)
);

CREATE INDEX IF NOT EXISTS idx_cost_benchmarks_active
  ON cost_benchmarks (category, cost_family) WHERE is_active = TRUE;

-- ────────────────────────────────────────────────────────────────────────────
-- EXEMPLE DE CALIBRATION (commenté). Décommenter et AJUSTER avec tes vrais
-- ratios observés. Les valeurs ci-dessous sont indicatives, pas des vérités.
-- cost_family ∈ { product_purchase, sourcing, hub, packaging, freight, customs,
--                 port_transitary, local_distribution, relay,
--                 payment, risk_provision, fixed_overhead }
-- ────────────────────────────────────────────────────────────────────────────
-- INSERT INTO cost_benchmarks (category, cost_family, expected_share_pct) VALUES
--   ('all', 'product_purchase', 50),
--   ('all', 'sourcing',          4),
--   ('all', 'hub',               8),
--   ('all', 'packaging',         3),
--   ('all', 'freight',           7),
--   ('all', 'customs',           4),
--   ('all', 'port_transitary',   3),
--   ('all', 'local_distribution',4),
--   ('all', 'relay',             4),
--   ('all', 'payment',           3),
--   ('all', 'risk_provision',    2),
--   ('all', 'fixed_overhead',   18)
-- ON CONFLICT (category, cost_family) DO NOTHING;
