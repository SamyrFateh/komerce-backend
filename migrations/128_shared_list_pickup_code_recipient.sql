-- ============================================================
-- Migration 128 : destinataire du code de retrait pour une commande
-- issue d'une liste partagée.
-- Date : août 2026
--
-- Le client transmet uniquement buyer|organizer. Le backend résout
-- l'utilisateur vérifié depuis la liste et le persiste séparément du
-- destinataire physique de la commande (orders.recipient_id).
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_code_recipient varchar(16) NOT NULL DEFAULT 'buyer',
  ADD COLUMN IF NOT EXISTS pickup_code_recipient_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE constraint_name = 'orders_pickup_code_recipient_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_pickup_code_recipient_check
      CHECK (pickup_code_recipient IN ('buyer', 'organizer'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE constraint_name = 'orders_pickup_code_recipient_user_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_pickup_code_recipient_user_id_fkey
      FOREIGN KEY (pickup_code_recipient_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Les commandes existantes restent adressées à leur acheteur.
UPDATE orders
   SET pickup_code_recipient = 'buyer',
       pickup_code_recipient_user_id = COALESCE(pickup_code_recipient_user_id, user_id)
 WHERE pickup_code_recipient_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_pickup_code_recipient_user
  ON orders (pickup_code_recipient_user_id)
  WHERE pickup_code_recipient_user_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'Migration 128 OK — destinataire buyer|organizer du code de retrait.';
END $$;
