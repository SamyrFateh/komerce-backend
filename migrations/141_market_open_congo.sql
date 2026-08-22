-- @migration 141_market_open_congo.sql
-- @domain    market
-- @purpose   Ouverture du marché Congo (Brazzaville). Même doctrine que
--            M10/CM : ouvrir un marché est un INSERT.
--
--            XAF, minor_unit=0 — le Congo-Brazzaville est membre de la
--            CEMAC, même franc CFA d'Afrique centrale que le Cameroun.

INSERT INTO markets (code, name, currency, minor_unit, is_active)
VALUES ('CG', 'Congo', 'XAF', 0, true)
ON CONFLICT (code) DO NOTHING;
