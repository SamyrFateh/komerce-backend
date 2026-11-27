-- @migration 454_local_stock_economic_multi_lot.sql
-- @domain economic-engine
-- @purpose One sale can consume quantities from multiple independently evidenced receipt lots.
ALTER TABLE public.local_stock_economic_lot_lines DROP CONSTRAINT local_stock_economic_lot_lines_pkey;
ALTER TABLE public.local_stock_economic_lot_lines ADD PRIMARY KEY (order_item_id,receipt_id);
