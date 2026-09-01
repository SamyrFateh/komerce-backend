-- @migration 191_restore_tech_navigation_subcategories.sql
-- @domain catalog
-- @owner scripts/run-migrations-once.js
-- @phase expand
-- @description Restore canonical Ordi and Gaming navigation entries for the Tech Boutique rail.

INSERT INTO boutique_subcategories (category_key, key, label, emoji, display_order, is_active)
VALUES
  ('Tech', 'Ordi', 'Ordi', '💻', 2, TRUE),
  ('Tech', 'Gaming', 'Gaming', '🎮', 5, TRUE)
ON CONFLICT (category_key, key)
DO UPDATE SET
  label = EXCLUDED.label,
  emoji = EXCLUDED.emoji,
  display_order = EXCLUDED.display_order,
  is_active = TRUE;
