-- @migration 156_physical_offers_and_neutral_inquiries.sql
-- @domain    providers-services
-- @purpose   Vague 2, D1 — table sœur physical_offers (produit physique
--            proposé par un tiers local, ex. samboussas), et adaptation
--            additive de inquiries pour porter une demande vers un service
--            OU une offre physique, jamais les deux, jamais un troisième
--            type sans nouvelle colonne explicite.
-- @added-header 2026-08-28
-- Idempotent : peut être rejoué sans risque.
--
-- Décision (RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §D, micro-arbitrage
-- validé) : rattachement à providers-services (5 signaux FEATURE_DOCTRINE.md,
-- 4/5 pointent vers un rattachement), PAS une nouvelle feature, PAS une
-- réutilisation brute de `services` (le nom mentirait sur des samboussas).
--
-- `offer_type` + `offer_id` (association polymorphe) a été explicitement
-- REJETÉ : aucune FK Postgres ne peut cibler conditionnellement deux tables
-- différentes — l'intégrité référentielle serait sacrifiée pour une
-- élégance de façade. Retenu : double FK nullable + CHECK exactement-une-
-- non-nulle, via num_nonnulls() (primitif Postgres natif, aucune fonction
-- custom). C'est le modèle minimal qui préserve une vraie intégrité DB pour
-- exactement 2 types connus aujourd'hui — pas une table d'identité partagée
-- (offers.id hérité), qui ne se justifierait qu'à l'apparition d'un 3e type.
--
-- Table `inquiries` elle-même NON renommée : le mot ne mentait jamais (une
-- demande peut porter sur n'importe quoi) — seule la colonne service_id
-- (NOT NULL, cible unique forcée) mentait. Migration additive uniquement.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'physical_offer_status') THEN
    CREATE TYPE public.physical_offer_status AS ENUM ('draft', 'active', 'suspended');
  END IF;
END $$;

-- ── physical_offers ─────────────────────────────────────────────────────
-- Table sœur de `services`, mêmes colonnes de forme (title, description,
-- market_id, zone, status, commercial_exposure) — délibérément un enum de
-- statut PROPRE (physical_offer_status, pas service_listing_status) : même
-- précédent que providers/services/inquiries, chacune sa propre table de
-- statut, jamais partagée, pour rester indépendamment évolutive.

CREATE TABLE IF NOT EXISTS public.physical_offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  market_id    uuid NOT NULL REFERENCES public.markets(id),
  zone         text,
  status       public.physical_offer_status NOT NULL DEFAULT 'draft',
  commercial_exposure text NOT NULL DEFAULT 'DISABLED'
               CHECK (commercial_exposure IN ('DISABLED', 'ENABLED')),
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at   timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.physical_offers IS
  'Produit physique réellement proposé par un tiers local (ex. samboussas '
  'pour mariage) — le tiers prépare/détient la marchandise, fixe le prix, '
  'porte le risque d''exécution. Distinct de products (Komerce fixe le '
  'prix et porte le risque commercial) et de local_stock (stock détenu par '
  'Komerce). Distinct de services (prestation de travail) par le nom, pas '
  'seulement par convention — RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §D.';

COMMENT ON COLUMN public.physical_offers.commercial_exposure IS
  'Même patron que services.commercial_exposure et les rails transport '
  '(DOCTRINE_TRANSPORT_RAILS.md) : donnée vivante, valorisée, jamais '
  'exposée tant que ce champ reste DISABLED.';

CREATE INDEX IF NOT EXISTS idx_physical_offers_provider ON public.physical_offers (provider_id);
CREATE INDEX IF NOT EXISTS idx_physical_offers_market ON public.physical_offers (market_id);

-- ── inquiries — adaptation additive ─────────────────────────────────────
-- service_id devient nullable, physical_offer_id ajouté, CHECK garantit
-- qu'une inquiry porte sur EXACTEMENT une cible — jamais les deux, jamais
-- aucune. num_nonnulls() est un primitif Postgres natif (>= 9.5), pas une
-- fonction custom à maintenir.

ALTER TABLE public.inquiries ALTER COLUMN service_id DROP NOT NULL;

ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS physical_offer_id uuid REFERENCES public.physical_offers(id) ON DELETE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_exactly_one_target'
  ) THEN
    ALTER TABLE public.inquiries
      ADD CONSTRAINT inquiries_exactly_one_target
      CHECK (num_nonnulls(service_id, physical_offer_id) = 1);
  END IF;
END $$;

COMMENT ON COLUMN public.inquiries.service_id IS
  'Nullable depuis la migration 156 — une inquiry porte sur EXACTEMENT une '
  'cible (service_id XOR physical_offer_id), jamais offer_type/offer_id '
  '(association polymorphe rejetée, aucune FK Postgres réelle possible) — '
  'voir contrainte inquiries_exactly_one_target.';

CREATE INDEX IF NOT EXISTS idx_inquiries_physical_offer ON public.inquiries (physical_offer_id);
