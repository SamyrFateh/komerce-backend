-- @migration 140_market_open_cameroon.sql
-- @domain    market
-- @purpose   Ouverture du marché Cameroun. Même doctrine que M10
--            (migrations/139_market_open_mayotte.sql) : ouvrir un marché
--            est un INSERT, jamais un ALTER TABLE.
--
--            XAF, minor_unit=0 (franc CFA d'Afrique centrale, pas de
--            sous-unité en usage courant — même convention que KMF).

INSERT INTO markets (code, name, currency, minor_unit, is_active)
VALUES ('CM', 'Cameroun', 'XAF', 0, true)
ON CONFLICT (code) DO NOTHING;
