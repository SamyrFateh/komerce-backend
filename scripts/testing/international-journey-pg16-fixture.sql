-- Standalone PostgreSQL 16 schema proof for migration 353 on disposable database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.markets(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),market_id uuid NOT NULL REFERENCES public.markets(id));
CREATE TABLE public.parcels(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES public.orders(id));
CREATE TABLE public.customs_shipments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),market_id uuid NOT NULL REFERENCES public.markets(id),
 reference text NOT NULL,status text NOT NULL DEFAULT 'pending',customs_paid_kmf numeric(14,2),
 is_active boolean NOT NULL DEFAULT true
);
