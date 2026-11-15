-- @migration 418_fable_manual_mobile_money_refund.sql
-- @domain refunds
-- Manual Mobile Money handoff. No connection to an operator or automatic payout.
CREATE TABLE public.local_mobile_refund_handoffs (
  reservation_id uuid PRIMARY KEY REFERENCES public.local_item_refund_reservations(id) ON DELETE RESTRICT,
  approved_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  payer_fingerprint text NOT NULL CHECK (payer_fingerprint ~ '^[a-f0-9]{64}$'),
  original_payer_proof_ref text NOT NULL CHECK (length(btrim(original_payer_proof_ref)) BETWEEN 8 AND 200),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','transfer_pending','settled')),
  started_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  transfer_ref text,
  transfer_proof_ref text,
  settled_amount_minor bigint,
  settled_currency text,
  settled_payee_fingerprint text,
  CHECK (
    (status <> 'settled' AND settled_amount_minor IS NULL AND settled_currency IS NULL AND settled_payee_fingerprint IS NULL)
    OR (status='settled' AND settled_amount_minor IS NOT NULL AND settled_currency IS NOT NULL AND settled_payee_fingerprint IS NOT NULL)
  ),
  CHECK (approved_by <> operator_id AND confirmed_by IS DISTINCT FROM operator_id),
  CHECK (
    (status='approved' AND started_at IS NULL AND confirmed_at IS NULL AND confirmed_by IS NULL AND transfer_ref IS NULL AND transfer_proof_ref IS NULL) OR
    (status='transfer_pending' AND started_at IS NOT NULL AND confirmed_at IS NULL AND confirmed_by IS NULL AND transfer_ref IS NULL AND transfer_proof_ref IS NULL) OR
    (status='settled' AND started_at IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND
      length(btrim(COALESCE(transfer_ref,''))) BETWEEN 8 AND 200 AND
      length(btrim(COALESCE(transfer_proof_ref,''))) BETWEEN 8 AND 200)
  )
);
CREATE UNIQUE INDEX ux_local_mobile_refund_transfer
  ON public.local_mobile_refund_handoffs(provider, lower(btrim(transfer_ref)))
  WHERE transfer_ref IS NOT NULL;

ALTER TABLE public.refunds ADD COLUMN local_mobile_refund_handoff_id uuid
  UNIQUE REFERENCES public.local_mobile_refund_handoffs(reservation_id) ON DELETE RESTRICT;

CREATE FUNCTION public.guard_local_mobile_refund_handoff()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE r public.local_item_refund_reservations%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'LOCAL_MOBILE_REFUND_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  SELECT * INTO r FROM public.local_item_refund_reservations WHERE id=NEW.reservation_id;
  PERFORM 1 FROM public.orders WHERE id=r.order_id AND payment_status='paid' FOR UPDATE;
  IF NOT FOUND OR r.payment_mode<>'mobile_money' OR NOT EXISTS (
    SELECT 1 FROM public.mobile_money_transactions t
     WHERE t.id::text=r.capture_ref AND t.order_id=r.order_id AND t.market_id=r.market_id
       AND t.provider=NEW.provider AND t.status='succeeded'
       AND t.currency=r.currency AND t.minor_unit=r.minor_unit AND t.amount_minor>=r.amount_minor
       AND NULLIF(btrim(t.external_transaction_id),'') IS NOT NULL
       AND lower(btrim(t.external_transaction_id)) IS DISTINCT FROM lower(btrim(NEW.transfer_ref))
  ) THEN
    RAISE EXCEPTION 'LOCAL_MOBILE_REFUND_CAPTURE_INVALID' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status='approved' AND
       (SELECT COUNT(*) FROM public.users WHERE role='admin' AND id IN (NEW.approved_by,NEW.operator_id))=2
    THEN RETURN NEW; END IF;
  ELSE
    IF (NEW.reservation_id,NEW.approved_by,NEW.operator_id,NEW.provider,NEW.payer_fingerprint,NEW.original_payer_proof_ref)
       IS DISTINCT FROM
       (OLD.reservation_id,OLD.approved_by,OLD.operator_id,OLD.provider,OLD.payer_fingerprint,OLD.original_payer_proof_ref)
    THEN RAISE EXCEPTION 'LOCAL_MOBILE_REFUND_APPROVAL_IMMUTABLE' USING ERRCODE='23514'; END IF;
    IF OLD.status='approved' AND NEW.status='transfer_pending' THEN RETURN NEW; END IF;
    IF OLD.status='transfer_pending' AND NEW.status='settled' AND NEW.started_at=OLD.started_at
       AND NEW.transfer_proof_ref<>NEW.original_payer_proof_ref
       AND NEW.settled_amount_minor=r.amount_minor AND NEW.settled_currency=r.currency
       AND NEW.settled_payee_fingerprint=NEW.payer_fingerprint
       AND EXISTS (SELECT 1 FROM public.users WHERE id=NEW.confirmed_by AND role='admin')
    THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'LOCAL_MOBILE_REFUND_TRANSITION_FORBIDDEN' USING ERRCODE='23514';
END $f$;
CREATE TRIGGER trg_local_mobile_refund_handoff_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.local_mobile_refund_handoffs
FOR EACH ROW EXECUTE FUNCTION public.guard_local_mobile_refund_handoff();

