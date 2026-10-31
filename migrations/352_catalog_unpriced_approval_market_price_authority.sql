-- @migration 352_catalog_unpriced_approval_market_price_authority.sql
-- @domain catalog
-- @purpose Align the persisted products price invariant with the established
--          market-local price authority. Globally approved products may have
--          NULL products.price_kmf while each market independently decides its
--          sellable LOCAL_ACTIVE price and exposure.
--
--          Migration 259 allowed NULL only on inactive candidates, even though
--          catalog-certification and catalog-approval allow a source-linked
--          certified candidate to be approved without a global selling price.
--          The outdated check caused SQLSTATE 23514 on approval.
--
-- Safety:
--   * Keep chk_products_price (>0 when non-null) unchanged.
--   * Keep catalog certification/source/FR/media/SKU gates unchanged.
--   * Keep global human approval, capacity and publication audit unchanged.
--   * Keep market price LOCAL_ACTIVE + exposure ENABLED + SKU/stock gates for
--     buyer visibility and checkout. This migration neither sets any prices
--     nor activates any products or market exposure.
--   * The application guard still rejects a NULL first-activation price
--     unless it is a certified, source-linked Catalogue candidate.
BEGIN;
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_unpriced_draft_only;
COMMENT ON COLUMN public.products.price_kmf IS
  'Optional global reference price (KMF); NULL is allowed for certified globally-approved products. Buyer prices are independently gated per market by LOCAL_ACTIVE plus enabled exposure. Positive non-NULL prices remain subject to chk_products_price.';
COMMIT;
