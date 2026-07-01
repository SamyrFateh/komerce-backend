-- @migration 017_hub_safety_constraints.sql
-- @domain    logistics
-- @purpose   Contraintes de sécurité sur parcel_items
-- @added-header 2026-07-01 (audit gouvernance)

-- 017_hub_safety_constraints.sql
-- Hub Safety Fixes: A + C
--
-- A. Empêcher qu'un même article soit ajouté 2 fois dans un colis
-- C. Un seul colis draft par commande

-- A. Contrainte UNIQUE sur parcel_items.order_item_id
ALTER TABLE parcel_items
  ADD CONSTRAINT unique_order_item_per_parcel UNIQUE (order_item_id);

-- C. Un seul colis draft par commande (index unique partiel)
CREATE UNIQUE INDEX IF NOT EXISTS one_draft_per_order
  ON parcels (order_id)
  WHERE status = 'draft';
