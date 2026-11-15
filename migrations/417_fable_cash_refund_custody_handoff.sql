-- @migration 417_fable_cash_refund_custody_handoff.sql
-- @domain refunds
-- Fable F1/F2 #4114. Human-attested ORIGINAL PAYEE cash handoff only.
-- No provider transfer, no invented payer, no wallet fallback.
-- The actual cash handoff occurs OUTSIDE the database, before the holder confirms it.
-- An ambiguous handoff is never retried as a new disbursement.

CREATE TABLE public.local_cash_refund_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES public.local_item_refund_reservations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  holder_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  original_payer_proof_ref text NOT NULL CHECK (char_length(btrim(original_payer_proof_ref)) BETWEEN 8 AND 200),
  identity_check_proof_ref text NOT NULL CHECK (char_length(btrim(identity_check_proof_ref)) BETWEEN 8 AND 200),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','handoff_pending','settled')),
  authorized_at timestamptz NOT NULL DEFAULT now(),
  handoff_started_at timestamptz,
  settled_at timestamptz,
  CONSTRAINT cash_refund_dual_actor CHECK (holder_id <> approved_by),
  CONSTRAINT cash_refund_auth_state_chk CHECK (
    (status='approved' AND handoff_started_at IS NULL AND settled_at IS NULL) OR
    (status='handoff_pending' AND handoff_started_at IS NOT NULL AND settled_at IS NULL) OR
    (status='settled' AND handoff_started_at IS NOT NULL AND settled_at IS NOT NULL))
);
CREATE INDEX idx_local_cash_refund_auth_order ON public.local_cash_refund_authorizations(order_id);
CREATE INDEX idx_local_cash_refund_pending_custody
  ON public.local_cash_refund_authorizations(holder_id,market_id)
  WHERE status='handoff_pending';

CREATE TABLE public.local_cash_refund_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id uuid NOT NULL UNIQUE REFERENCES public.local_cash_refund_authorizations(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL UNIQUE REFERENCES public.local_item_refund_reservations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  holder_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  paid_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount_kmf numeric(14,2) NOT NULL CHECK (amount_kmf>0),
  signed_receipt_ref text NOT NULL UNIQUE CHECK (char_length(btrim(signed_receipt_ref)) BETWEEN 8 AND 200),
  payer_signature_proof_ref text NOT NULL CHECK (char_length(btrim(payer_signature_proof_ref)) BETWEEN 8 AND 200),
  witness_proof_ref text NOT NULL CHECK (char_length(btrim(witness_proof_ref)) BETWEEN 8 AND 200),
  disbursed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_refund_payer_is_holder CHECK (paid_by=holder_id)
);

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS local_cash_refund_payout_id uuid
  REFERENCES public.local_cash_refund_payouts(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_refunds_local_cash_payout_id
  ON public.refunds(local_cash_refund_payout_id)
  WHERE local_cash_refund_payout_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_cash_refund_authorization()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE v_source public.local_item_refund_reservations%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CASH_REFUND_AUTH_APPEND_ONLY' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'approved' THEN
      RAISE EXCEPTION 'CASH_REFUND_AUTH_MUST_START_APPROVED' USING ERRCODE='23514';
    END IF;
    SELECT * INTO v_source FROM public.local_item_refund_reservations WHERE id=NEW.reservation_id;
    IF v_source.id IS NULL OR v_source.order_id<>NEW.order_id OR v_source.market_id<>NEW.market_id
       OR v_source.payment_mode<>'cash_relais' OR v_source.currency<>'KMF' OR v_source.minor_unit<>0
       OR v_source.status<>'reserved' THEN
      RAISE EXCEPTION 'CASH_REFUND_INVALID_SOURCE' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=NEW.approved_by AND role='admin') THEN
      RAISE EXCEPTION 'CASH_REFUND_ADMIN_APPROVAL_REQUIRED' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users u JOIN public.relais rel ON rel.id=u.relais_id
                   WHERE u.id=NEW.holder_id AND u.role='agent_relais' AND rel.market_id=NEW.market_id) THEN
      RAISE EXCEPTION 'CASH_REFUND_HOLDER_WRONG_MARKET' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.reservation_id,NEW.order_id,NEW.market_id,NEW.holder_id,NEW.approved_by,
      NEW.original_payer_proof_ref,NEW.identity_check_proof_ref,NEW.authorized_at)
     IS DISTINCT FROM
     (OLD.id,OLD.reservation_id,OLD.order_id,OLD.market_id,OLD.holder_id,OLD.approved_by,
      OLD.original_payer_proof_ref,OLD.identity_check_proof_ref,OLD.authorized_at) THEN
    RAISE EXCEPTION 'CASH_REFUND_AUTH_PROOF_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.status='approved' AND NEW.status='handoff_pending'
    AND NEW.handoff_started_at IS NOT NULL AND NEW.settled_at IS NULL THEN
    PERFORM public.cash_custody_lock(NEW.holder_id,NULL);
    RETURN NEW;
  END IF;
  IF OLD.status='handoff_pending' AND NEW.status='settled'
    AND NEW.handoff_started_at IS NOT DISTINCT FROM OLD.handoff_started_at
    AND NEW.settled_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.local_cash_refund_payouts WHERE authorization_id=NEW.id)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'CASH_REFUND_AUTH_TRANSITION_FORBIDDEN' USING ERRCODE='23514';
