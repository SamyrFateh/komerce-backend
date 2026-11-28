-- @migration 455_market_business_timezone.sql
-- @domain market
-- @purpose Persist the explicitly chosen IANA business timezone; preserve already approved business-day decisions.
ALTER TABLE public.markets ADD COLUMN IF NOT EXISTS business_timezone TEXT;
UPDATE public.markets
SET business_timezone = CASE code
  WHEN 'KM' THEN 'Indian/Comoro'
  WHEN 'CM' THEN 'Africa/Douala'
  WHEN 'CG' THEN 'Africa/Brazzaville'
  WHEN 'DJ' THEN 'Africa/Djibouti'
END
WHERE business_timezone IS NULL AND code IN ('KM','CM','CG','DJ');
COMMENT ON COLUMN public.markets.business_timezone IS 'Canonical IANA business timezone; NULL means no explicit decision.';
