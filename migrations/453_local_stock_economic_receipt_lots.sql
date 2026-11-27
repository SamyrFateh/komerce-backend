-- @migration 453_local_stock_economic_receipt_lots.sql
-- @domain economic-engine
-- @purpose Financial proof and explicit sale attribution of existing W3 stock receipts.
-- No stock mutation and no retrospective inference from stock balances.
CREATE TABLE public.local_stock_economic_lots (
  receipt_id uuid PRIMARY KEY REFERENCES public.market_delegation_audit(id) ON DELETE RESTRICT,
  sku_id uuid NOT NULL REFERENCES public.product_skus(id) ON DELETE CASCADE,
  market_id uuid NOT NULL REFERENCES public.markets(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  purchase_total_kmf numeric(16,2) NOT NULL CHECK (purchase_total_kmf >= 0),
  payment_proof_ref text NOT NULL CHECK (length(btrim(payment_proof_ref)) BETWEEN 1 AND 200),
  closed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  closed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.local_stock_economic_lot_lines (
  order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.local_stock_economic_lots(receipt_id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  purchase_kmf numeric(16,2) NOT NULL CHECK (purchase_kmf >= 0),
  lot_proof_ref text NOT NULL CHECK (length(btrim(lot_proof_ref)) BETWEEN 1 AND 200),
  linked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX local_stock_economic_lot_lines_receipt_idx ON public.local_stock_economic_lot_lines(receipt_id);
CREATE INDEX local_stock_economic_lots_market_sku_idx ON public.local_stock_economic_lots(market_id, sku_id, closed_at);
