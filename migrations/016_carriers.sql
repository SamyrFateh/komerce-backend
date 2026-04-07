-- Migration 016: Carriers table
-- Stores carrier/transporter information for shipment management

CREATE TABLE IF NOT EXISTS carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) DEFAULT 'maritime',
  contact_name VARCHAR(100),
  contact_phone VARCHAR(30),
  contact_email VARCHAR(100),
  avg_transit_days INTEGER,
  cost_per_kg_kmf NUMERIC(10,2),
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carriers_active ON carriers(is_active) WHERE is_active = TRUE;
