-- @migration 137_relais_market_id.sql
-- @domain    market
-- @purpose   M1b — scoper chaque relais à son marché. Freeze §DATABASE
--            (2026-08-19) : "relais.market_id + index".
--
--            Backfill total, pas conditionnel : à ce jour, KM (Comores) est
--            le seul marché ouvert (cf. markets, M0), et la colonne `island`
--            existante (Anjouan, etc.) est un découpage interne aux Comores,
--            jamais un autre pays. Toute ligne de relais existante appartient
--            donc à KM sans ambiguïté — le backfill ne fait aucun choix.
--
--            Un relais est un lieu physique : il ne peut pas exister sans
--            marché. NOT NULL est la contrainte correcte une fois le
--            backfill posé, pas une option.

-- Étape 1 — colonne nullable, pour ne pas bloquer sur les lignes existantes
ALTER TABLE relais
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id);

-- Étape 2 — backfill total : tout relais existant est KM (voir @purpose)
UPDATE relais
SET market_id = (SELECT id FROM markets WHERE code = 'KM')
WHERE market_id IS NULL;

-- Étape 3 — contrainte NOT NULL une fois le backfill garanti complet
ALTER TABLE relais
  ALTER COLUMN market_id SET NOT NULL;

-- Étape 4 — index de lecture chaude : filtrer les relais par marché
CREATE INDEX IF NOT EXISTS idx_relais_market
  ON relais (market_id);

COMMENT ON COLUMN relais.market_id IS
  'Marché auquel ce relais appartient. NOT NULL — un relais est un lieu '
  'physique, il ne peut pas exister sans marché. Backfill KM total au '
  '2026-08 (M1b), voir migrations/137_relais_market_id.sql.';