END $f$;
CREATE TRIGGER trg_cash_refund_authorization_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.local_cash_refund_authorizations
FOR EACH ROW EXECUTE FUNCTION public.guard_cash_refund_authorization();

-- Keep the canonical seven-column custody view; add one real outflow.
-- All existing cash transfer writers still serialize on cash_custody_lock.
CREATE OR REPLACE VIEW public.cash_custody_movements AS
  SELECT 'COLLECTION'::text AS source, cc.id AS ref_id, NULL::uuid AS deposit_id,
         cc.collected_by AS holder_id,
         public.cash_collection_market(cc.relais_id,cc.collected_by) AS market_id,
         cc.amount_kmf::numeric AS delta_kmf, cc.confirmed_at AS occurred_at
  FROM public.cash_collections cc
  UNION ALL
  SELECT 'TRANSFER_OUT',r.id,d.id,d.agent_id,d.market_id,
         -(CASE WHEN r.kind='REVERSAL' THEN -r.amount_kmf ELSE r.amount_kmf END),r.created_at
  FROM public.cash_custody_receipts r JOIN public.cash_deposits d ON d.id=r.deposit_id
  LEFT JOIN public.cash_custody_receipts t ON t.id=r.reverses_id
  WHERE d.movement_kind='TRANSFER' AND COALESCE(t.kind,r.kind)='RECEIVED'
  UNION ALL
  SELECT 'TRANSFER_IN',r.id,d.id,d.recipient_user_id,d.market_id,
         (CASE WHEN r.kind='REVERSAL' THEN -r.amount_kmf ELSE r.amount_kmf END),r.created_at
  FROM public.cash_custody_receipts r JOIN public.cash_deposits d ON d.id=r.deposit_id
  LEFT JOIN public.cash_custody_receipts t ON t.id=r.reverses_id
  WHERE d.movement_kind='TRANSFER' AND COALESCE(t.kind,r.kind)='RECEIVED'
  UNION ALL
  SELECT 'FINAL_CLOSURE',r.id,d.id,d.agent_id,d.market_id,
         -(CASE WHEN r.kind='REVERSAL' THEN -r.amount_kmf ELSE r.amount_kmf END),r.created_at
  FROM public.cash_custody_receipts r JOIN public.cash_deposits d ON d.id=r.deposit_id
  LEFT JOIN public.cash_custody_receipts t ON t.id=r.reverses_id
  WHERE d.movement_kind='FINAL' AND COALESCE(t.kind,r.kind)='CONTROL'
  UNION ALL
  SELECT 'LOSS',l.id,l.deposit_id,l.holder_id,l.market_id,
         (CASE WHEN l.kind='LOSS' THEN -l.amount_kmf ELSE l.amount_kmf END),l.created_at
  FROM public.cash_custody_losses l
  UNION ALL
  SELECT 'CUSTOMER_REFUND',p.id,NULL::uuid,p.holder_id,p.market_id,-p.amount_kmf,p.disbursed_at
  FROM public.local_cash_refund_payouts p;
