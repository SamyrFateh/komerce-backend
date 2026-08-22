-- @migration 139_market_open_mayotte.sql
-- @domain    market
-- @purpose   M10 — ouverture du marché Mayotte. Premier marché après le seed
--            KM de M0 (migrations/135_markets_foundation.sql).
--
--            Conforme à la doctrine posée dans 135 : ouvrir un marché est un
--            INSERT, jamais un ALTER TABLE. Cette migration ne touche aucune
--            colonne, aucun index, aucune contrainte — le schéma de markets
--            (M0) et toute la chaîne M1/M1b/M1c/M2/M5 le supportent déjà
--            sans modification.
--
--            EUR, minor_unit=2 : Mayotte est un territoire français, devise
--            décimale — premier marché qui exerce réellement la boundary
--            devise (utils/currency.js, M5) sur autre chose que KMF.
--
--            Hors périmètre de cette migration, par doctrine :
--              - activation frontend (public/boutique/js/market-context.js)
--                — scope H4, pas M10 (cf. commentaire "Marchés suivants (H4+)"
--                dans ce fichier)
--              - tout relais ou commande réels rattachés à YT — données
--                opérationnelles, pas du seed
--              - branchement de requireMarketScope sur une route — hors
--                scope depuis M2, inchangé ici

INSERT INTO markets (code, name, currency, minor_unit, is_active)
VALUES ('YT', 'Mayotte', 'EUR', 2, true)
ON CONFLICT (code) DO NOTHING;
