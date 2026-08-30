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

COMMENT ON COLUMN public.services.image_ref IS
  'Référence média publique optionnelle pour la représentation du service. '
  'Source owner = providers-services ; Discovery ne fait que la projeter.';

COMMENT ON COLUMN public.physical_offers.image_ref IS
  'Référence média publique optionnelle pour la représentation de l''offre physique. '
  'Source owner = providers-services ; Discovery ne fait que la projeter.';
