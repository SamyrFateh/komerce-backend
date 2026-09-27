-- @migration 249_customs_category_classifier_calibration.sql
-- @domain    customs
-- @purpose   Calibrer les termes du classifieur fournisseur sans règle métier runtime.
--
-- Les résultats AliExpress réels ont montré des retours hors sujet par rapport
-- au mot-clé de découverte. Cette migration enrichit uniquement les DONNÉES
-- administrables de customs_categories ; le classifieur reste générique.

UPDATE customs_categories
SET classification_terms = classification_terms || '{
  "hoodie":9,
  "jersey":8,
  "sweatshirt":9,
  "pullover":8,
  "boot":7,
  "boots":8,
  "gaiter":8,
  "gaiters":9,
  "glasses":7,
  "eyewear":8,
  "sunglasses":8,
  "frame glasses":9
}'::jsonb
WHERE key = 'vetements';

UPDATE customs_categories
SET classification_terms = classification_terms || '{
  "microphone":10,
  "lavalier":9,
  "lavalier microphone":12,
  "wireless microphone":11,
  "wristwatch":10,
  "wrist watch":10,
  "watches":7,
  "night light":10,
  "led night light":12,
  "moon lamp":12,
  "led light":8
}'::jsonb
WHERE key = 'electro';

UPDATE customs_categories
SET classification_terms = classification_terms || '{
  "bicycle":9,
  "bike":8,
  "cycling":6,
  "saddle":9,
  "scooter":9,
  "electric scooter":11,
  "backrest":8,
  "footrest":9,
  "footpeg":10,
  "pedal":7,
  "rearview mirror":10,
  "rear view mirror":10,
  "motorcycle part":10,
  "bracket":7,
  "drill bit":10,
  "magnetizer":9,
  "magnetic ring":7,
  "scale":8,
  "digital scale":10,
  "luggage scale":11,
  "circuit board":8,
  "impact wrench":11,
  "controller board":8
}'::jsonb
WHERE key = 'materiels';

COMMENT ON COLUMN customs_categories.classification_terms IS
  'Termes/phrases pondérés de classification fournisseur. Donnée administrable ; le produit réellement retourné fait autorité sur l intention de découverte.';
