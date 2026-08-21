-- @migration 135_markets_foundation.sql
-- @domain    market
-- @purpose   M0 — table markets, référentiel pur des marchés ouverts.
--            Fondation de KOMERCE_MARKET_LAYER_FREEZE.md (2026-08-19).
--
--            Cette table ne porte AUCUNE logique d'autorisation. C'est un
--            référentiel de données (code pays, devise, libellé), rien de
--            plus. L'autorisation (qui peut agir sur quel marché) arrive en
--            M1 avec operator_market_scopes, et se résout côté serveur —
--            jamais depuis cette table seule.
--
--            minor_unit anticipe la boundary devise (M5) : 0 chiffre après
--            la virgule pour KMF/XAF, 2 pour EUR. Le seed n'active que KM ;
--            Mayotte/Congo/Cameroun sont des lignes futures, pas des
--            colonnes futures — ouvrir un marché est un INSERT, jamais un
--            ALTER TABLE.

CREATE TABLE IF NOT EXISTS markets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,   -- ISO 3166-1 alpha-2 : 'KM', 'YT', 'CG', 'CM'
  name        TEXT NOT NULL,          -- 'Comores', 'Mayotte', 'Congo', 'Cameroun'
  currency    TEXT NOT NULL,          -- ISO 4217 : 'KMF', 'EUR', 'XAF'
  minor_unit  SMALLINT NOT NULL DEFAULT 0 CHECK (minor_unit >= 0 AND minor_unit <= 4),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE markets IS
  'Référentiel des marchés ouverts. Pur data — aucune autorisation. '
  'Voir operator_market_scopes (M1) pour qui peut agir sur quel marché.';

COMMENT ON COLUMN markets.code IS
  'ISO 3166-1 alpha-2. Clé stable référencée par relais.market_id (M1b) et '
  'orders.market_id (M1c) via markets.id, jamais via ce code directement.';

COMMENT ON COLUMN markets.minor_unit IS
  'Décimales de la devise : 0 pour KMF/XAF, 2 pour EUR. Consommé par la '
  'boundary devise (M5) — cette table ne formate rien elle-même.';

-- Seed : un seul marché actif aujourd'hui. Les marchés suivants (Mayotte,
-- Congo, Cameroun) sont des INSERT dans une migration future, pas ici —
-- chaque ouverture de marché reste un changement isolé et traçable.
INSERT INTO markets (code, name, currency, minor_unit, is_active)
VALUES ('KM', 'Comores', 'KMF', 0, true)
ON CONFLICT (code) DO NOTHING;
