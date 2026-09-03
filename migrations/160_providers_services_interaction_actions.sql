-- @migration 160_providers_services_interaction_actions.sql
-- @domain    providers-services
-- @purpose   Donner à chaque Service / Physical Offer un jeu cumulatif
--            d'actions autorisées dans l'unique fiche Komerce, sans déduire
--            l'interaction du kind. Le provider ne publie un contact direct
--            que via des champs publics explicites, distincts du téléphone
--            privé d'identité.
-- @added-header 2026-09-03
-- Idempotent : peut être rejoué sans risque.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS public_phone text,
  ADD COLUMN IF NOT EXISTS public_whatsapp text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'providers_public_phone_nonblank'
  ) THEN
    ALTER TABLE public.providers
      ADD CONSTRAINT providers_public_phone_nonblank
      CHECK (public_phone IS NULL OR length(btrim(public_phone)) > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'providers_public_whatsapp_nonblank'
  ) THEN
    ALTER TABLE public.providers
      ADD CONSTRAINT providers_public_whatsapp_nonblank
      CHECK (public_whatsapp IS NULL OR length(btrim(public_whatsapp)) > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.providers.public_phone IS
  'Coordonnée téléphonique explicitement publiable. Distincte de providers.phone, qui reste privée et ne doit jamais être projetée par défaut.';
COMMENT ON COLUMN public.providers.public_whatsapp IS
  'Coordonnée WhatsApp explicitement publiable. Distincte de providers.phone et exposée uniquement lorsqu une offre active l action whatsapp.';

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS actions_enabled text[] NOT NULL DEFAULT ARRAY['request']::text[];
ALTER TABLE public.physical_offers
  ADD COLUMN IF NOT EXISTS actions_enabled text[] NOT NULL DEFAULT ARRAY['request']::text[];

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'services_actions_enabled_allowed'
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_actions_enabled_allowed
      CHECK (
        cardinality(actions_enabled) > 0
        AND actions_enabled <@ ARRAY['request','quote','callback','call','whatsapp']::text[]
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'physical_offers_actions_enabled_allowed'
  ) THEN
    ALTER TABLE public.physical_offers
      ADD CONSTRAINT physical_offers_actions_enabled_allowed
      CHECK (
        cardinality(actions_enabled) > 0
        AND actions_enabled <@ ARRAY['request','quote','callback','call','whatsapp']::text[]
      );
  END IF;
END $$;

COMMENT ON COLUMN public.services.actions_enabled IS
  'Capacités cumulatives de la fiche Komerce : request, quote, callback, call, whatsapp. Le kind décrit ce que l objet est ; ce tableau décrit ce que le client peut faire.';
COMMENT ON COLUMN public.physical_offers.actions_enabled IS
  'Capacités cumulatives de la fiche Komerce : request, quote, callback, call, whatsapp. Le kind ne choisit jamais seul l interaction.';
