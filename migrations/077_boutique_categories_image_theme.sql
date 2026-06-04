-- Migration 077 — boutique_categories: image_url, theme_token, accent_token
-- L3-T1 : Backward-compatible (pas de NOT NULL), colonnes nullable.
-- Les catégories seed existantes ne sont pas affectées.

ALTER TABLE boutique_categories
  ADD COLUMN IF NOT EXISTS image_url    TEXT,
  ADD COLUMN IF NOT EXISTS theme_token  TEXT,
  ADD COLUMN IF NOT EXISTS accent_token TEXT;