COMMENT ON VIEW public.cash_custody_movements IS
  'Single custody authority incl. verified operator-attested cash-refund outflow; no wallet or simulated cash.';

-- Pending physical handoffs reserve custody, without creating ledger entries.
-- The existing receipt/loss writers call this same assertion under the custody lock.
CREATE OR REPLACE FUNCTION public.cash_custody_assert_nonnegative(p_holder uuid, p_market uuid)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE available_kmf numeric;
BEGIN
  IF p_holder IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(delta_kmf),0) INTO available_kmf
    FROM public.cash_custody_movements
   WHERE holder_id=p_holder AND market_id IS NOT DISTINCT FROM p_market;
  SELECT available_kmf - COALESCE(SUM(r.amount_kmf),0) INTO available_kmf
    FROM public.local_cash_refund_authorizations a
    JOIN public.local_item_refund_reservations r ON r.id=a.reservation_id
   WHERE a.status='handoff_pending' AND a.holder_id=p_holder AND a.market_id=p_market;
  IF available_kmf<0 THEN
    RAISE EXCEPTION 'CASH_CUSTODY_INSUFFICIENT_AVAILABLE_BALANCE' USING ERRCODE='23514';
  END IF;
END $f$;

CREATE OR REPLACE FUNCTION public.assert_cash_refund_handoff_funded()
RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM public.cash_custody_assert_nonnegative(NEW.holder_id,NEW.market_id);
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_cash_refund_handoff_funded
AFTER UPDATE OF status ON public.local_cash_refund_authorizations
FOR EACH ROW WHEN (OLD.status='approved' AND NEW.status='handoff_pending')
EXECUTE FUNCTION public.assert_cash_refund_handoff_funded();

CREATE OR REPLACE FUNCTION public.guard_cash_refund_payout()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE a public.local_cash_refund_authorizations%ROWTYPE;
        r public.local_item_refund_reservations%ROWTYPE;
        balance_kmf numeric;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_REFUND_PAYOUT_IMMUTABLE' USING ERRCODE='23514'; END IF;
  -- Order row is locked by the service before this row. Direct SQL must not bypass it.
  PERFORM 1 FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
  SELECT * INTO a FROM public.local_cash_refund_authorizations WHERE id=NEW.authorization_id FOR UPDATE;
  SELECT * INTO r FROM public.local_item_refund_reservations WHERE id=NEW.reservation_id;
  IF a.id IS NULL OR r.id IS NULL OR a.status<>'handoff_pending' OR a.reservation_id<>r.id
     OR a.order_id<>NEW.order_id OR a.market_id<>NEW.market_id OR a.holder_id<>NEW.holder_id
     OR a.approved_by=NEW.paid_by OR NEW.paid_by<>NEW.holder_id
     OR r.order_id<>NEW.order_id OR r.market_id<>NEW.market_id
     OR r.payment_mode<>'cash_relais' OR r.currency<>'KMF' OR r.minor_unit<>0
     OR NEW.amount_kmf<>r.amount_kmf OR NEW.amount_kmf<>r.amount_minor::numeric THEN
    RAISE EXCEPTION 'CASH_REFUND_PAYOUT_INVALID_OR_UNATTESTED' USING ERRCODE='23514';
  END IF;
  PERFORM public.cash_custody_lock(NEW.holder_id,NULL);
  SELECT COALESCE(SUM(delta_kmf),0) INTO balance_kmf FROM public.cash_custody_movements
   WHERE holder_id=NEW.holder_id AND market_id=NEW.market_id;
  IF balance_kmf<NEW.amount_kmf THEN
    RAISE EXCEPTION 'CASH_REFUND_HOLDER_INSUFFICIENT_CUSTODY' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_cash_refund_payout_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.local_cash_refund_payouts
