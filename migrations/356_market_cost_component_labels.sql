-- Market-only display labels and descriptions; global cost components remain unchanged.
ALTER TABLE cost_component_market_overrides
  ADD COLUMN IF NOT EXISTS label_override VARCHAR(160),
  ADD COLUMN IF NOT EXISTS description_override VARCHAR(500);
