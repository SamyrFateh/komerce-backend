-- @migration 155_providers_services_shadow.sql
-- @domain    providers-services
-- @purpose   Vague 1 Shadow (PR B) — cycle demande -> confirmation pour un
--            service local attaché à un provider tiers. Aucune exposition
--            frontend, aucun paiement, aucune commission, aucun calendrier.
-- @added-header 2026-08-28
-- Idempotent : peut être rejoué sans risque.
--
-- Décision (IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md §Providers-services,
-- ARBITRAGE_RECHALLENGE_SONNET.md) : Provider est le second principal
-- payable — le vrai chantier n'est pas ce lot, c'est le jour où de l'argent
-- doit sortir vers quelqu'un qui n'est pas Komerce. Tant que le service
-- reste gratuit pour le provider (aucune commission, aucun payout), ce lot
-- ne touche ni payments, ni wallet, ni orders.
--
-- Provider n'est PAS une ligne users / PAS un user_role : à ce stade il
-- n'a pas besoin de s'authentifier dans l'app (interaction WhatsApp,
-- cf. RECHALLENGE_DISCOVERY_LOCALE). Table autonome, découplée de auth.
--
-- Portée volontairement minimale (shadow, zéro exposition frontend) :
--   - PAS de scheduler / PAS de slot précis : "demain matin" est un texte,
--     jamais un créneau structuré (voir RECHALLENGE_MODELE_MINIMAL §5,
--     §7 — demander != réserver, une ressource non confirmée n'est pas
--     une réservation).
--   - PAS de market_offers ni de commission_rule : pas de deuxième origine
--     commerciale à ce stade, rien à offrir/comparer.
--   - PAS de fulfillment_mode : hors périmètre, produit physique seulement.
--   - service_listings, pas "offers" : nom qui ne collide avec aucun
--     concept déjà écarté dans les rounds de challenge précédents.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'provider_status') THEN
    CREATE TYPE public.provider_status AS ENUM ('pending', 'active', 'suspended');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_listing_status') THEN
    CREATE TYPE public.service_listing_status AS ENUM ('draft', 'active', 'suspended');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inquiry_status') THEN
    CREATE TYPE public.inquiry_status AS ENUM ('sent', 'answered', 'accepted', 'declined');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.providers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  phone        text NOT NULL,
  market_id    uuid NOT NULL REFERENCES public.markets(id),
  status       public.provider_status NOT NULL DEFAULT 'pending',
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at   timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.providers IS
  'Second principal payable (shadow, Vague 1 — aucune exposition frontend, '
  'aucun payout). PAS une ligne users / PAS un user_role : identité vérifiée '
  'par téléphone/WhatsApp, pas d''authentification app à ce stade. Validation '
  'identité, pas légalité (aucun formalisme administratif requis).';

COMMENT ON COLUMN public.providers.status IS
  'pending = jamais encore actif. active = peut porter des services exposables. '
  'suspended = coupure immédiate, réversible, sans validation centrale — '
  'le seul levier de sanction disponible dans l''informel est la visibilité, '
  'jamais une pénalité financière (cf. CHALLENGE_SERVICES_TWO_TRACK.md §T2).';

CREATE TABLE IF NOT EXISTS public.services (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  market_id       uuid NOT NULL REFERENCES public.markets(id),
  zone            text,
  status          public.service_listing_status NOT NULL DEFAULT 'draft',
  commercial_exposure text NOT NULL DEFAULT 'DISABLED'
                  CHECK (commercial_exposure IN ('DISABLED', 'ENABLED')),
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.services IS
  'Proposition de service local d''un provider (shadow, Vague 1). '
  'zone réutilise la granularité déjà en place sur relais (island/zone), '
  'aucun nouveau découpage géographique inventé.';

COMMENT ON COLUMN public.services.commercial_exposure IS
  'Patron déjà en production sur les rails transport (DOCTRINE_TRANSPORT_RAILS.md) : '
  'une donnée vivante, valorisée, mais non exposée tant que ce champ reste '
  'DISABLED. Attribut de donnée, jamais une branche de code frontend.';

CREATE INDEX IF NOT EXISTS idx_services_provider ON public.services (provider_id);
CREATE INDEX IF NOT EXISTS idx_services_market ON public.services (market_id);

CREATE TABLE IF NOT EXISTS public.inquiries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  requester_phone text NOT NULL,
  requested_window text,
  proposed_window  text,
  status          public.inquiry_status NOT NULL DEFAULT 'sent',
  sent_at         timestamp with time zone NOT NULL DEFAULT now(),
  answered_at     timestamp with time zone,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inquiries IS
  'Demande, jamais une réservation (shadow, Vague 1) — RECHALLENGE_MODELE_MINIMAL '
  '§6/§7 : avant confirmation du provider, aucune ressource n''est réellement '
  'engagée. requested_window/proposed_window sont du texte libre ("demain matin"), '
  'jamais un créneau structuré — pas de scheduler tant qu''aucun test ne le justifie.';

COMMENT ON COLUMN public.inquiries.status IS
  'Cycle linéaire : sent (demande envoyée) -> answered (le provider a réagi, '
  'éventuellement via proposed_window pour un autre créneau, sans encore '
  'trancher) -> accepted | declined (terminal). answered_at capture le délai '
  'de réponse, mesure clé du shadow test (temps moyen de confirmation, cf. '
  'CHALLENGE_SERVICES_TWO_TRACK §9-bis).';

CREATE INDEX IF NOT EXISTS idx_inquiries_service ON public.inquiries (service_id);