FOR EACH ROW EXECUTE FUNCTION public.guard_cash_refund_payout();

-- The entire disbursement, qty_refunded and financial journal source live
-- in one PostgreSQL transaction even for an alternate SQL caller.
CREATE OR REPLACE FUNCTION public.finalize_cash_refund_payout()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE r public.local_item_refund_reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.local_item_refund_reservations WHERE id=NEW.reservation_id;
  UPDATE public.order_items SET qty_refunded=COALESCE(qty_refunded,0)+r.quantity WHERE id=r.order_item_id;
  INSERT INTO public.refunds(order_id,amount_kmf,refund_type,refund_method,reason,initiated_by,
                             status,completed_at,local_cash_refund_payout_id)
    VALUES(r.order_id,r.amount_kmf,'cash_shortage:' || r.id::text,'cash',r.reason,NEW.paid_by,
           'completed',NEW.disbursed_at,NEW.id);
  UPDATE public.local_cash_refund_authorizations
     SET status='settled',settled_at=NEW.disbursed_at
   WHERE id=NEW.authorization_id AND status='handoff_pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_REFUND_AUTH_NOT_SETTLED' USING ERRCODE='23514'; END IF;
  PERFORM public.cash_custody_assert_nonnegative(NEW.holder_id,NEW.market_id);
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_cash_refund_payout_finalize
AFTER INSERT ON public.local_cash_refund_payouts
FOR EACH ROW EXECUTE FUNCTION public.finalize_cash_refund_payout();

-- A paid reservation stops occupying its own qty_refunded twice.
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
   AND NOT EXISTS (SELECT 1 FROM public.local_cash_refund_payouts p WHERE p.reservation_id=r.id);
 IF COALESCE(NEW.qty_collected,0)+COALESCE(NEW.qty_refunded,0)+v_local>NEW.quantity THEN
   RAISE EXCEPTION 'LOCAL_ITEM_REFUND_QTY_RESERVED_NOT_COLLECTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $f$;

-- The only permitted completion is the exact payout / order / amount.
-- The existing trigger on refunds remains in place with this replacement body.
CREATE OR REPLACE FUNCTION public.guard_legacy_refund_vs_local_obligation()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE p public.local_cash_refund_payouts%ROWTYPE;
        r public.local_item_refund_reservations%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
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

-- Enforce a full order-wide rail exclusion (including after local settlement).
CREATE OR REPLACE FUNCTION public.guard_psp_refund_vs_local_obligation()
RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM 1 FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.local_item_refund_reservations WHERE order_id=NEW.order_id) THEN
    RAISE EXCEPTION 'ITEM_REFUND_LOCAL_CROSS_RAIL_UNRESOLVED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION public.guard_completed_cash_refund_immutable()
RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.local_cash_refund_payout_id IS NOT NULL THEN
      RAISE EXCEPTION 'CASH_REFUND_COMPLETION_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.local_cash_refund_payout_id IS NOT NULL
      OR NEW.local_cash_refund_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'CASH_REFUND_COMPLETION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_completed_cash_refund_immutable
BEFORE UPDATE OR DELETE ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.guard_completed_cash_refund_immutable();

COMMENT ON TABLE public.local_cash_refund_authorizations IS
  'Two separate actors; approved or handoff_pending is NOT paid. Original payer evidence is independently reviewed offline.';
COMMENT ON TABLE public.local_cash_refund_payouts IS
  'Cash physically handed to identified original payer with signed receipt. Custody ledger outflow and refund completion are atomic.';
