-- Migration 023: Invoices table
-- Mini-facture client, générée au moment du paiement

CREATE TABLE IF NOT EXISTS invoices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  order_id      UUID NOT NULL REFERENCES orders(id),
  parcel_id     UUID REFERENCES parcels(id),
  -- Snapshot at invoice time (immutable)
  client_name   TEXT NOT NULL,
  client_phone  TEXT NOT NULL,
  relay_name    TEXT NOT NULL,
  items_snapshot JSONB NOT NULL,  -- [{name, qty, unit_price, total}]
  subtotal_kmf  INTEGER NOT NULL,
  shipping_kmf  INTEGER NOT NULL DEFAULT 0,
  total_kmf     INTEGER NOT NULL,
  payment_mode  TEXT NOT NULL,    -- 'cash_relais' or 'stripe_eur'
  payment_status TEXT NOT NULL DEFAULT 'paid',
  -- Delivery channel
  delivered_via TEXT,             -- 'print', 'email', 'whatsapp'
  delivered_at  TIMESTAMPTZ,
  -- Metadata
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sequence for invoice numbers: KOM-INV-2026-000001
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

