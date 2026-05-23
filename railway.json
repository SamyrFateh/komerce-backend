-- Migration 057 : Cart Event Shares + Contributions

-- Extend cart_shares pour le mode événement
ALTER TABLE cart_shares
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS event_label VARCHAR(100),
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS contributed_kmf INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sharer_name VARCHAR(80);

-- Table contributions
CREATE TABLE IF NOT EXISTS cart_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token VARCHAR(20) NOT NULL REFERENCES cart_shares(share_token) ON DELETE CASCADE,
  contributor_name VARCHAR(80) NOT NULL,
  mode VARCHAR(10) NOT NULL DEFAULT 'amount', -- 'item' | 'amount'
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  amount_kmf INTEGER,
  message VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'pledged', -- 'pledged' | 'paid'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contributions_share ON cart_contributions(share_token);
CREATE INDEX IF NOT EXISTS idx_contributions_status ON cart_contributions(status);
