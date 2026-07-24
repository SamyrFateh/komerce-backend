-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 114 — delivery_mode sur order_items
--
-- Stocke le choix de mode de livraison fait par le client en fiche produit.
-- 'sea' (défaut) = Maritime 3-5 semaines · 'air' = Express 1 semaine max
--
-- Valeur par défaut 'sea' : les commandes existantes et les clients qui ne
-- choisissent pas restent sur le maritime sans aucune action.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'sea'
    CONSTRAINT order_items_delivery_mode_check CHECK (delivery_mode IN ('sea', 'air'));

COMMENT ON COLUMN order_items.delivery_mode IS
  'Mode de livraison choisi par le client : sea (maritime, 3-5 semaines, défaut) '
  'ou air (express, 1 semaine max). Source : sélecteur fiche produit front '
  '(b-modal-desktop-product.js / b-modal-mobile-product.js). '
  'Transmis dans le payload POST /api/orders items[].delivery_mode.';
