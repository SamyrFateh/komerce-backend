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
