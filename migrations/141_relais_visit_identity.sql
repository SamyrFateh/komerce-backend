-- @migration 141_relais_visit_identity.sql
-- @domain    logistics
-- @purpose   Donner au point relais une identité de visite canonique :
--            coordonnées GPS exactes + photo reconnaissable par le client.
--
--            Ces données sont publiques par nature : elles alimentent le
--            checkout, le suivi de commande et les notifications de retrait.
--            Les colonnes restent nullables pour ne jamais inventer une
--            position ou une photo lorsqu'un relais n'a pas encore été enrichi.

ALTER TABLE relais
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(11,7),
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'relais_latitude_range_check'
  ) THEN
    ALTER TABLE relais
      ADD CONSTRAINT relais_latitude_range_check
      CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'relais_longitude_range_check'
  ) THEN
    ALTER TABLE relais
      ADD CONSTRAINT relais_longitude_range_check
      CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'relais_gps_pair_check'
  ) THEN
    ALTER TABLE relais
      ADD CONSTRAINT relais_gps_pair_check
      CHECK ((latitude IS NULL) = (longitude IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN relais.latitude IS
  'Latitude GPS exacte du point relais. Toujours renseignée avec longitude.';
COMMENT ON COLUMN relais.longitude IS
  'Longitude GPS exacte du point relais. Toujours renseignée avec latitude.';
COMMENT ON COLUMN relais.photo_url IS
  'Photo publique permettant au client de reconnaître physiquement le relais.';
