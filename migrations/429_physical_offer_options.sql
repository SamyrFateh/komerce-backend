-- @migration 429_physical_offer_options.sql
-- @domain providers-services
-- @purpose Optional structured informational configurations on third-party offers.
ALTER TABLE public.physical_offers ADD COLUMN IF NOT EXISTS offer_options jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'physical_offers_options_array' AND conrelid = 'public.physical_offers'::regclass) THEN
    ALTER TABLE public.physical_offers ADD CONSTRAINT physical_offers_options_array
      CHECK (jsonb_typeof(offer_options) = 'array' AND jsonb_array_length(offer_options) <= 30);
  END IF;
END $$;
COMMENT ON COLUMN public.physical_offers.offer_options IS 'Optional informational configurations; not stock, checkout SKU, reservations or binding prices.';
