-- @migration 161_providers_services_inquiry_context.sql
-- @domain    providers-services
-- @purpose   Faire de chaque demande/rappel une Inquiry contextualisée :
--            la cible FK porte le propos connu, intent distingue demander
--            d être rappelé, requester_note ajoute la précision du client.
-- @added-header 2026-09-03
-- Idempotent : peut être rejoué sans risque.

ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS intent text NOT NULL DEFAULT 'request',
  ADD COLUMN IF NOT EXISTS requester_note text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_intent_allowed'
  ) THEN
    ALTER TABLE public.inquiries
      ADD CONSTRAINT inquiries_intent_allowed
      CHECK (intent IN ('request', 'callback'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_requester_note_valid'
  ) THEN
    ALTER TABLE public.inquiries
      ADD CONSTRAINT inquiries_requester_note_valid
      CHECK (
        requester_note IS NULL
        OR (length(btrim(requester_note)) > 0 AND length(requester_note) <= 600)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.inquiries.intent IS
  'Intention publique Komerce : request ou callback. Le propos reste toujours connu par service_id XOR physical_offer_id.';
COMMENT ON COLUMN public.inquiries.requester_note IS
  'Précision libre facultative du demandeur, 600 caractères maximum. Elle enrichit la cible et ne la remplace jamais.';
