-- Migration 015: Customs enrichment on parcels
-- Adds customs-related columns to parcels table for per-parcel customs tracking

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_value_kmf NUMERIC(12,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_weight_kg NUMERIC(8,3);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_hs_code VARCHAR(20);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_cleared_at TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_notes TEXT;
