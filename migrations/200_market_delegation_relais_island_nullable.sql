-- @migration 200_market_delegation_relais_island_nullable.sql
-- @domain    market-delegation
-- @purpose   network.create doit fonctionner pour tout Market ID. relais.island
--            portait DEFAULT 'Anjouan' NOT NULL — un artefact mono-marché (KM) :
--            créer un relais hors KM via l'API aurait silencieusement hérité
--            d'une île comorienne. Rend island/island_code nullables ; aucune
--            valeur par défaut géographique n'est plus injectée.
--
--            Hors périmètre de cette migration : services/routing.js exige
--            island_code pour le routage inter-îles KM (ANJOUAN vs
--            GRANDE_COMORE/MOHELI) et lève une erreur s'il est absent. Ce
--            couplage est pré-existant et spécifique à KM ; il n'est pas
--            modifié ici. Un relais KM créé sans island_code restera
--            fonctionnellement incomplet pour le routage tant que ce chantier
--            séparé n'est pas traité. Voir feature card market-delegation,
--            section gaps.

ALTER TABLE relais ALTER COLUMN island DROP DEFAULT;
ALTER TABLE relais ALTER COLUMN island DROP NOT NULL;

COMMENT ON COLUMN relais.island IS
  'Île (nom lisible), pertinent uniquement pour les marchés à géographie insulaire (ex. KM). Nullable — aucune valeur par défaut géographique. Le routage inter-îles (services/routing.js) reste spécifique à KM et exige island_code pour les relais qui en dépendent.';
COMMENT ON COLUMN relais.island_code IS
  'Code île normalisé, consommé par services/routing.js pour le routage inter-îles KM. Nullable — non applicable hors marchés insulaires. Un relais créé sans île sur un marché qui en a besoin restera incomplet pour le routage tant que ce n''est pas renseigné explicitement.';

UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability IN ('network.create','network.update','network.suspend');
