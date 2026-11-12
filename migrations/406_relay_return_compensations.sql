-- @migration 406_relay_return_compensations.sql
-- @domain    orders,wallet,refunds
-- @purpose   Décision de compensation SAV après remise, rattachée au dossier de retour (dispute product_return).
-- @added-header 2026-11-12
--
-- Append-only. Une seule décision par dossier. Une ligne n'existe que lorsque le mouvement canonique est CONFIRMÉ
-- (crédit wallet commité dans la même transaction). Aucun stock, aucune vendabilité : le produit repris reste gelé.

CREATE TABLE IF NOT EXISTS public.relay_return_compensations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            uuid NOT NULL UNIQUE REFERENCES public.disputes(id),
  order_id              uuid NOT NULL REFERENCES public.orders(id),
  payer_user_id         uuid NOT NULL REFERENCES public.users(id),
  movement              text NOT NULL CHECK (movement IN ('wallet_credit','ledger_refund','reship')),
  amount                numeric(18,4) NOT NULL CHECK (amount > 0),
  currency              text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason                text NOT NULL CHECK (length(btrim(reason)) >= 10),
  scale_code            text NULL,
  scale_default_amount  numeric(18,4) NULL,
  wallet_transaction_id uuid NULL REFERENCES public.wallet_transactions(id),
  decided_by            uuid NOT NULL REFERENCES public.users(id),
  decided_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_return_compensation_wallet_ref
    CHECK (movement <> 'wallet_credit' OR wallet_transaction_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION public.relay_return_compensations_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'relay_return_compensation_immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS trg_relay_return_compensations_immutable ON public.relay_return_compensations;
CREATE TRIGGER trg_relay_return_compensations_immutable
  BEFORE UPDATE OR DELETE ON public.relay_return_compensations
  FOR EACH ROW EXECUTE FUNCTION public.relay_return_compensations_immutable();