CREATE OR REPLACE FUNCTION public.guard_local_item_refund_pending_collection()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE v_local integer;
BEGIN
 IF NEW.qty_collected IS NOT DISTINCT FROM OLD.qty_collected
    AND NEW.qty_refunded IS NOT DISTINCT FROM OLD.qty_refunded
    AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity THEN RETURN NEW; END IF;
 SELECT COALESCE(SUM(r.quantity),0)::integer INTO v_local
 FROM public.local_item_refund_reservations r
 WHERE r.order_item_id=NEW.id AND r.status='reserved'
   AND NOT EXISTS (SELECT 1 FROM public.local_cash_refund_payouts p WHERE p.reservation_id=r.id)
   AND NOT EXISTS (SELECT 1 FROM public.local_mobile_refund_handoffs h WHERE h.reservation_id=r.id AND h.status='settled');
 IF COALESCE(NEW.qty_collected,0)+COALESCE(NEW.qty_refunded,0)+v_local>NEW.quantity THEN
   RAISE EXCEPTION 'LOCAL_ITEM_REFUND_QTY_RESERVED_NOT_COLLECTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION public.guard_legacy_refund_vs_local_obligation()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE p public.local_cash_refund_payouts%ROWTYPE;
        r public.local_item_refund_reservations%ROWTYPE;
        h public.local_mobile_refund_handoffs%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
  IF NEW.local_mobile_refund_handoff_id IS NOT NULL THEN
    SELECT * INTO h FROM public.local_mobile_refund_handoffs WHERE reservation_id=NEW.local_mobile_refund_handoff_id;
    SELECT * INTO r FROM public.local_item_refund_reservations WHERE id=h.reservation_id;
    IF h.status IS DISTINCT FROM 'settled' OR r.order_id IS DISTINCT FROM NEW.order_id
       OR r.amount_kmf IS DISTINCT FROM NEW.amount_kmf
       OR NEW.refund_type IS DISTINCT FROM ('mobile_shortage:' || r.id::text)
       OR NEW.refund_method IS DISTINCT FROM 'mobile_money' OR NEW.status IS DISTINCT FROM 'completed'
       OR NEW.completed_at IS DISTINCT FROM h.confirmed_at OR NEW.initiated_by IS DISTINCT FROM h.confirmed_by
       OR NEW.local_cash_refund_payout_id IS NOT NULL OR NEW.store_credit_id IS NOT NULL OR NEW.stripe_refund_id IS NOT NULL
    THEN RAISE EXCEPTION 'LOCAL_MOBILE_REFUND_NO_VERIFIED_TRANSFER' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.local_cash_refund_payout_id IS NOT NULL THEN
    SELECT * INTO p FROM public.local_cash_refund_payouts WHERE id=NEW.local_cash_refund_payout_id;
    IF p.id IS NULL THEN RAISE EXCEPTION 'CASH_REFUND_NO_PAYOUT' USING ERRCODE='23514'; END IF;
    SELECT * INTO r FROM public.local_item_refund_reservations WHERE id=p.reservation_id;
    IF r.id IS NULL OR r.order_id<>NEW.order_id OR p.order_id<>NEW.order_id
      OR p.amount_kmf<>NEW.amount_kmf OR r.amount_kmf<>NEW.amount_kmf
      OR NEW.refund_type<>('cash_shortage:' || r.id::text)
      OR NEW.refund_method<>'cash' OR NEW.status<>'completed' OR NEW.completed_at IS NULL
      OR NEW.store_credit_id IS NOT NULL OR NEW.stripe_refund_id IS NOT NULL
    THEN RAISE EXCEPTION 'CASH_REFUND_NO_CONFIRMED_HANDED_MONEY' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.local_item_refund_reservations WHERE order_id=NEW.order_id) THEN
    RAISE EXCEPTION 'REFUND_LOCAL_OBLIGATION_UNRESOLVED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION public.guard_completed_cash_refund_immutable()
RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF TG_OP='DELETE' THEN
    IF (OLD.local_cash_refund_payout_id IS NOT NULL OR OLD.local_mobile_refund_handoff_id IS NOT NULL) THEN
      RAISE EXCEPTION 'CASH_REFUND_COMPLETION_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (OLD.local_cash_refund_payout_id IS NOT NULL OR OLD.local_mobile_refund_handoff_id IS NOT NULL)
      OR (NEW.local_cash_refund_payout_id IS NOT NULL OR NEW.local_mobile_refund_handoff_id IS NOT NULL) THEN
    RAISE EXCEPTION 'CASH_REFUND_COMPLETION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $f$;

CREATE FUNCTION public.finalize_local_mobile_refund_handoff()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE r public.local_item_refund_reservations%ROWTYPE;
BEGIN
  SELECT * INTO STRICT r FROM public.local_item_refund_reservations WHERE id=NEW.reservation_id;
  UPDATE public.order_items SET qty_refunded=COALESCE(qty_refunded,0)+r.quantity WHERE id=r.order_item_id;
  INSERT INTO public.refunds(order_id,amount_kmf,refund_type,refund_method,reason,initiated_by,
                             status,completed_at,local_mobile_refund_handoff_id)
    VALUES(r.order_id,r.amount_kmf,'mobile_shortage:' || r.id::text,'mobile_money',r.reason,NEW.confirmed_by,
           'completed',NEW.confirmed_at,NEW.reservation_id);
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_finalize_local_mobile_refund_handoff
AFTER UPDATE OF status ON public.local_mobile_refund_handoffs
FOR EACH ROW WHEN (OLD.status='transfer_pending' AND NEW.status='settled')
EXECUTE FUNCTION public.finalize_local_mobile_refund_handoff();
