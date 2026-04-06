-- ============================================================
-- Migration 005 : Ajout du statut in_transit au pipeline
-- ============================================================
-- Pipeline v9.0 : 7 étapes
-- confirmed → ordered → preparation → shipped → in_transit → available → collected
--
-- in_transit = confirmation embarquement bateau par le transitaire
-- Avant : shipped passait directement à available (trou noir de 3-5 semaines)
-- Après : shipped = remis au transitaire, in_transit = embarqué, available = arrivé au relais
-- ============================================================

BEGIN;

-- 1. Ajouter 'in_transit' à l'enum order_status (après 'shipped')
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'in_transit' AFTER 'shipped';

-- 2. Ajouter 'in_transit' à l'enum scan_step (après 'shipped')
ALTER TYPE scan_step ADD VALUE IF NOT EXISTS 'in_transit' AFTER 'shipped';

COMMIT;

-- 3. Ajouter la colonne in_transit_at à la table orders
-- (ALTER TABLE ne peut pas être dans la même transaction que ADD VALUE)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS in_transit_at TIMESTAMPTZ;

-- 4. Mettre à jour le trigger scan → statut commande
CREATE OR REPLACE FUNCTION sync_order_status_from_scan()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id UUID;
  v_new_status order_status;
BEGIN
  -- Résoudre l'order_id (direct ou via order_item)
  IF NEW.order_id IS NOT NULL THEN
    v_order_id := NEW.order_id;
  ELSE
    SELECT order_id INTO v_order_id FROM order_items WHERE id = NEW.order_item_id;
  END IF;

  -- Correspondance étape scan → statut commande (5 étapes MVP v9.0)
  v_new_status := CASE NEW.step
    WHEN 'preparation'    THEN 'preparation'::order_status
    WHEN 'shipped'        THEN 'shipped'::order_status
    WHEN 'in_transit'     THEN 'in_transit'::order_status
    WHEN 'relais_received'THEN 'available'::order_status
    WHEN 'collected'      THEN 'collected'::order_status
    ELSE NULL
  END;

  -- Mettre à jour la commande si statut défini
  IF v_new_status IS NOT NULL AND v_order_id IS NOT NULL THEN
    UPDATE orders SET
      status        = v_new_status,
      shipped_at    = CASE WHEN NEW.step = 'shipped'         THEN NOW() ELSE shipped_at    END,
      in_transit_at = CASE WHEN NEW.step = 'in_transit'      THEN NOW() ELSE in_transit_at  END,
      available_at  = CASE WHEN NEW.step = 'relais_received' THEN NOW() ELSE available_at   END,
      collected_at  = CASE WHEN NEW.step = 'collected'       THEN NOW() ELSE collected_at   END
    WHERE id = v_order_id;

    -- Insérer dans l'historique
    INSERT INTO order_status_history (order_id, status, scan_id, changed_by, note)
    VALUES (v_order_id, v_new_status, NEW.id, NEW.scanned_by, NEW.notes);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
