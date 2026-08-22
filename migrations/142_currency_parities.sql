-- @migration 142_currency_parities.sql
-- @domain    market
-- @purpose   P1 — Currency Boundary, parités fixes. Doctrine gelée le
--            22 août 2026 (GAP_ANALYSIS_CURRENCY_BOUNDARY.md, FREEZE FINAL).
--
--            reference_currency = EUR (canonique de la boundary)
--            economic_engine_base_currency = KMF (inchangé, hors périmètre)
--
--            Invariant 9 : un seul axe par devise Zone franc vers EUR.
--            JAMAIS de paire directe KMF↔XAF stockée — toute conversion
--            entre deux devises Zone franc se DÉRIVE de leurs deux parités
--            vers EUR au moment du calcul (utils/currency.js), jamais
--            persistée. C'est pour ça que la table n'a qu'une colonne de
--            taux, pas une matrice de paires.
--
--            Ancrages officiels réels (pas les approximations qui
--            traînaient jusqu'ici — 495 dans public/boutique/js/b-utils.js,
--            492 dans server.js#/api/public/config, deux valeurs
--            différentes, aucune exacte) :
--              1 EUR = 491,96775 KMF  (ancrage comorien, Trésor français)
--              1 EUR = 655,957   XAF  (CFA d'Afrique centrale, CEMAC)
--              1 EUR = 1         EUR  (la référence elle-même — ligne
--                                      présente pour que toute requête sur
--                                      cette table reste uniforme, jamais
--                                      un cas particulier "si c'est EUR")
--
--            Single source of truth (invariant explicite du freeze) :
--            aucune parité ne doit être maintenue manuellement ailleurs
--            après cette migration. server.js#/api/public/config et
--            utils/currency.js sont mis à jour dans ce même lot pour lire
--            cette table plutôt que porter leur propre valeur.
--
--            Devises de sourcing (USD, AED, CNY...) : ABSENTES de cette
--            table par construction, pas par oubli. Invariant 5 du freeze :
--            aucun taux flottant, aucun provider FX, aucun cron dans P1.

CREATE TABLE IF NOT EXISTS currency_parities (
  currency    TEXT PRIMARY KEY,        -- ISO 4217 : 'KMF', 'XAF', 'EUR'
  eur_rate    NUMERIC(14, 5) NOT NULL, -- unités de `currency` pour 1 EUR
  source_note TEXT NOT NULL,           -- provenance de l'ancrage, jamais une valeur inventée
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE currency_parities IS
  'Source unique des parités fixes vers EUR (reference_currency de la '
  'Currency Boundary). Un seul axe par devise — jamais de paire directe '
  'entre deux devises Zone franc. Ne contient QUE des devises à parité '
  'fixe garantie ; les devises de sourcing flottantes (USD/AED/CNY) sont '
  'un concern séparé, hors de cette table par construction (freeze '
  '22-08-2026, invariants 4/5/9).';

COMMENT ON COLUMN currency_parities.eur_rate IS
  'Unités de currency pour 1 EUR. Ex: KMF -> 491.96775 signifie '
  '1 EUR = 491,96775 KMF. Pour projeter un montant EUR vers currency : '
  'amount_eur * eur_rate. Pour l''inverse : amount_currency / eur_rate.';

INSERT INTO currency_parities (currency, eur_rate, source_note) VALUES
  ('EUR', 1,          'Référence — identité, pas un ancrage'),
  ('KMF', 491.96775,  'Ancrage comorien, garanti Trésor français, en vigueur depuis 1999'),
  ('XAF', 655.957,    'Franc CFA d''Afrique centrale (CEMAC), garanti Trésor français')
ON CONFLICT (currency) DO NOTHING;
