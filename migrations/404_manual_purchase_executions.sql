-- @migration 404_manual_purchase_executions.sql
-- @domain    purchasing
-- @purpose   Vendeur économique réel structuré par achat physique manuel (allocation vendeur -> ligne -> quantité/montant), append-only.
-- @added-header 2026-11-12
--
-- Additif. Aucun SOI, stock, dette ni paiement n'est créé ici : c'est la trace de preuve rattachée à la
-- confirmation d'une PO manuelle (writer unique : confirmGroupedPurchaseOrder). `currency` = devise de la PO/fournisseur.

CREATE TABLE IF NOT EXISTS public.manual_purchase_executions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  purchase_line_id   uuid NULL REFERENCES public.purchase_lines(id) ON DELETE RESTRICT,
  seller_supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  seller_label       text NULL,
  channel            text NOT NULL DEFAULT 'other' CHECK (channel IN ('in_person','phone','whatsapp','email','other')),
  quantity           integer NOT NULL CHECK (quantity > 0),
  amount             numeric(18,4) NOT NULL CHECK (amount >= 0),
  currency           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  proof_ref          text NOT NULL CHECK (btrim(proof_ref) <> ''),
  proof_document_id  uuid NULL,
  variance_reason    text NULL,
  recorded_by        uuid NULL REFERENCES public.users(id),
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_manual_purchase_exec_seller
    CHECK (seller_supplier_id IS NOT NULL OR (seller_label IS NOT NULL AND btrim(seller_label) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_manual_purchase_exec_po ON public.manual_purchase_executions (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_manual_purchase_exec_line ON public.manual_purchase_executions (purchase_line_id);

CREATE OR REPLACE FUNCTION public.manual_purchase_executions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'manual_purchase_execution_immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS trg_manual_purchase_exec_immutable ON public.manual_purchase_executions;
CREATE TRIGGER trg_manual_purchase_exec_immutable
  BEFORE UPDATE OR DELETE ON public.manual_purchase_executions
  FOR EACH ROW EXECUTE FUNCTION public.manual_purchase_executions_immutable();
