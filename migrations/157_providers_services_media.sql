-- @migration 157_providers_services_media.sql
-- @domain    providers-services
-- @purpose   Ajoute un média public optionnel aux services et offres physiques
--            locales. L'image reste une propriété de la source métier ;
--            recommendations/Discovery ne la possède ni ne l'invente.
-- @added-header 2026-08-31
-- Idempotent : peut être rejoué sans risque.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS image_ref text;

ALTER TABLE public.physical_offers
  ADD COLUMN IF NOT EXISTS image_ref text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'services_image_ref_public'
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_image_ref_public
      CHECK (image_ref IS NULL OR image_ref LIKE '/%' OR image_ref LIKE 'https://%');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'physical_offers_image_ref_public'
  ) THEN
    ALTER TABLE public.physical_offers
      ADD CONSTRAINT physical_offers_image_ref_public
      CHECK (image_ref IS NULL OR image_ref LIKE '/%' OR image_ref LIKE 'https://%');
  END IF;
END $$;

COMMENT ON COLUMN public.services.image_ref IS
  'Référence média publique optionnelle pour la représentation du service. '
  'Chemin public /... ou URL https:// uniquement. Source owner = providers-services.';

COMMENT ON COLUMN public.physical_offers.image_ref IS
  'Référence média publique optionnelle pour la représentation de l''offre physique. '
  'Chemin public /... ou URL https:// uniquement. Source owner = providers-services.';
