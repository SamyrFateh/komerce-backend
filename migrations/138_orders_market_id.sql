-- @migration 138_orders_market_id.sql
-- @domain    market
-- @purpose   M1c — scoper chaque commande à son marché. Freeze §DATABASE
--            (2026-08-19) : "orders.market_id snapshot · + index ·
--            résolu-du-relais (hypothèse nommée, à durée de vie limitée :
--            cassera si order sans relais)".
--
--            Vérifié sur le schéma réel (2026-08, banc Postgres local
--            chargé depuis db/schema.sql) : orders.relais_id est NOT NULL,
--            sans ON DELETE CASCADE. Aucune commande ne peut exister sans
--            relais — l'hypothèse nommée par le freeze est donc une
--            garantie de contrainte, pas seulement un fait observé
--            aujourd'hui. Le backfill par jointure couvre 100% des lignes.
--
--            SNAPSHOT, pas une FK vivante : orders.market_id est résolu une
--            fois depuis relais.market_id au moment du backfill (et, après
--            ce lot, au moment de la commande côté application — hors
--            périmètre ici). Si un relais changeait un jour de marché
--            (cas non prévu aujourd'hui), les commandes déjà passées
--            garderaient leur market_id d'origine — c'est le sens de
--            "snapshot" et la raison pour laquelle ce n'est PAS une colonne
--            calculée ni une vue.

-- Étape 1 — colonne nullable
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id);

-- Étape 2 — backfill total par jointure : orders.relais_id est NOT NULL,
-- donc chaque ligne resout vers exactement un relais et son market_id.
UPDATE orders o
SET market_id = r.market_id
FROM relais r
WHERE r.id = o.relais_id
  AND o.market_id IS NULL;

-- Étape 3 — NOT NULL, garanti par la contrainte sur relais_id + le backfill total
ALTER TABLE orders
  ALTER COLUMN market_id SET NOT NULL;

-- Étape 4 — index de lecture chaude : filtrer les commandes par marché
CREATE INDEX IF NOT EXISTS idx_orders_market
  ON orders (market_id);

COMMENT ON COLUMN orders.market_id IS
  'Marché de la commande, SNAPSHOT résolu depuis relais.market_id au moment '
  'de la commande (ou du backfill pour les commandes existantes). Ne se '
  're-synchronise jamais automatiquement si un relais changeait de marché. '
  'NOT NULL — garanti par orders.relais_id NOT NULL. Voir '
  'migrations/138_orders_market_id.sql.';
