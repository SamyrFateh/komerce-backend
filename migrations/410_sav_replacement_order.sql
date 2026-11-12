-- @migration 410_sav_replacement_order.sql
-- @domain orders,logistics
-- @purpose Persist no-charge replacements in the existing order and fulfillment circuit.
-- Internal replacement order: no collectible balance and no commercial sale.
ALTER TYPE public.payment_mode ADD VALUE IF NOT EXISTS 'sav_replacement';

ALTER TABLE public.order_items
  ADD COLUMN replacement_source_item_id uuid REFERENCES public.order_items(id),
  DROP CONSTRAINT chk_order_items_price,
  ADD CONSTRAINT chk_order_items_price
    CHECK ((replacement_source_item_id IS NULL AND price_kmf > 0)
        OR (replacement_source_item_id IS NOT NULL AND price_kmf = 0));

ALTER TABLE public.relay_return_compensations
  ADD COLUMN replacement_order_id uuid UNIQUE REFERENCES public.orders(id),
  DROP CONSTRAINT relay_return_compensations_amount_check,
  ADD CONSTRAINT chk_return_compensation_movement_amount
    CHECK ((movement = 'reship' AND amount = 0 AND replacement_order_id IS NOT NULL
            AND replacement_order_id <> order_id)
        OR (movement <> 'reship' AND amount > 0 AND replacement_order_id IS NULL));

ALTER TABLE public.orders
  ADD CONSTRAINT chk_sav_replacement_no_charge
    CHECK (payment_mode::text <> 'sav_replacement'
      OR (total_kmf = 0 AND total_eur IS NOT DISTINCT FROM 0::numeric
          AND stripe_payment_id IS NULL AND paypal_capture_id IS NULL
          AND COALESCE(wallet_applied_kmf, 0) = 0 AND remaining_cash_kmf = 0));
