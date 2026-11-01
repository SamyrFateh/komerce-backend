-- Independent PostgreSQL 16 fixture after migration 354 proof completed.
CREATE TABLE public.order_items (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id)
);
CREATE TABLE public.order_item_real_cost_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE public.customs_shipment_fees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shipment_id uuid NOT NULL REFERENCES public.customs_shipments(id),
 fee_type text NOT NULL, proof_ref text NOT NULL
);
ALTER TABLE public.customs_shipments ADD COLUMN freight_kmf numeric(14,2);
