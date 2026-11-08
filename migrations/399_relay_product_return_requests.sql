-- @migration 399_relay_product_return_requests.sql
-- @domain orders
-- Return V1: attach a customer dispute to a specific purchased line and quantity.
-- This is a REQUEST, not physical possession, approval, refund, wallet movement
-- or local resale. The parent lifecycle remains the canonical disputes table.
ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS return_order_item_id uuid REFERENCES public.order_items(id),
  ADD COLUMN IF NOT EXISTS return_quantity integer,
  ADD COLUMN IF NOT EXISTS return_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'disputes_return_request_shape'
  ) THEN
    ALTER TABLE public.disputes
      ADD CONSTRAINT disputes_return_request_shape
      CHECK (
        type <> 'product_return'
        OR (
          return_order_item_id IS NOT NULL
          AND return_quantity IS NOT NULL
          AND return_quantity > 0
          AND return_reason IN ('defective','damaged','wrong_item','not_as_described','other')
        )
      );
  END IF;
END $$;

-- One actionable request per purchased line at once. Subsequent requests after
-- explicit resolution can be opened only within the remaining collected quantity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_disputes_product_return_active_line
  ON public.disputes (return_order_item_id)
  WHERE type = 'product_return' AND status IN ('open', 'processing');

CREATE INDEX IF NOT EXISTS idx_disputes_product_return_order
  ON public.disputes (order_id, created_at DESC)
  WHERE type = 'product_return';

COMMENT ON COLUMN public.disputes.return_order_item_id IS
  'Article précis de la commande concerné par une DEMANDE de retour, pas une preuve de reprise physique.';
COMMENT ON COLUMN public.disputes.return_quantity IS
  'Quantité déclarée dans la demande, bornée côté serveur par les unités remises au client.';
COMMENT ON COLUMN public.disputes.return_reason IS
  'Motif de demande déclaré, distinct du verdict qualité, de l’autorisation wallet et de la destination du produit.';
