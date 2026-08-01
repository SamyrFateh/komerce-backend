-- ============================================================
-- Migration 123 : Pont checkout canonique ↔ liste partagée (Lot 4)
-- Date : août 2026
--
-- CONTEXTE :
--   Doctrine Boutique First — le panier partagé n'a plus de checkout
--   spécifique. Un participant réclame un article de liste en achetant
--   normalement via POST /api/orders, en passant l'id de l'article de
--   liste dans sa ligne de commande. La rareté (D2 — un article de liste
--   est réclamable une seule fois) n'est PAS arbitrée par un service de
--   réservation ni par une machine à états : elle est arbitrée par un
--   index unique en base. Deux INSERT concurrents sur le même
--   shared_cart_item_id : le premier commit gagne, le second reçoit une
--   violation de contrainte que routes/orders/create.js traduit en 409.
--
--   Choix technique : index UNIQUE standard, PAS partiel. En PostgreSQL,
--   plusieurs valeurs NULL ne sont jamais en conflit dans un index
--   unique — donc tout achat hors contexte de liste (immense majorité
--   des commandes) passe avec shared_cart_item_id = NULL sans jamais
--   toucher cette contrainte. Un prédicat partiel référençant
--   orders.status aurait été impossible de toute façon (un index ne
--   peut porter que sur les colonnes de sa propre table) ; la libération
--   du claim à l'annulation (services/order-status-machine.js, bloc
--   5b) repasse la colonne à NULL, ce qui rouvre l'article sans qu'aucun
--   prédicat n'ait besoin de connaître le statut de la commande.
--
--   Portée volontairement minimale : cette migration ne touche pas aux
--   colonnes de financement de shared_carts (contributed_kmf,
--   remaining_kmf, etc.) — leur suppression est le Lot 2/3, distinct.
--
-- IDEMPOTENT via IF NOT EXISTS / DO $$ garde-fou.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

-- ============================================================
-- 1. order_items.shared_cart_item_id — rattachement optionnel
-- ============================================================

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS shared_cart_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'order_items_shared_cart_item_id_fkey'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_shared_cart_item_id_fkey
      FOREIGN KEY (shared_cart_item_id)
      REFERENCES shared_cart_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 2. Arbitrage de la rareté sociale (D2) — index unique standard
--    (NULL non-conflictuel : voir note en tête de fichier)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS order_items_shared_cart_item_id_unique
  ON order_items (shared_cart_item_id);

DO $$
BEGIN
  RAISE NOTICE 'Migration 123 OK — pont order_items <-> shared_cart_items posé, arbitrage par contrainte unique.';
END $$;
