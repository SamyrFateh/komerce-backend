-- 365 — Réservation E7 d'un remboursement pour une QUANTITÉ d'article, jamais une commande entière.
-- Le versement externe reste interdit à ce stade : l'intention PSP doit être committée
-- et réconciliée indépendamment avant toute clôture ou mise à jour de statut.
-- Une quantité remboursée ne peut pas être à nouveau remise au client.
-- Les lignes historiques restent à zéro ; le premier transfert s'effectue uniquement
-- après preuve de sortie PSP via finalizeVerifiedRefund().
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS qty_refunded integer NOT NULL DEFAULT 0;
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS chk_order_items_qty_refunded;
ALTER TABLE public.order_items
  ADD CONSTRAINT chk_order_items_qty_refunded
    CHECK (qty_refunded >= 0 AND qty_refunded + qty_collected <= quantity);

CREATE TABLE IF NOT EXISTS public.order_item_refund_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  source_incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE RESTRICT,
  refund_intent_id uuid NOT NULL UNIQUE REFERENCES public.refund_execution_intents(id) ON DELETE RESTRICT,
  operation_key uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  amount_kmf numeric(14,2) NOT NULL CHECK (amount_kmf > 0),
  amount_eur numeric(12,2) NOT NULL CHECK (amount_eur > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 8),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','processing','unknown','confirmed','failed')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  provider_ref text,
  resolved_at timestamptz,
  CONSTRAINT uq_item_refund_order_operation UNIQUE (order_id, operation_key)
);
CREATE INDEX IF NOT EXISTS idx_item_refund_reservations_line
  ON public.order_item_refund_reservations(order_item_id, created_at);
COMMENT ON TABLE public.order_item_refund_reservations IS
  'E7: reservations partielles adossees a une attestation relais et a une intention PSP durable ;'
  ' aucune sortie de fonds ni annulation automatique lors de la reservation.';

-- La quantité réservée attend sa décision PSP : elle ne peut pas être remise
-- au client entre l'engagement du remboursement et sa confirmation/son échec.
-- Les remboursements confirmed sont déjà comptés par qty_refunded.
CREATE OR REPLACE FUNCTION public.guard_item_refund_pending_collection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_reserved integer;
BEGIN
  IF NEW.qty_collected IS NOT DISTINCT FROM OLD.qty_collected
     AND NEW.qty_refunded IS NOT DISTINCT FROM OLD.qty_refunded
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(r.quantity),0)::integer INTO v_reserved
    FROM public.order_item_refund_reservations r
   WHERE r.order_item_id=NEW.id AND r.status IN ('reserved','processing','unknown');
  IF NEW.qty_collected + NEW.qty_refunded + v_reserved > NEW.quantity THEN
    RAISE EXCEPTION 'ITEM_REFUND_PENDING_QTY_NOT_COLLECTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_item_refund_pending_collection ON public.order_items;
CREATE TRIGGER trg_guard_item_refund_pending_collection
  BEFORE UPDATE OF qty_collected, qty_refunded, quantity ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_item_refund_pending_collection();
