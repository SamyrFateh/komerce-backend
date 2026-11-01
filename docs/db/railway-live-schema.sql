--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: air_eligibility_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.air_eligibility_status AS ENUM (
    'PENDING_REVIEW',
    'ELIGIBLE',
    'EXCLUDED'
);


--
-- Name: basket_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.basket_type AS ENUM (
    'personal',
    'shared',
    'gift'
);


--
-- Name: ceremony_order_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ceremony_order_type AS ENUM (
    'ready_made',
    'fabric_only',
    'custom_from_fabric'
);


--
-- Name: customs_shipment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.customs_shipment_status AS ENUM (
    'pending',
    'declared',
    'confirmed'
);


--
-- Name: inquiry_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.inquiry_status AS ENUM (
    'sent',
    'answered',
    'accepted',
    'declined'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'confirmed',
    'ordered',
    'preparation',
    'shipped',
    'in_transit',
    'available',
    'collected',
    'cancelled',
    'refunded'
);


--
-- Name: parcel_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.parcel_status AS ENUM (
    'draft',
    'preparation',
    'shipped',
    'in_transit',
    'arrived',
    'available',
    'collected',
    'cancelled'
);


--
-- Name: payment_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_mode AS ENUM (
    'stripe_eur',
    'cash_relais',
    'mixed_shared_cart_cash',
    'paypal_eur',
    'mobile_money'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'paid',
    'failed',
    'refunded',
    'partially_paid'
);


--
-- Name: physical_offer_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.physical_offer_status AS ENUM (
    'draft',
    'active',
    'suspended'
);


--
-- Name: provider_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.provider_status AS ENUM (
    'pending',
    'active',
    'suspended'
);


--
-- Name: scan_step; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.scan_step AS ENUM (
    'preparation',
    'hub_preparation',
    'shipped',
    'in_transit',
    'relais_received',
    'collected'
);


--
-- Name: service_listing_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_listing_status AS ENUM (
    'draft',
    'active',
    'suspended'
);


--
-- Name: shared_cart_contribution_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shared_cart_contribution_status AS ENUM (
    'pending',
    'paid',
    'failed',
    'refunded',
    'cancelled',
    'pending_cash'
);


--
-- Name: shared_cart_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shared_cart_status AS ENUM (
    'open',
    'closed',
    'cancelled'
);


--
-- Name: sourcing_observation_grain; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sourcing_observation_grain AS ENUM (
    'product',
    'offer',
    'unit'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'client',
    'admin',
    'agent_relais',
    'agent_hub',
    'agent_transitaire',
    'sourcing',
    'market_operator',
    'finance'
);


--
-- Name: audit_customs_shipment_financial_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_customs_shipment_financial_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_fin JSONB;
  new_fin JSONB;
BEGIN
  old_fin := jsonb_build_object('customs_paid_kmf', OLD.customs_paid_kmf,
    'freight_kmf', OLD.freight_kmf,
    'allocation_method', OLD.allocation_method,
    'allocation_config', OLD.allocation_config);
  new_fin := jsonb_build_object('customs_paid_kmf', NEW.customs_paid_kmf,
    'freight_kmf', NEW.freight_kmf,
    'allocation_method', NEW.allocation_method,
    'allocation_config', NEW.allocation_config);
  IF old_fin IS DISTINCT FROM new_fin THEN
    INSERT INTO customs_shipment_financial_audit
      (shipment_id, actor_id, reason, old_values, new_values)
    VALUES (NEW.id,
      NULLIF(current_setting('komerce.actor_id', true), ''),
      NULLIF(current_setting('komerce.change_reason', true), ''),
      old_fin, new_fin);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: auto_unsold(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_unsold() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_count INTEGER := 0;
  v_rec   RECORD;
BEGIN
  FOR v_rec IN
    SELECT o.id, o.user_id, o.total_kmf
    FROM orders o
    WHERE o.status = 'available'
      AND o.available_at < NOW() - INTERVAL '14 days'
      AND o.unsold_at IS NULL
  LOOP
    UPDATE orders SET
      unsold_at        = NOW(),
      unsold_price_kmf = ROUND(total_kmf * 0.75)
    WHERE id = v_rec.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


--
-- Name: cash_alloc_enforce(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_alloc_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  dep cash_deposits%ROWTYPE;
  col cash_collections%ROWTYPE;
  col_market uuid;
  dep_total numeric;
  col_total numeric;
BEGIN
  SELECT * INTO dep FROM cash_deposits WHERE id = NEW.deposit_id FOR UPDATE;
  SELECT * INTO col FROM cash_collections WHERE id = NEW.collection_id FOR UPDATE;
  col_market := cash_collection_market(col.relais_id, col.collected_by);

  IF dep.market_id IS NULL OR col_market IS NULL
     OR dep.market_id <> col_market OR NEW.market_id <> dep.market_id THEN
    RAISE EXCEPTION 'cash_deposit_allocations: Market incohérent (remise %, encaissement %, ligne %)',
      dep.market_id, col_market, NEW.market_id USING ERRCODE = 'check_violation';
  END IF;
  IF dep.agent_id <> col.collected_by THEN
    RAISE EXCEPTION 'cash_deposit_allocations: la remise % n''appartient pas à l''agent de l''encaissement', dep.id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount_kmf), 0) INTO dep_total
    FROM cash_deposit_allocations WHERE deposit_id = NEW.deposit_id;
  IF dep_total > dep.amount_kmf THEN
    RAISE EXCEPTION 'cash_deposit_allocations: Σ allocations (%) > montant de la remise (%)', dep_total, dep.amount_kmf
      USING ERRCODE = 'check_violation';
  END IF;

  IF dep.status IN ('pending', 'verified') THEN
    SELECT COALESCE(SUM(a.amount_kmf), 0) INTO col_total
      FROM cash_deposit_allocations a
      JOIN cash_deposits d ON d.id = a.deposit_id
     WHERE a.collection_id = NEW.collection_id AND d.status IN ('pending', 'verified');
    IF col_total > col.amount_kmf THEN
      RAISE EXCEPTION 'cash_deposit_allocations: Σ allocations vivantes (%) > encaissement (%) — double comptage', col_total, col.amount_kmf
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: cash_allocate_fifo(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_allocate_fifo(p_deposit_id uuid, p_source text) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
  dep cash_deposits%ROWTYPE;
  c record;
  left_kmf numeric;
  take numeric;
  allocated numeric := 0;
BEGIN
  SELECT * INTO dep FROM cash_deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND OR dep.market_id IS NULL THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM cash_deposit_allocations WHERE deposit_id = dep.id) THEN
    RETURN 0;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cash_alloc:' || dep.agent_id::text));
  left_kmf := dep.amount_kmf;

  FOR c IN
    SELECT cc.id, cc.amount_kmf - COALESCE((
             SELECT SUM(a.amount_kmf)
               FROM cash_deposit_allocations a JOIN cash_deposits d ON d.id = a.deposit_id
              WHERE a.collection_id = cc.id AND d.status IN ('pending', 'verified')), 0) AS remaining
      FROM cash_collections cc
     WHERE cc.collected_by = dep.agent_id
       AND cash_collection_market(cc.relais_id, cc.collected_by) = dep.market_id
     ORDER BY cc.confirmed_at, cc.id
       FOR UPDATE OF cc
  LOOP
    EXIT WHEN left_kmf <= 0;
    CONTINUE WHEN c.remaining <= 0;
    take := LEAST(c.remaining, left_kmf);
    INSERT INTO cash_deposit_allocations
      (deposit_id, collection_id, market_id, amount_kmf, allocation_basis, allocation_source)
    VALUES (dep.id, c.id, dep.market_id, take, 'RECONSTRUCTED', p_source);
    left_kmf := left_kmf - take;
    allocated := allocated + take;
  END LOOP;
  RETURN allocated;
END
$$;


--
-- Name: cash_collection_market(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_collection_market(p_relais_id uuid, p_collected_by uuid) RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(
    (SELECT r.market_id FROM relais r WHERE r.id = p_relais_id),
    (SELECT r.market_id FROM users u JOIN relais r ON r.id = u.relais_id WHERE u.id = p_collected_by)
  )
$$;


--
-- Name: cash_custody_assert_nonnegative(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_custody_assert_nonnegative(p_holder uuid, p_market uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  bal numeric;
BEGIN
  IF p_holder IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(delta_kmf), 0) INTO bal
    FROM cash_custody_movements WHERE holder_id = p_holder AND market_id IS NOT DISTINCT FROM p_market;
  IF bal < 0 THEN
    RAISE EXCEPTION 'cash_custody: solde négatif interdit pour % (Market %) : %', p_holder, p_market, bal
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;


--
-- Name: cash_custody_authorized(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_custody_authorized(p_user uuid, p_market uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM market_operating_assignments a
      JOIN assignment_memberships am ON am.assignment_id = a.id AND am.status = 'ACTIVE'
      JOIN membership_capabilities mc ON mc.membership_id = am.id
           AND mc.capability = 'cash.custody.receive' AND mc.revoked_at IS NULL
     WHERE a.market_id = p_market AND a.status = 'ACTIVE' AND am.user_id = p_user)
$$;


--
-- Name: cash_custody_expected_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_custody_expected_status(p_deposit_id uuid) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cash_custody_receipts r WHERE r.deposit_id = d.id AND r.kind = 'REFUSED') THEN 'disputed'
    WHEN d.movement_kind = 'TRANSFER' THEN
      CASE WHEN EXISTS (SELECT 1 FROM cash_custody_receipts r WHERE r.deposit_id = d.id AND r.kind = 'RECEIVED') THEN 'verified' ELSE 'pending' END
    ELSE
      COALESCE((SELECT CASE WHEN r.amount_kmf > 0 THEN 'verified' ELSE 'disputed' END
                  FROM cash_custody_receipts r WHERE r.deposit_id = d.id AND r.kind = 'CONTROL'), 'pending')
  END
  FROM cash_deposits d WHERE d.id = p_deposit_id
$$;


--
-- Name: cash_custody_lock(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_custody_lock(p_a uuid, p_b uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  k text;
BEGIN
  FOR k IN SELECT DISTINCT x FROM unnest(ARRAY[p_a::text, p_b::text]) AS x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtext('cash_hold:' || k));
  END LOOP;
END
$$;


--
-- Name: cash_custody_losses_after(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_custody_losses_after() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM cash_custody_assert_nonnegative(NEW.holder_id, NEW.market_id);
  RETURN NEW;
END
$$;


--
-- Name: cash_custody_losses_enforce(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_custody_losses_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  tgt cash_custody_losses%ROWTYPE;
  reversed numeric;
BEGIN
  PERFORM cash_custody_lock(NEW.holder_id, NULL);
  IF NEW.kind = 'LOSS_REVERSAL' THEN
    SELECT * INTO tgt FROM cash_custody_losses WHERE id = NEW.reverses_id FOR UPDATE;
    IF NOT FOUND OR tgt.kind <> 'LOSS' OR tgt.holder_id <> NEW.holder_id OR tgt.market_id <> NEW.market_id THEN
      RAISE EXCEPTION 'cash_custody_losses: contre-écriture d''une perte du même détenteur et Market uniquement' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM(x.amount_kmf), 0) INTO reversed FROM cash_custody_losses x WHERE x.reverses_id = tgt.id;
    IF NEW.amount_kmf > tgt.amount_kmf - reversed THEN
      RAISE EXCEPTION 'cash_custody_losses: contre-écriture (%) > reste de la perte (%)', NEW.amount_kmf, tgt.amount_kmf - reversed USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: cash_custody_receipts_after(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_custody_receipts_after() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  dep cash_deposits%ROWTYPE;
  expected text;
BEGIN
  SELECT * INTO dep FROM cash_deposits WHERE id = NEW.deposit_id;
  expected := cash_custody_expected_status(dep.id);
  IF expected IS DISTINCT FROM dep.status THEN
    UPDATE cash_deposits SET status = expected, verified_by = NEW.actor_id, verified_at = now() WHERE id = dep.id;
  END IF;
  PERFORM cash_custody_assert_nonnegative(dep.agent_id, dep.market_id);
  PERFORM cash_custody_assert_nonnegative(dep.recipient_user_id, dep.market_id);
  RETURN NEW;
END
$$;


--
-- Name: cash_custody_receipts_enforce(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_custody_receipts_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  dep cash_deposits%ROWTYPE;
  rec cash_custody_receipts%ROWTYPE;
  tgt cash_custody_receipts%ROWTYPE;
  ctl cash_custody_receipts%ROWTYPE;
  reversed numeric;
  net_recv numeric;
  ctl_net numeric;
BEGIN
  SELECT * INTO dep FROM cash_deposits WHERE id = NEW.deposit_id FOR UPDATE;
  IF NOT FOUND OR dep.movement_kind = 'LEGACY' THEN
    RAISE EXCEPTION 'cash_custody_receipts: remise inconnue ou historique (aucune réception possible)' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM cash_custody_lock(dep.agent_id, dep.recipient_user_id);
  NEW.market_id := dep.market_id;

  IF NEW.kind IN ('RECEIVED', 'REFUSED') THEN
    IF dep.status <> 'pending' THEN
      RAISE EXCEPTION 'cash_custody_receipts: remise déjà résolue (%)', dep.status USING ERRCODE = 'check_violation';
    END IF;
    IF dep.movement_kind = 'TRANSFER' THEN
      IF NEW.actor_id <> dep.recipient_user_id THEN
        RAISE EXCEPTION 'cash_custody_receipts: seul le destinataire désigné reçoit ou refuse' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.actor_id = dep.agent_id OR NOT cash_custody_authorized(NEW.actor_id, dep.market_id) THEN
      RAISE EXCEPTION 'cash_custody_receipts: réception finale par un tiers habilité, distinct du remettant' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'RECEIVED' THEN
      IF NEW.received_currency IS NOT NULL AND NEW.received_currency <> dep.declared_currency THEN
        RAISE EXCEPTION 'cash_custody_receipts: devise figée % (reçu en %)', dep.declared_currency, NEW.received_currency USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.received_amount > dep.declared_amount THEN
        RAISE EXCEPTION 'cash_custody_receipts: reçu (%) > annoncé (%)', NEW.received_amount, dep.declared_amount USING ERRCODE = 'check_violation';
      END IF;
      NEW.received_currency := dep.declared_currency;
      NEW.fx_rate_to_kmf := dep.fx_rate_to_kmf;
      NEW.amount_kmf := CASE WHEN NEW.received_amount = dep.declared_amount THEN dep.amount_kmf
                             ELSE round(NEW.received_amount * dep.fx_rate_to_kmf, 2) END;
      IF NEW.amount_kmf > dep.amount_kmf OR NEW.amount_kmf <= 0 THEN
        RAISE EXCEPTION 'cash_custody_receipts: montant reçu en KMF hors bornes' USING ERRCODE = 'check_violation';
      END IF;
      IF dep.movement_kind = 'FINAL' AND char_length(btrim(COALESCE(NEW.proof_ref, ''))) < 3 THEN
        RAISE EXCEPTION 'cash_custody_receipts: preuve (référence) requise pour une réception finale' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF NEW.kind = 'CONTROL' THEN
    IF dep.movement_kind <> 'FINAL' THEN
      RAISE EXCEPTION 'cash_custody_receipts: seul un transfert final se contrôle' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO rec FROM cash_custody_receipts WHERE deposit_id = dep.id AND kind = 'RECEIVED';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cash_custody_receipts: aucune réception finale à contrôler' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actor_id = dep.agent_id OR NEW.actor_id = rec.actor_id THEN
      RAISE EXCEPTION 'cash_custody_receipts: le contrôle exige un acteur distinct du remettant et du receveur' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM(x.amount_kmf), 0) INTO reversed FROM cash_custody_receipts x WHERE x.reverses_id = rec.id;
    net_recv := rec.amount_kmf - reversed;
    IF NEW.amount_kmf > net_recv THEN
      RAISE EXCEPTION 'cash_custody_receipts: contrôlé (%) > reçu net (%)', NEW.amount_kmf, net_recv USING ERRCODE = 'check_violation';
    END IF;
  ELSE -- REVERSAL
    SELECT * INTO tgt FROM cash_custody_receipts WHERE id = NEW.reverses_id FOR UPDATE;
    IF NOT FOUND OR tgt.deposit_id <> dep.id OR tgt.kind NOT IN ('RECEIVED', 'CONTROL') THEN
      RAISE EXCEPTION 'cash_custody_receipts: contre-écriture d''une réception ou d''un contrôle de la même remise uniquement' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM(x.amount_kmf), 0) INTO reversed FROM cash_custody_receipts x WHERE x.reverses_id = tgt.id;
    IF NEW.amount_kmf > tgt.amount_kmf - reversed THEN
      RAISE EXCEPTION 'cash_custody_receipts: contre-écriture (%) > reste de la cible (%)', NEW.amount_kmf, tgt.amount_kmf - reversed USING ERRCODE = 'check_violation';
    END IF;
    IF tgt.kind = 'RECEIVED' AND dep.movement_kind = 'FINAL' THEN
      SELECT * INTO ctl FROM cash_custody_receipts WHERE deposit_id = dep.id AND kind = 'CONTROL';
      IF FOUND THEN
        SELECT ctl.amount_kmf - COALESCE(SUM(x.amount_kmf), 0) INTO ctl_net FROM cash_custody_receipts x WHERE x.reverses_id = ctl.id;
        IF tgt.amount_kmf - reversed - NEW.amount_kmf < ctl_net THEN
          RAISE EXCEPTION 'cash_custody_receipts: contre-passer d''abord le contrôle (reçu net < contrôlé)' USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: cash_deposits_custody_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_deposits_custody_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  rel_market uuid;
  dest market_cash_destinations%ROWTYPE;
  legacy cash_deposits%ROWTYPE;
  regularized numeric;
BEGIN
  IF NEW.movement_kind = 'LEGACY' THEN RETURN NEW; END IF;
  IF NEW.market_id IS NULL THEN
    RAISE EXCEPTION 'cash_deposits: Market requis pour un transfert de garde' USING ERRCODE = 'check_violation';
  END IF;
  SELECT r.market_id INTO rel_market FROM users u JOIN relais r ON r.id = u.relais_id WHERE u.id = NEW.agent_id;
  IF rel_market IS NULL THEN
    IF NOT cash_custody_authorized(NEW.agent_id, NEW.market_id) THEN
      RAISE EXCEPTION 'cash_deposits: le remettant n''appartient pas à ce Market (ni relais, ni habilité)' USING ERRCODE = 'check_violation';
    END IF;
    NEW.market_id_source := 'DERIVED_MEMBERSHIP';
  END IF;
  IF NEW.movement_kind = 'TRANSFER' THEN
    IF NOT cash_custody_authorized(NEW.recipient_user_id, NEW.market_id) THEN
      RAISE EXCEPTION 'cash_deposits: destinataire non habilité à recevoir des fonds dans ce Market' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO dest FROM market_cash_destinations WHERE id = NEW.destination_id;
    IF NOT FOUND OR dest.market_id <> NEW.market_id OR dest.status <> 'ACTIVE' OR dest.currency <> NEW.declared_currency THEN
      RAISE EXCEPTION 'cash_deposits: destination finale absente, inactive, hors Market ou de devise différente' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.regularizes_deposit_id IS NOT NULL THEN
    SELECT * INTO legacy FROM cash_deposits WHERE id = NEW.regularizes_deposit_id FOR UPDATE;
    IF NOT FOUND OR legacy.movement_kind <> 'LEGACY' OR legacy.status <> 'verified'
       OR legacy.agent_id <> NEW.agent_id OR legacy.market_id IS DISTINCT FROM NEW.market_id THEN
      RAISE EXCEPTION 'cash_deposits: régularisation possible seulement d''une remise historique vérifiée du même agent et Market' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM(amount_kmf), 0) INTO regularized
      FROM cash_deposits WHERE regularizes_deposit_id = legacy.id AND status <> 'disputed';
    IF regularized + NEW.amount_kmf > legacy.amount_kmf THEN
      RAISE EXCEPTION 'cash_deposits: Σ régularisations (% + %) > remise historique (%)', regularized, NEW.amount_kmf, legacy.amount_kmf
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: cash_deposits_derive_market(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_deposits_derive_market() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  derived uuid;
BEGIN
  SELECT r.market_id INTO derived
    FROM users u JOIN relais r ON r.id = u.relais_id
   WHERE u.id = NEW.agent_id;
  IF NEW.market_id IS NOT NULL AND derived IS NOT NULL AND NEW.market_id <> derived THEN
    RAISE EXCEPTION 'cash_deposits: market_id % incohérent avec le Market de l''agent %', NEW.market_id, derived
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.market_id := COALESCE(derived, NEW.market_id);
  NEW.market_id_source := CASE WHEN NEW.market_id IS NULL THEN 'NONE' ELSE 'DERIVED_RELAIS' END;
  RETURN NEW;
END
$$;


--
-- Name: cash_deposits_guard_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_deposits_guard_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  r record;
  col_amount numeric;
  live_total numeric;
BEGIN
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id
     OR NEW.amount_kmf IS DISTINCT FROM OLD.amount_kmf
     OR NEW.deposit_ref IS DISTINCT FROM OLD.deposit_ref
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.movement_kind IS DISTINCT FROM OLD.movement_kind
     OR NEW.declared_amount IS DISTINCT FROM OLD.declared_amount
     OR NEW.declared_currency IS DISTINCT FROM OLD.declared_currency
     OR NEW.fx_rate_to_kmf IS DISTINCT FROM OLD.fx_rate_to_kmf
     OR NEW.fx_source IS DISTINCT FROM OLD.fx_source
     OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
     OR NEW.destination_id IS DISTINCT FROM OLD.destination_id
     OR NEW.regularizes_deposit_id IS DISTINCT FROM OLD.regularizes_deposit_id
     OR (OLD.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM OLD.market_id) THEN
    RAISE EXCEPTION 'cash_deposits: champs d''origine immuables (agent, montant, devise, référence, Market, cible)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending' THEN
      RAISE EXCEPTION 'cash_deposits: retour à pending interdit (%→pending)', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.movement_kind <> 'LEGACY' AND NEW.status IS DISTINCT FROM cash_custody_expected_status(OLD.id) THEN
      RAISE EXCEPTION 'cash_deposits: le statut d''un transfert de garde découle des seules réceptions (attendu %)',
        cash_custody_expected_status(OLD.id) USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'disputed' AND NEW.status IN ('pending', 'verified') THEN
      FOR r IN SELECT collection_id, amount_kmf FROM cash_deposit_allocations WHERE deposit_id = OLD.id LOOP
        SELECT amount_kmf INTO col_amount FROM cash_collections WHERE id = r.collection_id FOR UPDATE;
        SELECT COALESCE(SUM(a.amount_kmf), 0) INTO live_total
          FROM cash_deposit_allocations a
          JOIN cash_deposits d ON d.id = a.deposit_id
         WHERE a.collection_id = r.collection_id AND d.status IN ('pending', 'verified') AND d.id <> OLD.id;
        IF live_total + r.amount_kmf > col_amount THEN
          RAISE EXCEPTION 'cash_deposits: réactivation de % refusée — double comptage sur l''encaissement % (% + % > %)',
            OLD.id, r.collection_id, live_total, r.amount_kmf, col_amount
            USING ERRCODE = 'check_violation';
        END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: cash_ledger_backfill_legacy(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_ledger_backfill_legacy() RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  d record;
  lines bigint := 0;
  before_n bigint;
  after_n bigint;
  legacy_ids uuid[];
BEGIN
  -- Idempotence réelle : seules les remises jamais traitées (market_id_source NULL, donc
  -- antérieures à 287) sont reconstruites ; une remise créée ensuite passe par le service.
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO legacy_ids
    FROM cash_deposits WHERE market_id_source IS NULL;

  UPDATE cash_deposits cd
     SET market_id = r.market_id, market_id_source = 'DERIVED_RELAIS'
    FROM users u JOIN relais r ON r.id = u.relais_id
   WHERE u.id = cd.agent_id AND cd.market_id IS NULL AND r.market_id IS NOT NULL;
  UPDATE cash_deposits SET market_id_source = 'NONE'
   WHERE market_id IS NULL AND market_id_source IS NULL;

  FOR d IN
    SELECT id FROM cash_deposits
     WHERE id = ANY(legacy_ids) AND movement_kind = 'LEGACY' AND market_id IS NOT NULL
     ORDER BY (status = 'disputed'), deposited_at, id
  LOOP
    SELECT count(*) INTO before_n FROM cash_deposit_allocations;
    PERFORM cash_allocate_fifo(d.id, 'LEGACY_BACKFILL');
    SELECT count(*) INTO after_n FROM cash_deposit_allocations;
    lines := lines + (after_n - before_n);
  END LOOP;
  RETURN lines;
END
$$;


--
-- Name: cash_ledger_prevent_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_ledger_prevent_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% est append-only : % interdit (contre-passer, ne pas supprimer)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;


--
-- Name: cash_provenance_enforce_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_provenance_enforce_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  src cash_collections%ROWTYPE;
  parent cash_custody_provenance_edges%ROWTYPE;
  receipt cash_custody_receipts%ROWTYPE;
  dep cash_deposits%ROWTYPE;
  used numeric;
  limit_amount numeric;
  reversed_amount numeric;
BEGIN
  -- Verrou unique par collection pour sérialiser toutes les branches concurrentes.
  SELECT * INTO src FROM cash_collections WHERE id = NEW.collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '303: encaissement inconnu'; END IF;
  IF NEW.market_id IS DISTINCT FROM cash_collection_market(src.relais_id, src.collected_by) THEN
    RAISE EXCEPTION '303: Market différent de la collection';
  END IF;
  SELECT * INTO receipt FROM cash_custody_receipts WHERE id = NEW.receipt_id FOR UPDATE;
  IF NOT FOUND OR receipt.kind NOT IN ('RECEIVED', 'CONTROL') THEN
    RAISE EXCEPTION '303: événement de réception ou contrôle requis';
  END IF;
  SELECT * INTO dep FROM cash_deposits WHERE id = receipt.deposit_id FOR UPDATE;
  IF dep.market_id IS DISTINCT FROM NEW.market_id
     OR (receipt.kind = 'RECEIVED' AND dep.movement_kind <> 'TRANSFER')
     OR (receipt.kind = 'CONTROL' AND dep.movement_kind <> 'FINAL') THEN
    RAISE EXCEPTION '303: remise incompatible avec événement de provenance';
  END IF;

  IF NEW.parent_id IS NULL THEN
    IF dep.agent_id <> src.collected_by THEN
      RAISE EXCEPTION '303: la première remise doit partir du collecteur';
    END IF;
    SELECT COALESCE(SUM(amount_kmf),0) INTO used
      FROM cash_custody_provenance_edges
     WHERE collection_id = NEW.collection_id AND parent_id IS NULL;
    IF used + NEW.amount_kmf > src.amount_kmf THEN
      RAISE EXCEPTION '303: attribution racine excède encaissement';
    END IF;
  ELSE
    SELECT * INTO parent FROM cash_custody_provenance_edges WHERE id = NEW.parent_id FOR UPDATE;
    IF NOT FOUND OR parent.collection_id <> NEW.collection_id OR parent.market_id <> NEW.market_id THEN
      RAISE EXCEPTION '303: parent absent ou hors collection/Market';
    END IF;
    IF parent.created_at > NEW.created_at THEN
      RAISE EXCEPTION '303: chronologie inversée';
    END IF;
    IF EXISTS (
      SELECT 1 FROM cash_custody_provenance_edges e
      JOIN cash_custody_receipts r ON r.id = e.receipt_id
      WHERE e.id = parent.id AND r.kind <> 'RECEIVED'
    ) THEN
      RAISE EXCEPTION '303: un contrôle final ne peut être retransféré';
    END IF;
    IF dep.agent_id IS DISTINCT FROM (
      SELECT pd.recipient_user_id FROM cash_custody_receipts pr
      JOIN cash_deposits pd ON pd.id = pr.deposit_id WHERE pr.id = parent.receipt_id
    ) THEN
      RAISE EXCEPTION '303: détenteur émetteur différent du précédent destinataire';
    END IF;
    SELECT COALESCE(SUM(amount_kmf),0) INTO used
      FROM cash_custody_provenance_edges WHERE parent_id = NEW.parent_id;
    IF used + NEW.amount_kmf > parent.amount_kmf THEN
      RAISE EXCEPTION '303: consommation multiple de la portion parente';
    END IF;
  END IF;

  -- Le plafond d'une réception/contrôle tient compte des contre-écritures.
  SELECT COALESCE(SUM(rv.amount_kmf),0)
    INTO reversed_amount FROM cash_custody_receipts rv
    WHERE rv.reverses_id = receipt.id;
  limit_amount := receipt.amount_kmf - reversed_amount;
  SELECT COALESCE(SUM(amount_kmf),0) INTO used
    FROM cash_custody_provenance_edges WHERE receipt_id = NEW.receipt_id;
  IF used + NEW.amount_kmf > limit_amount THEN
    RAISE EXCEPTION '303: provenance excède le reçu/contrôle net';
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: check_parcel_item_quantities(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_parcel_item_quantities() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.qty_packed > NEW.qty_allocated THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_packed (%) > qty_allocated (%) pour parcel_item %', 
      NEW.qty_packed, NEW.qty_allocated, NEW.id;
  END IF;
  IF NEW.qty_shipped > NEW.qty_packed THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_shipped (%) > qty_packed (%) pour parcel_item %', 
      NEW.qty_shipped, NEW.qty_packed, NEW.id;
  END IF;
  IF NEW.qty_received > NEW.qty_shipped THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_received (%) > qty_shipped (%) pour parcel_item %', 
      NEW.qty_received, NEW.qty_shipped, NEW.id;
  END IF;
  IF NEW.qty_collected > NEW.qty_received THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_collected (%) > qty_received (%) pour parcel_item %', 
      NEW.qty_collected, NEW.qty_received, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: check_parcel_ship_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_parcel_ship_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'shipped' AND (OLD.status IS NULL OR OLD.status != 'shipped') THEN
    IF NEW.relais_id IS NULL AND NEW.destination_relais IS NULL THEN
      RAISE EXCEPTION 'ANTI-ERREUR: Impossible d''expÃ©dier colis % sans destination', NEW.reference;
    END IF;
  END IF;
  -- EmpÃªcher collected sans available/arrived
  IF NEW.status = 'collected' AND OLD.status NOT IN ('available', 'arrived') THEN
    RAISE EXCEPTION 'ANTI-ERREUR: Colis % ne peut pas passer Ã  collected depuis %', NEW.reference, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: collective_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.collective_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;


--
-- Name: compute_real_margin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_real_margin() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Calcul uniquement si cost_real_kmf est renseignÃ© et total_kmf > 0
  IF NEW.cost_real_kmf IS NOT NULL AND NEW.total_kmf > 0 THEN

    NEW.margin_real_pct := ROUND(
      (NEW.total_kmf - NEW.cost_real_kmf)::NUMERIC / NEW.total_kmf * 100,
      3
    );

    NEW.cost_delta_pct := CASE
      WHEN NEW.cost_estimated_kmf IS NOT NULL AND NEW.cost_estimated_kmf > 0
      THEN ROUND(
        (NEW.cost_real_kmf::NUMERIC / NEW.cost_estimated_kmf - 1) * 100,
        3
      )
      ELSE NULL
    END;

    -- Alerte si marge rÃ©elle < 10%
    NEW.margin_alert := NEW.margin_real_pct < 10;

    -- Blocage sourcing si marge rÃ©elle nÃ©gative
    NEW.sourcing_blocked := NEW.margin_real_pct < 0;

    -- ClÃ´ture comptable
    IF NEW.cost_closed_at IS NULL THEN
      NEW.cost_closed_at := NOW();
    END IF;

  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: currency_parities_no_truncate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.currency_parities_no_truncate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'currency_parities : TRUNCATE interdit';
END;
$$;


--
-- Name: currency_parities_value_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.currency_parities_value_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency OR NEW.eur_rate IS DISTINCT FROM OLD.eur_rate THEN
    RAISE EXCEPTION 'currency_parities : parité immuable (une nouvelle parité est une décision gouvernée, pas un UPDATE)';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: customs_shipment_fees_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customs_shipment_fees_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'customs_shipment_fees est append-only (% interdit) : corriger par une ligne credit/charge', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;


--
-- Name: customs_shipment_parcel_events_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customs_shipment_parcel_events_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'customs_shipment_parcel_events est append-only (% refusé)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;


--
-- Name: enforce_assignment_ceiling_amount_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_assignment_ceiling_amount_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_amount_bearing BOOLEAN;
BEGIN
  IF NEW.limit_amount IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT amount_bearing
    INTO v_amount_bearing
    FROM capability_registry
   WHERE capability = NEW.capability;

  IF v_amount_bearing IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'capability % is not amount-bearing', NEW.capability;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_assignment_ceiling_capability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_assignment_ceiling_capability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_scope TEXT;
  v_mode TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.assignment_id IS DISTINCT FROM OLD.assignment_id THEN
    RAISE EXCEPTION 'assignment ceiling rows cannot move between assignments';
  END IF;
  SELECT authority_scope, delegation_mode
    INTO v_scope, v_mode
    FROM capability_registry
   WHERE capability = NEW.capability;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'unknown capability: %', NEW.capability;
  END IF;
  IF v_scope <> 'MARKET' OR v_mode <> 'DELEGABLE' THEN
    RAISE EXCEPTION 'capability % cannot enter a market assignment ceiling', NEW.capability;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_cash_policy_assignment_market(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_cash_policy_assignment_market() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_market_id UUID;
BEGIN
  SELECT market_id INTO v_market_id
    FROM market_operating_assignments
   WHERE id = NEW.assignment_id;

  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'cash policy assignment % not found', NEW.assignment_id;
  END IF;
  IF v_market_id IS DISTINCT FROM NEW.market_id THEN
    RAISE EXCEPTION 'cash policy market % does not match assignment market %', NEW.market_id, v_market_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_market_delegation_audit_market(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_market_delegation_audit_market() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_assignment_market UUID;
  v_membership_assignment UUID;
  v_membership_market UUID;
BEGIN
  IF NEW.assignment_id IS NOT NULL THEN
    SELECT market_id
      INTO v_assignment_market
      FROM market_operating_assignments
     WHERE id = NEW.assignment_id;

    IF v_assignment_market IS NULL THEN
      RAISE EXCEPTION 'market delegation audit assignment % not found', NEW.assignment_id;
    END IF;

    IF NEW.market_id IS NULL THEN
      NEW.market_id := v_assignment_market;
    ELSIF NEW.market_id IS DISTINCT FROM v_assignment_market THEN
      RAISE EXCEPTION 'market delegation audit market % conflicts with assignment market %',
        NEW.market_id, v_assignment_market;
    END IF;
  END IF;

  IF NEW.membership_id IS NOT NULL THEN
    SELECT am.assignment_id, assignment.market_id
      INTO v_membership_assignment, v_membership_market
      FROM assignment_memberships am
      JOIN market_operating_assignments assignment ON assignment.id = am.assignment_id
     WHERE am.id = NEW.membership_id;

    IF v_membership_assignment IS NULL THEN
      RAISE EXCEPTION 'market delegation audit membership % not found', NEW.membership_id;
    END IF;

    IF NEW.assignment_id IS NOT NULL
       AND NEW.assignment_id IS DISTINCT FROM v_membership_assignment THEN
      RAISE EXCEPTION 'market delegation audit membership assignment % conflicts with assignment %',
        v_membership_assignment, NEW.assignment_id;
    END IF;

    IF NEW.market_id IS NULL THEN
      NEW.market_id := v_membership_market;
    ELSIF NEW.market_id IS DISTINCT FROM v_membership_market THEN
      RAISE EXCEPTION 'market delegation audit market % conflicts with membership market %',
        NEW.market_id, v_membership_market;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_market_settlement_invariants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_market_settlement_invariants() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  expected_currency TEXT;
  assignment_market UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT m.currency INTO expected_currency FROM markets m WHERE m.id = NEW.market_id;
    SELECT a.market_id INTO assignment_market FROM market_operating_assignments a WHERE a.id = NEW.assignment_id;

    IF expected_currency IS NULL OR assignment_market IS NULL THEN
      RAISE EXCEPTION 'market_settlement_reference_invalid';
    END IF;
    IF assignment_market <> NEW.market_id THEN
      RAISE EXCEPTION 'market_settlement_assignment_market_mismatch';
    END IF;
    IF NEW.currency <> expected_currency THEN
      RAISE EXCEPTION 'market_settlement_currency_mismatch';
    END IF;
    IF NEW.status <> 'READY' THEN
      RAISE EXCEPTION 'market_settlement_must_start_ready';
    END IF;
    IF NEW.requested_by IS NOT NULL OR NEW.requested_at IS NOT NULL
       OR NEW.paid_by IS NOT NULL OR NEW.paid_at IS NOT NULL OR NEW.payment_reference IS NOT NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL OR NEW.receipt_note IS NOT NULL THEN
      RAISE EXCEPTION 'market_settlement_future_stage_fields_forbidden';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.market_id IS DISTINCT FROM OLD.market_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.attested_by IS DISTINCT FROM OLD.attested_by
     OR NEW.attestation_note IS DISTINCT FROM OLD.attestation_note THEN
    RAISE EXCEPTION 'market_settlement_attestation_immutable';
  END IF;

  IF OLD.status = 'READY' AND NEW.status = 'REQUESTED' THEN
    IF NEW.requested_by IS NULL OR NEW.requested_at IS NULL
       OR NEW.paid_by IS NOT NULL OR NEW.paid_at IS NOT NULL OR NEW.payment_reference IS NOT NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL OR NEW.receipt_note IS NOT NULL THEN
      RAISE EXCEPTION 'market_settlement_requested_stage_invalid';
    END IF;
  ELSIF OLD.status = 'REQUESTED' AND NEW.status = 'PAID' THEN
    IF NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
       OR NEW.paid_by IS NULL OR NEW.paid_at IS NULL OR NULLIF(BTRIM(NEW.payment_reference), '') IS NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL OR NEW.receipt_note IS NOT NULL THEN
      RAISE EXCEPTION 'market_settlement_paid_stage_invalid';
    END IF;
  ELSIF OLD.status = 'PAID' AND NEW.status = 'RECEIVED' THEN
    IF NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
       OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
       OR NEW.received_by IS NULL OR NEW.received_at IS NULL THEN
      RAISE EXCEPTION 'market_settlement_received_stage_invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'market_settlement_transition_invalid:%->%', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: enforce_membership_capability_amount_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_membership_capability_amount_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_assignment_id UUID;
  v_amount_bearing BOOLEAN;
  v_ceiling_limit NUMERIC(20,6);
BEGIN
  SELECT am.assignment_id
    INTO v_assignment_id
    FROM assignment_memberships am
   WHERE am.id = NEW.membership_id;

  IF v_assignment_id IS NULL THEN
    RAISE EXCEPTION 'membership % not found', NEW.membership_id;
  END IF;

  SELECT cr.amount_bearing, acc.limit_amount
    INTO v_amount_bearing, v_ceiling_limit
    FROM assignment_capability_ceiling acc
    JOIN capability_registry cr ON cr.capability = acc.capability
   WHERE acc.assignment_id = v_assignment_id
     AND acc.capability = NEW.capability
     AND acc.revoked_at IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capability % exceeds assignment ceiling', NEW.capability;
  END IF;

  IF v_amount_bearing IS DISTINCT FROM TRUE AND NEW.limit_amount IS NOT NULL THEN
    RAISE EXCEPTION 'capability % is not amount-bearing', NEW.capability;
  END IF;

  IF v_ceiling_limit IS NOT NULL THEN
    IF NEW.limit_amount IS NULL THEN
      RAISE EXCEPTION 'membership limit required when ceiling limit is finite for %', NEW.capability;
    END IF;
    IF NEW.limit_amount > v_ceiling_limit THEN
      RAISE EXCEPTION 'membership limit % exceeds ceiling limit % for %',
        NEW.limit_amount, v_ceiling_limit, NEW.capability;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_membership_capability_within_ceiling(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_membership_capability_within_ceiling() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_assignment UUID;
BEGIN
  SELECT assignment_id INTO v_assignment
    FROM assignment_memberships
   WHERE id = NEW.membership_id;
  IF v_assignment IS NULL THEN
    RAISE EXCEPTION 'membership % not found', NEW.membership_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM assignment_capability_ceiling acc
     WHERE acc.assignment_id = v_assignment
       AND acc.capability = NEW.capability
       AND acc.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'capability % exceeds assignment ceiling', NEW.capability;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: flag_customs_anomaly(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.flag_customs_anomaly() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.customs_real_kmf IS NOT NULL
     AND NEW.customs_estimated_kmf > 0
     AND NEW.customs_real_kmf > (NEW.customs_estimated_kmf * 2)
  THEN
    NEW.is_anomaly := TRUE;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fx_append_only_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fx_append_only_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% est append-only : suppression interdite', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'fx_rate_observations' THEN
    IF OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL
       AND (NEW.id, NEW.base_ccy, NEW.quote_ccy, NEW.rate, NEW.source_label, NEW.source_ref, NEW.as_of, NEW.entered_by, NEW.created_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.base_ccy, OLD.quote_ccy, OLD.rate, OLD.source_label, OLD.source_ref, OLD.as_of, OLD.entered_by, OLD.created_at) THEN
      NEW.approved_by := lower(btrim(NEW.approved_by));
      NEW.approved_at := now();
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% est append-only : modification interdite', TG_TABLE_NAME;
END;
$$;


--
-- Name: fx_insert_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fx_insert_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.created_at := now();
  IF TG_TABLE_NAME = 'fx_rate_observations' THEN
    NEW.entered_by := lower(btrim(NEW.entered_by));
    IF NEW.entered_by = '' THEN
      RAISE EXCEPTION 'fx_rate_observations : entered_by vide';
    END IF;
    IF NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'fx_rate_observations : une observation est insérée non approuvée (approbation = étape séparée)';
    END IF;
    IF NEW.as_of > NEW.created_at THEN
      RAISE EXCEPTION 'fx_rate_observations : as_of dans le futur';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fx_no_truncate_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fx_no_truncate_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% est append-only : TRUNCATE interdit', TG_TABLE_NAME;
END;
$$;


--
-- Name: guard_international_n1_against_legacy_duplicate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_international_n1_against_legacy_duplicate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'customs_shipments' THEN
    IF NEW.freight_kmf IS NOT NULL AND NEW.freight_kmf > 0 AND EXISTS (
      SELECT 1 FROM public.international_shipments s
      JOIN public.international_n1_reconciliations n ON n.shipment_id=s.id
      WHERE s.customs_shipment_id=NEW.id AND s.freight_invoice_kmf > 0
    ) THEN
      RAISE EXCEPTION 'INTERNATIONAL_N1_DUPLICATE_FREIGHT'
        USING ERRCODE='check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'customs_shipment_fees' THEN
    IF EXISTS (
      SELECT 1 FROM public.international_shipments s
      JOIN public.international_n1_reconciliations n ON n.shipment_id=s.id
      WHERE s.customs_shipment_id=NEW.shipment_id
        AND (
          EXISTS (SELECT 1 FROM public.international_shipment_charges c
                  WHERE c.shipment_id=s.id AND
                    (c.fee_type=NEW.fee_type OR lower(btrim(c.proof_ref))=lower(btrim(NEW.proof_ref))))
          OR lower(btrim(COALESCE(s.freight_invoice_ref,'')))=lower(btrim(NEW.proof_ref))
        )
    ) THEN
      RAISE EXCEPTION 'INTERNATIONAL_N1_DUPLICATE_FEE'
        USING ERRCODE='check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: hub_guard_allocation_purchase_line(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hub_guard_allocation_purchase_line() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_line public.purchase_lines%ROWTYPE;
  v_po_order_id uuid;
BEGIN
  IF NEW.purchase_line_id IS NULL THEN
    SELECT order_id INTO v_po_order_id FROM public.purchase_orders WHERE id = NEW.purchase_order_id;
    IF FOUND AND v_po_order_id IS NULL THEN
      RAISE EXCEPTION 'hub_allocation_grouped_requires_line: une PO regroupée ne s''alloue que par ligne d''achat'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_line FROM public.purchase_lines WHERE id = NEW.purchase_line_id;
  IF NOT FOUND
     OR v_line.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id
     OR v_line.order_item_id IS DISTINCT FROM NEW.order_item_id
     OR v_line.product_sku_id IS DISTINCT FROM NEW.product_sku_id
     OR v_line.supplier_id IS DISTINCT FROM NEW.supplier_id THEN
    RAISE EXCEPTION 'hub_allocation_line_mismatch: l''allocation ne décrit pas la ligne d''achat référencée'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: hub_guard_physical_unit_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hub_guard_physical_unit_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.market_id IS NOT NULL THEN
    RAISE EXCEPTION 'hub_market_only_derived_at_outbound';
  END IF;

  IF NEW.outcome_type IS NOT NULL OR NEW.outcome_recorded_at IS NOT NULL THEN
    RAISE EXCEPTION 'hub_physical_outcome_requires_recording_boundary';
  END IF;

  IF NEW.state NOT IN ('RECEIVED', 'QUARANTINED') THEN
    RAISE EXCEPTION 'hub_physical_initial_state_invalid:%', NEW.state;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: hub_guard_physical_unit_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hub_guard_physical_unit_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  active_count integer;
  market_count integer;
  destination_count integer;
  resolved_market_id uuid;
  resolved_destination_ref text;
  transition_ok boolean;
  resume_state text;
BEGIN
  IF OLD.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    RAISE EXCEPTION 'hub_physical_unit_market_immutable';
  END IF;

  IF OLD.outcome_type IS NOT NULL AND NEW.outcome_type IS DISTINCT FROM OLD.outcome_type THEN
    RAISE EXCEPTION 'hub_physical_outcome_immutable';
  END IF;

  IF NEW.market_id IS DISTINCT FROM OLD.market_id
     AND NEW.state NOT IN ('PACKED', 'DISPATCHED') THEN
    RAISE EXCEPTION 'hub_market_only_derived_at_outbound';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'QUARANTINED' THEN
      IF OLD.outcome_type IS NOT NULL THEN
        RAISE EXCEPTION 'hub_destructive_outcome_quarantine_terminal';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM incidents i
         WHERE i.status IN ('open', 'investigating')
           AND i.details->>'physical_unit_id' = OLD.id::text
      ) THEN
        RAISE EXCEPTION 'hub_quarantine_incident_active';
      END IF;

      SELECT COALESCE(NULLIF(e.from_state, 'QUARANTINED'), 'RECEIVED')
        INTO resume_state
        FROM hub_custody_events e
       WHERE e.physical_unit_id = OLD.id
         AND e.event_type = 'QUARANTINE'
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 1;

      resume_state := COALESCE(resume_state, 'RECEIVED');
      transition_ok := NEW.state = resume_state;
    ELSE
      transition_ok := CASE OLD.state
        WHEN 'RECEIVED'        THEN NEW.state IN ('IDENTIFIED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'IDENTIFIED'      THEN NEW.state IN ('QUALITY_CHECKED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'QUALITY_CHECKED' THEN NEW.state IN ('LOCATED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'LOCATED'         THEN NEW.state IN ('ALLOCATED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'ALLOCATED'       THEN NEW.state IN ('PICKED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'PICKED'          THEN NEW.state IN ('PACKED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'PACKED'          THEN NEW.state IN ('DISPATCHED', 'QUARANTINED')
        WHEN 'DISPATCHED'      THEN NEW.state = 'QUARANTINED'
        ELSE false
      END;
    END IF;

    IF NOT transition_ok THEN
      RAISE EXCEPTION 'hub_physical_state_transition_invalid:%->%', OLD.state, NEW.state;
    END IF;
  END IF;

  IF NEW.state IN ('PACKED', 'DISPATCHED') THEN
    SELECT COUNT(*)::integer,
           COUNT(DISTINCT a.market_id)::integer,
           COUNT(DISTINCT a.destination_ref)::integer,
           MIN(a.market_id::text)::uuid,
           MIN(a.destination_ref)
      INTO active_count, market_count, destination_count, resolved_market_id, resolved_destination_ref
      FROM hub_physical_unit_placements p
      JOIN hub_purchase_allocations a ON a.id = p.allocation_id
     WHERE p.physical_unit_id = NEW.id
       AND p.removed_at IS NULL;

    IF active_count = 0 THEN
      RAISE EXCEPTION 'hub_outbound_unit_empty';
    END IF;
    IF market_count <> 1 THEN
      RAISE EXCEPTION 'hub_outbound_market_not_homogeneous';
    END IF;
    IF destination_count <> 1 OR resolved_destination_ref IS NULL THEN
      RAISE EXCEPTION 'hub_outbound_destination_not_homogeneous';
    END IF;
    IF NEW.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM resolved_market_id THEN
      RAISE EXCEPTION 'hub_outbound_market_snapshot_mismatch';
    END IF;

    NEW.market_id := resolved_market_id;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION hub_guard_physical_unit_update(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.hub_guard_physical_unit_update() IS 'HUB-001 hardening — outbound mono-Market + mono-destination ; sortie de QUARANTINED seulement après incident résolu et vers état pré-quarantaine.';


--
-- Name: hub_guard_placement_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hub_guard_placement_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  allocation_qty integer;
  already_placed integer;
  unit_state text;
BEGIN
  SELECT state INTO unit_state
    FROM hub_physical_units
   WHERE id = NEW.physical_unit_id
   FOR UPDATE;

  IF unit_state IS NULL THEN
    RAISE EXCEPTION 'hub_physical_unit_unresolvable';
  END IF;
  IF unit_state IN ('PACKED', 'DISPATCHED', 'QUARANTINED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'hub_physical_unit_content_frozen';
  END IF;

  SELECT quantity INTO allocation_qty
    FROM hub_purchase_allocations
   WHERE id = NEW.allocation_id
   FOR UPDATE;

  IF allocation_qty IS NULL THEN
    RAISE EXCEPTION 'hub_purchase_allocation_unresolvable';
  END IF;

  SELECT COALESCE(SUM(p.quantity), 0)::integer INTO already_placed
    FROM hub_physical_unit_placements p
    JOIN hub_physical_units u ON u.id = p.physical_unit_id
   WHERE p.allocation_id = NEW.allocation_id
     AND p.removed_at IS NULL
     AND u.outcome_type IS NULL;

  IF already_placed + NEW.quantity > allocation_qty THEN
    RAISE EXCEPTION 'hub_allocation_overplaced';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: hub_guard_placement_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hub_guard_placement_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  unit_state text;
BEGIN
  IF NEW.physical_unit_id IS DISTINCT FROM OLD.physical_unit_id
     OR NEW.allocation_id IS DISTINCT FROM OLD.allocation_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.placed_at IS DISTINCT FROM OLD.placed_at THEN
    RAISE EXCEPTION 'hub_placement_identity_immutable';
  END IF;

  IF OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'hub_placement_close_once';
  END IF;

  IF NEW.removed_at <= OLD.placed_at THEN
    RAISE EXCEPTION 'hub_placement_removed_at_invalid';
  END IF;

  SELECT state INTO unit_state
    FROM hub_physical_units
   WHERE id = OLD.physical_unit_id
   FOR UPDATE;

  IF unit_state IN ('PACKED', 'DISPATCHED', 'QUARANTINED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'hub_physical_unit_content_frozen';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: hub_reject_custody_event_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hub_reject_custody_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'hub_custody_event_append_only';
END;
$$;


--
-- Name: hub_reject_placement_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hub_reject_placement_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'hub_placement_history_no_delete';
END;
$$;


--
-- Name: hub_reject_purchase_allocation_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hub_reject_purchase_allocation_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'hub_purchase_allocation_immutable';
END;
$$;


--
-- Name: hub_require_quarantine_incident(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hub_require_quarantine_incident() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state = 'QUARANTINED' AND NEW.outcome_type IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM incidents i
       WHERE i.status IN ('open', 'investigating')
         AND i.details->>'physical_unit_id' = NEW.id::text
    ) THEN
      RAISE EXCEPTION 'hub_quarantine_incident_required';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: FUNCTION hub_require_quarantine_incident(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.hub_require_quarantine_incident() IS 'HUB-001 — toute quarantaine non destructive doit avoir un incident actif au COMMIT ; empêche les quarantaines orphelines même par SQL direct.';


--
-- Name: international_facts_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.international_facts_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'international_shipment_facts append-only (% interdit)',TG_OP
    USING ERRCODE='integrity_constraint_violation';
END;
$$;


--
-- Name: international_shipment_hub_units_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.international_shipment_hub_units_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_unit record;
  v_shipment record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT stage INTO v_shipment FROM public.international_shipments WHERE id = OLD.shipment_id FOR UPDATE;
    IF v_shipment.stage IS DISTINCT FROM 'hub_ready' THEN
      RAISE EXCEPTION 'hub_box_shipment_detach_after_handover' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'hub_box_shipment_link_immutable' USING ERRCODE = '23514';
  END IF;

  SELECT id, unit_type, state, market_id INTO v_unit
    FROM public.hub_physical_units WHERE id = NEW.physical_unit_id FOR UPDATE;
  SELECT id, market_id, stage INTO v_shipment
    FROM public.international_shipments WHERE id = NEW.shipment_id FOR UPDATE;
  IF v_unit.unit_type IS DISTINCT FROM 'MARKET_PARCEL' THEN
    RAISE EXCEPTION 'hub_box_shipment_requires_market_parcel' USING ERRCODE = '23514';
  END IF;
  IF v_unit.state NOT IN ('PACKED','DISPATCHED') OR v_unit.market_id IS NULL THEN
    RAISE EXCEPTION 'hub_box_shipment_requires_packed_box' USING ERRCODE = '23514';
  END IF;
  IF v_shipment.market_id IS DISTINCT FROM v_unit.market_id THEN
    RAISE EXCEPTION 'hub_box_shipment_market_mismatch: carton et expédition de marchés différents'
      USING ERRCODE = '23514';
  END IF;
  IF v_shipment.stage IS DISTINCT FROM 'hub_ready' THEN
    RAISE EXCEPTION 'hub_box_shipment_closed: expédition déjà remise au transitaire'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: is_order_complete(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_order_complete(p_order_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public.v_purchase_line_progress v
     WHERE v.order_id = p_order_id
       AND NOT v.cancelled
       AND v.received_quantity < v.effective_quantity
  );
$$;


--
-- Name: FUNCTION is_order_complete(p_order_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_order_complete(p_order_id uuid) IS 'Retourne TRUE si tous les POs non annulÃ©s ont received_qty >= qty.';


--
-- Name: market_cash_destinations_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_cash_destinations_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  acct market_payment_accounts%ROWTYPE;
BEGIN
  IF NEW.payment_account_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.payment_account_id IS DISTINCT FROM OLD.payment_account_id) THEN
    SELECT * INTO acct FROM market_payment_accounts WHERE id = NEW.payment_account_id;
    IF NOT FOUND OR acct.market_id <> NEW.market_id OR acct.currency <> NEW.currency THEN
      RAISE EXCEPTION 'market_cash_destinations: compte de paiement hors Market ou devise différente'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PROPOSED' THEN
      RAISE EXCEPTION 'market_cash_destinations: création uniquement en PROPOSED (activation par un second acteur)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.market_id IS DISTINCT FROM OLD.market_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.account_ref IS DISTINCT FROM OLD.account_ref
     OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'market_cash_destinations: Market, type, devise, référence et proposant sont immuables'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PROPOSED' AND NEW.status IN ('ACTIVE', 'CLOSED'))
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('SUSPENDED', 'CLOSED'))
    OR (OLD.status = 'SUSPENDED' AND NEW.status IN ('ACTIVE', 'CLOSED'))
  ) THEN
    RAISE EXCEPTION 'market_cash_destinations: transition % → % interdite', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;


--
-- Name: market_cost_attributions_check_conservation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_cost_attributions_check_conservation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_event_amount numeric(18,2);
  v_scope        text;
  v_kind         text;
  v_active       numeric(18,2);
BEGIN
  SELECT e.amount_kmf, e.scope_kind, e.event_kind
    INTO v_event_amount, v_scope, v_kind
    FROM public.economic_structure_cost_events e
   WHERE e.id = NEW.source_event_id;

  IF NEW.event_kind = 'ATTRIBUTION' AND (v_scope IS DISTINCT FROM 'GROUP' OR v_kind IS DISTINCT FROM 'ACCRUAL') THEN
    RAISE EXCEPTION 'market_cost_attribution_event_not_attributable: le fait % est % / %, seul un fait GROUP ACCRUAL est attribuable',
      NEW.source_event_id, v_scope, v_kind
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(a.amount_kmf), 0)
    INTO v_active
    FROM public.market_cost_attributions a
   WHERE a.source_event_id = NEW.source_event_id
     AND a.event_kind = 'ATTRIBUTION'
     AND NOT EXISTS (
       SELECT 1 FROM public.market_cost_attributions r WHERE r.reverses_id = a.id
     );

  IF v_active <> 0 AND v_active IS DISTINCT FROM v_event_amount THEN
    RAISE EXCEPTION 'market_cost_attribution_not_conserved: attributions actives % <> montant du fait % (source_event_id %)',
      v_active, v_event_amount, NEW.source_event_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: market_cost_attributions_guard_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_cost_attributions_guard_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'market_cost_attribution_immutable: UPDATE interdit — utiliser REVERSAL + nouvelle ATTRIBUTION'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'market_cost_attribution_immutable: DELETE interdit — journal append-only'
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;


--
-- Name: market_cost_attributions_guard_reversal_target(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_cost_attributions_guard_reversal_target() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_target_kind text;
  v_target_source uuid;
BEGIN
  IF NEW.event_kind <> 'REVERSAL' OR NEW.reverses_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT event_kind, source_event_id INTO v_target_kind, v_target_source
  FROM public.market_cost_attributions
  WHERE id = NEW.reverses_id;

  IF v_target_kind IS NULL THEN
    RAISE EXCEPTION 'market_cost_attribution_reversal_target_missing: l''attribution cible % n''existe pas', NEW.reverses_id
      USING ERRCODE = '23503';
  END IF;

  IF v_target_kind <> 'ATTRIBUTION' THEN
    RAISE EXCEPTION 'market_cost_attribution_reversal_target_invalid: la cible % est un %, pas une ATTRIBUTION', NEW.reverses_id, v_target_kind
      USING ERRCODE = '23514';
  END IF;

  IF v_target_source IS DISTINCT FROM NEW.source_event_id THEN
    RAISE EXCEPTION 'market_cost_attribution_reversal_source_mismatch: le REVERSAL pointe source_event_id % mais l''ATTRIBUTION cible pointe %', NEW.source_event_id, v_target_source
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;


--
-- Name: orders_snapshots_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orders_snapshots_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.fx_snapshot IS NOT NULL AND NEW.fx_snapshot IS DISTINCT FROM OLD.fx_snapshot THEN
    RAISE EXCEPTION 'orders.fx_snapshot est immuable une fois posé';
  END IF;
  IF OLD.transport_pricing_snapshot IS NOT NULL AND NEW.transport_pricing_snapshot IS DISTINCT FROM OLD.transport_pricing_snapshot THEN
    RAISE EXCEPTION 'orders.transport_pricing_snapshot est immuable une fois posé';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: prevent_ceiling_removal_with_active_member_grants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_ceiling_removal_with_active_member_grants() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_assignment UUID := OLD.assignment_id;
  v_capability TEXT := OLD.capability;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM assignment_memberships am
      JOIN membership_capabilities mc ON mc.membership_id = am.id
     WHERE am.assignment_id = v_assignment
       AND am.status = 'ACTIVE'
       AND mc.capability = v_capability
       AND mc.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot remove ceiling capability % while active member grants remain', v_capability;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: prevent_customs_financial_audit_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_customs_financial_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'customs_shipment_financial_audit is append-only';
END;
$$;


--
-- Name: prevent_economic_risk_truth_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_economic_risk_truth_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; record a new economic event instead', TG_TABLE_NAME;
END;
$$;


--
-- Name: prevent_economic_structure_cost_event_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_economic_structure_cost_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'economic_structure_cost_events is append-only; record an ADJUSTMENT or REVERSAL event';
END;
$$;


--
-- Name: prevent_hard_delete_parcels(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_hard_delete_parcels() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Suppression interdite sur %. Utilisez status=cancelled.', TG_TABLE_NAME;
  RETURN NULL;
END;
$$;


--
-- Name: prevent_incident_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_incident_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'La suppression d''incidents est interdite. Utilisez status=dismissed pour fermer.';
  RETURN NULL;
END;
$$;


--
-- Name: prevent_market_settlement_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_market_settlement_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'market_settlements are non-destructive; create a new attestation instead';
END;
$$;


--
-- Name: prevent_market_settlement_event_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_market_settlement_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'market_settlement_events is append-only';
END;
$$;


--
-- Name: prevent_order_item_fulfillment_source_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_order_item_fulfillment_source_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.fulfillment_source IS DISTINCT FROM NEW.fulfillment_source THEN
    RAISE EXCEPTION
      'order_items.fulfillment_source est immuable après création (% -> %)',
      OLD.fulfillment_source, NEW.fulfillment_source
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: prevent_order_simulation_scope_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_order_simulation_scope_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.simulation_scope IS NOT NULL AND NEW.simulation_scope IS DISTINCT FROM OLD.simulation_scope THEN
    RAISE EXCEPTION 'orders.simulation_scope est immuable une fois posé (%)', OLD.simulation_scope;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: prevent_orders_market_id_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_orders_market_id_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    RAISE EXCEPTION 'orders_market_id_immutable';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION prevent_orders_market_id_mutation(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.prevent_orders_market_id_mutation() IS 'F1.1 — orders.market_id est un snapshot commercial historique, jamais resynchronisé.';


--
-- Name: prevent_orders_relais_market_mismatch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_orders_relais_market_mismatch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  new_relais_market_id uuid;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.relais_id IS DISTINCT FROM OLD.relais_id THEN
    SELECT market_id INTO new_relais_market_id
    FROM relais
    WHERE id = NEW.relais_id
    FOR SHARE;

    IF new_relais_market_id IS NULL THEN
      RAISE EXCEPTION 'orders_relais_id_unresolvable';
    END IF;

    IF new_relais_market_id IS DISTINCT FROM NEW.market_id THEN
      RAISE EXCEPTION 'orders_relais_reassignment_cross_market';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION prevent_orders_relais_market_mismatch(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.prevent_orders_relais_market_mismatch() IS 'F1.2 — INSERT/réassignation order.relais_id uniquement vers un relais du même Market que la commande.';


--
-- Name: prevent_outbox_event_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_outbox_event_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'La suppression de outbox_events est interdite (append-only).';
  RETURN NULL;
END;
$$;


--
-- Name: prevent_pricing_market_decision_policy_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_pricing_market_decision_policy_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'pricing_market_decision_policy_events is append-only; record a new policy event instead';
END;
$$;


--
-- Name: prevent_referenced_relais_market_drift(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_referenced_relais_market_drift() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    IF EXISTS (
      SELECT 1 FROM orders WHERE relais_id = OLD.id LIMIT 1
    ) THEN
      RAISE EXCEPTION 'relais_market_id_immutable_once_referenced';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION prevent_referenced_relais_market_drift(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.prevent_referenced_relais_market_drift() IS 'F1.3 — un relais déjà référencé par une commande ne peut plus changer de Market.';


--
-- Name: prevent_scan_event_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_scan_event_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'La suppression de scan_events est interdite. Utilisez status=reversed pour annuler.';
  RETURN NULL;
END;
$$;


--
-- Name: purchase_line_effective_quantity(timestamp with time zone, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_line_effective_quantity(p_cancelled_at timestamp with time zone, p_settled integer, p_confirmed integer, p_quantity integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE WHEN p_cancelled_at IS NOT NULL THEN 0
              ELSE COALESCE(p_settled, p_confirmed, p_quantity) END
$$;


--
-- Name: purchase_lines_guard_attachment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_lines_guard_attachment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_status text;
  v_order_id uuid;
  v_order_item uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.purchase_order_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT status, order_id, order_item_id INTO v_status, v_order_id, v_order_item
      FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR SHARE;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'purchase_line_po_missing' USING ERRCODE = '23503';
    END IF;
    IF v_order_id IS NULL OR v_order_item IS DISTINCT FROM NEW.order_item_id THEN
      RAISE EXCEPTION 'purchase_line_attach_forbidden: insertion rattachée réservée à une PO historique du même order_item'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.purchase_lines WHERE purchase_order_id = NEW.purchase_order_id) THEN
      RAISE EXCEPTION 'purchase_line_historical_po_already_has_line' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.purchase_order_id IS NOT DISTINCT FROM OLD.purchase_order_id THEN
    RETURN NEW;
  END IF;

  IF OLD.purchase_order_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.purchase_orders WHERE id = OLD.purchase_order_id FOR SHARE;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'purchase_line_detach_forbidden: la PO d''origine n''est pas en brouillon' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.purchase_order_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR SHARE;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'purchase_line_attach_forbidden: la PO cible n''est pas en brouillon' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: purchase_lines_guard_commitment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_lines_guard_commitment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_need integer;
  v_others integer;
  v_self integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.order_item_id = OLD.order_item_id
     AND NEW.quantity = OLD.quantity
     AND NEW.confirmed_quantity IS NOT DISTINCT FROM OLD.confirmed_quantity
     AND NEW.settled_quantity IS NOT DISTINCT FROM OLD.settled_quantity
     AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at THEN
    RETURN NEW;
  END IF;

  SELECT quantity INTO v_need FROM public.order_items WHERE id = NEW.order_item_id FOR UPDATE;
  IF v_need IS NULL THEN
    RAISE EXCEPTION 'purchase_line_order_item_missing' USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(SUM(public.purchase_line_effective_quantity(cancelled_at, settled_quantity, confirmed_quantity, quantity)), 0)
    INTO v_others
  FROM public.purchase_lines
  WHERE order_item_id = NEW.order_item_id AND id <> NEW.id;

  v_self := public.purchase_line_effective_quantity(NEW.cancelled_at, NEW.settled_quantity, NEW.confirmed_quantity, NEW.quantity);

  IF v_others + v_self > v_need THEN
    RAISE EXCEPTION 'purchase_line_overcommitted: order_item % besoin % engagé %', NEW.order_item_id, v_need, v_others + v_self
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: purchase_lines_guard_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_lines_guard_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'purchase_line_delete_forbidden: annuler la ligne (cancelled_at) plutôt que la supprimer' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;


--
-- Name: purchase_lines_guard_freeze(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_lines_guard_freeze() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_po_status text;
BEGIN
  IF NEW.order_item_id IS DISTINCT FROM OLD.order_item_id
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.product_supplier_id IS DISTINCT FROM OLD.product_supplier_id
     OR NEW.product_sku_id IS DISTINCT FROM OLD.product_sku_id
     OR NEW.supplier_sku IS DISTINCT FROM OLD.supplier_sku
     OR NEW.supplier_unit_ref IS DISTINCT FROM OLD.supplier_unit_ref
     OR NEW.supplier_order_identity IS DISTINCT FROM OLD.supplier_order_identity
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.supplier_unit_price IS DISTINCT FROM OLD.supplier_unit_price
     OR NEW.supplier_currency IS DISTINCT FROM OLD.supplier_currency
     OR NEW.procurement_hub_ref IS DISTINCT FROM OLD.procurement_hub_ref
     OR NEW.parent_line_id IS DISTINCT FROM OLD.parent_line_id THEN
    RAISE EXCEPTION 'purchase_line_frozen: champ d''identité ou de quantité immuable' USING ERRCODE = '23514';
  END IF;

  -- Ligne ouverte ou en brouillon : ni confirmation ni clôture (rien n'est parti chez le fournisseur).
  IF OLD.purchase_order_id IS NOT NULL THEN
    SELECT status INTO v_po_status FROM public.purchase_orders WHERE id = OLD.purchase_order_id;
  END IF;
  IF (OLD.purchase_order_id IS NULL OR v_po_status = 'draft')
     AND (NEW.confirmed_quantity IS DISTINCT FROM OLD.confirmed_quantity
          OR NEW.confirmed_unit_price IS DISTINCT FROM OLD.confirmed_unit_price
          OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
          OR NEW.settled_quantity IS DISTINCT FROM OLD.settled_quantity
          OR NEW.settled_at IS DISTINCT FROM OLD.settled_at
          OR NEW.settle_reason IS DISTINCT FROM OLD.settle_reason) THEN
    RAISE EXCEPTION 'purchase_line_frozen: pas de confirmation ni de clôture avant soumission' USING ERRCODE = '23514';
  END IF;

  -- Écritures uniques : une valeur posée ne change plus.
  IF OLD.confirmed_quantity IS NOT NULL
     AND (NEW.confirmed_quantity IS DISTINCT FROM OLD.confirmed_quantity
          OR NEW.confirmed_unit_price IS DISTINCT FROM OLD.confirmed_unit_price
          OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
    RAISE EXCEPTION 'purchase_line_frozen: confirmation déjà enregistrée' USING ERRCODE = '23514';
  END IF;
  IF OLD.settled_at IS NOT NULL
     AND (NEW.settled_quantity IS DISTINCT FROM OLD.settled_quantity
          OR NEW.settled_at IS DISTINCT FROM OLD.settled_at
          OR NEW.settle_reason IS DISTINCT FROM OLD.settle_reason) THEN
    RAISE EXCEPTION 'purchase_line_frozen: clôture déjà enregistrée' USING ERRCODE = '23514';
  END IF;
  IF OLD.cancelled_at IS NOT NULL
     AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
          OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION 'purchase_line_frozen: annulation déjà enregistrée' USING ERRCODE = '23514';
  END IF;
  -- Confirmation et prix confirmé s'écrivent ensemble.
  IF (NEW.confirmed_quantity IS NULL) <> (NEW.confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'purchase_line_frozen: confirmed_quantity et confirmed_at s''écrivent ensemble' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: purchase_lines_guard_groupable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_lines_guard_groupable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_other_currency text;
BEGIN
  IF NEW.purchase_order_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.purchase_order_id IS NOT DISTINCT FROM OLD.purchase_order_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR UPDATE;
  IF NOT FOUND OR v_po.order_id IS NOT NULL THEN
    RETURN NEW; -- PO historique : écriture double 1:1, gardée par I3
  END IF;

  IF NEW.product_sku_id IS NULL
     OR NEW.supplier_unit_ref IS NULL
     OR NEW.supplier_order_identity IS NULL
     OR NEW.supplier_unit_price IS NULL
     OR NEW.supplier_currency IS NULL THEN
    RAISE EXCEPTION 'purchase_line_not_groupable: seule une ligne à identité fournisseur exacte et prix connu est regroupable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.supplier_id IS DISTINCT FROM v_po.supplier_id
     OR NEW.procurement_hub_ref IS DISTINCT FROM v_po.procurement_hub_ref THEN
    RAISE EXCEPTION 'purchase_line_not_homogeneous: fournisseur ou hub différent de l''en-tête de la PO'
      USING ERRCODE = '23514';
  END IF;

  SELECT pl.supplier_currency INTO v_other_currency
    FROM public.purchase_lines pl
   WHERE pl.purchase_order_id = NEW.purchase_order_id
     AND pl.cancelled_at IS NULL
     AND pl.id IS DISTINCT FROM NEW.id
     AND pl.supplier_currency IS DISTINCT FROM NEW.supplier_currency
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'purchase_line_not_homogeneous: devise différente des lignes déjà rattachées (%)', v_other_currency
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;


--
-- Name: purchase_lines_guard_market_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_lines_guard_market_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_po_market uuid;
  v_po_order uuid;
  v_line_market uuid;
BEGIN
  IF NEW.purchase_order_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.purchase_order_id IS NOT DISTINCT FROM OLD.purchase_order_id
       AND NEW.order_item_id IS NOT DISTINCT FROM OLD.order_item_id THEN
    RETURN NEW;
  END IF;

  -- Le verrou de l'en-tête sérialise les rattachements concurrents.
  SELECT market_id, order_id INTO v_po_market, v_po_order
    FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR UPDATE;
  IF NOT FOUND OR v_po_order IS NOT NULL THEN
    RETURN NEW; -- Forme historique 1:1 préservée.
  END IF;

  IF v_po_market IS NULL THEN
    RAISE EXCEPTION 'purchase_line_market_unset: ancien dossier sans marché unique, aucun nouveau rattachement'
      USING ERRCODE = '23514';
  END IF;

  SELECT o.market_id INTO v_line_market
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE oi.id = NEW.order_item_id;
  IF v_line_market IS NULL OR v_line_market IS DISTINCT FROM v_po_market THEN
    RAISE EXCEPTION 'purchase_line_market_mismatch: ligne non destinée au marché de la PO'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: purchase_orders_cancel_lines(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_orders_cancel_lines() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE public.purchase_lines
     SET cancelled_at = now(), cancel_reason = 'purchase_order_cancelled', updated_at = now()
   WHERE purchase_order_id = NEW.id AND cancelled_at IS NULL;
  RETURN NULL;
END $$;


--
-- Name: purchase_orders_guard_market_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_orders_guard_market_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.order_id IS NULL AND NEW.market_id IS NULL THEN
    RAISE EXCEPTION 'purchase_order_market_required: marché obligatoire pour une nouvelle PO regroupée'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.market_id IS NOT NULL
       AND NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    RAISE EXCEPTION 'purchase_order_market_immutable: marché de la PO immuable'
      USING ERRCODE = '23514';
  END IF;

  -- Même sur un ancien en-tête dont le marché était absent, le rendre
  -- non-null exige que toutes les lignes déjà rattachées concordent.
  IF NEW.order_id IS NULL AND NEW.market_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.market_id IS DISTINCT FROM OLD.market_id)
     AND EXISTS (
       SELECT 1 FROM public.purchase_lines pl
       JOIN public.order_items oi ON oi.id = pl.order_item_id
       JOIN public.orders o ON o.id = oi.order_id
       WHERE pl.purchase_order_id = NEW.id
         AND o.market_id IS DISTINCT FROM NEW.market_id
     ) THEN
    RAISE EXCEPTION 'purchase_order_market_mismatch: lignes de marché différent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: purchase_orders_guard_sent_proof(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_orders_guard_sent_proof() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.sent_at IS NOT NULL AND (
       NEW.sent_at IS DISTINCT FROM OLD.sent_at
    OR NEW.sent_channel IS DISTINCT FROM OLD.sent_channel
    OR NEW.sent_by IS DISTINCT FROM OLD.sent_by) THEN
    RAISE EXCEPTION 'purchase_order_sent_proof_immutable: envoi déjà enregistré'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL
     AND NEW.status NOT IN ('notified','confirmed','shipped','hub_received') THEN
    RAISE EXCEPTION 'purchase_order_sent_requires_submitted: seule une PO soumise peut être envoyée'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: recalculate_loyalty(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_loyalty(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_count  INTEGER;
  v_tier   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM orders
  WHERE user_id = p_user_id AND status = 'collected';

  SELECT id INTO v_tier
  FROM loyalty_tiers
  WHERE min_orders <= v_count
  ORDER BY min_orders DESC
  LIMIT 1;

  UPDATE users SET
    orders_count    = v_count,
    loyalty_tier_id = v_tier,
    loyalty_since   = CASE
      WHEN loyalty_tier_id IS DISTINCT FROM v_tier THEN NOW()
      ELSE loyalty_since
    END
  WHERE id = p_user_id;
END;
$$;


--
-- Name: sc_set_updated(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sc_set_updated() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: sourcing_check_api_requires_units(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sourcing_check_api_requires_units() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  offending_source text;
BEGIN
  SELECT em.source_id
    INTO offending_source
    FROM public.sourcing_source_execution_modes em
   WHERE em.mode = 'api'
     AND NOT EXISTS (
       SELECT 1
         FROM public.sourcing_source_provides sp
        WHERE sp.source_id = em.source_id
          AND sp.layer = 'units'
     )
   LIMIT 1;

  IF offending_source IS NOT NULL THEN
    RAISE EXCEPTION
      'capability invariant: source % supports api execution but does not provide units',
      offending_source
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: sourcing_check_binding_grain(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sourcing_check_binding_grain() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  observed_grain public.sourcing_observation_grain;
BEGIN
  SELECT grain
    INTO observed_grain
    FROM public.sourcing_observations
   WHERE observation_id = NEW.observation_id;

  IF observed_grain IS DISTINCT FROM NEW.grain THEN
    RAISE EXCEPTION 'resolution grain mismatch: observation % is %, binding is %',
      NEW.observation_id, observed_grain, NEW.grain
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: sourcing_check_canonical_hierarchy(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sourcing_check_canonical_hierarchy() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  parent_grain public.sourcing_observation_grain;
BEGIN
  IF NEW.grain = 'product' THEN
    IF NEW.parent_entity_id IS NOT NULL THEN
      RAISE EXCEPTION 'canonical hierarchy: product % cannot have parent', NEW.canonical_entity_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.parent_entity_id IS NULL THEN
    RAISE EXCEPTION 'canonical hierarchy: % % requires parent', NEW.grain, NEW.canonical_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT grain
    INTO parent_grain
    FROM public.sourcing_canonical_entities
   WHERE canonical_entity_id = NEW.parent_entity_id;

  IF NEW.grain = 'offer' AND parent_grain IS DISTINCT FROM 'product'::public.sourcing_observation_grain THEN
    RAISE EXCEPTION 'canonical hierarchy: offer % parent must be product', NEW.canonical_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.grain = 'unit' AND parent_grain IS DISTINCT FROM 'offer'::public.sourcing_observation_grain THEN
    RAISE EXCEPTION 'canonical hierarchy: unit % parent must be offer', NEW.canonical_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: sourcing_check_decision_grain(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sourcing_check_decision_grain() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  observed_grain public.sourcing_observation_grain;
  proposal_observation uuid;
  proposal_candidate uuid;
BEGIN
  IF NEW.observation_id IS NOT NULL THEN
    SELECT grain
      INTO observed_grain
      FROM public.sourcing_observations
     WHERE observation_id = NEW.observation_id;

    IF observed_grain IS DISTINCT FROM NEW.grain THEN
      RAISE EXCEPTION 'resolution grain mismatch: observation % is %, decision is %',
        NEW.observation_id, observed_grain, NEW.grain
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.proposal_id IS NOT NULL THEN
    SELECT observation_id, candidate_entity_id
      INTO proposal_observation, proposal_candidate
      FROM public.sourcing_match_proposals
     WHERE proposal_id = NEW.proposal_id;

    IF NEW.observation_id IS DISTINCT FROM proposal_observation THEN
      RAISE EXCEPTION 'resolution decision proposal observation mismatch'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.canonical_entity_id IS NOT NULL
       AND NEW.canonical_entity_id IS DISTINCT FROM proposal_candidate THEN
      RAISE EXCEPTION 'resolution decision proposal candidate mismatch'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: sourcing_check_proposal_grain(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sourcing_check_proposal_grain() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  observed_grain public.sourcing_observation_grain;
BEGIN
  SELECT grain
    INTO observed_grain
    FROM public.sourcing_observations
   WHERE observation_id = NEW.observation_id;

  IF observed_grain IS DISTINCT FROM NEW.grain THEN
    RAISE EXCEPTION 'resolution grain mismatch: observation % is %, proposal is %',
      NEW.observation_id, observed_grain, NEW.grain
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: sourcing_forbid_observation_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sourcing_forbid_observation_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION
    'append-only violation: % interdit sur %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;


--
-- Name: sourcing_forbid_resolution_audit_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sourcing_forbid_resolution_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION
    'append-only violation: % interdit sur %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;


--
-- Name: supplier_execution_group_members_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.supplier_execution_group_members_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_group_po uuid;
  v_group_provider text;
  v_order_po uuid;
  v_order_provider text;
BEGIN
  SELECT purchase_order_id, provider
    INTO v_group_po, v_group_provider
    FROM public.supplier_execution_groups
   WHERE id = NEW.supplier_execution_group_id
   FOR SHARE;

  SELECT purchase_order_id, provider
    INTO v_order_po, v_order_provider
    FROM public.supplier_execution_orders
   WHERE id = NEW.supplier_execution_order_id
   FOR SHARE;

  IF v_group_po IS DISTINCT FROM v_order_po
     OR v_group_provider IS DISTINCT FROM v_order_provider THEN
    RAISE EXCEPTION
      'supplier_execution_group_member_mismatch: parent et sous-ordre doivent partager purchase_order_id et provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;


--
-- Name: supplier_execution_payments_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.supplier_execution_payments_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_po uuid;
  v_provider text;
BEGIN
  IF NEW.supplier_execution_group_id IS NOT NULL THEN
    SELECT purchase_order_id, provider
      INTO v_po, v_provider
      FROM public.supplier_execution_groups
     WHERE id = NEW.supplier_execution_group_id
     FOR SHARE;
  ELSE
    SELECT purchase_order_id, provider
      INTO v_po, v_provider
      FROM public.supplier_execution_orders
     WHERE id = NEW.supplier_execution_order_id
     FOR SHARE;
  END IF;

  IF v_po IS NULL THEN
    RAISE EXCEPTION 'supplier_execution_payment_target_missing'
      USING ERRCODE = '23503';
  END IF;

  IF v_po IS DISTINCT FROM NEW.purchase_order_id
     OR v_provider IS DISTINCT FROM NEW.provider THEN
    RAISE EXCEPTION
      'supplier_execution_payment_target_mismatch: payment, target, purchase_order_id et provider doivent etre coherents'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;


--
-- Name: supplier_payment_settlements_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.supplier_payment_settlements_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'supplier_payment_settlements est append-only (% interdit) : corriger par une ligne de compensation', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;


--
-- Name: sync_has_variants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_has_variants() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  _product_id uuid;
  _count      integer;
BEGIN
  -- RÃ©cupÃ©rer le product_id concernÃ© (INSERT/UPDATE = NEW, DELETE = OLD)
  _product_id := COALESCE(NEW.product_id, OLD.product_id);

  SELECT COUNT(*) INTO _count
  FROM public.product_variants
  WHERE product_id = _product_id;

  UPDATE public.products
  SET has_variants = (_count > 0),
      updated_at   = NOW()
  WHERE id = _product_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: update_customs_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customs_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    entity_type text DEFAULT 'parcel'::text NOT NULL,
    entity_id uuid,
    severity text DEFAULT 'medium'::text NOT NULL,
    title text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    CONSTRAINT alerts_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


--
-- Name: assignment_capability_ceiling; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignment_capability_ceiling (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid NOT NULL,
    capability text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    limit_amount numeric(20,6),
    CONSTRAINT assignment_ceiling_limit_nonnegative_check CHECK (((limit_amount IS NULL) OR (limit_amount >= (0)::numeric)))
);


--
-- Name: TABLE assignment_capability_ceiling; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.assignment_capability_ceiling IS 'Maximum MARKET/DELEGABLE authority granted by central to one operating assignment.';


--
-- Name: COLUMN assignment_capability_ceiling.limit_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assignment_capability_ceiling.limit_amount IS 'Optional per-operation maximum for amount-bearing capability; NULL means unlimited ceiling.';


--
-- Name: assignment_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignment_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    is_operating_lead boolean DEFAULT false NOT NULL,
    effective_until timestamp with time zone,
    CONSTRAINT assignment_membership_effective_until_check CHECK (((effective_until IS NULL) OR (effective_until > granted_at))),
    CONSTRAINT assignment_membership_revocation_state_check CHECK ((((status = 'ACTIVE'::text) AND (revoked_at IS NULL)) OR ((status = 'REVOKED'::text) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT assignment_memberships_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text])))
);


--
-- Name: TABLE assignment_memberships; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.assignment_memberships IS 'Users acting under one Market Operating Assignment; capabilities are granted separately.';


--
-- Name: COLUMN assignment_memberships.is_operating_lead; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assignment_memberships.is_operating_lead IS 'Operating lead designation only. Grants no capability by itself.';


--
-- Name: COLUMN assignment_memberships.effective_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assignment_memberships.effective_until IS 'Optional membership expiry. Runtime enforcement is added by the owning service lot.';


--
-- Name: basket_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.basket_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    basket_id uuid NOT NULL,
    product_id uuid NOT NULL,
    added_by uuid,
    quantity integer DEFAULT 1 NOT NULL,
    price_kmf numeric(12,2) NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: baskets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.baskets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code text NOT NULL,
    type public.basket_type DEFAULT 'personal'::public.basket_type NOT NULL,
    owner_id uuid,
    expires_at timestamp with time zone,
    is_locked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: boutique_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boutique_categories (
    key text NOT NULL,
    label text NOT NULL,
    short_label text,
    section_emoji text DEFAULT 'ðŸ“¦'::text NOT NULL,
    icon_svg text,
    db_keys text[] DEFAULT '{}'::text[] NOT NULL,
    filter_type text,
    display_order integer DEFAULT 99 NOT NULL,
    show_in_rail boolean DEFAULT true NOT NULL,
    show_in_sections boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    image_alt text,
    theme_token text,
    accent_token text
);


--
-- Name: boutique_subcategories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boutique_subcategories (
    id integer NOT NULL,
    category_key text NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    short_label text,
    icon text DEFAULT 'âœ¨'::text NOT NULL,
    display_order integer DEFAULT 99 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    customs_category_key text,
    image_url text,
    image_alt text,
    object_classification_terms jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT boutique_subcategories_object_classification_terms_object CHECK ((jsonb_typeof(object_classification_terms) = 'object'::text))
);


--
-- Name: COLUMN boutique_subcategories.customs_category_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boutique_subcategories.customs_category_key IS 'Catégorie douanière/Komerce de proximité utilisée uniquement en fallback lorsque les signaux produit réels ne permettent pas un mapping lexical suffisamment fiable.';


--
-- Name: COLUMN boutique_subcategories.object_classification_terms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boutique_subcategories.object_classification_terms IS 'Indices stricts d objet pour la taxonomie commerciale, configurables en base; sans autorite de classement douanier.';


--
-- Name: boutique_subcategories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.boutique_subcategories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: boutique_subcategories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.boutique_subcategories_id_seq OWNED BY public.boutique_subcategories.id;


--
-- Name: business_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text DEFAULT 'number'::text NOT NULL,
    label_fr text NOT NULL,
    description text,
    min_value numeric,
    max_value numeric,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: business_rules_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_rules_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by uuid,
    change_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: capability_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capability_registry (
    capability text NOT NULL,
    class text NOT NULL,
    domain text NOT NULL,
    authority_scope text NOT NULL,
    delegation_mode text NOT NULL,
    requires_audit boolean DEFAULT false NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    effect text DEFAULT 'ACT'::text NOT NULL,
    amount_bearing boolean DEFAULT false NOT NULL,
    CONSTRAINT capability_registry_authority_scope_check CHECK ((authority_scope = ANY (ARRAY['MARKET'::text, 'GROUP'::text]))),
    CONSTRAINT capability_registry_class_check CHECK ((class = ANY (ARRAY['DELEGATION'::text, 'EXECUTION'::text, 'BOUNDARY'::text]))),
    CONSTRAINT capability_registry_delegation_mode_check CHECK ((delegation_mode = ANY (ARRAY['DELEGABLE'::text, 'CENTRAL_ONLY'::text]))),
    CONSTRAINT capability_registry_domain_check CHECK ((char_length(btrim(domain)) > 0)),
    CONSTRAINT capability_registry_effect_check CHECK ((effect = ANY (ARRAY['READ'::text, 'ACT'::text]))),
    CONSTRAINT capability_registry_group_central_only CHECK (((authority_scope <> 'GROUP'::text) OR (delegation_mode = 'CENTRAL_ONLY'::text))),
    CONSTRAINT capability_registry_status_check CHECK ((status = ANY (ARRAY['LIVE'::text, 'IMPLEMENTED_PENDING_MERGE'::text, 'CENTRAL_HELD'::text, 'READ_ONLY'::text, 'MISSING'::text])))
);


--
-- Name: TABLE capability_registry; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.capability_registry IS 'Executable market-delegation registry. Only rows where class = DELEGATION AND authority_scope = MARKET AND delegation_mode = DELEGABLE belong to the autonomy KPI denominator. market_config.update: CENTRAL_HELD by design, no local field to delegate (see migration 246) — excluded from the denominator despite class = DELEGATION.';


--
-- Name: carriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carriers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(50) DEFAULT 'maritime'::character varying,
    contact_name character varying(100),
    contact_phone character varying(30),
    contact_email character varying(100),
    avg_transit_days integer,
    cost_per_kg_kmf numeric(10,2),
    is_active boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: cart_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    share_token character varying(16) NOT NULL,
    cart_items jsonb NOT NULL,
    cart_total_kmf numeric(14,2) NOT NULL,
    items_count smallint NOT NULL,
    sharer_name character varying(50),
    sharer_ip_hash character varying(64),
    sharer_ua_hash character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    first_opened_at timestamp with time zone,
    open_count integer DEFAULT 0 NOT NULL,
    converted_order_id uuid,
    converted_at timestamp with time zone,
    type character varying(20) DEFAULT 'simple'::character varying NOT NULL,
    event_label character varying(100),
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: cash_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    collected_by uuid NOT NULL,
    relais_id uuid,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cash_confirmation_controls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_confirmation_controls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    market_id uuid NOT NULL,
    relais_id uuid NOT NULL,
    policy_assignment_id uuid,
    required_approvals smallint NOT NULL,
    state text NOT NULL,
    first_actor_user_id uuid NOT NULL,
    first_source text NOT NULL,
    first_at timestamp with time zone DEFAULT now() NOT NULL,
    second_actor_user_id uuid,
    second_source text,
    second_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_confirmation_controls_first_source_check CHECK ((char_length(btrim(first_source)) > 0)),
    CONSTRAINT cash_confirmation_controls_required_approvals_check CHECK ((required_approvals = ANY (ARRAY[1, 2]))),
    CONSTRAINT cash_confirmation_controls_state_check CHECK ((state = ANY (ARRAY['PENDING_SECOND'::text, 'APPROVED'::text, 'CONFIRMED'::text, 'CANCELLED'::text]))),
    CONSTRAINT cash_confirmation_second_actor_distinct CHECK (((second_actor_user_id IS NULL) OR (second_actor_user_id <> first_actor_user_id))),
    CONSTRAINT cash_confirmation_second_fields_consistent CHECK ((((second_actor_user_id IS NULL) AND (second_source IS NULL) AND (second_at IS NULL)) OR ((second_actor_user_id IS NOT NULL) AND (second_source IS NOT NULL) AND (second_at IS NOT NULL)))),
    CONSTRAINT cash_confirmation_state_consistent CHECK ((((state = 'PENDING_SECOND'::text) AND (required_approvals = 2) AND (second_actor_user_id IS NULL) AND (confirmed_at IS NULL) AND (cancelled_at IS NULL)) OR ((state = 'APPROVED'::text) AND (confirmed_at IS NULL) AND (cancelled_at IS NULL) AND (((required_approvals = 1) AND (second_actor_user_id IS NULL)) OR ((required_approvals = 2) AND (second_actor_user_id IS NOT NULL)))) OR ((state = 'CONFIRMED'::text) AND (confirmed_at IS NOT NULL) AND (cancelled_at IS NULL) AND (((required_approvals = 1) AND (second_actor_user_id IS NULL)) OR ((required_approvals = 2) AND (second_actor_user_id IS NOT NULL)))) OR ((state = 'CANCELLED'::text) AND (cancelled_at IS NOT NULL) AND (confirmed_at IS NULL))))
);


--
-- Name: TABLE cash_confirmation_controls; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_confirmation_controls IS 'Payment-owned control record for cash confirmation. First approval snapshots required approvals; a stricter in-flight requirement is never weakened by a later policy change.';


--
-- Name: cash_custody_losses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_custody_losses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    holder_id uuid NOT NULL,
    kind text NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    reason text NOT NULL,
    decided_by uuid NOT NULL,
    deposit_id uuid,
    reverses_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_custody_losses_amount_chk CHECK ((amount_kmf > (0)::numeric)),
    CONSTRAINT cash_custody_losses_decider_chk CHECK ((decided_by <> holder_id)),
    CONSTRAINT cash_custody_losses_kind_chk CHECK ((kind = ANY (ARRAY['LOSS'::text, 'LOSS_REVERSAL'::text]))),
    CONSTRAINT cash_custody_losses_reason_chk CHECK ((char_length(btrim(reason)) >= 10)),
    CONSTRAINT cash_custody_losses_reversal_chk CHECK ((((kind = 'LOSS'::text) AND (reverses_id IS NULL)) OR ((kind = 'LOSS_REVERSAL'::text) AND (reverses_id IS NOT NULL))))
);


--
-- Name: TABLE cash_custody_losses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_custody_losses IS 'Décisions centrales de perte (append-only, motivées, distinctes des montants reçus) ; correction par LOSS_REVERSAL.';


--
-- Name: cash_custody_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_custody_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deposit_id uuid NOT NULL,
    market_id uuid NOT NULL,
    kind text NOT NULL,
    actor_id uuid NOT NULL,
    amount_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    received_amount numeric(18,2),
    received_currency text,
    fx_rate_to_kmf numeric(18,6),
    proof_ref text,
    proof_url text,
    reason text,
    reverses_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_custody_receipts_amount_chk CHECK ((amount_kmf >= (0)::numeric)),
    CONSTRAINT cash_custody_receipts_kind_chk CHECK ((kind = ANY (ARRAY['RECEIVED'::text, 'REFUSED'::text, 'CONTROL'::text, 'REVERSAL'::text]))),
    CONSTRAINT cash_custody_receipts_proof_chk CHECK (((proof_ref IS NULL) OR (((char_length(btrim(proof_ref)) >= 3) AND (char_length(btrim(proof_ref)) <= 200)) AND (proof_ref !~* '(^|[^a-z])(sk|rk|pk|whsec)_'::text)))),
    CONSTRAINT cash_custody_receipts_shape_chk CHECK ((((kind = 'RECEIVED'::text) AND (amount_kmf > (0)::numeric) AND (received_amount > (0)::numeric) AND (reverses_id IS NULL)) OR ((kind = 'REFUSED'::text) AND (amount_kmf = (0)::numeric) AND (char_length(btrim(COALESCE(reason, ''::text))) >= 3) AND (reverses_id IS NULL)) OR ((kind = 'CONTROL'::text) AND (reverses_id IS NULL) AND ((amount_kmf > (0)::numeric) OR (char_length(btrim(COALESCE(reason, ''::text))) >= 3))) OR ((kind = 'REVERSAL'::text) AND (amount_kmf > (0)::numeric) AND (reverses_id IS NOT NULL) AND (char_length(btrim(COALESCE(reason, ''::text))) >= 3))))
);


--
-- Name: TABLE cash_custody_receipts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_custody_receipts IS 'Faits de réception d''une remise de garde (append-only) : RECEIVED (montant et devise/taux figés), REFUSED, CONTROL (final, acteur indépendant), REVERSAL (contre-écriture motivée).';


--
-- Name: cash_deposit_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_deposit_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_deposits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    deposit_method text NOT NULL,
    reference text,
    proof_url text,
    period_start date NOT NULL,
    period_end date NOT NULL,
    deposited_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deposit_ref text DEFAULT ('KDP-'::text || lpad((nextval('public.cash_deposit_ref_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    declared_amount numeric(18,2),
    declared_currency text,
    fx_rate_to_kmf numeric(18,6),
    fx_source text,
    market_id uuid,
    market_id_source text,
    movement_kind text DEFAULT 'LEGACY'::text NOT NULL,
    recipient_user_id uuid,
    destination_id uuid,
    regularizes_deposit_id uuid,
    CONSTRAINT cash_deposits_amount_positive_chk CHECK ((amount_kmf > (0)::numeric)),
    CONSTRAINT cash_deposits_custody_target_chk CHECK ((((movement_kind = 'LEGACY'::text) AND (recipient_user_id IS NULL) AND (destination_id IS NULL) AND (regularizes_deposit_id IS NULL)) OR ((movement_kind = 'TRANSFER'::text) AND (recipient_user_id IS NOT NULL) AND (destination_id IS NULL) AND (recipient_user_id <> agent_id) AND (declared_currency IS NOT NULL) AND (market_id IS NOT NULL)) OR ((movement_kind = 'FINAL'::text) AND (destination_id IS NOT NULL) AND (recipient_user_id IS NULL) AND (declared_currency IS NOT NULL) AND (market_id IS NOT NULL)))),
    CONSTRAINT cash_deposits_declared_snapshot_chk CHECK ((((declared_amount IS NULL) AND (declared_currency IS NULL) AND (fx_rate_to_kmf IS NULL) AND (fx_source IS NULL)) OR ((declared_amount > (0)::numeric) AND (declared_currency ~ '^[A-Z]{3}$'::text) AND (fx_rate_to_kmf > (0)::numeric) AND ((char_length(btrim(fx_source)) >= 2) AND (char_length(btrim(fx_source)) <= 200)) AND ((declared_currency <> 'KMF'::text) OR (fx_rate_to_kmf = (1)::numeric))))),
    CONSTRAINT cash_deposits_market_source_chk CHECK (((market_id_source IS NULL) OR (market_id_source = ANY (ARRAY['DERIVED_RELAIS'::text, 'DERIVED_MEMBERSHIP'::text, 'NONE'::text])))),
    CONSTRAINT cash_deposits_movement_kind_chk CHECK ((movement_kind = ANY (ARRAY['LEGACY'::text, 'TRANSFER'::text, 'FINAL'::text]))),
    CONSTRAINT cash_deposits_status_domain_chk CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'disputed'::text])))
);


--
-- Name: COLUMN cash_deposits.deposit_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_deposits.deposit_ref IS 'Référence métier stable du dépôt cash exposable au navigateur (KDP-xxxxxx). L UUID interne reste serveur-only.';


--
-- Name: COLUMN cash_deposits.declared_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_deposits.declared_amount IS 'Montant tel que déclaré par le relais, dans declared_currency. NULL = saisie historique en KMF (amount_kmf seul).';


--
-- Name: COLUMN cash_deposits.fx_rate_to_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_deposits.fx_rate_to_kmf IS 'KMF pour 1 unité de declared_currency, figé à la déclaration depuis currency_parities (jamais saisi).';


--
-- Name: COLUMN cash_deposits.market_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_deposits.market_id IS 'Market dérivé du relais de l''agent (trigger), jamais fourni librement ; NULL = agent sans relais (aucune allocation).';


--
-- Name: COLUMN cash_deposits.movement_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_deposits.movement_kind IS 'LEGACY = remise historique ; TRANSFER/FINAL/LOSS réservés PR 4 (contrainte PR3-only à lever alors).';


--
-- Name: COLUMN cash_deposits.recipient_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_deposits.recipient_user_id IS 'TRANSFER : personne habilitée désignée ; le solde ne bouge qu''à son acceptation.';


--
-- Name: COLUMN cash_deposits.destination_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_deposits.destination_id IS 'FINAL : destination finale ACTIVE ; la clôture exige réception prouvée + contrôle indépendant.';


--
-- Name: COLUMN cash_deposits.regularizes_deposit_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_deposits.regularizes_deposit_id IS 'Remise historique vérifiée que ce transfert régularise (jamais clôturée automatiquement).';


--
-- Name: cash_custody_movements; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cash_custody_movements AS
 SELECT 'COLLECTION'::text AS source,
    cc.id AS ref_id,
    NULL::uuid AS deposit_id,
    cc.collected_by AS holder_id,
    public.cash_collection_market(cc.relais_id, cc.collected_by) AS market_id,
    (cc.amount_kmf)::numeric AS delta_kmf,
    cc.confirmed_at AS occurred_at
   FROM public.cash_collections cc
UNION ALL
 SELECT 'TRANSFER_OUT'::text AS source,
    r.id AS ref_id,
    d.id AS deposit_id,
    d.agent_id AS holder_id,
    d.market_id,
    (-
        CASE
            WHEN (r.kind = 'REVERSAL'::text) THEN (- r.amount_kmf)
            ELSE r.amount_kmf
        END) AS delta_kmf,
    r.created_at AS occurred_at
   FROM ((public.cash_custody_receipts r
     JOIN public.cash_deposits d ON ((d.id = r.deposit_id)))
     LEFT JOIN public.cash_custody_receipts t ON ((t.id = r.reverses_id)))
  WHERE ((d.movement_kind = 'TRANSFER'::text) AND (COALESCE(t.kind, r.kind) = 'RECEIVED'::text))
UNION ALL
 SELECT 'TRANSFER_IN'::text AS source,
    r.id AS ref_id,
    d.id AS deposit_id,
    d.recipient_user_id AS holder_id,
    d.market_id,
        CASE
            WHEN (r.kind = 'REVERSAL'::text) THEN (- r.amount_kmf)
            ELSE r.amount_kmf
        END AS delta_kmf,
    r.created_at AS occurred_at
   FROM ((public.cash_custody_receipts r
     JOIN public.cash_deposits d ON ((d.id = r.deposit_id)))
     LEFT JOIN public.cash_custody_receipts t ON ((t.id = r.reverses_id)))
  WHERE ((d.movement_kind = 'TRANSFER'::text) AND (COALESCE(t.kind, r.kind) = 'RECEIVED'::text))
UNION ALL
 SELECT 'FINAL_CLOSURE'::text AS source,
    r.id AS ref_id,
    d.id AS deposit_id,
    d.agent_id AS holder_id,
    d.market_id,
    (-
        CASE
            WHEN (r.kind = 'REVERSAL'::text) THEN (- r.amount_kmf)
            ELSE r.amount_kmf
        END) AS delta_kmf,
    r.created_at AS occurred_at
   FROM ((public.cash_custody_receipts r
     JOIN public.cash_deposits d ON ((d.id = r.deposit_id)))
     LEFT JOIN public.cash_custody_receipts t ON ((t.id = r.reverses_id)))
  WHERE ((d.movement_kind = 'FINAL'::text) AND (COALESCE(t.kind, r.kind) = 'CONTROL'::text))
UNION ALL
 SELECT 'LOSS'::text AS source,
    l.id AS ref_id,
    l.deposit_id,
    l.holder_id,
    l.market_id,
        CASE
            WHEN (l.kind = 'LOSS'::text) THEN (- l.amount_kmf)
            ELSE l.amount_kmf
        END AS delta_kmf,
    l.created_at AS occurred_at
   FROM public.cash_custody_losses l;


--
-- Name: VIEW cash_custody_movements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.cash_custody_movements IS 'Autorité unique des soldes de garde : encaissements (+), transferts acceptés (−/+), clôtures finales contrôlées (−), pertes décidées (−), contre-écritures. Une déclaration seule ne bouge rien.';


--
-- Name: cash_custody_provenance_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_custody_provenance_edges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    collection_id uuid NOT NULL,
    parent_id uuid,
    receipt_id uuid NOT NULL,
    market_id uuid NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_custody_provenance_edges_amount_kmf_check CHECK ((amount_kmf > (0)::numeric)),
    CONSTRAINT cash_provenance_no_self_parent CHECK (((parent_id IS NULL) OR (parent_id <> id)))
);


--
-- Name: TABLE cash_custody_provenance_edges; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_custody_provenance_edges IS 'Golden 1D-B: revendications de provenance explicites, append-only; ne certifie pas la clôture financière. Les inversions de réception nécessitent une projection nette avant activation.';


--
-- Name: cash_deposit_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_deposit_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deposit_id uuid NOT NULL,
    collection_id uuid NOT NULL,
    market_id uuid NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    allocation_basis text DEFAULT 'RECONSTRUCTED'::text NOT NULL,
    allocation_source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_deposit_allocations_amount_chk CHECK ((amount_kmf > (0)::numeric)),
    CONSTRAINT cash_deposit_allocations_basis_chk CHECK ((allocation_basis = ANY (ARRAY['RECONSTRUCTED'::text, 'CONFIRMED'::text]))),
    CONSTRAINT cash_deposit_allocations_source_chk CHECK ((allocation_source = ANY (ARRAY['SERVER_FIFO'::text, 'LEGACY_BACKFILL'::text, 'AGENT_DESIGNATED'::text])))
);


--
-- Name: TABLE cash_deposit_allocations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_deposit_allocations IS 'Grand livre de garde: part de chaque encaissement couverte par une remise (append-only). RECONSTRUCTED = FIFO serveur/historique, non confirmé; ne décharge jamais l''agent.';


--
-- Name: cash_reconciliation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_reconciliation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    expected_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    declared_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    deposited_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    gap_collection integer DEFAULT 0 NOT NULL,
    gap_deposit integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: catalog_enrichment_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_enrichment_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    prompt_version integer NOT NULL,
    model text NOT NULL,
    status character varying(20) NOT NULL,
    confidence numeric(4,3),
    input_tokens integer,
    output_tokens integer,
    duration_ms integer,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_enrichment_runs_status_check CHECK (((status)::text = ANY ((ARRAY['ok'::character varying, 'low_confidence'::character varying, 'invalid_output'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: TABLE catalog_enrichment_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_enrichment_runs IS 'Trace de chaque appel d''enrichissement IA (doctrine catalogue §8 : échecs tracés, coût par produit suivi en tokens). ok = appliqué ; low_confidence = appliqué + needs_review ; invalid_output = JSON hors schéma, rien appliqué ; failed = erreur réseau/modèle, rien appliqué.';


--
-- Name: catalog_exclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_exclusions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    layer character varying(12) NOT NULL,
    label text NOT NULL,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    categories text[] DEFAULT '{}'::text[] NOT NULL,
    constraint_note text,
    legal_note text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_exclusions_layer_check CHECK (((layer)::text = ANY ((ARRAY['absolute'::character varying, 'restricted'::character varying])::text[])))
);


--
-- Name: TABLE catalog_exclusions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_exclusions IS 'Éligibilité « ce que Komerce peut recevoir » (doctrine catalogue §3). absolute = jamais, définitif. restricted = embarquement contraint (constraint_note). Étage ③ de la raffinerie, avant traduction.';


--
-- Name: catalog_field_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_field_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    field_name character varying(50) NOT NULL,
    field_value text NOT NULL,
    reason text,
    set_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE catalog_field_overrides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_field_overrides IS 'Retouches manuelles par champ, réappliquées après chaque re-raffinage (doctrine catalogue §5). Dernier override par champ gagne (UNIQUE). L''édition directe de la fiche générée est interdite par doctrine.';


--
-- Name: catalog_field_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_field_sync_state (
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    field_name text NOT NULL,
    source_id text NOT NULL,
    last_observation_id uuid NOT NULL,
    last_event_id text NOT NULL,
    last_observed_at timestamp with time zone NOT NULL,
    applied_value jsonb NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_field_sync_state_subject_type_check CHECK ((subject_type = ANY (ARRAY['product'::text, 'sku'::text])))
);


--
-- Name: TABLE catalog_field_sync_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_field_sync_state IS 'Owner: catalog. État courant (non-journal) de la dernière observation de changement de catalogue appliquée, par (subject_type, subject_id, field_name). Alimenté exclusivement par services/catalog-field-sync-application.js (Mission 2, DOCTRINE_CATALOG_CHANGE_INTAKE.md). N''écrit jamais products.cost_kmf (alimente le moteur économique actif, cf. services/pricing-output.js) ni offer_status/is_active/option_axes/sellable_units (lié à la publication, services/catalog-promotion/*) — decision-only pour ces champs, cette table n''en porte donc jamais de ligne applied.';


--
-- Name: COLUMN catalog_field_sync_state.applied_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.catalog_field_sync_state.applied_value IS 'Valeur appliquée, typée selon le champ (texte, tableau de médias, prix+devise) — preuve de lecture après écriture, jamais recalculée après coup.';


--
-- Name: catalog_global_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_global_access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid,
    reason text,
    revoked_at timestamp with time zone,
    revoked_by uuid
);


--
-- Name: TABLE catalog_global_access_grants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_global_access_grants IS 'Historique des grants autorisant les mutations du catalogue global Komerce. Le rôle admin seul ne confère jamais cette autorité.';


--
-- Name: catalog_glossary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_glossary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    term_source text NOT NULL,
    term_fr text NOT NULL,
    note text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE catalog_glossary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_glossary IS 'Glossaire EN→FR injecté dans l''enrichissement IA (doctrine catalogue §4). term_fr = ''='' signifie : conserver tel quel (marques, noms propres).';


--
-- Name: catalog_import_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.catalog_import_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: catalog_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    source_media_id text,
    url text NOT NULL,
    role character varying(20) DEFAULT 'PRODUCT'::character varying NOT NULL,
    alt text,
    option_values jsonb,
    display_order integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_media_option_values_object CHECK (((option_values IS NULL) OR (jsonb_typeof(option_values) = 'object'::text))),
    CONSTRAINT catalog_media_role_check CHECK (((role)::text = ANY ((ARRAY['PRODUCT'::character varying, 'SCENE'::character varying, 'DETAIL'::character varying, 'SIZE_GUIDE'::character varying, 'OTHER'::character varying])::text[])))
);


--
-- Name: TABLE catalog_media; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_media IS 'Média canonique catalogue (PDC-8 Lot 2). Cible de promotion depuis normalized_source_contract.media[]. Identité stable : product_id + source_media_id lorsque connu. Legacy (products.images / product_variants.images) reste le fallback pour les produits non promus.';


--
-- Name: COLUMN catalog_media.source_media_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.catalog_media.source_media_id IS 'supplier_media_id V2 tel quel. NULL = source pauvre, aucune identité fournisseur fabriquée : pas d''unicité applicable, ré-promotion peut dupliquer honnêtement.';


--
-- Name: catalog_media_recovery_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_media_recovery_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    product_ref text NOT NULL,
    candidate_ref text NOT NULL,
    actor_user_id uuid NOT NULL,
    source_media_ids text[] NOT NULL,
    source_media_hash text NOT NULL,
    active_before integer NOT NULL,
    active_after integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_media_recovery_audit_active_after_check CHECK ((active_after > 0)),
    CONSTRAINT catalog_media_recovery_audit_active_before_check CHECK ((active_before = 0))
);


--
-- Name: catalog_media_visual_fr_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_media_visual_fr_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    media_id uuid NOT NULL,
    source_media_id text NOT NULL,
    source_url text NOT NULL,
    option_values jsonb,
    text_presence text NOT NULL,
    source_transcription text,
    french_translation text,
    french_presentation jsonb,
    reviewed_by text NOT NULL,
    reviewed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_media_visual_fr_identity_nonempty CHECK (((length(btrim(source_media_id)) > 0) AND (length(btrim(source_url)) > 0))),
    CONSTRAINT catalog_media_visual_fr_option_values_object CHECK (((option_values IS NULL) OR (jsonb_typeof(option_values) = 'object'::text))),
    CONSTRAINT catalog_media_visual_fr_reviewer_nonempty CHECK ((length(btrim(reviewed_by)) > 0)),
    CONSTRAINT catalog_media_visual_fr_text_presence CHECK ((text_presence = ANY (ARRAY['NONE'::text, 'PRESENT'::text, 'UNREADABLE'::text])))
);


--
-- Name: TABLE catalog_media_visual_fr_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_media_visual_fr_reviews IS 'Explicit source-linked human visual-language review. A source URL or variant change invalidates the verdict at read time; not automatic publication authority.';


--
-- Name: catalog_publication_decision_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_publication_decision_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action text NOT NULL,
    product_id uuid,
    product_ref text NOT NULL,
    actor_user_id uuid,
    actor_role text,
    source_surface text DEFAULT 'catalog_approval'::text NOT NULL,
    reason text,
    overridden_fields text[] DEFAULT '{}'::text[] NOT NULL,
    before_snapshot jsonb NOT NULL,
    after_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_publication_decision_audit_action_chk CHECK ((action = ANY (ARRAY['CATALOG_PRODUCT_APPROVED'::text, 'CATALOG_PRODUCT_REJECTED'::text, 'CATALOG_PRODUCT_OVERRIDDEN_AND_APPROVED'::text])))
);


--
-- Name: catalog_stock_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_stock_sync_state (
    product_sku_id uuid NOT NULL,
    source_id text NOT NULL,
    last_observation_id uuid NOT NULL,
    last_event_id text NOT NULL,
    last_observed_at timestamp with time zone NOT NULL,
    applied_stock_value integer NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_stock_sync_state_applied_stock_value_check CHECK ((applied_stock_value >= 0))
);


--
-- Name: TABLE catalog_stock_sync_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_stock_sync_state IS 'Owner: catalog. État courant (non-journal) de la dernière observation de stock fournisseur appliquée par SKU. Alimenté exclusivement par le décideur de synchronisation de stock catalogue (Mission 1, DOCTRINE_CATALOG_CHANGE_INTAKE.md) — jamais par order-payment-confirmation.js ni order-status-machine.js, qui continuent de n''écrire que via product-stock-service.js#adjustStock.';


--
-- Name: COLUMN catalog_stock_sync_state.source_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.catalog_stock_sync_state.source_id IS 'sourcing_sources.source_id de la source ayant produit la dernière observation appliquée. Une observation d''une AUTRE source pour le même SKU est un cas explicitement hors périmètre de la première tranche (cf. doctrine SOURCE_LINEAGE_AMBIGUOUS déjà appliquée en amont par la preuve d''identité SKU).';


--
-- Name: COLUMN catalog_stock_sync_state.applied_stock_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.catalog_stock_sync_state.applied_stock_value IS 'Valeur de product_skus.stock immédiatement après cette application — preuve de lecture après écriture, jamais recalculée après coup.';


--
-- Name: catalog_taxonomy_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_taxonomy_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    category_key text NOT NULL,
    subcategory_key text,
    actor_user_id uuid,
    actor_role text,
    source_surface text DEFAULT 'catalog'::text NOT NULL,
    before_snapshot jsonb,
    after_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_taxonomy_audit_action_chk CHECK ((action = ANY (ARRAY['CATEGORY_CREATED'::text, 'CATEGORY_UPDATED'::text, 'CATEGORY_DEACTIVATED'::text, 'SUBCATEGORY_CREATED'::text, 'SUBCATEGORY_UPDATED'::text, 'SUBCATEGORY_DEACTIVATED'::text, 'SUBCATEGORY_DELETED'::text]))),
    CONSTRAINT catalog_taxonomy_audit_entity_chk CHECK ((entity_type = ANY (ARRAY['category'::text, 'subcategory'::text])))
);


--
-- Name: catalog_terminology_reference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_terminology_reference (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference_key text NOT NULL,
    source text NOT NULL,
    source_record_id text,
    dataset_domain text,
    subject_en text,
    subject_fr text,
    term_en text NOT NULL,
    term_en_normalized text NOT NULL,
    term_fr text NOT NULL,
    term_fr_normalized text NOT NULL,
    term_en_parameter text,
    term_fr_parameter text,
    abbreviation_en text,
    abbreviation_fr text,
    source_url text,
    source_license text NOT NULL,
    source_data_date date,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_terminology_reference_source_check CHECK ((source = ANY (ARRAY['termium_plus'::text, 'franceterme'::text, 'iate'::text, 'other'::text])))
);


--
-- Name: TABLE catalog_terminology_reference; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalog_terminology_reference IS 'External EN→FR terminology references. catalog_glossary remains the curated Komerce authority; this table provides sourced contextual candidates only.';


--
-- Name: COLUMN catalog_terminology_reference.reference_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.catalog_terminology_reference.reference_key IS 'Stable SHA-256 identity of source + record + EN/FR term + context, used for idempotent imports.';


--
-- Name: COLUMN catalog_terminology_reference.source_license; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.catalog_terminology_reference.source_license IS 'Licence provenance carried with every imported reference; TERMIUM Plus uses Open Government Licence – Canada.';


--
-- Name: ceiling_template_capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ceiling_template_capabilities (
    template_id uuid NOT NULL,
    capability text NOT NULL
);


--
-- Name: ceiling_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ceiling_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    version integer NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ceiling_templates_name_check CHECK ((char_length(btrim(name)) > 0)),
    CONSTRAINT ceiling_templates_version_check CHECK ((version > 0))
);


--
-- Name: charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family text NOT NULL,
    name text NOT NULL,
    amount_kmf numeric NOT NULL,
    is_recurring boolean DEFAULT false,
    recurrence_period text,
    is_active boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    emoji text,
    display_order integer DEFAULT 100,
    is_editable boolean DEFAULT true,
    is_deletable boolean DEFAULT true,
    market_owner_id uuid
);


--
-- Name: COLUMN charges.market_owner_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.charges.market_owner_id IS 'Null = shared reference. Non-null = only this market can select or record facts for the reference; never use as GROUP pool.';


--
-- Name: client_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_key text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    order_reference text NOT NULL,
    severity text DEFAULT 'important'::text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    action_target text DEFAULT 'orders'::text NOT NULL,
    requires_ack boolean DEFAULT true NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledged_at timestamp with time zone,
    resolved_at timestamp with time zone,
    CONSTRAINT client_notifications_action_target_check CHECK ((action_target = 'orders'::text)),
    CONSTRAINT client_notifications_entity_type_check CHECK ((entity_type = 'order'::text)),
    CONSTRAINT client_notifications_severity_check CHECK ((severity = ANY (ARRAY['important'::text, 'urgent'::text]))),
    CONSTRAINT client_notifications_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text])))
);


--
-- Name: TABLE client_notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.client_notifications IS 'Notifications in-app essentielles. Aucun canal externe et aucun contenu sensible.';


--
-- Name: pricing_competitor_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pricing_competitor_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: competitor_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitor_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    category text,
    competitor_name text NOT NULL,
    price_kmf numeric(14,2) NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'manual'::text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    competitor_ref text DEFAULT ('KPC-'::text || lpad((nextval('public.pricing_competitor_ref_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    CONSTRAINT competitor_target_check CHECK (((product_id IS NOT NULL) OR (category IS NOT NULL)))
);


--
-- Name: cost_benchmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_benchmarks (
    id integer NOT NULL,
    category text DEFAULT 'all'::text NOT NULL,
    cost_family text NOT NULL,
    expected_share_pct numeric(6,2) NOT NULL,
    warn_ratio numeric(5,2) DEFAULT 1.30 NOT NULL,
    alert_ratio numeric(5,2) DEFAULT 1.60 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cost_benchmarks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cost_benchmarks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cost_benchmarks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cost_benchmarks_id_seq OWNED BY public.cost_benchmarks.id;


--
-- Name: cost_component_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_component_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    component_id uuid,
    component_key text,
    event_type text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    notes text,
    triggered_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cost_component_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'updated'::text, 'activated'::text, 'deactivated'::text, 'deleted'::text, 'value_changed'::text, 'scope_changed'::text])))
);


--
-- Name: cost_component_market_override_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_component_market_override_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    override_id uuid,
    market_id uuid NOT NULL,
    component_id uuid,
    component_key text NOT NULL,
    event_type text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    notes text,
    triggered_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cost_component_market_override_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'updated'::text, 'reset'::text])))
);


--
-- Name: TABLE cost_component_market_override_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cost_component_market_override_events IS 'Append-only audit trail for market cost model changes and resets.';


--
-- Name: cost_component_market_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_component_market_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    component_id uuid NOT NULL,
    default_value numeric(14,4),
    is_active boolean,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    label_override character varying(160),
    description_override character varying(500),
    CONSTRAINT cost_component_market_overrides_default_value_check CHECK (((default_value IS NULL) OR (default_value >= (0)::numeric)))
);


--
-- Name: TABLE cost_component_market_overrides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cost_component_market_overrides IS 'Market-specific value/activation overrides for global cost_components. No row = inherit global.';


--
-- Name: cost_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    emoji text,
    description text,
    family text NOT NULL,
    category text NOT NULL,
    default_value numeric(14,4) DEFAULT 0 NOT NULL,
    unit text NOT NULL,
    currency text,
    scope text DEFAULT 'global'::text NOT NULL,
    scope_value text,
    allocation_method text DEFAULT 'none'::text NOT NULL,
    source text DEFAULT 'default'::text NOT NULL,
    confidence text DEFAULT 'medium'::text NOT NULL,
    channel text,
    island text,
    is_active boolean DEFAULT true NOT NULL,
    is_exceptional boolean DEFAULT false NOT NULL,
    active_from date,
    active_until date,
    is_editable boolean DEFAULT true NOT NULL,
    is_deletable boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 100 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    economic_nature text,
    allocation_perimeter text DEFAULT 'direct'::text NOT NULL,
    provenance text,
    CONSTRAINT cost_components_allocation_check CHECK ((allocation_method = ANY (ARRAY['none'::text, 'per_order'::text, 'per_item'::text, 'by_value'::text, 'by_weight'::text, 'by_volume'::text, 'by_taxable_weight'::text, 'by_quantity'::text, 'by_category_risk'::text, 'manual'::text]))),
    CONSTRAINT cost_components_allocation_perimeter_check CHECK ((allocation_perimeter = ANY (ARRAY['direct'::text, 'mutualized'::text]))),
    CONSTRAINT cost_components_category_check CHECK ((category = ANY (ARRAY['product_purchase'::text, 'sourcing'::text, 'hub'::text, 'packaging'::text, 'freight'::text, 'customs'::text, 'port_transitary'::text, 'local_distribution'::text, 'relay'::text, 'payment'::text, 'risk_provision'::text, 'fixed_overhead'::text, 'incident'::text, 'marketing_campaign'::text]))),
    CONSTRAINT cost_components_channel_check CHECK (((channel IS NULL) OR (channel = ANY (ARRAY['cash_relais'::text, 'diaspora'::text, 'mobile_money'::text])))),
    CONSTRAINT cost_components_confidence_check CHECK ((confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT cost_components_economic_nature_check CHECK (((economic_nature IS NULL) OR (economic_nature = ANY (ARRAY['variable'::text, 'fixed'::text])))),
    CONSTRAINT cost_components_family_category_consistency CHECK ((((family = 'landed_relay'::text) AND (category = ANY (ARRAY['product_purchase'::text, 'sourcing'::text, 'hub'::text, 'packaging'::text, 'freight'::text, 'customs'::text, 'port_transitary'::text, 'local_distribution'::text, 'relay'::text]))) OR ((family = 'business'::text) AND (category = ANY (ARRAY['payment'::text, 'risk_provision'::text, 'fixed_overhead'::text]))) OR ((family = 'exceptional'::text) AND (category = ANY (ARRAY['incident'::text, 'marketing_campaign'::text]))))),
    CONSTRAINT cost_components_family_check CHECK ((family = ANY (ARRAY['landed_relay'::text, 'business'::text, 'exceptional'::text]))),
    CONSTRAINT cost_components_island_check CHECK (((island IS NULL) OR (island = ANY (ARRAY['grande_comore'::text, 'moheli'::text, 'anjouan'::text, 'mayotte'::text])))),
    CONSTRAINT cost_components_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'category'::text, 'product'::text, 'order'::text, 'parcel'::text, 'shipment'::text, 'supplier'::text, 'relay'::text]))),
    CONSTRAINT cost_components_source_check CHECK ((source = ANY (ARRAY['default'::text, 'category'::text, 'manual'::text, 'supplier'::text, 'real'::text, 'missing'::text]))),
    CONSTRAINT cost_components_unit_check CHECK ((unit = ANY (ARRAY['kmf'::text, 'pct'::text, 'kmf_per_kg'::text, 'kmf_per_m3'::text, 'kmf_per_order'::text, 'kmf_per_parcel'::text, 'kmf_per_shipment'::text, 'aed'::text, 'eur'::text, 'usd'::text])))
);


--
-- Name: COLUMN cost_components.economic_nature; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cost_components.economic_nature IS 'Nature economique canonique: variable ou fixed. NULL uniquement lorsque la nature doit encore etre qualifiee explicitement.';


--
-- Name: COLUMN cost_components.allocation_perimeter; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cost_components.allocation_perimeter IS 'Perimetre canonique: direct ou mutualized. Independent de la nature economique.';


--
-- Name: COLUMN cost_components.provenance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cost_components.provenance IS 'Provenance déclarée de la valeur saisie. Un coût réel dérivé exige auteur ET provenance.';


--
-- Name: currency_parities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency_parities (
    currency text NOT NULL,
    eur_rate numeric(14,5) NOT NULL,
    source_note text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE currency_parities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.currency_parities IS 'Source unique des parités fixes vers EUR (reference_currency de la Currency Boundary). Un seul axe par devise — jamais de paire directe entre deux devises Zone franc. Ne contient QUE des devises à parité fixe garantie ; les devises de sourcing flottantes (USD/AED/CNY) sont un concern séparé, hors de cette table par construction (freeze 22-08-2026, invariants 4/5/9).';


--
-- Name: COLUMN currency_parities.eur_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.currency_parities.eur_rate IS 'Unités de currency pour 1 EUR. Ex: KMF -> 491.96775 signifie 1 EUR = 491,96775 KMF. Pour projeter un montant EUR vers currency : amount_eur * eur_rate. Pour l''inverse : amount_currency / eur_rate.';


--
-- Name: customs_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    sub_label text,
    emoji text,
    douane_pct numeric(5,2) DEFAULT 0 NOT NULL,
    tva_pct numeric(5,2) DEFAULT 10 NOT NULL,
    taxe_add_pct numeric(5,2) DEFAULT 0 NOT NULL,
    default_dim_l_cm integer,
    default_dim_w_cm integer,
    default_dim_h_cm integer,
    sh_code text,
    hint text,
    default_margin_pct numeric(5,2),
    display_order integer DEFAULT 0,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    classification_terms jsonb DEFAULT '{}'::jsonb NOT NULL,
    default_weight_kg numeric(8,3),
    CONSTRAINT customs_categories_classification_terms_object CHECK ((jsonb_typeof(classification_terms) = 'object'::text)),
    CONSTRAINT customs_categories_default_weight_positive CHECK (((default_weight_kg IS NULL) OR (default_weight_kg > (0)::numeric)))
);


--
-- Name: COLUMN customs_categories.classification_terms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_categories.classification_terms IS 'Termes/phrases pondérés de classification fournisseur. Donnée administrable ; le produit réellement retourné fait autorité sur l intention de découverte.';


--
-- Name: COLUMN customs_categories.default_weight_kg; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_categories.default_weight_kg IS 'Poids logistique par défaut de la catégorie lorsque le fournisseur ne fournit pas de poids fiable.';


--
-- Name: customs_shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_shipments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reference text NOT NULL,
    shipment_date date NOT NULL,
    transitaire_name text,
    transport_mode text,
    cif_value_kmf numeric(12,2) NOT NULL,
    customs_paid_kmf numeric(12,2) DEFAULT NULL::numeric,
    freight_kmf numeric(12,2),
    total_weight_kg numeric(10,3),
    nb_parcels integer,
    allocation_method text DEFAULT 'by_cif_value'::text NOT NULL,
    allocation_config jsonb,
    effective_rate_pct numeric(6,2) GENERATED ALWAYS AS (
CASE
    WHEN (cif_value_kmf > (0)::numeric) THEN round(((customs_paid_kmf / cif_value_kmf) * (100)::numeric), 2)
    ELSE (0)::numeric
END) STORED,
    is_active boolean DEFAULT true NOT NULL,
    deactivated_at timestamp with time zone,
    deactivated_reason text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_id uuid,
    status public.customs_shipment_status DEFAULT 'pending'::public.customs_shipment_status NOT NULL,
    declared_at timestamp with time zone,
    declared_by uuid,
    total_volume_m3 numeric(8,4),
    market_id uuid,
    CONSTRAINT customs_shipments_allocation_method_check CHECK ((allocation_method = ANY (ARRAY['by_cif_value'::text, 'by_weight'::text, 'by_volume'::text, 'mixed'::text, 'manual'::text]))),
    CONSTRAINT customs_shipments_transport_mode_check CHECK ((transport_mode = ANY (ARRAY['sea'::text, 'air'::text, 'land'::text])))
);


--
-- Name: COLUMN customs_shipments.total_volume_m3; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_shipments.total_volume_m3 IS 'Volume total facturé par le transitaire (m³), saisi depuis la facture. Sert au taux de remplissage et au tonnage taxable W/M (v_shipment_density).';


--
-- Name: COLUMN customs_shipments.market_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_shipments.market_id IS 'Marché propriétaire de l expédition douane. Autorité serveur pour les Workspaces Canonical; NULL = legacy non résolu, non actionnable en Canonical.';


--
-- Name: customs_effective_rates; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customs_effective_rates AS
 SELECT p.period,
    count(s.id) AS nb_shipments,
    COALESCE(sum(s.cif_value_kmf) FILTER (WHERE (s.customs_paid_kmf IS NOT NULL)), (0)::numeric) AS total_cif_kmf,
    COALESCE(sum(s.customs_paid_kmf), (0)::numeric) AS total_customs_kmf,
        CASE
            WHEN (COALESCE(sum(s.cif_value_kmf) FILTER (WHERE (s.customs_paid_kmf IS NOT NULL)), (0)::numeric) > (0)::numeric) THEN round(((sum(s.customs_paid_kmf) / sum(s.cif_value_kmf) FILTER (WHERE (s.customs_paid_kmf IS NOT NULL))) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS rate_pct,
    count(s.id) FILTER (WHERE (s.customs_paid_kmf IS NOT NULL)) AS nb_observed,
    count(s.id) FILTER (WHERE (s.customs_paid_kmf IS NULL)) AS nb_unknown
   FROM (( VALUES ('last_30d'::text,30), ('last_90d'::text,90), ('last_365d'::text,365)) p(period, days)
     LEFT JOIN public.customs_shipments s ON (((s.is_active = true) AND (s.shipment_date >= (CURRENT_DATE - ((p.days)::double precision * '1 day'::interval))))))
  GROUP BY p.period;


--
-- Name: customs_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    shipment_id uuid,
    sh_category text NOT NULL,
    product_category text,
    customs_estimated_kmf numeric(14,2) NOT NULL,
    customs_real_kmf numeric(14,2),
    customs_date date DEFAULT CURRENT_DATE NOT NULL,
    customs_agent_id text,
    customs_notes text,
    is_anomaly boolean DEFAULT false NOT NULL,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    valeur_cif_kmf numeric(14,2),
    droits_douane_kmf numeric(14,2) DEFAULT 0,
    tva_import_kmf numeric(14,2) DEFAULT 0,
    taxes_diverses_kmf numeric(14,2) DEFAULT 0,
    frais_portuaires_kmf numeric(14,2) DEFAULT 0,
    frais_agent_kmf numeric(14,2) DEFAULT 0,
    taux_aed_kmf numeric(8,2),
    taux_eur_kmf numeric(8,2),
    nb_colis integer DEFAULT 1,
    statut text DEFAULT 'validated'::text,
    updated_at timestamp with time zone DEFAULT now(),
    droits_payes_kmf numeric(14,2),
    taux_effectif_pct numeric(6,2),
    notes text,
    customs_delta_kmf numeric(14,2) GENERATED ALWAYS AS ((customs_real_kmf - customs_estimated_kmf)) STORED,
    customs_delta_pct numeric GENERATED ALWAYS AS (
CASE
    WHEN (customs_estimated_kmf > (0)::numeric) THEN round(((((customs_real_kmf)::numeric / (customs_estimated_kmf)::numeric) - (1)::numeric) * (100)::numeric), 4)
    ELSE NULL::numeric
END) STORED,
    CONSTRAINT customs_history_statut_check CHECK ((statut = ANY (ARRAY['validated'::text, 'contested'::text, 'pending'::text, 'anomaly'::text])))
);


--
-- Name: TABLE customs_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customs_history IS 'Historique de chaque passage douanier â€” source de vÃ©ritÃ© pour le coefficient de risque';


--
-- Name: COLUMN customs_history.customs_agent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_history.customs_agent_id IS 'Identifiant ou nom agent douanier â€” dÃ©tection de patterns de sur-Ã©valuation';


--
-- Name: COLUMN customs_history.is_anomaly; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_history.is_anomaly IS 'true si customs_real > 2Ã— customs_estimated â€” alerte back-office automatique';


--
-- Name: customs_invoice_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customs_invoice_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customs_shipment_fees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_shipment_fees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    fee_type text NOT NULL,
    kind text DEFAULT 'charge'::text NOT NULL,
    amount_currency numeric(18,4) NOT NULL,
    currency text NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    proof_ref text NOT NULL,
    idempotency_key text NOT NULL,
    notes text,
    recorded_by uuid,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    post_closure boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_csf_amount_currency CHECK ((amount_currency >= (0)::numeric)),
    CONSTRAINT chk_csf_amount_kmf CHECK ((amount_kmf >= (0)::numeric)),
    CONSTRAINT chk_csf_credit_positive CHECK (((kind = 'charge'::text) OR (amount_kmf > (0)::numeric))),
    CONSTRAINT chk_csf_currency CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT chk_csf_fee_type CHECK ((fee_type = ANY (ARRAY['handling'::text, 'storage'::text, 'forwarder'::text, 'local_tax'::text, 'exceptional'::text, 'other'::text]))),
    CONSTRAINT chk_csf_idem CHECK ((btrim(idempotency_key) <> ''::text)),
    CONSTRAINT chk_csf_kind CHECK ((kind = ANY (ARRAY['charge'::text, 'credit'::text]))),
    CONSTRAINT chk_csf_kmf_currency CHECK (((currency <> 'KMF'::text) OR (amount_currency = amount_kmf))),
    CONSTRAINT chk_csf_proof CHECK ((btrim(proof_ref) <> ''::text))
);


--
-- Name: COLUMN customs_shipment_fees.post_closure; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_shipment_fees.post_closure IS 'TRUE = ligne enregistrée après clôture de l''expédition (status confirmed) ; correction tracée, montant d''origine jamais réécrit.';


--
-- Name: customs_shipment_financial_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_shipment_financial_audit (
    id bigint NOT NULL,
    shipment_id uuid NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id text,
    reason text,
    old_values jsonb NOT NULL,
    new_values jsonb NOT NULL
);


--
-- Name: customs_shipment_financial_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customs_shipment_financial_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customs_shipment_financial_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customs_shipment_financial_audit_id_seq OWNED BY public.customs_shipment_financial_audit.id;


--
-- Name: customs_shipment_parcel_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_shipment_parcel_events (
    id bigint NOT NULL,
    shipment_id uuid NOT NULL,
    parcel_id uuid NOT NULL,
    event text NOT NULL,
    actor_id text,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customs_shipment_parcel_events_event_check CHECK ((event = ANY (ARRAY['attach'::text, 'detach'::text]))),
    CONSTRAINT customs_shipment_parcel_events_reason_check CHECK ((length(btrim(reason)) > 0))
);


--
-- Name: customs_shipment_parcel_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customs_shipment_parcel_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customs_shipment_parcel_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customs_shipment_parcel_events_id_seq OWNED BY public.customs_shipment_parcel_events.id;


--
-- Name: customs_shipment_parcels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_shipment_parcels (
    shipment_id uuid NOT NULL,
    parcel_id uuid NOT NULL,
    parcel_cif_kmf numeric(12,2),
    parcel_weight_kg numeric(10,3),
    customs_share_kmf numeric(12,2),
    allocation_basis text,
    manual_override boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parcel_volume_cm3 numeric(12,2)
);


--
-- Name: COLUMN customs_shipment_parcels.parcel_volume_cm3; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_shipment_parcels.parcel_volume_cm3 IS 'Snapshot du volume du colis (cm3) au moment du rattachement au shipment. Utilise pour ventiler le fret maritime au m3 (doctrine LCL) au lieu du poids. NULL pour les rattachements anterieurs a la migration 095 -> repartition egale, confidence low (jamais le poids en maritime).';


--
-- Name: customs_taux_actuel; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customs_taux_actuel AS
 SELECT COALESCE(taux_effectif_pct, round(((COALESCE(droits_payes_kmf, (customs_real_kmf)::numeric, (0)::numeric) / NULLIF(COALESCE(valeur_cif_kmf, (customs_estimated_kmf)::numeric), (0)::numeric)) * (100)::numeric), 2)) AS taux_effectif_pct,
    customs_date AS date_dedouanement,
    sh_category AS categorie_declaree,
    nb_colis,
    COALESCE(valeur_cif_kmf, (customs_estimated_kmf)::numeric) AS valeur_cif_kmf,
    COALESCE(droits_payes_kmf, (customs_real_kmf)::numeric) AS droits_payes_kmf,
    customs_notes AS notes
   FROM public.customs_history
  WHERE ((COALESCE(statut, 'validated'::text) = 'validated'::text) AND (customs_date IS NOT NULL) AND (COALESCE(droits_payes_kmf, (customs_real_kmf)::numeric) IS NOT NULL))
  ORDER BY customs_date DESC
 LIMIT 1;


--
-- Name: customs_taux_mensuel; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customs_taux_mensuel AS
 SELECT to_char(created_at, 'YYYY-MM'::text) AS mois,
    round(avg(customs_delta_pct), 2) AS taux_effectif_pct
   FROM public.customs_history
  WHERE (customs_real_kmf > (0)::numeric)
  GROUP BY (to_char(created_at, 'YYYY-MM'::text));


--
-- Name: dashboard_global_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_global_access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid,
    reason text,
    revoked_at timestamp with time zone,
    revoked_by uuid
);


--
-- Name: TABLE dashboard_global_access_grants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dashboard_global_access_grants IS 'Historique des grants autorisant le contexte dashboard global Komerce. Jamais dérivé du rôle admin ni de l absence de operator_market_scopes.';


--
-- Name: COLUMN dashboard_global_access_grants.revoked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_global_access_grants.revoked_at IS 'NULL = grant global actif. Révocation historisée par UPDATE, jamais DELETE.';


--
-- Name: decision_signal_global_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_signal_global_access_grants (
    user_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid,
    reason text,
    revoked_at timestamp with time zone
);


--
-- Name: decision_signal_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.decision_signal_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: demo_kpr_backup_20261024; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_kpr_backup_20261024 (
    id uuid,
    sku text,
    name text,
    description text,
    category text,
    emoji text,
    price_kmf numeric(12,2),
    cost_kmf numeric(12,2),
    promo_pct integer,
    promo_until date,
    stock integer,
    weight_kg numeric(6,2),
    is_active boolean,
    is_promo boolean,
    image_url text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    price_aed numeric(10,2),
    source text,
    dims_l numeric(8,2),
    dims_w numeric(8,2),
    dims_h numeric(8,2),
    customs_risk_coeff numeric(5,3),
    customs_risk_updated date,
    price_eur numeric(12,2),
    dimensions_cm text,
    images jsonb,
    badge text,
    is_available boolean,
    has_couture boolean,
    sourcing_source text,
    sort_order integer,
    unsold_price_kmf numeric(12,2),
    unsold_channel character varying(20),
    requires_secure_transport boolean,
    volume_cm3 numeric(10,2),
    is_fragile boolean,
    is_bulky boolean,
    compatibility_group text,
    subcategory text,
    sourcing_rail text,
    volume_class text,
    fragility text,
    sale_mode text,
    exposure_mode text,
    lifecycle_status text,
    quality_validated boolean,
    real_weight_known boolean,
    real_price_validated boolean,
    delivery_delay_days integer,
    supplier_notes text,
    last_review_at timestamp with time zone,
    has_variants boolean,
    product_ref text,
    repack_volume_cm3 numeric(10,2),
    repack_exempt boolean,
    name_source text,
    description_source text,
    source_locale character varying(8),
    content_source character varying(20),
    enrichment_version integer,
    needs_review boolean,
    enrichment_confidence numeric(4,3),
    inventory_model text,
    series text,
    air_excluded boolean,
    air_eligibility_status public.air_eligibility_status,
    air_exclusion_reason text,
    boutique_category_key text,
    boutique_subcategory_key text,
    target_margin_pct numeric(5,2)
);


--
-- Name: demo_kpr_exposure_backup_20261024; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_kpr_exposure_backup_20261024 (
    id uuid,
    product_id uuid,
    market_id uuid,
    commercial_exposure text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disputes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    type text NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    description text,
    photo_urls text[] DEFAULT '{}'::text[],
    resolution text,
    refund_kmf numeric(14,2) DEFAULT 0,
    refund_eur numeric(10,2) DEFAULT 0,
    created_by uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    confection_type text,
    CONSTRAINT disputes_level_check CHECK ((level = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT disputes_status_check CHECK ((status = ANY (ARRAY['open'::text, 'processing'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: COLUMN disputes.confection_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.disputes.confection_type IS 'Si litige liÃ© Ã  un service couture : type du service concernÃ©';


--
-- Name: economic_risk_cost_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.economic_risk_cost_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    order_id uuid,
    risk_provision_id uuid,
    risk_key_snapshot text NOT NULL,
    risk_label_snapshot text NOT NULL,
    event_kind text NOT NULL,
    adjusts_event_id uuid,
    economic_at timestamp with time zone NOT NULL,
    amount_original numeric(18,4) NOT NULL,
    currency text NOT NULL,
    fx_rate_to_kmf numeric(18,6) NOT NULL,
    fx_source text NOT NULL,
    amount_kmf numeric(18,2) NOT NULL,
    source_kind text NOT NULL,
    evidence_ref text NOT NULL,
    notes text,
    recorded_by uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT economic_risk_cost_events_adjustment_link_check CHECK ((((event_kind = 'ACCRUAL'::text) AND (adjusts_event_id IS NULL)) OR ((event_kind = ANY (ARRAY['ADJUSTMENT'::text, 'REVERSAL'::text])) AND (adjusts_event_id IS NOT NULL)))),
    CONSTRAINT economic_risk_cost_events_amount_kmf_check CHECK ((amount_kmf <> (0)::numeric)),
    CONSTRAINT economic_risk_cost_events_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT economic_risk_cost_events_event_kind_check CHECK ((event_kind = ANY (ARRAY['ACCRUAL'::text, 'ADJUSTMENT'::text, 'REVERSAL'::text]))),
    CONSTRAINT economic_risk_cost_events_evidence_ref_check CHECK (((char_length(btrim(evidence_ref)) >= 3) AND (char_length(btrim(evidence_ref)) <= 1000))),
    CONSTRAINT economic_risk_cost_events_fx_rate_to_kmf_check CHECK ((fx_rate_to_kmf > (0)::numeric)),
    CONSTRAINT economic_risk_cost_events_fx_source_check CHECK (((char_length(btrim(fx_source)) >= 2) AND (char_length(btrim(fx_source)) <= 200))),
    CONSTRAINT economic_risk_cost_events_kmf_fx_check CHECK (((currency <> 'KMF'::text) OR (fx_rate_to_kmf = (1)::numeric))),
    CONSTRAINT economic_risk_cost_events_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000))),
    CONSTRAINT economic_risk_cost_events_risk_key_snapshot_check CHECK (((char_length(btrim(risk_key_snapshot)) >= 1) AND (char_length(btrim(risk_key_snapshot)) <= 200))),
    CONSTRAINT economic_risk_cost_events_risk_label_snapshot_check CHECK (((char_length(btrim(risk_label_snapshot)) >= 1) AND (char_length(btrim(risk_label_snapshot)) <= 300))),
    CONSTRAINT economic_risk_cost_events_sign_check CHECK ((((event_kind = 'ACCRUAL'::text) AND (amount_kmf > (0)::numeric) AND (amount_original > (0)::numeric)) OR ((event_kind = 'REVERSAL'::text) AND (amount_kmf < (0)::numeric) AND (amount_original < (0)::numeric)) OR ((event_kind = 'ADJUSTMENT'::text) AND (amount_kmf <> (0)::numeric) AND (amount_original <> (0)::numeric)))),
    CONSTRAINT economic_risk_cost_events_source_kind_check CHECK (((char_length(btrim(source_kind)) >= 2) AND (char_length(btrim(source_kind)) <= 100)))
);


--
-- Name: TABLE economic_risk_cost_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.economic_risk_cost_events IS 'Vérité append-only des pertes/sinistres réalisés N2 par marché. risk_provisions reste une configuration ; aucune absence de ligne ne vaut zéro.';


--
-- Name: COLUMN economic_risk_cost_events.economic_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.economic_risk_cost_events.economic_at IS 'Date économique du risque réalisé ; les corrections gardent la date du fait original afin de ne pas déplacer le coût entre fenêtres.';


--
-- Name: economic_risk_watermark_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.economic_risk_watermark_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    closed_through timestamp with time zone NOT NULL,
    review_version text NOT NULL,
    source text NOT NULL,
    evidence_ref text NOT NULL,
    notes text,
    recorded_by uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT economic_risk_watermark_events_evidence_ref_check CHECK (((char_length(btrim(evidence_ref)) >= 3) AND (char_length(btrim(evidence_ref)) <= 1000))),
    CONSTRAINT economic_risk_watermark_events_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000))),
    CONSTRAINT economic_risk_watermark_events_review_version_check CHECK (((char_length(btrim(review_version)) >= 1) AND (char_length(btrim(review_version)) <= 100))),
    CONSTRAINT economic_risk_watermark_events_source_check CHECK (((char_length(btrim(source)) >= 3) AND (char_length(btrim(source)) <= 500)))
);


--
-- Name: TABLE economic_risk_watermark_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.economic_risk_watermark_events IS 'Certifications append-only de revue du risque par marché. Un closed_through explicite permet de prouver un zéro réalisé sans inventer un événement de coût nul.';


--
-- Name: COLUMN economic_risk_watermark_events.closed_through; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.economic_risk_watermark_events.closed_through IS 'Borne exclusive de risque revue/certifiée. Toute écriture backdatée ultérieure dans une fenêtre déjà certifiée rend cette certification stale jusqu à une nouvelle revue.';


--
-- Name: economic_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.economic_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_data jsonb NOT NULL,
    model_status text DEFAULT 'stable'::text NOT NULL,
    trigger_event text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: economic_structure_cost_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.economic_structure_cost_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    charge_id uuid NOT NULL,
    charge_family_snapshot text NOT NULL,
    charge_name_snapshot text NOT NULL,
    recurrence_period_snapshot text,
    scope_kind text NOT NULL,
    market_id uuid,
    event_kind text NOT NULL,
    adjusts_event_id uuid,
    economic_from timestamp with time zone NOT NULL,
    economic_to timestamp with time zone NOT NULL,
    amount_original numeric(18,4) NOT NULL,
    currency text NOT NULL,
    fx_rate_to_kmf numeric(18,6) NOT NULL,
    fx_source text NOT NULL,
    amount_kmf numeric(18,2) NOT NULL,
    source_kind text NOT NULL,
    evidence_ref text NOT NULL,
    notes text,
    recorded_by uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT economic_structure_cost_events_adjustment_link_check CHECK ((((event_kind = 'ACCRUAL'::text) AND (adjusts_event_id IS NULL)) OR ((event_kind = ANY (ARRAY['ADJUSTMENT'::text, 'REVERSAL'::text])) AND (adjusts_event_id IS NOT NULL)))),
    CONSTRAINT economic_structure_cost_events_amount_kmf_check CHECK ((amount_kmf <> (0)::numeric)),
    CONSTRAINT economic_structure_cost_events_charge_family_snapshot_check CHECK (((char_length(btrim(charge_family_snapshot)) >= 1) AND (char_length(btrim(charge_family_snapshot)) <= 200))),
    CONSTRAINT economic_structure_cost_events_charge_name_snapshot_check CHECK (((char_length(btrim(charge_name_snapshot)) >= 1) AND (char_length(btrim(charge_name_snapshot)) <= 300))),
    CONSTRAINT economic_structure_cost_events_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT economic_structure_cost_events_event_kind_check CHECK ((event_kind = ANY (ARRAY['ACCRUAL'::text, 'ADJUSTMENT'::text, 'REVERSAL'::text]))),
    CONSTRAINT economic_structure_cost_events_evidence_ref_check CHECK (((char_length(btrim(evidence_ref)) >= 3) AND (char_length(btrim(evidence_ref)) <= 1000))),
    CONSTRAINT economic_structure_cost_events_fx_rate_to_kmf_check CHECK ((fx_rate_to_kmf > (0)::numeric)),
    CONSTRAINT economic_structure_cost_events_fx_source_check CHECK (((char_length(btrim(fx_source)) >= 2) AND (char_length(btrim(fx_source)) <= 200))),
    CONSTRAINT economic_structure_cost_events_kmf_fx_check CHECK (((currency <> 'KMF'::text) OR (fx_rate_to_kmf = (1)::numeric))),
    CONSTRAINT economic_structure_cost_events_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000))),
    CONSTRAINT economic_structure_cost_events_period_check CHECK ((economic_to > economic_from)),
    CONSTRAINT economic_structure_cost_events_recurrence_period_snapshot_check CHECK (((recurrence_period_snapshot IS NULL) OR ((char_length(btrim(recurrence_period_snapshot)) >= 1) AND (char_length(btrim(recurrence_period_snapshot)) <= 100)))),
    CONSTRAINT economic_structure_cost_events_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['GROUP'::text, 'MARKET_DIRECT'::text]))),
    CONSTRAINT economic_structure_cost_events_scope_market_check CHECK ((((scope_kind = 'GROUP'::text) AND (market_id IS NULL)) OR ((scope_kind = 'MARKET_DIRECT'::text) AND (market_id IS NOT NULL)))),
    CONSTRAINT economic_structure_cost_events_sign_check CHECK ((((event_kind = 'ACCRUAL'::text) AND (amount_kmf > (0)::numeric) AND (amount_original > (0)::numeric)) OR ((event_kind = 'REVERSAL'::text) AND (amount_kmf < (0)::numeric) AND (amount_original < (0)::numeric)) OR ((event_kind = 'ADJUSTMENT'::text) AND (amount_kmf <> (0)::numeric) AND (amount_original <> (0)::numeric)))),
    CONSTRAINT economic_structure_cost_events_source_kind_check CHECK ((source_kind = ANY (ARRAY['INVOICE'::text, 'CONTRACT'::text, 'CONNECTOR'::text, 'MANUAL'::text, 'ADJUSTMENT'::text])))
);


--
-- Name: TABLE economic_structure_cost_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.economic_structure_cost_events IS 'Vérité append-only des charges économiques N3 de période. Générique pour toute charge de structure ; GROUP reste non alloué et MARKET_DIRECT est directement attribuable à un marché.';


--
-- Name: COLUMN economic_structure_cost_events.charge_family_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.economic_structure_cost_events.charge_family_snapshot IS 'Famille de structure figée au constat du fait (ex. overhead, relay, hub, platform) ; aucune liste fermée n’est imposée par le moteur.';


--
-- Name: COLUMN economic_structure_cost_events.recurrence_period_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.economic_structure_cost_events.recurrence_period_snapshot IS 'Récurrence de configuration au moment du constat, à titre explicatif uniquement ; la reconnaissance économique repose sur economic_from/economic_to.';


--
-- Name: COLUMN economic_structure_cost_events.adjusts_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.economic_structure_cost_events.adjusts_event_id IS 'Lien obligatoire vers l’événement corrigé pour ADJUSTMENT/REVERSAL ; aucune mutation du réel historique.';


--
-- Name: COLUMN economic_structure_cost_events.amount_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.economic_structure_cost_events.amount_kmf IS 'Montant économique en KMF pour toute la période de l’événement ; ne provient jamais automatiquement de charges.amount_kmf.';


--
-- Name: economic_variables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.economic_variables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    unit text DEFAULT 'KMF'::text,
    value_supposed numeric,
    value_observed numeric,
    value_used numeric,
    source_used text DEFAULT 'supposed'::text,
    description text,
    is_critical boolean DEFAULT false,
    is_computed boolean DEFAULT false,
    is_active boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: exchange_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    eur_kmf integer DEFAULT 492 NOT NULL,
    aed_kmf integer DEFAULT 138 NOT NULL,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fabrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fabrics (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    material text,
    price_per_meter_aed numeric(8,2) NOT NULL,
    colors text[] DEFAULT '{}'::text[],
    occasions text[] DEFAULT '{}'::text[],
    image_url text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    fabric_type text,
    price_per_meter_kmf numeric(14,2),
    price_per_yard_kmf numeric(14,2),
    min_order_meters numeric(4,1) DEFAULT 1.0 NOT NULL,
    stock_meters numeric(8,2),
    is_available boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: COLUMN fabrics.fabric_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fabrics.fabric_type IS 'Wax | Dentelle | Mousseline | Soie | Coton | Bogolan';


--
-- Name: COLUMN fabrics.price_per_meter_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fabrics.price_per_meter_kmf IS 'Prix au mÃ¨tre KMF â€” calculÃ© depuis price_per_meter_aed Ã— taux 138';


--
-- Name: COLUMN fabrics.price_per_yard_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fabrics.price_per_yard_kmf IS 'Prix au yard KMF (optionnel)';


--
-- Name: COLUMN fabrics.min_order_meters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fabrics.min_order_meters IS 'Minimum commandable en mÃ¨tres';


--
-- Name: COLUMN fabrics.stock_meters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fabrics.stock_meters IS 'Stock Hub Deira en mÃ¨tres â€” null = sur commande';


--
-- Name: COLUMN fabrics.is_available; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fabrics.is_available IS 'Disponible Ã  la commande';


--
-- Name: COLUMN fabrics.sort_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fabrics.sort_order IS 'Ordre affichage sÃ©lecteur cÃ©rÃ©monie';


--
-- Name: finance_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_config (
    id integer DEFAULT 1 NOT NULL,
    cost_fixed_sourcing_kmf numeric(14,2) DEFAULT 1000 NOT NULL,
    cost_fixed_transit_kmf numeric(14,2) DEFAULT 500 NOT NULL,
    cost_fixed_hub_kmf numeric(14,2) DEFAULT 400 NOT NULL,
    cost_fixed_relais_kmf numeric(14,2) DEFAULT 300 NOT NULL,
    cost_fixed_support_kmf numeric(14,2) DEFAULT 200 NOT NULL,
    target_marge_brute_pct numeric(5,2) DEFAULT 40.00 NOT NULL,
    target_panier_moyen_kmf numeric(14,2) DEFAULT 15000 NOT NULL,
    objectif_commandes_mois integer DEFAULT 100 NOT NULL,
    objectif_ca_mensuel_kmf numeric(14,2) DEFAULT 1500000 NOT NULL,
    taux_change_eur_kmf numeric(10,2),
    markup_cible_pct numeric(5,2) DEFAULT 250.00 NOT NULL,
    cout_achat_moyen_eur numeric(10,2) DEFAULT 5.00 NOT NULL,
    delai_transit_jours integer DEFAULT 25 NOT NULL,
    commission_relais_pct numeric(5,2) DEFAULT 5.00 NOT NULL,
    frais_livraison_defaut_kmf numeric(14,2) DEFAULT 1500 NOT NULL,
    seuil_livraison_gratuite_kmf numeric(14,2) DEFAULT 25000 NOT NULL,
    taux_conversion_pct numeric(5,2) DEFAULT 3.00 NOT NULL,
    taux_retour_pct numeric(5,2) DEFAULT 2.00 NOT NULL,
    loyalty_active boolean DEFAULT true NOT NULL,
    loyalty_threshold_kmf numeric(14,2) DEFAULT 20000 NOT NULL,
    loyalty_trigger_count integer DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    taux_aed_kmf numeric(10,2),
    fret_eur_per_m3 integer DEFAULT 180 NOT NULL,
    frais_stripe_pct numeric(5,2) DEFAULT 2.5 NOT NULL,
    frais_stripe_fixed_kmf numeric(14,2) DEFAULT 150 NOT NULL,
    commission_relais_standard_kmf numeric(14,2) DEFAULT 500 NOT NULL,
    commission_relais_showroom_kmf numeric(14,2) DEFAULT 750 NOT NULL,
    transitaire_pct numeric(5,2) DEFAULT 2.0 NOT NULL,
    transitaire_fixed_kmf numeric(14,2) DEFAULT 450 NOT NULL,
    portuaires_kmf numeric(14,2) DEFAULT 1200 NOT NULL,
    commission_agent_pct numeric(5,2) DEFAULT 5.0 NOT NULL,
    hub_monthly_cost_aed numeric(14,2) DEFAULT 7000 NOT NULL,
    sante_seuil_cash_retard_pct numeric(5,2) DEFAULT 15.00 NOT NULL,
    sante_seuil_pipeline_block_pct numeric(5,2) DEFAULT 15.00 NOT NULL,
    sante_seuil_vip_kmf numeric(14,2) DEFAULT 200000 NOT NULL,
    sante_seuil_atrisk_ltv_kmf numeric(14,2) DEFAULT 500000 NOT NULL,
    avg_articles_per_order numeric(6,2) DEFAULT 2.5 NOT NULL,
    avg_articles_per_parcel numeric(6,2) DEFAULT 4.0 NOT NULL,
    avg_articles_per_shipment numeric(8,2) DEFAULT 200.0 NOT NULL,
    avg_orders_per_month numeric(8,2) DEFAULT 50.0 NOT NULL,
    allocation_confidence text DEFAULT 'low'::text NOT NULL,
    allocation_calibrated_at timestamp with time zone,
    allocation_notes text,
    provision_risque_pct numeric(6,4) DEFAULT 0.01 NOT NULL,
    customs_rate_default_pct numeric(5,2) DEFAULT 42 NOT NULL,
    mix_rail_a numeric(5,2) DEFAULT 60 NOT NULL,
    mix_rail_b numeric(5,2) DEFAULT 25 NOT NULL,
    mix_rail_c numeric(5,2) DEFAULT 10 NOT NULL,
    mix_rail_d numeric(5,2) DEFAULT 5 NOT NULL,
    margin_rail_a numeric(5,2) DEFAULT 45 NOT NULL,
    margin_rail_b numeric(5,2) DEFAULT 18 NOT NULL,
    margin_rail_c numeric(5,2) DEFAULT 35 NOT NULL,
    margin_rail_d numeric(5,2) DEFAULT 70 NOT NULL,
    taux_pln_kmf numeric(18,6),
    CONSTRAINT finance_config_allocation_confidence_check CHECK ((allocation_confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT finance_config_id_check CHECK ((id = 1)),
    CONSTRAINT finance_config_taux_pln_kmf_check CHECK ((taux_pln_kmf > (0)::numeric))
);


--
-- Name: COLUMN finance_config.taux_change_eur_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.taux_change_eur_kmf IS 'DEPRECATED (migration 316) : jamais lu ni écrit. Autorité = currency_parities (EUR/KMF) via services/fx-authority.js.';


--
-- Name: COLUMN finance_config.taux_aed_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.taux_aed_kmf IS 'DEPRECATED (migration 316) : jamais lu ni écrit. AED = observation EUR/USD approuvée x peg USD/AED via services/fx-authority.js.';


--
-- Name: COLUMN finance_config.avg_articles_per_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.avg_articles_per_order IS 'Nombre moyen d''articles par commande client. Sert a diviser les couts kmf_per_order pour les imputer a l''article.';


--
-- Name: COLUMN finance_config.avg_articles_per_parcel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.avg_articles_per_parcel IS 'Nombre moyen d''articles par colis sortant du hub. Sert a diviser les couts kmf_per_parcel.';


--
-- Name: COLUMN finance_config.avg_articles_per_shipment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.avg_articles_per_shipment IS 'Nombre moyen d''articles dans un shipment LCL Dubai-Moroni. Sert a diviser les couts kmf_per_shipment.';


--
-- Name: COLUMN finance_config.avg_orders_per_month; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.avg_orders_per_month IS 'Volume mensuel cible de commandes. Sert a diluer les charges_fixes_mensuelles_kmf.';


--
-- Name: COLUMN finance_config.provision_risque_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.provision_risque_pct IS 'Taux de provision risque mensuel appliquÃ© au CA (ex: 0.01 = 1%). Configurable via Control Tower > ParamÃ¨tres Ã©conomiques.';


--
-- Name: COLUMN finance_config.customs_rate_default_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.customs_rate_default_pct IS 'Fallback douane terrain Ops. Copié iso-CURRENT depuis economic_variables par migration 119.';


--
-- Name: COLUMN finance_config.mix_rail_a; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.mix_rail_a IS 'Mix CA Rail A — source runtime canonique depuis migration 119.';


--
-- Name: COLUMN finance_config.mix_rail_b; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.mix_rail_b IS 'Mix CA Rail B — source runtime canonique depuis migration 119.';


--
-- Name: COLUMN finance_config.mix_rail_c; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.mix_rail_c IS 'Mix CA Rail C — source runtime canonique depuis migration 119.';


--
-- Name: COLUMN finance_config.mix_rail_d; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.mix_rail_d IS 'Mix CA Rail D — source runtime canonique depuis migration 119.';


--
-- Name: COLUMN finance_config.margin_rail_a; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.margin_rail_a IS 'Marge Rail A — source runtime canonique depuis migration 119.';


--
-- Name: COLUMN finance_config.margin_rail_b; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.margin_rail_b IS 'Marge Rail B — source runtime canonique depuis migration 119.';


--
-- Name: COLUMN finance_config.margin_rail_c; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.margin_rail_c IS 'Marge Rail C — source runtime canonique depuis migration 119.';


--
-- Name: COLUMN finance_config.margin_rail_d; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.margin_rail_d IS 'Marge Rail D — source runtime canonique depuis migration 119.';


--
-- Name: COLUMN finance_config.taux_pln_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_config.taux_pln_kmf IS 'KMF per PLN, explicitly maintained in Finance sourcing configuration. NULL blocks PLN sourcing valuation; native provider amounts remain PLN.';


--
-- Name: fx_pegs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fx_pegs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    base_ccy text DEFAULT 'USD'::text NOT NULL,
    quote_ccy text DEFAULT 'DJF'::text NOT NULL,
    rate numeric(18,8) NOT NULL,
    source_label text NOT NULL,
    source_ref text,
    valid_from timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fx_peg_rate_band CHECK ((((quote_ccy = 'DJF'::text) AND (rate >= (100)::numeric) AND (rate <= (300)::numeric)) OR ((quote_ccy = 'AED'::text) AND (rate >= (3)::numeric) AND (rate <= 4.5)))),
    CONSTRAINT fx_pegs_base_ccy_check CHECK ((base_ccy = 'USD'::text)),
    CONSTRAINT fx_pegs_quote_ccy_check CHECK ((quote_ccy = ANY (ARRAY['DJF'::text, 'AED'::text]))),
    CONSTRAINT fx_pegs_rate_check CHECK ((rate > (0)::numeric)),
    CONSTRAINT fx_pegs_source_label_check CHECK ((length(btrim(source_label)) > 0))
);


--
-- Name: TABLE fx_pegs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fx_pegs IS 'Pegs officiels USD→devise (DJF Banque centrale de Djibouti ; AED Central Bank of the UAE). Append-only, datés.';


--
-- Name: fx_public_reference_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fx_public_reference_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    base_ccy text DEFAULT 'EUR'::text NOT NULL,
    quote_ccy text NOT NULL,
    rate numeric(24,8) NOT NULL,
    as_of date NOT NULL,
    source_label text DEFAULT 'Banque centrale européenne'::text NOT NULL,
    source_ref text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fx_public_reference_quotes_as_of_check CHECK ((as_of <= CURRENT_DATE)),
    CONSTRAINT fx_public_reference_quotes_base_ccy_check CHECK ((base_ccy = 'EUR'::text)),
    CONSTRAINT fx_public_reference_quotes_quote_ccy_check CHECK (((quote_ccy ~ '^[A-Z]{3}$'::text) AND (quote_ccy <> ALL (ARRAY['EUR'::text, 'KMF'::text, 'XAF'::text])))),
    CONSTRAINT fx_public_reference_quotes_rate_check CHECK (((rate > (0)::numeric) AND (rate < (100000000)::numeric))),
    CONSTRAINT fx_public_reference_quotes_source_label_check CHECK ((source_label = 'Banque centrale européenne'::text)),
    CONSTRAINT fx_public_reference_quotes_source_ref_check CHECK ((source_ref = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'::text))
);


--
-- Name: TABLE fx_public_reference_quotes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fx_public_reference_quotes IS 'Cotations EUR/XXX BCE datées, sourcées, ingérées automatiquement et immuables. Source publique distincte des observations manuelles à double approbation.';


--
-- Name: fx_rate_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fx_rate_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    base_ccy text DEFAULT 'EUR'::text NOT NULL,
    quote_ccy text DEFAULT 'USD'::text NOT NULL,
    rate numeric(18,8) NOT NULL,
    source_label text NOT NULL,
    source_ref text,
    as_of timestamp with time zone NOT NULL,
    entered_by text NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fx_obs_approval_pair CHECK (((approved_by IS NULL) = (approved_at IS NULL))),
    CONSTRAINT fx_obs_as_of_not_future CHECK ((as_of <= created_at)),
    CONSTRAINT fx_obs_two_person CHECK (((approved_by IS NULL) OR (approved_by <> entered_by))),
    CONSTRAINT fx_rate_observations_base_ccy_check CHECK ((base_ccy = 'EUR'::text)),
    CONSTRAINT fx_rate_observations_entered_by_check CHECK ((length(btrim(entered_by)) > 0)),
    CONSTRAINT fx_rate_observations_quote_ccy_check CHECK ((quote_ccy = 'USD'::text)),
    CONSTRAINT fx_rate_observations_rate_check CHECK (((rate >= 0.8) AND (rate <= 1.6))),
    CONSTRAINT fx_rate_observations_source_label_check CHECK ((length(btrim(source_label)) > 0))
);


--
-- Name: TABLE fx_rate_observations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fx_rate_observations IS 'EUR→USD flottant sourcé, daté, approuvé par une 2e personne. Aucune valeur pré-remplie. Distinct de currency_parities.';


--
-- Name: garment_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.garment_models (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    making_cost_aed numeric(8,2) NOT NULL,
    fabric_meters numeric(6,2) NOT NULL,
    occasions text[] DEFAULT '{}'::text[],
    sizes_available text[] DEFAULT '{S,M,L,XL,XXL}'::text[],
    image_url text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hub_custody_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_custody_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    physical_unit_id uuid NOT NULL,
    event_type text NOT NULL,
    from_state text,
    to_state text,
    allocation_id uuid,
    quantity integer,
    operation_id uuid,
    operation_type text,
    actor_id uuid,
    location_ref text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hub_custody_events_event_type_check CHECK ((event_type = ANY (ARRAY['STATE_TRANSITION'::text, 'PLACEMENT_IN'::text, 'PLACEMENT_OUT'::text, 'OUTCOME_REPORTED'::text, 'QUARANTINE'::text]))),
    CONSTRAINT hub_custody_events_operation_type_check CHECK (((operation_type IS NULL) OR (operation_type = ANY (ARRAY['RECEIVE'::text, 'SPLIT'::text, 'MERGE'::text, 'REPACK'::text])))),
    CONSTRAINT hub_custody_events_quantity_check CHECK (((quantity IS NULL) OR (quantity > 0)))
);


--
-- Name: TABLE hub_custody_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hub_custody_events IS 'HUB-001 append-only custody/lineage history for physical state and placement operations.';


--
-- Name: hub_physical_unit_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_physical_unit_placements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    physical_unit_id uuid NOT NULL,
    allocation_id uuid NOT NULL,
    quantity integer NOT NULL,
    operation_id uuid,
    operation_type text,
    created_by uuid,
    placed_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone,
    CONSTRAINT chk_hub_placement_time_order CHECK (((removed_at IS NULL) OR (removed_at > placed_at))),
    CONSTRAINT hub_physical_unit_placements_operation_type_check CHECK (((operation_type IS NULL) OR (operation_type = ANY (ARRAY['RECEIVE'::text, 'SPLIT'::text, 'MERGE'::text, 'REPACK'::text])))),
    CONSTRAINT hub_physical_unit_placements_quantity_check CHECK ((quantity > 0))
);


--
-- Name: TABLE hub_physical_unit_placements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hub_physical_unit_placements IS 'HUB-001 physical placement history. SPLIT/MERGE/REPACK close old placements and append new ones; allocation remains immutable.';


--
-- Name: hub_physical_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_physical_units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text NOT NULL,
    unit_type text NOT NULL,
    state text DEFAULT 'RECEIVED'::text NOT NULL,
    external_ref text,
    market_id uuid,
    current_location_ref text,
    outcome_type text,
    outcome_recorded_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_hub_physical_outcome_timestamp CHECK ((((outcome_type IS NULL) AND (outcome_recorded_at IS NULL)) OR ((outcome_type IS NOT NULL) AND (outcome_recorded_at IS NOT NULL)))),
    CONSTRAINT hub_physical_units_outcome_type_check CHECK (((outcome_type IS NULL) OR (outcome_type = ANY (ARRAY['LOST'::text, 'STOLEN'::text, 'DESTROYED'::text, 'DAMAGED_UNUSABLE'::text])))),
    CONSTRAINT hub_physical_units_reference_check CHECK ((btrim(reference) <> ''::text)),
    CONSTRAINT hub_physical_units_state_check CHECK ((state = ANY (ARRAY['RECEIVED'::text, 'IDENTIFIED'::text, 'QUALITY_CHECKED'::text, 'LOCATED'::text, 'ALLOCATED'::text, 'PICKED'::text, 'PACKED'::text, 'DISPATCHED'::text, 'QUARANTINED'::text, 'SUPERSEDED'::text]))),
    CONSTRAINT hub_physical_units_unit_type_check CHECK ((unit_type = ANY (ARRAY['SUPPLIER_PACKAGE'::text, 'HANDLING_UNIT'::text, 'MARKET_PARCEL'::text])))
);


--
-- Name: TABLE hub_physical_units; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hub_physical_units IS 'HUB-001 physical identity. Inbound may be multi-market; PACKED/DISPATCHED is forced mono-market from active allocations.';


--
-- Name: hub_purchase_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_purchase_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id uuid NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    product_sku_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    supplier_unit_ref text NOT NULL,
    supplier_order_identity jsonb NOT NULL,
    quantity integer NOT NULL,
    market_id uuid NOT NULL,
    destination_ref text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purchase_line_id uuid,
    CONSTRAINT chk_hub_purchase_allocation_soi_shape CHECK (((jsonb_typeof(supplier_order_identity) = 'object'::text) AND (jsonb_typeof((supplier_order_identity -> 'provider'::text)) = 'string'::text) AND (btrim((supplier_order_identity ->> 'provider'::text)) <> ''::text) AND (jsonb_typeof((supplier_order_identity -> 'version'::text)) = 'number'::text) AND ((supplier_order_identity ->> 'version'::text) ~ '^[0-9]+$'::text) AND (((supplier_order_identity ->> 'version'::text))::integer >= 1) AND (jsonb_typeof((supplier_order_identity -> 'payload'::text)) = 'object'::text) AND ((supplier_order_identity -> 'payload'::text) <> '{}'::jsonb))),
    CONSTRAINT hub_purchase_allocations_destination_ref_check CHECK ((btrim(destination_ref) <> ''::text)),
    CONSTRAINT hub_purchase_allocations_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT hub_purchase_allocations_supplier_unit_ref_check CHECK ((btrim(supplier_unit_ref) <> ''::text))
);


--
-- Name: TABLE hub_purchase_allocations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hub_purchase_allocations IS 'HUB-001 immutable economic snapshot: exact Purchase Order identity + order Market/destination. Hub cannot reassign it.';


--
-- Name: import_runtime_item_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_runtime_item_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    seq integer NOT NULL,
    candidate_id uuid,
    supplier_product_id text,
    product_name text,
    image_url text,
    purchase_price numeric(12,2),
    currency text,
    stage text DEFAULT 'REFINERY'::text NOT NULL,
    outcome text,
    change_kind text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT chk_import_runtime_item_events_finish CHECK (((finished_at IS NULL) OR (finished_at >= started_at))),
    CONSTRAINT import_runtime_item_events_change_kind_check CHECK (((change_kind IS NULL) OR (change_kind = ANY (ARRAY['created'::text, 'updated'::text])))),
    CONSTRAINT import_runtime_item_events_seq_check CHECK ((seq > 0))
);


--
-- Name: import_runtime_run_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_runtime_run_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: import_runtime_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_runtime_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_ref text DEFAULT ('KIR-'::text || lpad((nextval('public.import_runtime_run_ref_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    provider text NOT NULL,
    source_type text NOT NULL,
    source_ref text,
    import_id uuid,
    mode text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'RUNNING'::text NOT NULL,
    source_total integer DEFAULT 0 NOT NULL,
    stages jsonb DEFAULT '{}'::jsonb NOT NULL,
    intake jsonb DEFAULT '{}'::jsonb NOT NULL,
    failure_reason text,
    started_by uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_runtime_runs_mode_check CHECK ((mode = ANY (ARRAY['normal'::text, 'replay'::text, 'reconstruction'::text]))),
    CONSTRAINT import_runtime_runs_source_total_check CHECK ((source_total >= 0)),
    CONSTRAINT import_runtime_runs_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'COMPLETED'::text, 'FAILED'::text])))
);


--
-- Name: incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incidents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    parcel_id uuid,
    order_id uuid,
    order_item_id uuid,
    scan_event_id uuid,
    incident_type text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    title text NOT NULL,
    description text,
    details jsonb DEFAULT '{}'::jsonb,
    client_impact text DEFAULT 'none'::text,
    client_notified boolean DEFAULT false NOT NULL,
    client_notification text,
    detected_by uuid,
    detected_source text DEFAULT 'system'::text,
    resolution jsonb,
    resolution_type text,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    parent_incident_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    origin_domain text NOT NULL,
    resolver_domain text NOT NULL,
    resolution_class text NOT NULL,
    due_at timestamp with time zone,
    escalation_level integer DEFAULT 0 NOT NULL,
    CONSTRAINT incidents_client_impact_check CHECK ((client_impact = ANY (ARRAY['none'::text, 'delayed'::text, 'partial_delivery'::text, 'wrong_item'::text, 'blocked'::text]))),
    CONSTRAINT incidents_detected_source_check CHECK ((detected_source = ANY (ARRAY['system'::text, 'hub_agent'::text, 'relay_agent'::text, 'driver'::text, 'customer'::text, 'admin'::text, 'reconciliation'::text]))),
    CONSTRAINT incidents_escalation_level_check CHECK ((escalation_level >= 0)),
    CONSTRAINT incidents_incident_type_check CHECK ((incident_type = ANY (ARRAY['content_mismatch'::text, 'missing_item'::text, 'unexpected_item'::text, 'damaged_item'::text, 'weight_mismatch'::text, 'quantity_mismatch'::text, 'scan_anomaly'::text, 'sequence_violation'::text, 'delay'::text, 'blocked'::text, 'payment_issue'::text, 'reconciliation_error'::text]))),
    CONSTRAINT incidents_origin_domain_check CHECK ((origin_domain = ANY (ARRAY['LOGISTICS'::text, 'PAYMENTS'::text, 'ORDERS'::text, 'PURCHASING'::text, 'MARKET'::text, 'UNCLASSIFIED'::text]))),
    CONSTRAINT incidents_resolution_class_check CHECK ((resolution_class = ANY (ARRAY['PHYSICAL_PROOF'::text, 'UPSTREAM_TRUTH'::text, 'UNCLASSIFIED'::text]))),
    CONSTRAINT incidents_resolution_type_check CHECK ((resolution_type = ANY (ARRAY['reship'::text, 'refund'::text, 'manual_fix'::text, 'dismissed'::text, 'auto_resolved'::text, NULL::text]))),
    CONSTRAINT incidents_resolver_domain_check CHECK ((resolver_domain = ANY (ARRAY['LOGISTICS'::text, 'PAYMENTS'::text, 'ORDERS'::text, 'PURCHASING'::text, 'MARKET'::text, 'UNCLASSIFIED'::text]))),
    CONSTRAINT incidents_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT incidents_status_check CHECK ((status = ANY (ARRAY['open'::text, 'investigating'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid,
    requester_phone text NOT NULL,
    requested_window text,
    proposed_window text,
    status public.inquiry_status DEFAULT 'sent'::public.inquiry_status NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    physical_offer_id uuid,
    intent text DEFAULT 'request'::text NOT NULL,
    requester_note text,
    CONSTRAINT inquiries_exactly_one_target CHECK ((num_nonnulls(service_id, physical_offer_id) = 1)),
    CONSTRAINT inquiries_intent_allowed CHECK ((intent = ANY (ARRAY['request'::text, 'callback'::text]))),
    CONSTRAINT inquiries_requester_note_valid CHECK (((requester_note IS NULL) OR ((length(btrim(requester_note)) > 0) AND (length(requester_note) <= 600))))
);


--
-- Name: TABLE inquiries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inquiries IS 'Demande, jamais une réservation (shadow, Vague 1) — RECHALLENGE_MODELE_MINIMAL §6/§7 : avant confirmation du provider, aucune ressource n''est réellement engagée. requested_window/proposed_window sont du texte libre ("demain matin"), jamais un créneau structuré — pas de scheduler tant qu''aucun test ne le justifie.';


--
-- Name: COLUMN inquiries.service_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inquiries.service_id IS 'Nullable depuis la migration 156 — une inquiry porte sur EXACTEMENT une cible (service_id XOR physical_offer_id), jamais offer_type/offer_id (association polymorphe rejetée, aucune FK Postgres réelle possible) — voir contrainte inquiries_exactly_one_target.';


--
-- Name: COLUMN inquiries.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inquiries.status IS 'Cycle linéaire : sent (demande envoyée) -> answered (le provider a réagi, éventuellement via proposed_window pour un autre créneau, sans encore trancher) -> accepted | declined (terminal). answered_at capture le délai de réponse, mesure clé du shadow test (temps moyen de confirmation, cf. CHALLENGE_SERVICES_TWO_TRACK §9-bis).';


--
-- Name: COLUMN inquiries.intent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inquiries.intent IS 'Intention publique Komerce : request ou callback. Le propos reste toujours connu par service_id XOR physical_offer_id.';


--
-- Name: COLUMN inquiries.requester_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inquiries.requester_note IS 'Précision libre facultative du demandeur, 600 caractères maximum. Elle enrichit la cible et ne la remplace jamais.';


--
-- Name: international_n1_allocation_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.international_n1_allocation_links (
    allocation_id uuid NOT NULL,
    shipment_id uuid NOT NULL,
    component text NOT NULL,
    fee_type text DEFAULT ''::text NOT NULL,
    parcel_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    CONSTRAINT international_n1_allocation_links_component_check CHECK ((component = ANY (ARRAY['freight'::text, 'port_transitaire'::text, 'local_distribution'::text])))
);


--
-- Name: TABLE international_n1_allocation_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.international_n1_allocation_links IS 'Ownership of N1 allocations by international freight/fee projection; legacy customs allocator must not delete these rows.';


--
-- Name: international_n1_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.international_n1_reconciliations (
    shipment_id uuid NOT NULL,
    snapshot_hash text NOT NULL,
    total_freight_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    freight_known boolean DEFAULT false NOT NULL,
    total_arrival_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    total_local_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    allocation_rows integer DEFAULT 0 NOT NULL,
    actor_id text NOT NULL,
    reconciled_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT international_n1_reconciliations_allocation_rows_check CHECK ((allocation_rows >= 0)),
    CONSTRAINT international_n1_reconciliations_snapshot_hash_check CHECK ((length(snapshot_hash) = 64))
);


--
-- Name: TABLE international_n1_reconciliations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.international_n1_reconciliations IS 'Idempotent source snapshot of actual international N1; never forecasts or N3.';


--
-- Name: international_shipment_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.international_shipment_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    fee_type text NOT NULL,
    kind text DEFAULT 'charge'::text NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    currency text DEFAULT 'KMF'::text NOT NULL,
    proof_ref text NOT NULL,
    idempotency_key text NOT NULL,
    notes text,
    actor_id text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_international_charge_credit CHECK (((kind = 'charge'::text) OR (amount_kmf > (0)::numeric))),
    CONSTRAINT international_shipment_charges_amount_kmf_check CHECK ((amount_kmf >= (0)::numeric)),
    CONSTRAINT international_shipment_charges_currency_check CHECK ((currency = 'KMF'::text)),
    CONSTRAINT international_shipment_charges_fee_type_check CHECK ((fee_type = ANY (ARRAY['handling'::text, 'storage'::text, 'forwarder'::text, 'local_tax'::text, 'exceptional'::text, 'other'::text, 'local_transport'::text]))),
    CONSTRAINT international_shipment_charges_idempotency_key_check CHECK ((length(btrim(idempotency_key)) > 0)),
    CONSTRAINT international_shipment_charges_kind_check CHECK ((kind = ANY (ARRAY['charge'::text, 'credit'::text]))),
    CONSTRAINT international_shipment_charges_proof_ref_check CHECK ((length(btrim(proof_ref)) > 0))
);


--
-- Name: TABLE international_shipment_charges; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.international_shipment_charges IS 'Faits de frais documentaires non ventilés au coût N1 tant que le rapprochement avec customs_shipment_fees n est pas certifié.';


--
-- Name: international_shipment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.international_shipment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    event_type text NOT NULL,
    from_stage text,
    to_stage text,
    proof_ref text NOT NULL,
    actor_id text NOT NULL,
    notes text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT international_shipment_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'stage_changed'::text, 'tracking_updated'::text, 'freight_recorded'::text, 'customs_linked'::text]))),
    CONSTRAINT international_shipment_events_proof_ref_check CHECK ((length(btrim(proof_ref)) > 0))
);


--
-- Name: international_shipment_hub_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.international_shipment_hub_units (
    shipment_id uuid NOT NULL,
    physical_unit_id uuid NOT NULL,
    attached_by uuid,
    attached_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: international_shipment_parcels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.international_shipment_parcels (
    shipment_id uuid NOT NULL,
    parcel_id uuid NOT NULL,
    volume_cm3 numeric(14,2),
    attached_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT international_shipment_parcels_volume_cm3_check CHECK ((volume_cm3 >= (0)::numeric))
);


--
-- Name: international_shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.international_shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    reference text NOT NULL,
    forwarder_name text NOT NULL,
    transport_mode text NOT NULL,
    stage text DEFAULT 'hub_ready'::text NOT NULL,
    volume_m3 numeric(12,5),
    freight_rate_kmf_per_m3 numeric(14,2),
    freight_invoice_kmf numeric(14,2),
    freight_invoice_ref text,
    tracking_reference text,
    container_reference text,
    bill_of_lading_ref text,
    estimated_arrival_at timestamp with time zone,
    departed_at timestamp with time zone,
    arrived_at timestamp with time zone,
    customs_shipment_id uuid,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_international_invoice_proof CHECK (((freight_invoice_kmf IS NULL) OR ((freight_invoice_ref IS NOT NULL) AND (length(btrim(freight_invoice_ref)) > 0)))),
    CONSTRAINT international_shipments_forwarder_name_check CHECK (((length(btrim(forwarder_name)) >= 2) AND (length(btrim(forwarder_name)) <= 180))),
    CONSTRAINT international_shipments_freight_invoice_kmf_check CHECK ((freight_invoice_kmf >= (0)::numeric)),
    CONSTRAINT international_shipments_freight_rate_kmf_per_m3_check CHECK ((freight_rate_kmf_per_m3 >= (0)::numeric)),
    CONSTRAINT international_shipments_reference_check CHECK (((length(btrim(reference)) >= 3) AND (length(btrim(reference)) <= 96))),
    CONSTRAINT international_shipments_stage_check CHECK ((stage = ANY (ARRAY['hub_ready'::text, 'handed_over'::text, 'forwarder_received'::text, 'in_transit'::text, 'arrived'::text, 'customs_released'::text, 'local_delivery'::text, 'relay_received'::text]))),
    CONSTRAINT international_shipments_transport_mode_check CHECK ((transport_mode = ANY (ARRAY['sea'::text, 'air'::text]))),
    CONSTRAINT international_shipments_volume_m3_check CHECK ((volume_m3 > (0)::numeric))
);


--
-- Name: TABLE international_shipments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.international_shipments IS 'Transport international réel séparé des déclarations douanières; progression par preuves et coûts de fret facturés.';


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_item_id uuid,
    order_id uuid,
    product_id uuid,
    quantity integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    parcel_id uuid,
    received_at timestamp with time zone DEFAULT now(),
    assigned_at timestamp with time zone,
    buffer_reason text,
    buffer_until timestamp with time zone,
    received_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    proposed_parcel_id uuid,
    proposed_at timestamp with time zone
);


--
-- Name: invoice_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text NOT NULL,
    order_id uuid NOT NULL,
    parcel_id uuid,
    client_name text NOT NULL,
    client_phone text NOT NULL,
    relay_name text NOT NULL,
    items_snapshot jsonb NOT NULL,
    subtotal_kmf numeric(14,2) NOT NULL,
    shipping_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    total_kmf numeric(14,2) NOT NULL,
    payment_mode text NOT NULL,
    payment_status text DEFAULT 'paid'::text NOT NULL,
    delivered_via text,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    public_token text,
    owner_user_id uuid,
    pdf_content bytea,
    pdf_sha256 text,
    pdf_filename text,
    pdf_generated_at timestamp with time zone,
    template_version text DEFAULT '2026-08-v1'::text NOT NULL,
    total_eur numeric(10,2),
    payment_total_amount numeric(18,4),
    payment_currency text,
    payment_minor_unit integer
);


--
-- Name: COLUMN invoices.public_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.public_token IS 'DEPRECATED 2026-08: aucune route publique; téléchargement authentifié uniquement';


--
-- Name: COLUMN invoices.total_eur; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.total_eur IS 'Montant en EUR — snapshot de orders.total_eur au moment de l''émission. Affiché sur la facture UNIQUEMENT si payment_mode = stripe_eur ou paypal_eur (P4, freeze 22-08-2026) ; sinon total_kmf fait foi. NULL pour les factures antérieures à cette migration — aucun backfill fabriqué.';


--
-- Name: COLUMN invoices.payment_total_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.payment_total_amount IS 'Montant réellement encaissé dans payment_currency ; alimenté par les rails dont la devise n est pas déductible de total_kmf/total_eur (ex. Mobile Money XAF).';


--
-- Name: local_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    market_id uuid NOT NULL,
    location text DEFAULT 'KM_MAIN'::text NOT NULL,
    qty_physical integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    commercial_exposure text DEFAULT 'DISABLED'::text NOT NULL,
    CONSTRAINT local_stock_exposure_valid CHECK ((commercial_exposure = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text]))),
    CONSTRAINT local_stock_qty_non_negatif CHECK ((qty_physical >= 0))
);


--
-- Name: TABLE local_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.local_stock IS 'Stock physique vendable détenu par Komerce dans un marché (shadow, Vague 1 — aucune exposition frontend). Distinct de inventory_items (hub/transit) et de products.stock/product_skus.stock (import/national). location est un texte, pas une FK : un seul entrepôt (KM_MAIN) au lancement, table de lieux différée au deuxième lieu réel.';


--
-- Name: COLUMN local_stock.location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.local_stock.location IS 'Identifiant texte du lieu physique (ex. KM_MAIN). Deviendra une FK vers un référentiel de lieux le jour où un deuxième lieu existe réellement — jamais avant, pour ne pas généraliser sur un seul cas.';


--
-- Name: COLUMN local_stock.commercial_exposure; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.local_stock.commercial_exposure IS 'Même patron que services/physical_offers.commercial_exposure. Badge "Disponible maintenant" affiché seulement si ENABLED — et seulement si le cycle allocate/consume/release (local_stock_allocations) garantit que la promesse est tenue (pas de survente).';


--
-- Name: local_stock_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_stock_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    local_stock_id uuid NOT NULL,
    order_id uuid NOT NULL,
    quantity integer NOT NULL,
    allocated_at timestamp with time zone DEFAULT now() NOT NULL,
    consumed_at timestamp with time zone,
    released_at timestamp with time zone,
    CONSTRAINT local_stock_allocations_quantity_check CHECK ((quantity > 0))
);


--
-- Name: TABLE local_stock_allocations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.local_stock_allocations IS 'Engagement d''une commande sur un stock local, avant confirmation du paiement. Cycle : allocate (création commande) -> consume (paiement confirmé, qty_physical réellement décrémenté) OU release (annulation, échec, abandon). Toute mutation consume/release est gardée par WHERE consumed_at IS NULL AND released_at IS NULL — idempotente par construction, un webhook rejoué ou une annulation en double sont des no-op, jamais une double consommation ou un double release.';


--
-- Name: COLUMN local_stock_allocations.quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.local_stock_allocations.quantity IS 'Quantité allouée par cet order_id pour ce local_stock_id. Un même order_id peut porter plusieurs lignes (un produit local par item de commande), jamais fusionnées — chaque allocation garde sa propre issue.';


--
-- Name: loyalty_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_rewards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    triggered_by_order_id uuid,
    basket_count_at_trigger integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    gift_description text,
    granted_at timestamp with time zone,
    granted_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT loyalty_rewards_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'granted'::text, 'skipped'::text])))
);


--
-- Name: loyalty_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_tiers (
    id integer NOT NULL,
    label character varying(50) NOT NULL,
    badge character varying(20) DEFAULT '*'::character varying NOT NULL,
    min_orders integer NOT NULL,
    discount_pct numeric(4,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: loyalty_tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loyalty_tiers_id_seq OWNED BY public.loyalty_tiers.id;


--
-- Name: market_cash_control_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_cash_control_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid NOT NULL,
    market_id uuid NOT NULL,
    cash_enabled boolean DEFAULT true NOT NULL,
    confirmation_mode text DEFAULT 'SINGLE'::text NOT NULL,
    updated_by_membership_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custody_max_days integer,
    CONSTRAINT market_cash_control_policies_confirmation_mode_check CHECK ((confirmation_mode = ANY (ARRAY['SINGLE'::text, 'DUAL_ALWAYS'::text]))),
    CONSTRAINT market_cash_control_policies_custody_days_chk CHECK (((custody_max_days IS NULL) OR ((custody_max_days >= 1) AND (custody_max_days <= 365))))
);


--
-- Name: TABLE market_cash_control_policies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_cash_control_policies IS 'Partner-owned Market cash policy. Komerce enforces the non-bypassable safety floor; partner may require dual confirmation.';


--
-- Name: COLUMN market_cash_control_policies.custody_max_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.market_cash_control_policies.custody_max_days IS 'Délai de garde maximal des espèces dans ce Market (jours) ; NULL = défaut central ; borné par la limite centrale côté service.';


--
-- Name: market_cash_destinations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_cash_destinations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    kind text NOT NULL,
    label text NOT NULL,
    currency text NOT NULL,
    account_ref text NOT NULL,
    payment_account_id uuid,
    status text DEFAULT 'PROPOSED'::text NOT NULL,
    proposed_by uuid NOT NULL,
    activated_by uuid,
    activated_at timestamp with time zone,
    status_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_cash_destinations_account_ref_chk CHECK ((((char_length(btrim(account_ref)) >= 3) AND (char_length(btrim(account_ref)) <= 120)) AND (account_ref !~* '(^|[^a-z])(sk|rk|pk|whsec)_'::text))),
    CONSTRAINT market_cash_destinations_currency_chk CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT market_cash_destinations_kind_chk CHECK ((kind = ANY (ARRAY['BANK'::text, 'MOBILE_MONEY'::text]))),
    CONSTRAINT market_cash_destinations_label_chk CHECK (((char_length(btrim(label)) >= 2) AND (char_length(btrim(label)) <= 120))),
    CONSTRAINT market_cash_destinations_reason_chk CHECK (((status <> ALL (ARRAY['SUSPENDED'::text, 'CLOSED'::text])) OR ((status_reason IS NOT NULL) AND (char_length(btrim(status_reason)) >= 3)))),
    CONSTRAINT market_cash_destinations_status_chk CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'CLOSED'::text]))),
    CONSTRAINT market_cash_destinations_two_actors_chk CHECK ((((activated_by IS NULL) AND (activated_at IS NULL) AND (status = ANY (ARRAY['PROPOSED'::text, 'CLOSED'::text]))) OR ((activated_by IS NOT NULL) AND (activated_at IS NOT NULL) AND (activated_by <> proposed_by))))
);


--
-- Name: TABLE market_cash_destinations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_cash_destinations IS 'Destinations finales autorisées (banque, Mobile Money) par Market : proposée par un acteur, activée par un autre, jamais supprimée. Peut référencer un compte de paiement sans le modifier.';


--
-- Name: market_central_collection_modes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_central_collection_modes (
    market_id uuid NOT NULL,
    payment_mode text NOT NULL,
    evidence_ref text NOT NULL,
    authorized_by uuid,
    authorized_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT market_central_collection_modes_evidence_ref_check CHECK ((length(btrim(evidence_ref)) >= 3)),
    CONSTRAINT market_central_collection_modes_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['stripe_eur'::text, 'paypal_eur'::text])))
);


--
-- Name: TABLE market_central_collection_modes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_central_collection_modes IS 'Moyens d''encaissement central (stripe_eur, paypal_eur) autorisés par marché. Absence ou revoked_at = refus. Le titulaire des fonds doit être décidé par le propriétaire avant toute ligne hors KM.';


--
-- Name: market_cost_attributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_cost_attributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_event_id uuid NOT NULL,
    market_id uuid NOT NULL,
    event_kind text NOT NULL,
    amount_kmf numeric(18,2) NOT NULL,
    allocation_key text NOT NULL,
    allocation_basis jsonb NOT NULL,
    policy_version text NOT NULL,
    reverses_id uuid,
    recorded_by uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_mca_amount_nonzero CHECK ((amount_kmf <> (0)::numeric)),
    CONSTRAINT chk_mca_event_kind CHECK ((event_kind = ANY (ARRAY['ATTRIBUTION'::text, 'REVERSAL'::text]))),
    CONSTRAINT chk_mca_reversal_link CHECK ((((event_kind = 'ATTRIBUTION'::text) AND (reverses_id IS NULL)) OR ((event_kind = 'REVERSAL'::text) AND (reverses_id IS NOT NULL)))),
    CONSTRAINT chk_mca_sign CHECK ((((event_kind = 'ATTRIBUTION'::text) AND (amount_kmf > (0)::numeric)) OR ((event_kind = 'REVERSAL'::text) AND (amount_kmf < (0)::numeric))))
);


--
-- Name: market_delegation_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_delegation_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    assignment_id uuid,
    membership_id uuid,
    capability text,
    action text NOT NULL,
    payload_before jsonb,
    payload_after jsonb,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    correlation_id text,
    market_id uuid,
    CONSTRAINT market_delegation_audit_action_check CHECK ((char_length(btrim(action)) > 0))
);


--
-- Name: TABLE market_delegation_audit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_delegation_audit IS 'Append-only audit trail for market delegation mutations; distinct from economic facts.';


--
-- Name: COLUMN market_delegation_audit.market_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.market_delegation_audit.market_id IS 'Market ID audité directement. Permet de tracer le provisioning avant création complète de l assignment ; cohérent avec assignment/membership quand présents.';


--
-- Name: market_delivery_attestations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_delivery_attestations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    carrier_id uuid NOT NULL,
    mode text NOT NULL,
    origin_ref text NOT NULL,
    freight_rate numeric(14,2) NOT NULL,
    rate_currency text NOT NULL,
    rate_unit text NOT NULL,
    transit_days integer NOT NULL,
    evidence_ref text NOT NULL,
    attested_by uuid NOT NULL,
    attested_at timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    revoke_reason text,
    CONSTRAINT market_delivery_attestation_revocation CHECK ((((revoked_at IS NULL) AND (revoked_by IS NULL) AND (revoke_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL) AND (length(btrim(COALESCE(revoke_reason, ''::text))) >= 3)))),
    CONSTRAINT market_delivery_attestation_validity CHECK ((valid_until > attested_at)),
    CONSTRAINT market_delivery_attestations_evidence_ref_check CHECK ((length(btrim(evidence_ref)) >= 3)),
    CONSTRAINT market_delivery_attestations_freight_rate_check CHECK ((freight_rate > (0)::numeric)),
    CONSTRAINT market_delivery_attestations_mode_check CHECK ((mode = ANY (ARRAY['SEA'::text, 'AIR'::text, 'ROAD'::text, 'MIXED'::text]))),
    CONSTRAINT market_delivery_attestations_origin_ref_check CHECK ((length(btrim(origin_ref)) >= 2)),
    CONSTRAINT market_delivery_attestations_rate_currency_check CHECK ((rate_currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT market_delivery_attestations_rate_unit_check CHECK ((rate_unit = ANY (ARRAY['PER_KG'::text, 'PER_PARCEL'::text]))),
    CONSTRAINT market_delivery_attestations_transit_days_check CHECK (((transit_days > 0) AND (transit_days <= 365)))
);


--
-- Name: TABLE market_delivery_attestations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_delivery_attestations IS 'Preuve centrale, vérifiable et révocable, qu''une liaison de transport et un tarif applicable existent pour un marché. Jamais un booléen ; jamais déduite des tarifs globaux.';


--
-- Name: market_operating_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_operating_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_until timestamp with time zone,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    central_referent_user_id uuid,
    CONSTRAINT market_operating_assignment_period_check CHECK (((effective_until IS NULL) OR (effective_until > effective_from))),
    CONSTRAINT market_operating_assignments_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'ENDED'::text])))
);


--
-- Name: TABLE market_operating_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_operating_assignments IS 'Sole active economic operating mandate for a Market ID; at most one ACTIVE row per market.';


--
-- Name: COLUMN market_operating_assignments.central_referent_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.market_operating_assignments.central_referent_user_id IS 'Central referent designation only. Grants no authority by itself.';


--
-- Name: market_payment_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_payment_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    provider text NOT NULL,
    adapter text,
    currency text NOT NULL,
    account_holder text NOT NULL,
    legal_seller text NOT NULL,
    market_operator_entity text,
    refund_bearer text NOT NULL,
    external_account_id text,
    credentials_ref text,
    legal_basis_ref text,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    verification_ref text,
    verified_at timestamp with time zone,
    verified_by uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_payment_accounts_account_holder_check CHECK (((char_length(btrim(account_holder)) >= 2) AND (char_length(btrim(account_holder)) <= 200))),
    CONSTRAINT market_payment_accounts_active_complete_chk CHECK (((status <> 'ACTIVE'::text) OR ((credentials_ref IS NOT NULL) AND (legal_basis_ref IS NOT NULL) AND (verified_at IS NOT NULL) AND (verified_by IS NOT NULL) AND (verification_ref IS NOT NULL)))),
    CONSTRAINT market_payment_accounts_adapter_check CHECK (((adapter IS NULL) OR (adapter ~ '^[a-z][a-z0-9_]{1,40}$'::text))),
    CONSTRAINT market_payment_accounts_credentials_ref_check CHECK (((credentials_ref IS NULL) OR ((credentials_ref ~ '^[a-z0-9][a-z0-9:_./-]{2,200}$'::text) AND (credentials_ref !~* '(^|[^a-z])(sk|rk|pk|whsec)_'::text)))),
    CONSTRAINT market_payment_accounts_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT market_payment_accounts_external_account_id_check CHECK (((external_account_id IS NULL) OR ((char_length(btrim(external_account_id)) >= 2) AND (char_length(btrim(external_account_id)) <= 200)))),
    CONSTRAINT market_payment_accounts_legal_basis_ref_check CHECK (((legal_basis_ref IS NULL) OR ((char_length(btrim(legal_basis_ref)) >= 3) AND (char_length(btrim(legal_basis_ref)) <= 300)))),
    CONSTRAINT market_payment_accounts_legal_seller_check CHECK (((char_length(btrim(legal_seller)) >= 2) AND (char_length(btrim(legal_seller)) <= 200))),
    CONSTRAINT market_payment_accounts_market_operator_entity_check CHECK (((market_operator_entity IS NULL) OR ((char_length(btrim(market_operator_entity)) >= 2) AND (char_length(btrim(market_operator_entity)) <= 200)))),
    CONSTRAINT market_payment_accounts_provider_check CHECK ((provider ~ '^[a-z][a-z0-9_]{1,40}$'::text)),
    CONSTRAINT market_payment_accounts_refund_bearer_check CHECK ((refund_bearer = ANY (ARRAY['MARKET'::text, 'PLATFORM'::text]))),
    CONSTRAINT market_payment_accounts_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'CLOSED'::text]))),
    CONSTRAINT market_payment_accounts_verification_chk CHECK ((((verified_at IS NULL) AND (verified_by IS NULL) AND (verification_ref IS NULL)) OR ((verified_at IS NOT NULL) AND (verified_by IS NOT NULL) AND (verification_ref IS NOT NULL)))),
    CONSTRAINT market_payment_accounts_verification_ref_check CHECK (((verification_ref IS NULL) OR ((char_length(btrim(verification_ref)) >= 3) AND (char_length(btrim(verification_ref)) <= 300))))
);


--
-- Name: market_payment_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_payment_providers (
    market_id uuid NOT NULL,
    provider text NOT NULL,
    currency text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_payment_currency_chk CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT market_payment_provider_chk CHECK ((provider = ANY (ARRAY['orange_money'::text, 'mtn_momo'::text, 'kartapay'::text]))),
    CONSTRAINT market_payment_providers_priority_check CHECK ((priority > 0))
);


--
-- Name: TABLE market_payment_providers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_payment_providers IS 'Providers Mobile Money autorisés par marché. KM utilise KartaPay comme gateway vers MVola/Holo ; credentials exclusivement runtime.';


--
-- Name: market_price_observation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_price_observation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    observation_id uuid,
    observation_ref text NOT NULL,
    market_id uuid NOT NULL,
    product_id uuid NOT NULL,
    action text NOT NULL,
    snapshot jsonb NOT NULL,
    reason text,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_price_observation_events_action_check CHECK ((action = ANY (ARRAY['RECORDED'::text, 'DEACTIVATED'::text])))
);


--
-- Name: TABLE market_price_observation_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_price_observation_events IS 'Append-only audit trail for local market price observations.';


--
-- Name: market_price_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_price_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    observation_ref text NOT NULL,
    market_id uuid NOT NULL,
    product_id uuid NOT NULL,
    category text,
    competitor_name text NOT NULL,
    observed_amount numeric(14,4) NOT NULL,
    currency text NOT NULL,
    price_kmf numeric(14,4) NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'market_manager'::text NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_price_observations_observed_amount_check CHECK ((observed_amount > (0)::numeric)),
    CONSTRAINT market_price_observations_price_kmf_check CHECK ((price_kmf > (0)::numeric))
);


--
-- Name: TABLE market_price_observations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_price_observations IS 'Observed local market prices. Market scope is resolved server-side; corridor projection is informative evidence, not an automatic pricing gate.';


--
-- Name: market_settlement_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_settlement_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    settlement_id uuid NOT NULL,
    actor_user_id uuid,
    event_type text NOT NULL,
    payload jsonb,
    correlation_id text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_settlement_events_event_type_check CHECK ((event_type = ANY (ARRAY['READY_ATTESTED'::text, 'REQUESTED'::text, 'PAID'::text, 'RECEIVED'::text])))
);


--
-- Name: TABLE market_settlement_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_settlement_events IS 'Journal append-only du lifecycle settlement. Complète market_delegation_audit : ici la vérité financière ; là-bas la preuve d usage des capabilities déléguées. UPDATE/DELETE interdits.';


--
-- Name: market_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    amount numeric(24,6) NOT NULL,
    currency text NOT NULL,
    source text DEFAULT 'CENTRAL_ATTESTATION'::text NOT NULL,
    source_reference text,
    period_start date,
    period_end date,
    attestation_note text,
    status text DEFAULT 'READY'::text NOT NULL,
    attested_by uuid NOT NULL,
    requested_by uuid,
    requested_at timestamp with time zone,
    paid_by uuid,
    paid_at timestamp with time zone,
    payment_reference text,
    received_by uuid,
    received_at timestamp with time zone,
    receipt_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_settlements_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT market_settlements_check CHECK (((period_start IS NULL) OR (period_end IS NULL) OR (period_end >= period_start))),
    CONSTRAINT market_settlements_check1 CHECK (((status = 'READY'::text) OR ((requested_by IS NOT NULL) AND (requested_at IS NOT NULL)))),
    CONSTRAINT market_settlements_check2 CHECK (((status <> ALL (ARRAY['PAID'::text, 'RECEIVED'::text])) OR ((paid_by IS NOT NULL) AND (paid_at IS NOT NULL) AND (NULLIF(btrim(payment_reference), ''::text) IS NOT NULL)))),
    CONSTRAINT market_settlements_check3 CHECK (((status <> 'RECEIVED'::text) OR ((received_by IS NOT NULL) AND (received_at IS NOT NULL)))),
    CONSTRAINT market_settlements_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT market_settlements_source_check CHECK ((source = 'CENTRAL_ATTESTATION'::text)),
    CONSTRAINT market_settlements_status_check CHECK ((status = ANY (ARRAY['READY'::text, 'REQUESTED'::text, 'PAID'::text, 'RECEIVED'::text])))
);


--
-- Name: TABLE market_settlements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_settlements IS 'Vérité de settlement du Market Operating Assignment. READY = attestation centrale, REQUESTED = demande pays, PAID = attestation centrale de paiement, RECEIVED = accusé de réception pays. amount/currency sont immuables après création ; DELETE interdit.';


--
-- Name: market_team_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_team_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid NOT NULL,
    email_normalized text,
    token_hash text NOT NULL,
    requested_capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    invited_by_membership_id uuid,
    status text DEFAULT 'PENDING'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by_user_id uuid,
    revoked_at timestamp with time zone,
    revoked_by_membership_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phone_e164 text,
    channel text DEFAULT 'EMAIL'::text NOT NULL,
    invited_by_user_id uuid NOT NULL,
    grants_operating_lead boolean DEFAULT false NOT NULL,
    CONSTRAINT market_team_invitation_channel_check CHECK ((channel = ANY (ARRAY['EMAIL'::text, 'WHATSAPP'::text]))),
    CONSTRAINT market_team_invitation_expiry_check CHECK ((expires_at > created_at)),
    CONSTRAINT market_team_invitation_lead_requires_central_check CHECK (((grants_operating_lead = false) OR (invited_by_membership_id IS NULL))),
    CONSTRAINT market_team_invitation_phone_e164_check CHECK (((phone_e164 IS NULL) OR (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'::text))),
    CONSTRAINT market_team_invitation_recipient_check CHECK ((((channel = 'EMAIL'::text) AND (email_normalized IS NOT NULL)) OR ((channel = 'WHATSAPP'::text) AND (phone_e164 IS NOT NULL)))),
    CONSTRAINT market_team_invitation_state_check CHECK ((((status = 'PENDING'::text) AND (accepted_at IS NULL) AND (revoked_at IS NULL)) OR ((status = 'ACCEPTED'::text) AND (accepted_at IS NOT NULL) AND (accepted_by_user_id IS NOT NULL) AND (revoked_at IS NULL)) OR ((status = 'REVOKED'::text) AND (revoked_at IS NOT NULL) AND (accepted_at IS NULL)) OR ((status = 'EXPIRED'::text) AND (accepted_at IS NULL) AND (revoked_at IS NULL)))),
    CONSTRAINT market_team_invitations_email_normalized_check CHECK (((email_normalized = lower(btrim(email_normalized))) AND (POSITION(('@'::text) IN (email_normalized)) > 1))),
    CONSTRAINT market_team_invitations_requested_capabilities_check CHECK ((jsonb_typeof(requested_capabilities) = 'array'::text)),
    CONSTRAINT market_team_invitations_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'REVOKED'::text, 'EXPIRED'::text]))),
    CONSTRAINT market_team_invitations_token_hash_check CHECK ((char_length(token_hash) = 64))
);


--
-- Name: TABLE market_team_invitations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_team_invitations IS 'Expiring invitation intent for Market Operating Assignment membership. Raw tokens are never persisted; requested capabilities are revalidated at acceptance.';


--
-- Name: COLUMN market_team_invitations.phone_e164; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.market_team_invitations.phone_e164 IS 'E.164 recipient used when channel=WHATSAPP. No local-number guessing.';


--
-- Name: COLUMN market_team_invitations.channel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.market_team_invitations.channel IS 'Invitation delivery intent: EMAIL or WHATSAPP. Delivery itself belongs to the notification layer.';


--
-- Name: COLUMN market_team_invitations.invited_by_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.market_team_invitations.invited_by_user_id IS 'Canonical inviter identity. invited_by_membership_id remains optional for delegated team invites.';


--
-- Name: COLUMN market_team_invitations.grants_operating_lead; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.market_team_invitations.grants_operating_lead IS 'When true, acceptance designates the resulting ACTIVE membership as operating lead; only central invitations may request it.';


--
-- Name: market_transport_sale_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_transport_sale_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    rate_key text NOT NULL,
    rate_per_kg numeric(14,4) NOT NULL,
    currency text NOT NULL,
    evidence_ref text NOT NULL,
    set_by uuid,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_transport_sale_rates_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT market_transport_sale_rates_evidence_ref_check CHECK ((length(btrim(evidence_ref)) > 0)),
    CONSTRAINT market_transport_sale_rates_rate_key_check CHECK ((rate_key = ANY (ARRAY['SEA_KMF_PER_KG_COMMERCIAL'::text, 'AIR_KMF_PER_KG_TAXABLE'::text]))),
    CONSTRAINT market_transport_sale_rates_rate_per_kg_check CHECK ((rate_per_kg > (0)::numeric))
);


--
-- Name: TABLE market_transport_sale_rates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_transport_sale_rates IS 'Tarif de vente transport par Market (devise du marché, par kg ; converti en KMF de base par voie gouvernée). Absent = refus hors KMF. Distinct du coût de fret attesté.';


--
-- Name: markets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.markets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    currency text NOT NULL,
    minor_unit smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lifecycle_status text DEFAULT 'PROVISIONING'::text NOT NULL,
    storefront_texts jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT markets_lifecycle_is_active_check CHECK ((is_active = (lifecycle_status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text])))),
    CONSTRAINT markets_lifecycle_status_check CHECK ((lifecycle_status = ANY (ARRAY['PROVISIONING'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'CLOSED'::text]))),
    CONSTRAINT markets_minor_unit_check CHECK (((minor_unit >= 0) AND (minor_unit <= 4))),
    CONSTRAINT markets_storefront_texts_object_check CHECK ((jsonb_typeof(storefront_texts) = 'object'::text))
);


--
-- Name: TABLE markets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.markets IS 'Référentiel des marchés ouverts. Pur data — aucune autorisation. Voir operator_market_scopes (M1) pour qui peut agir sur quel marché.';


--
-- Name: COLUMN markets.code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.markets.code IS 'ISO 3166-1 alpha-2. Clé stable référencée par relais.market_id (M1b) et orders.market_id (M1c) via markets.id, jamais via ce code directement.';


--
-- Name: COLUMN markets.minor_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.markets.minor_unit IS 'Décimales de la devise : 0 pour KMF/XAF, 2 pour EUR. Consommé par la boundary devise (M5) — cette table ne formate rien elle-même.';


--
-- Name: COLUMN markets.lifecycle_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.markets.lifecycle_status IS 'Canonical lifecycle: PROVISIONING, ACTIVE, SUSPENDED, CLOSED. is_active is a compatibility projection constrained by this value.';


--
-- Name: COLUMN markets.storefront_texts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.markets.storefront_texts IS 'Market-owned storefront copy/settings as JSON object. No authorization is derived from this payload.';


--
-- Name: membership_capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_capabilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    membership_id uuid NOT NULL,
    capability text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    limit_amount numeric(20,6),
    CONSTRAINT membership_capability_limit_nonnegative_check CHECK (((limit_amount IS NULL) OR (limit_amount >= (0)::numeric)))
);


--
-- Name: COLUMN membership_capabilities.limit_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.membership_capabilities.limit_amount IS 'Optional member per-operation maximum. Must not exceed a finite assignment ceiling.';


--
-- Name: mobile_money_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_money_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    market_id uuid NOT NULL,
    provider text NOT NULL,
    msisdn text,
    currency text NOT NULL,
    minor_unit integer DEFAULT 0 NOT NULL,
    amount_minor bigint NOT NULL,
    external_transaction_id text,
    status text DEFAULT 'initiated'::text NOT NULL,
    provider_status text,
    provider_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mobile_money_currency_chk CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT mobile_money_provider_chk CHECK ((provider = ANY (ARRAY['orange_money'::text, 'mtn_momo'::text, 'kartapay'::text]))),
    CONSTRAINT mobile_money_status_chk CHECK ((status = ANY (ARRAY['initiated'::text, 'pending'::text, 'succeeded'::text, 'failed'::text, 'expired'::text]))),
    CONSTRAINT mobile_money_transactions_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT mobile_money_transactions_minor_unit_check CHECK (((minor_unit >= 0) AND (minor_unit <= 4)))
);


--
-- Name: TABLE mobile_money_transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mobile_money_transactions IS 'Transactions Mobile Money Komerce. Le provider externe ne confirme jamais directement stock/commande : passage obligatoire par order-payment-confirmation.';


--
-- Name: notification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parcel_ref text,
    order_ref text,
    channel character varying(20) NOT NULL,
    event character varying(50) NOT NULL,
    recipient character varying(100),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: operator_market_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_market_scopes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    market_id uuid NOT NULL,
    role text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    projected_from_membership_id uuid,
    CONSTRAINT operator_market_scopes_role_check CHECK ((role = ANY (ARRAY['viewer'::text, 'manager'::text])))
);


--
-- Name: TABLE operator_market_scopes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.operator_market_scopes IS 'Historique d''ACCÈS opérateur → marché, grain user. Jamais la source de vérité du settlement (grain organisation, différé). Révocation = UPDATE revoked_at, jamais DELETE.';


--
-- Name: COLUMN operator_market_scopes.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.operator_market_scopes.id IS 'Identité du grant lui-même, pas du couple (user_id, market_id) — un cycle grant/revoke/re-grant produit plusieurs lignes distinctes.';


--
-- Name: COLUMN operator_market_scopes.revoked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.operator_market_scopes.revoked_at IS 'NULL = grant actif. Un grant révoqué n''est jamais supprimé : l''historique d''accès doit rester reconstructible à tout instant.';


--
-- Name: COLUMN operator_market_scopes.projected_from_membership_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.operator_market_scopes.projected_from_membership_id IS 'Non-null when this authorization read-model row is deterministically projected from market-delegation assignment membership.';


--
-- Name: order_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    author_id uuid,
    author_name text,
    author_role text,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: order_cost_entry_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_cost_entry_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    event_type text NOT NULL,
    cost_type text,
    idempotency_key text,
    old_value jsonb,
    new_value jsonb,
    provenance text,
    reason text,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_cost_entry_events_event_type_check CHECK ((event_type = ANY (ARRAY['simulation_scope_assigned'::text, 'manual_cost_entered'::text, 'manual_cost_corrected'::text])))
);


--
-- Name: order_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    reporter_id uuid,
    reporter_name text,
    type text NOT NULL,
    description text,
    priority text DEFAULT 'normal'::text,
    status text DEFAULT 'open'::text,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    resolved_by uuid,
    resolution_note text,
    CONSTRAINT order_incidents_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT order_incidents_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text]))),
    CONSTRAINT order_incidents_type_check CHECK ((type = ANY (ARRAY['retard'::text, 'blocage'::text, 'paiement'::text, 'stock'::text, 'colis_endommage'::text, 'colis_perdu'::text, 'client_absent'::text, 'autre'::text])))
);


--
-- Name: order_item_cost_imputations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_item_cost_imputations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    product_id uuid,
    quantity integer NOT NULL,
    sale_unit_price_kmf numeric(12,2) NOT NULL,
    sale_total_kmf numeric(12,2) NOT NULL,
    estimated_landed_relay_cost_kmf numeric(12,2),
    estimated_business_complete_cost_kmf numeric(12,2),
    estimated_margin_kmf numeric(12,2),
    estimated_margin_pct numeric(6,2),
    cost_breakdown jsonb,
    allocations jsonb,
    allocation_averages jsonb,
    allocation_confidence text,
    data_quality jsonb,
    pricing_source text DEFAULT 'pricing-engine'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    estimated_business_variable_cost_kmf numeric(12,2),
    estimated_fixed_overhead_kmf numeric(12,2)
);


--
-- Name: COLUMN order_item_cost_imputations.estimated_business_variable_cost_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_item_cost_imputations.estimated_business_variable_cost_kmf IS 'Snapshot N2 total de l order_item : paiement + provision risque. NULL si non reconstructible.';


--
-- Name: COLUMN order_item_cost_imputations.estimated_fixed_overhead_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_item_cost_imputations.estimated_fixed_overhead_kmf IS 'Snapshot N3 total de l order_item : allocation de structure pour lecture. NULL si non reconstructible.';


--
-- Name: order_item_real_cost_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_item_real_cost_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    parcel_id uuid,
    shipment_id uuid,
    cost_type text NOT NULL,
    amount_kmf numeric(12,2) NOT NULL,
    allocation_method text NOT NULL,
    source text,
    is_actual boolean DEFAULT true NOT NULL,
    confidence text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    provenance text
);


--
-- Name: COLUMN order_item_real_cost_allocations.provenance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_item_real_cost_allocations.provenance IS 'Provenance déclarée du coût (ex. FICTIF recette, pièce fournisseur). NULL = non déclarée (historique).';


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    price_kmf numeric(12,2) NOT NULL,
    scan_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    module_type public.ceremony_order_type,
    module_fabric_id uuid,
    module_fabric_type text,
    module_size character varying(8),
    module_retouche boolean DEFAULT false CONSTRAINT order_items_ceremony_retouche_not_null NOT NULL,
    module_qty_meters numeric(6,2),
    module_accessories jsonb,
    availability_status text DEFAULT 'pending'::text,
    estimated_available_at timestamp with time zone,
    backorder_reason text,
    qty_ordered integer DEFAULT 1 NOT NULL,
    qty_allocated integer DEFAULT 0 NOT NULL,
    qty_packed integer DEFAULT 0 NOT NULL,
    qty_shipped integer DEFAULT 0 NOT NULL,
    qty_received integer DEFAULT 0 NOT NULL,
    qty_collected integer DEFAULT 0 NOT NULL,
    variant_combo jsonb,
    customs_category_key text,
    sh_code text,
    douane_pct numeric(5,2),
    tva_pct numeric(5,2),
    taxe_add_pct numeric(5,2),
    classification_defaulted boolean DEFAULT false NOT NULL,
    sku_id uuid,
    delivery_mode text DEFAULT 'sea'::text NOT NULL,
    requested_transport_rail text,
    shared_cart_item_id uuid,
    fulfillment_source text,
    CONSTRAINT chk_order_items_price CHECK ((price_kmf > (0)::numeric)),
    CONSTRAINT chk_order_items_qty CHECK ((quantity > 0)),
    CONSTRAINT order_items_delivery_mode_check CHECK ((delivery_mode = ANY (ARRAY['sea'::text, 'air'::text]))),
    CONSTRAINT order_items_fulfillment_source_valid CHECK (((fulfillment_source IS NULL) OR (fulfillment_source = ANY (ARRAY['LOCAL_STOCK'::text, 'IMPORT'::text])))),
    CONSTRAINT order_items_requested_transport_rail_check CHECK ((requested_transport_rail = ANY (ARRAY['SEA_STANDARD'::text, 'AIR_EXPRESS'::text])))
);


--
-- Name: COLUMN order_items.module_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.module_type IS 'Type cÃ©rÃ©monie pour cet article â€” null si article standard';


--
-- Name: COLUMN order_items.module_fabric_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.module_fabric_id IS 'FK vers fabrics â€” tissu pour cet article';


--
-- Name: COLUMN order_items.module_size; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.module_size IS 'Taille pour cet article cÃ©rÃ©monie';


--
-- Name: COLUMN order_items.module_retouche; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.module_retouche IS 'Retouche locale pour cet article';


--
-- Name: COLUMN order_items.module_qty_meters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.module_qty_meters IS 'QuantitÃ© tissu en mÃ¨tres (fabric_only)';


--
-- Name: COLUMN order_items.module_accessories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.module_accessories IS 'Accessoires pour cet article';


--
-- Name: COLUMN order_items.customs_category_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.customs_category_key IS 'Clé customs_categories figée à la création — immuable comme price_kmf. Source : product.category → customs_categories.key.';


--
-- Name: COLUMN order_items.sh_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.sh_code IS 'Code SH (nomenclature douanière) figé à la création.';


--
-- Name: COLUMN order_items.douane_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.douane_pct IS 'Taux de droit de douane (%) figé à la création depuis customs_categories.';


--
-- Name: COLUMN order_items.tva_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.tva_pct IS 'Taux TVA (%) figé à la création depuis customs_categories.';


--
-- Name: COLUMN order_items.taxe_add_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.taxe_add_pct IS 'Taux taxe additionnelle (%) figé à la création depuis customs_categories.';


--
-- Name: COLUMN order_items.classification_defaulted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.classification_defaulted IS 'true si product.category ne matchait aucune customs_categories.key et que la catégorie "default" a été utilisée en repli.';


--
-- Name: COLUMN order_items.sku_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.sku_id IS 'FK vers product_skus (Lot 0). NULL tant que routes/orders/create.js ne le renseigne pas (Lot 3). Remplacera variant_combo comme canal de pilotage du stock — variant_combo reste pour affichage/historique.';


--
-- Name: COLUMN order_items.delivery_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.delivery_mode IS 'DÉPRÉCIÉE — remplacée par requested_transport_rail (migration 117). À supprimer après vérification en production.';


--
-- Name: COLUMN order_items.requested_transport_rail; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.requested_transport_rail IS 'Code canonique du rail demandé par le client lors de la commande. NULL = aucun choix explicite (ne déduit pas SEA_STANDARD). Valeurs : SEA_STANDARD, AIR_EXPRESS. À distinguer de assigned_transport_rail (rail réellement exécuté par logistics).';


--
-- Name: COLUMN order_items.fulfillment_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.fulfillment_source IS 'Snapshot immuable de provenance au checkout : LOCAL_STOCK ou IMPORT. NULL est réservé aux lignes historiques/synthétiques sans snapshot fiable et ne doit jamais être interprété comme IMPORT.';


--
-- Name: order_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    status public.order_status NOT NULL,
    scan_id uuid,
    changed_by uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reference text NOT NULL,
    user_id uuid,
    basket_id uuid,
    recipient_id uuid,
    relais_id uuid NOT NULL,
    shipment_id uuid,
    total_kmf numeric(14,2) NOT NULL,
    total_eur numeric(10,2),
    total_aed numeric(10,2),
    payment_mode public.payment_mode NOT NULL,
    payment_status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    stripe_payment_id text,
    cash_ref_code text,
    cash_qr_data text,
    cash_paid_at timestamp with time zone,
    status public.order_status DEFAULT 'confirmed'::public.order_status NOT NULL,
    shipped_at timestamp with time zone,
    available_at timestamp with time zone,
    collected_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    cost_transport_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    cost_douane_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    reminder_h12_sent boolean DEFAULT false NOT NULL,
    reminder_h36_sent boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cost_estimated_kmf numeric(14,2),
    cost_real_kmf numeric(14,2),
    cost_delta_pct numeric(6,3),
    margin_estimated_pct numeric(6,3),
    margin_real_pct numeric(6,3),
    margin_alert boolean DEFAULT false NOT NULL,
    sourcing_blocked boolean DEFAULT false NOT NULL,
    cost_closed_at timestamp with time zone,
    confection_type character varying(32) DEFAULT 'aucun'::character varying NOT NULL,
    confection_instructions text,
    confection_delay_days integer DEFAULT 0 NOT NULL,
    confection_artisan_id uuid,
    purchasing_at timestamp with time zone,
    in_transit_at timestamp with time zone,
    module_type public.ceremony_order_type,
    module_fabric_id uuid,
    module_fabric_type text,
    module_size character varying(8),
    module_retouche boolean DEFAULT false CONSTRAINT orders_ceremony_retouche_not_null NOT NULL,
    module_qty_meters numeric(6,2),
    module_accessories jsonb,
    ordered_at timestamp with time zone,
    preparation_at timestamp with time zone,
    hub_preparation_at timestamp with time zone,
    order_occasion text,
    supplier_name text,
    supplier_invoice_url text,
    discount_pct numeric(4,2) DEFAULT 0 NOT NULL,
    discount_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    loyalty_label character varying(50),
    unsold_at timestamp with time zone,
    unsold_price_kmf numeric(14,2),
    batch_id uuid,
    qr_token character varying(64),
    qr_expires_at timestamp without time zone,
    computed_status text,
    wallet_applied_kmf numeric(14,2) DEFAULT 0,
    destination_island character varying(20),
    routing_mode character varying(20),
    transit_hub character varying(20),
    pending_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    completion_ratio double precision DEFAULT 0,
    items_received integer DEFAULT 0,
    items_total integer DEFAULT 0,
    deadline_dispatch timestamp with time zone,
    tracking_phone character varying(32),
    pickup_secret_hash text,
    pickup_secret_salt text,
    pickup_secret_created_at timestamp with time zone,
    pickup_secret_expires_at timestamp with time zone,
    pickup_secret_attempts integer DEFAULT 0,
    pickup_secret_blocked_until timestamp with time zone,
    pickup_secret_regen_count integer DEFAULT 0,
    pickup_secret_regen_reason text,
    payment_received_at timestamp with time zone,
    payment_received_by_agent_id uuid,
    payer_name text,
    payer_id_type text,
    payer_id_number text,
    payer_note text,
    collected_by_name text,
    tracking_phone_secondary character varying(30),
    tracking_phone_confirmed_at timestamp with time zone,
    tracking_phone_confirmed_by_agent_id uuid,
    pickup_secret_last4 character varying(4),
    pickup_secret_channel text,
    pickup_secret_emitted_at timestamp with time zone,
    pickup_secret_revealed_at timestamp with time zone,
    stripe_billing_name text,
    stripe_card_last4 character varying(4),
    stripe_receipt_email text,
    mobile_money_msisdn character varying(30),
    mobile_money_operator text,
    mobile_money_payer_name text,
    supplier_id uuid,
    shared_cart_id uuid,
    prepaid_amount_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    remaining_cash_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    paypal_order_id text,
    paypal_capture_id text,
    paypal_payer_email text,
    paypal_payer_id text,
    paypal_pay_in_4_used boolean DEFAULT false,
    transport_price_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    exceptional_pickup_attempts integer DEFAULT 0 NOT NULL,
    exceptional_pickup_blocked_until timestamp with time zone,
    pickup_collected_via text,
    pickup_code_recipient character varying(16) DEFAULT 'buyer'::character varying NOT NULL,
    pickup_code_recipient_user_id uuid,
    market_id uuid NOT NULL,
    display_total_amount numeric(14,2),
    display_currency text,
    display_parity_snapshot jsonb,
    simulation_scope text,
    transport_pricing_snapshot jsonb,
    fx_snapshot jsonb,
    CONSTRAINT chk_orders_discount CHECK (((discount_pct >= (0)::numeric) AND (discount_pct <= (100)::numeric))),
    CONSTRAINT chk_orders_total CHECK ((total_kmf >= (0)::numeric)),
    CONSTRAINT orders_pickup_code_recipient_check CHECK (((pickup_code_recipient)::text = ANY ((ARRAY['buyer'::character varying, 'organizer'::character varying])::text[]))),
    CONSTRAINT orders_simulation_scope_format CHECK (((simulation_scope IS NULL) OR (simulation_scope ~ '^[A-Z][A-Z0-9-]{1,31}$'::text)))
);


--
-- Name: COLUMN orders.cost_estimated_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.cost_estimated_kmf IS 'CoÃ»t total estimÃ© par le moteur pricing au moment de la commande';


--
-- Name: COLUMN orders.cost_real_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.cost_real_kmf IS 'CoÃ»t total rÃ©el renseignÃ© aprÃ¨s livraison (douane rÃ©elle incluse)';


--
-- Name: COLUMN orders.cost_delta_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.cost_delta_pct IS 'Ã‰cart coÃ»t rÃ©el vs estimÃ© en % â€” alimentation mensuelle du coefficient risque';


--
-- Name: COLUMN orders.margin_estimated_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.margin_estimated_pct IS 'Marge estimÃ©e Ã  la commande â€” objectif 12%';


--
-- Name: COLUMN orders.margin_real_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.margin_real_pct IS 'Marge rÃ©elle post-livraison = (total_kmf - cost_real_kmf) / total_kmf';


--
-- Name: COLUMN orders.margin_alert; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.margin_alert IS 'true si margin_real_pct < 10% â€” alerte back-office';


--
-- Name: COLUMN orders.sourcing_blocked; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.sourcing_blocked IS 'true si margin_real_pct < 0 â€” blocage sourcing produit/catÃ©gorie';


--
-- Name: COLUMN orders.cost_closed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.cost_closed_at IS 'Horodatage de la clÃ´ture comptable commande';


--
-- Name: COLUMN orders.confection_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.confection_type IS 'aucun | couture_standard | sur_mesure | retouche_locale | broderie';


--
-- Name: COLUMN orders.confection_instructions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.confection_instructions IS 'Mensurations ou notes libres transmises par le client';


--
-- Name: COLUMN orders.confection_delay_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.confection_delay_days IS 'DÃ©lai supplÃ©mentaire jours calculÃ© selon le service choisi';


--
-- Name: COLUMN orders.confection_artisan_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.confection_artisan_id IS 'RÃ©fÃ©rence atelier Deira ou artisan relais Anjouan (table partners)';


--
-- Name: COLUMN orders.purchasing_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.purchasing_at IS 'Horodatage passage au statut purchasing (en achat au hub)';


--
-- Name: COLUMN orders.in_transit_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.in_transit_at IS 'Horodatage passage au statut transit_comores (dÃ©douanement Mutsamudu)';


--
-- Name: COLUMN orders.module_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.module_type IS 'ready_made | fabric_only | custom_from_fabric â€” null si commande standard';


--
-- Name: COLUMN orders.module_fabric_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.module_fabric_id IS 'FK vers fabrics.id â€” tissu choisi (fabric_only et custom_from_fabric)';


--
-- Name: COLUMN orders.module_fabric_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.module_fabric_type IS 'Label lisible du tissu : Wax, Dentelle, Mousseline, Soie, Coton, Bogolan';


--
-- Name: COLUMN orders.module_size; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.module_size IS 'Taille standard client : XS S M L XL XXL XXXL';


--
-- Name: COLUMN orders.module_retouche; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.module_retouche IS 'Retouche locale demandÃ©e aux Comores â€” incluse sans surcoÃ»t MVP';


--
-- Name: COLUMN orders.module_qty_meters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.module_qty_meters IS 'QuantitÃ© tissu en mÃ¨tres ou yards (fabric_only uniquement)';


--
-- Name: COLUMN orders.module_accessories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.module_accessories IS 'Accessoires choisis ex: ["Fil assorti","Doublure","Boutons"]';


--
-- Name: COLUMN orders.ordered_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.ordered_at IS 'Horodatage passage au statut ordered â€” paiement confirmÃ©, commande lancÃ©e (spec Â§9.1 statut #1)';


--
-- Name: COLUMN orders.preparation_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.preparation_at IS 'Horodatage SCAN 3 Hub â€” rÃ©ception marchandise au hub Dubai (spec Â§9.1 statut #3)';


--
-- Name: COLUMN orders.hub_preparation_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.hub_preparation_at IS 'Horodatage SCAN 4 Hub â€” colis emballÃ©, prÃªt pour remise groupeur (spec Â§9.1 statut #4)';


--
-- Name: COLUMN orders.order_occasion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.order_occasion IS 'Occasion de commande â€” mariage Â· cadeau Â· personnel Â· construction Â· rentree Â· ramadan Â· aid Â· autre â€” Phase 2 fidÃ©lisation';


--
-- Name: COLUMN orders.supplier_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.supplier_name IS 'Enseigne ou fournisseur Dubai (ex: Noon, Carrefour MoE, souk Deira)';


--
-- Name: COLUMN orders.supplier_invoice_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.supplier_invoice_url IS 'URL ou chemin vers la facture fournisseur (Google Drive, S3, URL directe)';


--
-- Name: COLUMN orders.batch_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.batch_id IS 'Lot d expÃ©dition groupÃ© (Phase 2). NULL en Phase 1.';


--
-- Name: COLUMN orders.pending_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.pending_at IS 'Timestamp de crÃ©ation de la commande (status=pending).';


--
-- Name: COLUMN orders.confirmed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.confirmed_at IS 'Timestamp de confirmation du paiement (status=confirmed).';


--
-- Name: COLUMN orders.paypal_order_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.paypal_order_id IS 'PayPal Order ID (avant capture) — pattern: 8 chars majuscules + chiffres';


--
-- Name: COLUMN orders.paypal_capture_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.paypal_capture_id IS 'PayPal Capture ID (après approval) — utilisé pour refund via /v2/payments/captures/:id/refund';


--
-- Name: COLUMN orders.paypal_payer_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.paypal_payer_email IS 'Email PayPal du payeur diaspora (≠ user.email — l''email enregistré peut différer)';


--
-- Name: COLUMN orders.paypal_payer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.paypal_payer_id IS 'PayPal Payer ID (Account ID PayPal du payeur) — pour traçabilité litige';


--
-- Name: COLUMN orders.paypal_pay_in_4_used; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.paypal_pay_in_4_used IS 'TRUE si le payeur a choisi Pay-in-4 (utile pour suivi conversion diaspora)';


--
-- Name: COLUMN orders.transport_price_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.transport_price_kmf IS 'Part du total (orders.total_kmf) facturée au transport, calculée par services/transport-pricing.js au moment de la commande. Distincte de cost_estimated_kmf (coût interne fret, jamais facturé tel quel). 0 pour les commandes créées avant la migration 118.';


--
-- Name: COLUMN orders.market_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.market_id IS 'Marché de la commande, SNAPSHOT résolu depuis relais.market_id au moment de la commande (ou du backfill pour les commandes existantes). Ne se re-synchronise jamais automatiquement si un relais changeait de marché. NOT NULL — garanti par orders.relais_id NOT NULL. Voir migrations/138_orders_market_id.sql.';


--
-- Name: COLUMN orders.display_total_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.display_total_amount IS 'Montant PRÉSENTÉ au client au moment de confirmer, dans display_currency. Figé à la création, jamais recalculé. JAMAIS lu par Stripe/PayPal/cash_relais (ceux-ci lisent exclusivement total_kmf/total_eur). NULL pour les commandes antérieures à cette migration — pas de backfill fabriqué (freeze P3, invariant 7).';


--
-- Name: COLUMN orders.display_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.display_currency IS 'Devise de display_total_amount — celle du contexte marché du client au moment de la commande (market-context.js, override ?market= inclus), PAS nécessairement celle de relais.market_id (freeze P3, invariant 4 : ne jamais supposer silencieusement que orders.market_id == marché de navigation — un acheteur diaspora peut consulter en XAF et livrer via un relais KM).';


--
-- Name: COLUMN orders.display_parity_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.display_parity_snapshot IS 'Métadonnée d''audit : parité(s) currency_parities utilisée(s) pour calculer display_total_amount, et la source du contexte marché (explicite ou fallback). Ne remplace JAMAIS display_total_amount comme source de vérité (freeze P3, invariant 5) — lecture humaine/debug uniquement.';


--
-- Name: COLUMN orders.simulation_scope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.simulation_scope IS 'NULL = activité réelle. Sinon identifiant du périmètre de recette (faits simulés) : exclu des agrégats d''activité réelle, inclus seulement quand ce périmètre est demandé explicitement. Immuable une fois posé.';


--
-- Name: COLUMN orders.transport_pricing_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.transport_pricing_snapshot IS 'Preuve figée du tarif de vente transport (devise marché, pivot EUR, ids de tarif, jambes FX). Nullable : commandes antérieures ou sans transport import.';


--
-- Name: COLUMN orders.fx_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.fx_snapshot IS 'Snapshot monétaire immuable de la commande : origine KMF, montant confirmé devise marché, EUR autorisé, jambes FX. Lu, jamais recalculé.';


--
-- Name: otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_codes (
    id integer NOT NULL,
    phone character varying(20) NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    purpose text DEFAULT 'login'::text NOT NULL,
    consumed_at timestamp with time zone
);


--
-- Name: otp_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.otp_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: otp_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.otp_codes_id_seq OWNED BY public.otp_codes.id;


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    aggregate_sequence bigint NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    CONSTRAINT chk_outbox_events_payload_shape CHECK (((jsonb_typeof(payload) = 'object'::text) AND ((payload ->> 'outcome_type'::text) = ANY (ARRAY['LOST'::text, 'STOLEN'::text, 'DESTROYED'::text, 'DAMAGED_UNUSABLE'::text])))),
    CONSTRAINT outbox_events_event_type_check CHECK ((event_type = 'physical_outcome_reported'::text))
);


--
-- Name: TABLE outbox_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.outbox_events IS 'Primitive outbox transactionnelle (HUB-000/F0). Un seul event_type aujourd''hui : physical_outcome_reported. Toute nouvelle famille nécessite une migration ajoutant sa valeur au CHECK — jamais un ajout silencieux côté code.';


--
-- Name: COLUMN outbox_events.aggregate_sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbox_events.aggregate_sequence IS 'Autorité d''ordre par agrégat, attribuée par le producer sous pg_advisory_xact_lock (bloquant, tenu jusqu''au commit appelant). Jamais calculée hors de ce verrou.';


--
-- Name: COLUMN outbox_events.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbox_events.created_at IS 'Audit/observabilité uniquement — PAS l''autorité d''ordre. Voir aggregate_sequence pour l''ordre causal garanti par agrégat.';


--
-- Name: parcel_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parcel_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parcel_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_id uuid,
    location text,
    weight_kg numeric(6,2),
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: parcel_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parcel_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parcel_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    qty_allocated integer DEFAULT 0 NOT NULL,
    qty_packed integer DEFAULT 0 NOT NULL,
    qty_shipped integer DEFAULT 0 NOT NULL,
    qty_received integer DEFAULT 0 NOT NULL,
    qty_collected integer DEFAULT 0 NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    verified_by uuid,
    product_name text,
    CONSTRAINT parcel_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: parcel_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parcel_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parcels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parcels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    shipment_id uuid,
    reference text NOT NULL,
    label text,
    type text DEFAULT 'standard'::text NOT NULL,
    status public.parcel_status DEFAULT 'draft'::public.parcel_status NOT NULL,
    prepared_at timestamp with time zone,
    shipped_at timestamp with time zone,
    in_transit_at timestamp with time zone,
    arrived_at timestamp with time zone,
    available_at timestamp with time zone,
    collected_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    relais_id uuid,
    pickup_code text,
    weight_kg numeric(6,2),
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cancel_reason text,
    estimated_date timestamp with time zone,
    backorder_reminder_sent boolean DEFAULT false,
    volume_cm3 numeric(10,2),
    shipping_session_id uuid,
    external_code text,
    seal_code text,
    last_weight_kg numeric(6,2),
    last_weight_at timestamp with time zone,
    last_weight_location text,
    destination_island text,
    relay_id uuid,
    eta timestamp with time zone,
    delivered_at timestamp with time zone,
    verification_status text DEFAULT 'pending'::text,
    verified_at timestamp with time zone,
    verified_by uuid,
    verification_notes text,
    expected_weight_kg numeric(6,2),
    actual_weight_kg numeric(6,2),
    destination_relais text,
    recipient_name text,
    recipient_phone text,
    items_count integer DEFAULT 0,
    total_qty integer DEFAULT 0,
    customs_value_kmf numeric(12,2),
    customs_weight_kg numeric(8,3),
    customs_hs_code character varying(20),
    customs_cleared_at timestamp with time zone,
    customs_notes text,
    CONSTRAINT parcels_type_check CHECK ((type = ANY (ARRAY['standard'::text, 'partial'::text, 'backorder'::text, 'awaiting_stock'::text])))
);


--
-- Name: partner_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.partner_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partners (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    partner_type text CONSTRAINT partners_type_not_null NOT NULL,
    location text,
    island text DEFAULT 'Anjouan'::text NOT NULL,
    country character(2) DEFAULT 'KM'::bpchar NOT NULL,
    phone text,
    email text,
    contact_name text,
    commission_kmf numeric(14,2),
    commission_pct numeric(5,2),
    commission_type text DEFAULT 'fixed'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    activated_at date,
    suspended_at date,
    suspension_reason text,
    activation_phase text DEFAULT 'phase_1'::text NOT NULL,
    relais_id uuid,
    avg_delivery_hours numeric(6,1),
    scan_rate_pct numeric(5,2),
    nps_score numeric(4,1),
    incident_count integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    country_code text,
    country_label text,
    currency text,
    lead_time_days integer,
    payment_terms text,
    product_categories text[],
    whatsapp_url text,
    website_url text,
    pricing_notes text,
    rating smallint,
    contact_phone text,
    contact_email text,
    address text,
    zone text,
    partner_ref text DEFAULT ('KPT-'::text || lpad((nextval('public.partner_ref_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    CONSTRAINT chk_partners_partner_type CHECK ((partner_type = ANY (ARRAY['relais_simple'::text, 'relais_showroom'::text, 'partenaire_avance'::text, 'atelier_couture'::text, 'artisan_retouche'::text, 'franchise_s5'::text]))),
    CONSTRAINT partners_rating_check CHECK (((rating IS NULL) OR ((rating >= 1) AND (rating <= 5))))
);


--
-- Name: TABLE partners; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.partners IS 'RÃ©seau partenaires Komerce â€” 3 niveaux MVP + artisans couture + franchise Phase 4';


--
-- Name: COLUMN partners.partner_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.partners.partner_type IS 'relais_simple | relais_showroom | partenaire_avance | atelier_couture | artisan_retouche | franchise_s5';


--
-- Name: COLUMN partners.activation_phase; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.partners.activation_phase IS 'Phase d activation : phase_1 (MVP) Ã  phase_4 (franchise)';


--
-- Name: paypal_events_processed; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paypal_events_processed (
    event_id text NOT NULL,
    event_type text NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    payload_summary jsonb,
    status text DEFAULT 'processed'::text NOT NULL,
    CONSTRAINT paypal_events_processed_status_check CHECK ((status = ANY (ARRAY['processed'::text, 'ignored'::text, 'rejected'::text, 'noop'::text])))
);


--
-- Name: TABLE paypal_events_processed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.paypal_events_processed IS 'Idempotence I-07 pour les webhooks PayPal. Tout event_id traité est marqué ici DANS la même transaction que la confirmation paiement.';


--
-- Name: physical_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.physical_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    market_id uuid NOT NULL,
    zone text,
    status public.physical_offer_status DEFAULT 'draft'::public.physical_offer_status NOT NULL,
    commercial_exposure text DEFAULT 'DISABLED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_ref text,
    actions_enabled text[] DEFAULT ARRAY['request'::text] NOT NULL,
    CONSTRAINT physical_offers_actions_enabled_allowed CHECK (((cardinality(actions_enabled) > 0) AND (actions_enabled <@ ARRAY['request'::text, 'quote'::text, 'callback'::text, 'call'::text, 'whatsapp'::text]))),
    CONSTRAINT physical_offers_commercial_exposure_check CHECK ((commercial_exposure = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text]))),
    CONSTRAINT physical_offers_image_ref_public CHECK (((image_ref IS NULL) OR (image_ref ~ '^/[^/]'::text) OR (image_ref ~~ 'https://%'::text)))
);


--
-- Name: TABLE physical_offers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.physical_offers IS 'Produit physique réellement proposé par un tiers local (ex. samboussas pour mariage) — le tiers prépare/détient la marchandise, fixe le prix, porte le risque d''exécution. Distinct de products (Komerce fixe le prix et porte le risque commercial) et de local_stock (stock détenu par Komerce). Distinct de services (prestation de travail) par le nom, pas seulement par convention — RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §D.';


--
-- Name: COLUMN physical_offers.commercial_exposure; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.physical_offers.commercial_exposure IS 'Même patron que services.commercial_exposure et les rails transport (DOCTRINE_TRANSPORT_RAILS.md) : donnée vivante, valorisée, jamais exposée tant que ce champ reste DISABLED.';


--
-- Name: COLUMN physical_offers.image_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.physical_offers.image_ref IS 'Référence média publique optionnelle pour la représentation de l''offre physique. Chemin public /... (jamais //...) ou URL https:// uniquement. Source owner = providers-services.';


--
-- Name: COLUMN physical_offers.actions_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.physical_offers.actions_enabled IS 'Capacités cumulatives de la fiche Komerce : request, quote, callback, call, whatsapp. Le kind ne choisit jamais seul l interaction.';


--
-- Name: physical_outcome_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.physical_outcome_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    consumer_key text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    outcome_type text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE physical_outcome_receipts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.physical_outcome_receipts IS 'Consumer minimal réel de physical_outcome_reported (F0). Preuve d''idempotence via UNIQUE(event_id, consumer_key), pas de conséquence métier — HUB-001 branchera les vrais consumers (Purchasing/Orders) plus tard, chacun avec son propre consumer_key.';


--
-- Name: pickup_print_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickup_print_tokens (
    token text NOT NULL,
    order_id uuid NOT NULL,
    code text NOT NULL,
    payer_name text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE pickup_print_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pickup_print_tokens IS 'Tokens Ã©phÃ©mÃ¨res (TTL 2 min) pour accÃ¨s one-shot au HTML imprimable du reÃ§u cash. Remplace la Map printTokens in-memory de routes/pickup-secret.js (SEC-1).';


--
-- Name: pickup_proof_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pickup_proof_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pickup_reveal_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickup_reveal_codes (
    order_id uuid NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE pickup_reveal_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pickup_reveal_codes IS 'Codes pickup en clair, stockÃ©s temporairement (TTL 30 min) pour la rÃ©vÃ©lation one-shot aprÃ¨s paiement Stripe/Wallet/MM. Le code est supprimÃ© immÃ©diatement aprÃ¨s la premiÃ¨re lecture par GET /reveal-once. Remplace la Map REVEAL_CACHE in-memory de routes/pickup-secret.js (SEC-1).';


--
-- Name: pickup_verify_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickup_verify_attempts (
    attempt_key text NOT NULL,
    token text NOT NULL,
    ip_hash text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    reset_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    old_price_kmf numeric,
    new_price_kmf numeric NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    applied_by uuid,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    scenario_id text,
    scenario_label text,
    levier text
);


--
-- Name: pricing_benchmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_benchmarks (
    id integer NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    emoji text,
    category text NOT NULL,
    unit text NOT NULL,
    benchmark_median numeric NOT NULL,
    benchmark_min numeric,
    benchmark_max numeric,
    importance text DEFAULT 'recommended'::text NOT NULL,
    why text,
    source_benchmark text,
    applies_to text DEFAULT 'all'::text,
    display_order integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pricing_benchmarks_category_check CHECK ((category = ANY (ARRAY['sourcing'::text, 'transit'::text, 'douane'::text, 'hub'::text, 'distribution'::text, 'paiement'::text]))),
    CONSTRAINT pricing_benchmarks_importance_check CHECK ((importance = ANY (ARRAY['critical'::text, 'recommended'::text, 'optional'::text]))),
    CONSTRAINT pricing_benchmarks_unit_check CHECK ((unit = ANY (ARRAY['pct'::text, 'kmf'::text, 'kmf_per_kg'::text, 'kmf_per_m3'::text, 'aed'::text, 'eur'::text, 'months'::text])))
);


--
-- Name: pricing_benchmarks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pricing_benchmarks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pricing_benchmarks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pricing_benchmarks_id_seq OWNED BY public.pricing_benchmarks.id;


--
-- Name: pricing_category_dims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_category_dims (
    category character varying(50) NOT NULL,
    label_fr character varying(100) NOT NULL,
    length_cm integer NOT NULL,
    width_cm integer NOT NULL,
    height_cm integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT pricing_category_dims_height_cm_check CHECK (((height_cm > 0) AND (height_cm <= 200))),
    CONSTRAINT pricing_category_dims_length_cm_check CHECK (((length_cm > 0) AND (length_cm <= 200))),
    CONSTRAINT pricing_category_dims_width_cm_check CHECK (((width_cm > 0) AND (width_cm <= 200)))
);


--
-- Name: pricing_category_taxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_category_taxes (
    category character varying(50) NOT NULL,
    label_fr character varying(100) NOT NULL,
    douane_pct numeric(5,4) NOT NULL,
    tva_pct numeric(5,4) NOT NULL,
    taxe_add_pct numeric(5,4) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT pricing_category_taxes_douane_pct_check CHECK (((douane_pct >= (0)::numeric) AND (douane_pct <= (1)::numeric))),
    CONSTRAINT pricing_category_taxes_taxe_add_pct_check CHECK (((taxe_add_pct >= (0)::numeric) AND (taxe_add_pct <= (1)::numeric))),
    CONSTRAINT pricing_category_taxes_tva_pct_check CHECK (((tva_pct >= (0)::numeric) AND (tva_pct <= (1)::numeric)))
);


--
-- Name: pricing_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    emoji text,
    category text NOT NULL,
    default_value numeric NOT NULL,
    unit text NOT NULL,
    applies_to text DEFAULT 'all'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_editable boolean DEFAULT true NOT NULL,
    is_deletable boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 100 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_global_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_global_access_grants (
    user_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid,
    reason text,
    revoked_at timestamp with time zone
);


--
-- Name: pricing_market_decision_policy_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_market_decision_policy_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    version text NOT NULL,
    window_days integer NOT NULL,
    maturity_threshold numeric(7,6) CONSTRAINT pricing_market_decision_policy_even_maturity_threshold_not_null NOT NULL,
    coverage_threshold numeric(12,6) CONSTRAINT pricing_market_decision_policy_even_coverage_threshold_not_null NOT NULL,
    max_disposition_ratio numeric(7,6) CONSTRAINT pricing_market_decision_policy_e_max_disposition_ratio_not_null NOT NULL,
    disposed_contribution_treatment text DEFAULT 'EXCLUDE_FROM_NUMERATOR'::text CONSTRAINT pricing_market_decision_pol_disposed_contribution_trea_not_null NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    effective_to timestamp with time zone,
    source text NOT NULL,
    evidence_ref text NOT NULL,
    rationale text NOT NULL,
    recorded_by uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pricing_market_decision_poli_disposed_contribution_treatm_check CHECK ((disposed_contribution_treatment = 'EXCLUDE_FROM_NUMERATOR'::text)),
    CONSTRAINT pricing_market_decision_policy_even_max_disposition_ratio_check CHECK (((max_disposition_ratio >= (0)::numeric) AND (max_disposition_ratio <= (1)::numeric))),
    CONSTRAINT pricing_market_decision_policy_events_coverage_threshold_check CHECK ((coverage_threshold > (0)::numeric)),
    CONSTRAINT pricing_market_decision_policy_events_evidence_ref_check CHECK (((char_length(btrim(evidence_ref)) >= 3) AND (char_length(btrim(evidence_ref)) <= 1000))),
    CONSTRAINT pricing_market_decision_policy_events_maturity_threshold_check CHECK (((maturity_threshold >= (0)::numeric) AND (maturity_threshold <= (1)::numeric))),
    CONSTRAINT pricing_market_decision_policy_events_rationale_check CHECK (((char_length(btrim(rationale)) >= 10) AND (char_length(btrim(rationale)) <= 2000))),
    CONSTRAINT pricing_market_decision_policy_events_source_check CHECK (((char_length(btrim(source)) >= 3) AND (char_length(btrim(source)) <= 500))),
    CONSTRAINT pricing_market_decision_policy_events_version_check CHECK (((char_length(btrim(version)) >= 1) AND (char_length(btrim(version)) <= 100))),
    CONSTRAINT pricing_market_decision_policy_events_window_days_check CHECK ((window_days > 0)),
    CONSTRAINT pricing_market_decision_policy_period_check CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))
);


--
-- Name: TABLE pricing_market_decision_policy_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pricing_market_decision_policy_events IS 'Politique append-only du gate économique par marché : fenêtre mécanique, seuil de maturité, seuil de couverture et plafond de dispositions. Aucune valeur implicite.';


--
-- Name: COLUMN pricing_market_decision_policy_events.window_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricing_market_decision_policy_events.window_days IS 'Largeur mécanique de la fenêtre canonique ; les dates du gate sont dérivées côté serveur et ne sont jamais choisies ad hoc par le navigateur.';


--
-- Name: COLUMN pricing_market_decision_policy_events.coverage_threshold; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricing_market_decision_policy_events.coverage_threshold IS 'Seuil explicite de market_coverage_ratio autorisant une nouvelle position sous CDR ; toute modification est un nouvel événement auditable.';


--
-- Name: pricing_matrices_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_matrices_audit (
    id integer CONSTRAINT pricing_matrices_audit_id_not_null1 NOT NULL,
    matrix_type character varying(20) CONSTRAINT pricing_matrices_audit_matrix_type_not_null1 NOT NULL,
    category character varying(50) CONSTRAINT pricing_matrices_audit_category_not_null1 NOT NULL,
    old_value jsonb CONSTRAINT pricing_matrices_audit_old_value_not_null1 NOT NULL,
    new_value jsonb CONSTRAINT pricing_matrices_audit_new_value_not_null1 NOT NULL,
    changed_by uuid,
    change_reason text,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT pricing_matrices_audit_created_at_not_null1 NOT NULL,
    CONSTRAINT pricing_matrices_audit_matrix_type_check CHECK (((matrix_type)::text = ANY ((ARRAY['taxes'::character varying, 'dims'::character varying])::text[])))
);


--
-- Name: pricing_matrices_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pricing_matrices_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pricing_matrices_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pricing_matrices_audit_id_seq OWNED BY public.pricing_matrices_audit.id;


--
-- Name: pricing_maturity_disposition_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_maturity_disposition_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    market_id uuid NOT NULL,
    state text NOT NULL,
    reason_code text NOT NULL,
    rationale text NOT NULL,
    evidence_ref text NOT NULL,
    decided_by uuid NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pricing_maturity_disposition_events_evidence_ref_check CHECK (((char_length(btrim(evidence_ref)) >= 3) AND (char_length(btrim(evidence_ref)) <= 1000))),
    CONSTRAINT pricing_maturity_disposition_events_rationale_check CHECK (((char_length(btrim(rationale)) >= 10) AND (char_length(btrim(rationale)) <= 2000))),
    CONSTRAINT pricing_maturity_disposition_events_reason_code_check CHECK ((reason_code ~ '^[A-Z][A-Z0-9_]{2,79}$'::text)),
    CONSTRAINT pricing_maturity_disposition_events_state_check CHECK ((state = ANY (ARRAY['RECONCILIABLE'::text, 'IRRECONCILABLE_DISPOSED'::text])))
);


--
-- Name: TABLE pricing_maturity_disposition_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pricing_maturity_disposition_events IS 'Journal append-only des transitions de disposition de maturité économique.';


--
-- Name: COLUMN pricing_maturity_disposition_events.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricing_maturity_disposition_events.state IS 'RECONCILIABLE ou IRRECONCILABLE_DISPOSED ; le dernier événement fait foi.';


--
-- Name: COLUMN pricing_maturity_disposition_events.evidence_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricing_maturity_disposition_events.evidence_ref IS 'Référence obligatoire vers la preuve ayant motivé la transition.';


--
-- Name: pricing_strategies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_strategies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    category text,
    strategy_type text NOT NULL,
    strategy_value numeric,
    applied_price_kmf numeric(14,2),
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    applied_by uuid,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT strategy_target_check CHECK (((product_id IS NOT NULL) OR (category IS NOT NULL))),
    CONSTRAINT strategy_type_valid CHECK ((strategy_type = ANY (ARRAY['mechanical'::text, 'competitor_aligned'::text, 'premium'::text, 'loss_leader'::text, 'manual'::text])))
);


--
-- Name: pricing_strategy_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_strategy_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    category text,
    old_strategy_type text,
    new_strategy_type text NOT NULL,
    strategy_value numeric,
    old_price_kmf numeric(14,2),
    new_price_kmf numeric(14,2) NOT NULL,
    reason text,
    applied_by uuid,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_attributes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_attributes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    kind character varying(20) NOT NULL,
    group_key text DEFAULT ''::text NOT NULL,
    attribute_key character varying(128) NOT NULL,
    label text NOT NULL,
    value_text text,
    unit character varying(50),
    display_order integer DEFAULT 0 NOT NULL,
    source character varying(20) DEFAULT 'SUPPLIER'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_attributes_highlight_no_value CHECK ((((kind)::text <> 'HIGHLIGHT'::text) OR (value_text IS NULL))),
    CONSTRAINT product_attributes_kind_check CHECK (((kind)::text = ANY ((ARRAY['HIGHLIGHT'::character varying, 'SPECIFICATION'::character varying])::text[]))),
    CONSTRAINT product_attributes_source_check CHECK (((source)::text = ANY ((ARRAY['SUPPLIER'::character varying, 'AI_ENRICHED'::character varying, 'MANUAL'::character varying])::text[])))
);


--
-- Name: TABLE product_attributes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_attributes IS 'Attributs structurés clé/label/valeur (fiche produit enrichie). kind=HIGHLIGHT alimente content.highlights (label seul, pas de valeur). kind=SPECIFICATION alimente content.specifications (group/key/label/value/unit). Ré-promotion idempotente via UNIQUE(product_id, kind, group_key, attribute_key).';


--
-- Name: product_content_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_content_profile (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    brand text,
    short_description text,
    source character varying(20) DEFAULT 'SUPPLIER'::character varying NOT NULL,
    enrichment_version text,
    reviewed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_content_profile_brand_len CHECK (((brand IS NULL) OR (char_length(brand) <= 200))),
    CONSTRAINT product_content_profile_short_desc_len CHECK (((short_description IS NULL) OR (char_length(short_description) <= 500))),
    CONSTRAINT product_content_profile_source_check CHECK (((source)::text = ANY ((ARRAY['SUPPLIER'::character varying, 'AI_ENRICHED'::character varying, 'MANUAL'::character varying])::text[])))
);


--
-- Name: TABLE product_content_profile; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_content_profile IS 'Profil éditorial 1:1 par produit (fiche produit enrichie). Porte brand, short_description et la provenance globale exposée par product_detail_v1.content.provenance. Cible de promotion depuis normalized_source_contract V2, jamais servi depuis le raw_payload.';


--
-- Name: product_content_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_content_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    section_key character varying(128) NOT NULL,
    title text NOT NULL,
    section_type character varying(20) NOT NULL,
    content_json jsonb NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    source character varying(20) DEFAULT 'SUPPLIER'::character varying NOT NULL,
    enrichment_version text,
    reviewed boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_content_sections_content_json_object CHECK ((jsonb_typeof(content_json) = 'object'::text)),
    CONSTRAINT product_content_sections_source_check CHECK (((source)::text = ANY ((ARRAY['SUPPLIER'::character varying, 'AI_ENRICHED'::character varying, 'MANUAL'::character varying])::text[]))),
    CONSTRAINT product_content_sections_type_check CHECK (((section_type)::text = ANY ((ARRAY['TEXT'::character varying, 'BULLETS'::character varying, 'KEY_VALUE'::character varying])::text[])))
);


--
-- Name: TABLE product_content_sections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_content_sections IS 'Sections éditoriales structurées (fiche produit enrichie). section_key réservés MATERIALS/CARE/WARNINGS (toujours BULLETS) sont aplatis par buildContent() vers content.materials/care/warnings ; tout autre section_key alimente content.sections[]. Ré-promotion idempotente via la contrainte UNIQUE(product_id, section_key).';


--
-- Name: COLUMN product_content_sections.content_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_content_sections.content_json IS 'Forme dépendant de section_type : {"text": string} pour TEXT, {"items": string[]} pour BULLETS, {"entries": [{"label","value"}]} pour KEY_VALUE. Validé par le service de projection avant de traverser le contrat public — jamais rendu comme HTML brut.';


--
-- Name: product_market_exposure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_market_exposure (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    market_id uuid NOT NULL,
    commercial_exposure text DEFAULT 'DISABLED'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_market_exposure_commercial_exposure_check CHECK ((commercial_exposure = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text])))
);


--
-- Name: TABLE product_market_exposure; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_market_exposure IS 'Exposition commerciale d''un produit du catalogue global sur un Market ID donné. Le catalogue (products) reste unique et propriété de catalog. Absence de ligne = DISABLED. Écrite exclusivement via services/catalog-market-exposure-service.js (catalog, lifecycle owner) ; market-delegation (capability catalog.expose) délègue, jamais de SQL direct — writer_not_owner_boundary.';


--
-- Name: product_market_price_draft_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_market_price_draft_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    product_id uuid NOT NULL,
    action character varying(16) NOT NULL,
    old_amount numeric(18,4),
    new_amount numeric(18,4),
    currency character varying(3) NOT NULL,
    old_status character varying(48),
    new_status character varying(48),
    decision_snapshot jsonb,
    reason text NOT NULL,
    source character varying(80) DEFAULT 'market_manager'::character varying NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_market_price_draft_events_action_check CHECK (((action)::text = ANY ((ARRAY['SET'::character varying, 'RESET'::character varying, 'AUTHORIZE'::character varying, 'ACTIVATE'::character varying])::text[]))),
    CONSTRAINT product_market_price_draft_events_currency_check CHECK (((currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT product_market_price_draft_events_reason_check CHECK ((char_length(btrim(reason)) >= 3))
);


--
-- Name: TABLE product_market_price_draft_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_market_price_draft_events IS 'Append-only audit of country price SET/RESET/AUTHORIZE/ACTIVATE actions.';


--
-- Name: product_market_price_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_market_price_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    product_id uuid NOT NULL,
    amount numeric(18,4) NOT NULL,
    currency character varying(3) NOT NULL,
    status character varying(48) DEFAULT 'DRAFT_PENDING_GATE'::character varying NOT NULL,
    reason text NOT NULL,
    source character varying(80) DEFAULT 'market_manager'::character varying NOT NULL,
    decided_by uuid,
    authorized_at timestamp with time zone,
    authorization_snapshot jsonb,
    active_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_market_price_authorization_state_check CHECK (((((status)::text = 'DRAFT_PENDING_GATE'::text) AND (authorized_at IS NULL) AND (authorization_snapshot IS NULL) AND (active_at IS NULL)) OR (((status)::text = 'LOCAL_AUTHORIZED_PENDING_CUTOVER'::text) AND (authorized_at IS NOT NULL) AND (authorization_snapshot IS NOT NULL) AND (active_at IS NULL)) OR (((status)::text = 'LOCAL_ACTIVE'::text) AND (authorized_at IS NOT NULL) AND (authorization_snapshot IS NOT NULL) AND (active_at IS NOT NULL)))),
    CONSTRAINT product_market_price_drafts_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT product_market_price_drafts_currency_check CHECK (((currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT product_market_price_drafts_reason_check CHECK ((char_length(btrim(reason)) >= 3)),
    CONSTRAINT product_market_price_drafts_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT_PENDING_GATE'::character varying, 'LOCAL_AUTHORIZED_PENDING_CUTOVER'::character varying, 'LOCAL_ACTIVE'::character varying])::text[])))
);


--
-- Name: TABLE product_market_price_drafts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_market_price_drafts IS 'Current market-owned commercial price decision. Currency is resolved from markets server-side; economic authorization is distinct from buyer cutover.';


--
-- Name: COLUMN product_market_price_drafts.authorization_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_market_price_drafts.authorization_snapshot IS 'Immutable-at-authorization evidence snapshot: local->KMF projection, CDR and market gate decision used to authorize this exact amount.';


--
-- Name: product_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_sku_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_sku_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku_id uuid NOT NULL,
    media_id uuid NOT NULL,
    display_order integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE product_sku_media; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_sku_media IS 'Association explicite SKU <-> média canonique (PDC-8 Lot 5), source : sellable_units[].media_refs (V2). Les références explicites gagnent toujours sur un matching option_values heuristique. Table neuve, aucun writer avant le service de promotion (Lot 6).';


--
-- Name: product_skus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_skus (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    sku text,
    variant_combo jsonb,
    stock integer DEFAULT 0 NOT NULL,
    price_kmf numeric(12,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_sku text,
    source character varying(20) DEFAULT 'MANUAL'::character varying NOT NULL,
    supplier_unit_ref text,
    supplier_order_identity jsonb,
    CONSTRAINT chk_product_skus_source CHECK (((source)::text = ANY ((ARRAY['MANUAL'::character varying, 'SUPPLIER'::character varying])::text[]))),
    CONSTRAINT chk_product_skus_supplier_order_identity_shape CHECK (((supplier_order_identity IS NULL) OR ((supplier_unit_ref IS NOT NULL) AND (jsonb_typeof(supplier_order_identity) = 'object'::text) AND (jsonb_typeof((supplier_order_identity -> 'provider'::text)) = 'string'::text) AND (btrim((supplier_order_identity ->> 'provider'::text)) <> ''::text) AND (jsonb_typeof((supplier_order_identity -> 'version'::text)) = 'number'::text) AND ((supplier_order_identity ->> 'version'::text) ~ '^[0-9]+$'::text) AND (((supplier_order_identity ->> 'version'::text))::integer >= 1) AND (jsonb_typeof((supplier_order_identity -> 'payload'::text)) = 'object'::text) AND ((supplier_order_identity -> 'payload'::text) <> '{}'::jsonb)))),
    CONSTRAINT chk_product_skus_supplier_unit_ref_nonempty CHECK (((supplier_unit_ref IS NULL) OR (btrim(supplier_unit_ref) <> ''::text))),
    CONSTRAINT product_skus_prix_non_negatif CHECK (((price_kmf IS NULL) OR (price_kmf >= (0)::numeric))),
    CONSTRAINT product_skus_stock_non_negatif CHECK ((stock >= 0))
);


--
-- Name: TABLE product_skus; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_skus IS 'Source de vérité du stock par unité vendable (Lot 0, DECISION_MODELE_STOCK_SKU.md). variant_combo NULL = SKU par défaut (produit sans variantes). Non consommée par le code applicatif tant que les Lots 1-4 ne sont pas livrés.';


--
-- Name: COLUMN product_skus.variant_combo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_skus.variant_combo IS 'Même shape que order_items.variant_combo, ex: {"couleur":"Noir","taille":"M"}. NULL = SKU par défaut.';


--
-- Name: COLUMN product_skus.supplier_sku; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_skus.supplier_sku IS 'Identité source stable (NormalizedSupplierProduct V2 sellable_units[].supplier_sku). NULL pour les SKU manuels (source=MANUAL). Gouverne la re-promotion : un supplier_sku rejoué conserve TOUJOURS le même product_skus.id, même si variant_combo change (correction fournisseur). Ne jamais réutiliser product_id+variant_combo comme identité de re-promotion (insuffisant, cf. PDC-8 §SKU).';


--
-- Name: COLUMN product_skus.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_skus.source IS 'MANUAL = créé par un admin via routes/products.js (upsertProductSku). SUPPLIER = promu depuis normalized_source_contract.sellable_units[] (PDC-8 Lot 6). Distinction honnête, jamais déduite après coup.';


--
-- Name: COLUMN product_skus.supplier_unit_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_skus.supplier_unit_ref IS 'Référence technique stable de l''unité commandable fournisseur. NULL pour les SKU historiques/manuels non encore résolus. Ne jamais reconstruire par heuristique depuis variant_combo ou un libellé humain.';


--
-- Name: COLUMN product_skus.supplier_order_identity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_skus.supplier_order_identity IS 'Supplier Order Identity canonique et versionnée {provider,version,payload}. Le payload est opaque au coeur Komerce et ne contient ni prix, ni stock, ni fret. NULL signifie non Supplier-Mapped / non Fulfillment Ready.';


--
-- Name: product_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    supplier_sku text NOT NULL,
    supplier_url text,
    supplier_price_aed numeric(10,2),
    min_order_qty integer DEFAULT 1 NOT NULL,
    priority integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_checked_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT product_suppliers_priority_check CHECK ((priority > 0))
);


--
-- Name: TABLE product_suppliers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_suppliers IS 'Mapping produit â†’ fournisseur avec SKU, prix AED et prioritÃ©';


--
-- Name: COLUMN product_suppliers.supplier_price_aed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_suppliers.supplier_price_aed IS 'LEGACY uniquement. Prix AED historique du mapping. NULL autorisé pour les produits SKU/SOI dont le prix fournisseur vient de la Canonical Unit.';


--
-- Name: COLUMN product_suppliers.priority; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_suppliers.priority IS '1 = fournisseur prÃ©fÃ©rÃ© Â· 2+ = fallback si indisponible';


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    variant_type text NOT NULL,
    variant_value text NOT NULL,
    sku text,
    stock integer DEFAULT 0 NOT NULL,
    price_kmf numeric(12,2),
    image_url text,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    images jsonb DEFAULT '[]'::jsonb NOT NULL,
    display_name text,
    CONSTRAINT product_variants_prix_non_negatif CHECK (((price_kmf IS NULL) OR (price_kmf >= (0)::numeric))),
    CONSTRAINT product_variants_stock_non_negatif CHECK (((stock IS NULL) OR (stock >= 0)))
);


--
-- Name: COLUMN product_variants.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_variants.display_name IS 'Nom d''affichage de l''AXE (ex: "Couleur" pour variant_type="couleur"), préservé tel que fourni par NormalizedSupplierProduct V2 option_axes[].display_name (PDC-8 Lot 3). NULL = source ne le portait pas — jamais fabriqué.';


--
-- Name: product_variants_ordered; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.product_variants_ordered AS
 SELECT id,
    product_id,
    variant_type,
    variant_value,
    sku,
    COALESCE(stock, 0) AS stock,
    price_kmf,
    image_url,
    display_order,
    created_at,
    updated_at,
    images
   FROM public.product_variants
  ORDER BY product_id, variant_type, display_order, created_at;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sku text,
    name text NOT NULL,
    description text,
    category text,
    emoji text,
    price_kmf numeric(12,2),
    cost_kmf numeric(12,2),
    promo_pct integer,
    promo_until date,
    stock integer DEFAULT 100 NOT NULL,
    weight_kg numeric(6,2),
    is_active boolean DEFAULT true NOT NULL,
    is_promo boolean DEFAULT false NOT NULL,
    image_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    price_aed numeric(10,2),
    source text DEFAULT 'S1'::text,
    dims_l numeric(8,2),
    dims_w numeric(8,2),
    dims_h numeric(8,2),
    customs_risk_coeff numeric(5,3) DEFAULT 1.200 NOT NULL,
    customs_risk_updated date,
    price_eur numeric(12,2),
    dimensions_cm text,
    images jsonb,
    badge text,
    is_available boolean DEFAULT true NOT NULL,
    has_couture boolean DEFAULT false NOT NULL,
    sourcing_source text,
    sort_order integer DEFAULT 0 NOT NULL,
    unsold_price_kmf numeric(12,2),
    unsold_channel character varying(20) DEFAULT 'both'::character varying,
    requires_secure_transport boolean DEFAULT false NOT NULL,
    volume_cm3 numeric(10,2),
    is_fragile boolean DEFAULT false NOT NULL,
    is_bulky boolean DEFAULT false NOT NULL,
    compatibility_group text,
    subcategory text,
    sourcing_rail text,
    volume_class text,
    fragility text,
    sale_mode text,
    exposure_mode text,
    lifecycle_status text DEFAULT 'candidate'::text,
    quality_validated boolean DEFAULT false,
    real_weight_known boolean DEFAULT false,
    real_price_validated boolean DEFAULT false,
    delivery_delay_days integer,
    supplier_notes text,
    last_review_at timestamp with time zone,
    has_variants boolean DEFAULT false NOT NULL,
    product_ref text DEFAULT ('KPR-'::text || lpad((nextval('public.product_ref_seq'::regclass))::text, 6, '0'::text)),
    repack_volume_cm3 numeric(10,2),
    repack_exempt boolean DEFAULT false NOT NULL,
    name_source text,
    description_source text,
    source_locale character varying(8),
    content_source character varying(20),
    enrichment_version integer,
    needs_review boolean DEFAULT false NOT NULL,
    enrichment_confidence numeric(4,3),
    inventory_model text DEFAULT 'LEGACY_VARIANTS'::text NOT NULL,
    series text,
    air_excluded boolean DEFAULT false NOT NULL,
    air_eligibility_status public.air_eligibility_status DEFAULT 'PENDING_REVIEW'::public.air_eligibility_status NOT NULL,
    air_exclusion_reason text,
    boutique_category_key text,
    boutique_subcategory_key text,
    target_margin_pct numeric(5,2),
    CONSTRAINT chk_products_inventory_model CHECK ((inventory_model = ANY (ARRAY['LEGACY_VARIANTS'::text, 'SKU'::text]))),
    CONSTRAINT chk_products_price CHECK ((price_kmf > (0)::numeric)),
    CONSTRAINT chk_products_sourcing_rail CHECK (((sourcing_rail IS NULL) OR (sourcing_rail = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])))),
    CONSTRAINT chk_products_stock CHECK ((stock >= 0)),
    CONSTRAINT chk_products_target_margin_pct CHECK (((target_margin_pct IS NULL) OR ((target_margin_pct >= (0)::numeric) AND (target_margin_pct < (100)::numeric)))),
    CONSTRAINT chk_stock_nonneg CHECK (((stock >= 0) OR (stock IS NULL))),
    CONSTRAINT price_eur_positive CHECK (((price_eur IS NULL) OR (price_eur >= (0)::numeric))),
    CONSTRAINT products_boutique_subcategory_requires_category CHECK (((boutique_subcategory_key IS NULL) OR (boutique_category_key IS NOT NULL)))
);


--
-- Name: COLUMN products.price_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.price_kmf IS 'Optional global reference price (KMF); NULL is allowed for certified globally-approved products. Buyer prices are independently gated per market by LOCAL_ACTIVE plus enabled exposure. Positive non-NULL prices remain subject to chk_products_price.';


--
-- Name: COLUMN products.customs_risk_coeff; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.customs_risk_coeff IS 'Coefficient risque douane (ex: 1.200 = +20%). MVP=1.2 fixe. Phase 2=calculÃ© depuis customs_history';


--
-- Name: COLUMN products.customs_risk_updated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.customs_risk_updated IS 'Date de derniÃ¨re mise Ã  jour du coefficient (rÃ©vision mensuelle)';


--
-- Name: COLUMN products.is_fragile; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.is_fragile IS 'DÉPRÉCIÉE (096, 2026-07-02) — remplacée par fragility (texte). Backfillée puis figée ; ne plus écrire. Drop planifié : migrations/scheduled/097_drop_products_is_fragile.sql (exécutable 2026-07-16).';


--
-- Name: COLUMN products.fragility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.fragility IS 'SOURCE UNIQUE du tag manipulation (doctrine non-conformité §3). Texte libre ; valeurs conseillées : fragile, electronique, sensible_chaleur, sensible_humidite. Tag => contrôle qualité prescrit au hub Dubaï + exclusion repack si fragile. NULL = aucune précaution requise.';


--
-- Name: COLUMN products.product_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.product_ref IS 'Référence interne Komerce stable (KPR-XXXXXX). Indépendante de category/sku. Générée automatiquement à la création via séquence product_ref_seq.';


--
-- Name: COLUMN products.repack_volume_cm3; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.repack_volume_cm3 IS 'Volume constaté après repack hub (cm³), mesuré à la première réception. NULL = jamais mesuré. Gain repack = volume_cm3 - repack_volume_cm3.';


--
-- Name: COLUMN products.repack_exempt; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.repack_exempt IS 'Exclusion doctrinale du repack : fragile, boîte = valeur perçue, douane. Posé par admin uniquement (R2 : l''agent hub exécute, ne décide pas).';


--
-- Name: COLUMN products.name_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.name_source IS 'Titre ORIGINAL fournisseur (généralement EN, Dubaï). Conservé à vie : retraduction en masse + litiges fournisseur (la commande se passe en anglais). La boutique ne lit JAMAIS ce champ — elle lit name (FR).';


--
-- Name: COLUMN products.description_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.description_source IS 'Description originale fournisseur. Même règle que name_source.';


--
-- Name: COLUMN products.source_locale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.source_locale IS 'Langue de la donnée source (en, fr, ar...). NULL = inconnue (legacy).';


--
-- Name: COLUMN products.content_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.content_source IS 'Qui a écrit les champs publiés : connector_raw | ai_enriched | manual. Backfill legacy = manual (fiches saisies à la main avant la raffinerie).';


--
-- Name: COLUMN products.enrichment_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.enrichment_version IS 'Version du prompt d''enrichissement ayant produit la fiche (doctrine §8 : le prompt est du code, versionné). NULL = jamais enrichie par IA.';


--
-- Name: COLUMN products.needs_review; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.needs_review IS 'Fiche à relire humainement : confiance IA sous CATALOG_ENRICH_CONFIDENCE_MIN, ou enrichissement en échec (fiche restée en donnée source). Champ de CUISINE : la boutique ne le lit jamais (catalog-public-view.js).';


--
-- Name: COLUMN products.enrichment_confidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.enrichment_confidence IS 'Score de confiance (0..1) déclaré par le dernier enrichissement IA appliqué. NULL = jamais enrichie. Champ de cuisine, invisible boutique.';


--
-- Name: COLUMN products.inventory_model; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.inventory_model IS 'LEGACY_VARIANTS (défaut) = stock lu/écrit sur products.stock + product_variants.stock. SKU = stock lu/écrit exclusivement sur product_skus, aucune lecture/écriture legacy autorisée pour ce produit. Bascule atomique portée par le Lot 5 — jamais déduite de l''existence de lignes product_skus.';


--
-- Name: COLUMN products.air_excluded; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.air_excluded IS 'Opt-out livraison aérienne. false (défaut) = éligible AIR_EXPRESS. true = maritime uniquement (volume, matières dangereuses, fragile non-validé). Source unique pour buildDeliveryOptions() dans catalog-product-detail.js.';


--
-- Name: COLUMN products.air_eligibility_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.air_eligibility_status IS 'Qualification Air : PENDING_REVIEW (défaut, non sélectionnable), ELIGIBLE (approuvé pour fret aérien), EXCLUDED (interdit avec raison). Seul ELIGIBLE peut participer à AIR_EXPRESS quand le rail est PUBLIC.';


--
-- Name: COLUMN products.air_exclusion_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.air_exclusion_reason IS 'Raison de l''exclusion Air (batteries lithium, aérosols, fragile, surpoids...). Null si ELIGIBLE ou PENDING_REVIEW.';


--
-- Name: COLUMN products.boutique_category_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.boutique_category_key IS 'Univers boutique canonique (ex. Mode & Beauté, Tech). Distinct de products.category, qui reste la classification économique/douanière.';


--
-- Name: COLUMN products.boutique_subcategory_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.boutique_subcategory_key IS 'Sous-catégorie boutique canonique, scoped par boutique_category_key.';


--
-- Name: COLUMN products.target_margin_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.target_margin_pct IS 'Marge cible commerciale du produit (%) ; NULL = marge par défaut de la catégorie puis finance_config.';


--
-- Name: provider_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_credentials (
    credential_ref text NOT NULL,
    provider_key text NOT NULL,
    auth_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    envelope_ciphertext text,
    envelope_iv text,
    envelope_tag text,
    key_version integer,
    oauth_session_key text,
    provider_account_label text,
    access_expires_at timestamp with time zone,
    refresh_expires_at timestamp with time zone,
    replaces_ref text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    rotated_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_tested_at timestamp with time zone,
    last_test_status text,
    last_test_code text,
    CONSTRAINT provider_credentials_auth_type_chk CHECK ((auth_type = ANY (ARRAY['api_key'::text, 'client_credentials'::text, 'oauth'::text]))),
    CONSTRAINT provider_credentials_envelope_triplet_chk CHECK ((((envelope_ciphertext IS NULL) AND (envelope_iv IS NULL) AND (envelope_tag IS NULL) AND (key_version IS NULL)) OR ((envelope_ciphertext IS NOT NULL) AND (envelope_iv IS NOT NULL) AND (envelope_tag IS NOT NULL) AND (key_version IS NOT NULL)))),
    CONSTRAINT provider_credentials_oauth_shape_chk CHECK ((((auth_type = 'oauth'::text) AND (envelope_ciphertext IS NULL) AND (oauth_session_key IS NOT NULL)) OR ((auth_type <> 'oauth'::text) AND (oauth_session_key IS NULL)))),
    CONSTRAINT provider_credentials_provider_chk CHECK ((provider_key ~ '^[a-z0-9_-]{2,64}$'::text)),
    CONSTRAINT provider_credentials_ref_chk CHECK ((credential_ref ~ '^cred_[a-f0-9]{32}$'::text)),
    CONSTRAINT provider_credentials_shredded_chk CHECK (((status = ANY (ARRAY['pending'::text, 'active'::text])) OR (envelope_ciphertext IS NULL))),
    CONSTRAINT provider_credentials_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'superseded'::text, 'revoked'::text, 'failed'::text]))),
    CONSTRAINT provider_credentials_test_status_chk CHECK (((last_test_status IS NULL) OR (last_test_status = ANY (ARRAY['ok'::text, 'failed'::text]))))
);


--
-- Name: TABLE provider_credentials; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.provider_credentials IS 'Coffre des credentials fournisseurs. Enveloppe AES-256-GCM (IV aléatoire, AAD = provider + credential_ref + version + auth_type) sous clé maître serveur. Jamais relue par le navigateur. Enveloppe effacée dès que le credential est remplacé, révoqué ou en échec.';


--
-- Name: COLUMN provider_credentials.oauth_session_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.provider_credentials.oauth_session_key IS 'Pour auth_type=oauth : clé de la session chiffrée dans supplier_oauth_connections (aucun token ici).';


--
-- Name: providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    market_id uuid NOT NULL,
    status public.provider_status DEFAULT 'pending'::public.provider_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    public_phone text,
    public_whatsapp text,
    CONSTRAINT providers_public_phone_nonblank CHECK (((public_phone IS NULL) OR (length(btrim(public_phone)) > 0))),
    CONSTRAINT providers_public_whatsapp_nonblank CHECK (((public_whatsapp IS NULL) OR (length(btrim(public_whatsapp)) > 0)))
);


--
-- Name: TABLE providers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.providers IS 'Second principal payable (shadow, Vague 1 — aucune exposition frontend, aucun payout). PAS une ligne users / PAS un user_role : identité vérifiée par téléphone/WhatsApp, pas d''authentification app à ce stade. Validation identité, pas légalité (aucun formalisme administratif requis).';


--
-- Name: COLUMN providers.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.providers.status IS 'pending = jamais encore actif. active = peut porter des services exposables. suspended = coupure immédiate, réversible, sans validation centrale — le seul levier de sanction disponible dans l''informel est la visibilité, jamais une pénalité financière (cf. CHALLENGE_SERVICES_TWO_TRACK.md §T2).';


--
-- Name: COLUMN providers.public_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.providers.public_phone IS 'Coordonnée téléphonique explicitement publiable. Distincte de providers.phone, qui reste privée et ne doit jamais être projetée par défaut.';


--
-- Name: COLUMN providers.public_whatsapp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.providers.public_whatsapp IS 'Coordonnée WhatsApp explicitement publiable. Distincte de providers.phone et exposée uniquement lorsqu une offre active l action whatsapp.';


--
-- Name: purchase_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id uuid,
    order_item_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    product_supplier_id uuid,
    product_sku_id uuid,
    supplier_sku text NOT NULL,
    supplier_unit_ref text,
    supplier_order_identity jsonb,
    quantity integer NOT NULL,
    supplier_unit_price numeric(18,4),
    supplier_currency text,
    procurement_hub_ref text NOT NULL,
    parent_line_id uuid,
    confirmed_quantity integer,
    confirmed_unit_price numeric(18,4),
    confirmed_at timestamp with time zone,
    settled_quantity integer,
    settled_at timestamp with time zone,
    settle_reason text,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_purchase_lines_cancel_pair CHECK (((cancelled_at IS NULL) = (cancel_reason IS NULL))),
    CONSTRAINT chk_purchase_lines_confirmed_bound CHECK (((confirmed_quantity IS NULL) OR ((confirmed_quantity >= 0) AND (confirmed_quantity <= quantity)))),
    CONSTRAINT chk_purchase_lines_confirmed_price CHECK (((confirmed_unit_price IS NULL) OR (confirmed_unit_price > (0)::numeric))),
    CONSTRAINT chk_purchase_lines_hub_ref CHECK ((btrim(procurement_hub_ref) <> ''::text)),
    CONSTRAINT chk_purchase_lines_quantity CHECK ((quantity > 0)),
    CONSTRAINT chk_purchase_lines_settle_bound CHECK (((settled_quantity IS NULL) OR (settled_quantity <= COALESCE(confirmed_quantity, quantity)))),
    CONSTRAINT chk_purchase_lines_settle_pair CHECK (((settled_at IS NULL) = (settled_quantity IS NULL))),
    CONSTRAINT chk_purchase_lines_settled_nonneg CHECK (((settled_quantity IS NULL) OR (settled_quantity >= 0))),
    CONSTRAINT chk_purchase_lines_supplier_money_pair CHECK ((((supplier_unit_price IS NULL) AND (supplier_currency IS NULL)) OR ((supplier_unit_price IS NOT NULL) AND (supplier_currency IS NOT NULL) AND (supplier_unit_price > (0)::numeric) AND (supplier_currency ~ '^[A-Z]{3}$'::text)))),
    CONSTRAINT chk_purchase_lines_supplier_order_identity_shape CHECK (((supplier_order_identity IS NULL) OR ((product_sku_id IS NOT NULL) AND (supplier_unit_ref IS NOT NULL) AND (jsonb_typeof(supplier_order_identity) = 'object'::text) AND (jsonb_typeof((supplier_order_identity -> 'provider'::text)) = 'string'::text) AND (btrim((supplier_order_identity ->> 'provider'::text)) <> ''::text) AND (jsonb_typeof((supplier_order_identity -> 'version'::text)) = 'number'::text) AND ((supplier_order_identity ->> 'version'::text) ~ '^[0-9]+$'::text) AND (((supplier_order_identity ->> 'version'::text))::integer >= 1) AND (jsonb_typeof((supplier_order_identity -> 'payload'::text)) = 'object'::text) AND ((supplier_order_identity -> 'payload'::text) <> '{}'::jsonb)))),
    CONSTRAINT chk_purchase_lines_supplier_unit_ref_nonempty CHECK (((supplier_unit_ref IS NULL) OR (btrim(supplier_unit_ref) <> ''::text)))
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    supplier_id uuid NOT NULL,
    product_supplier_id uuid,
    supplier_order_id text,
    supplier_sku text,
    qty integer DEFAULT 1,
    unit_price_aed numeric(10,2),
    total_price_aed numeric(10,2) GENERATED ALWAYS AS ((unit_price_aed * (qty)::numeric)) STORED,
    status text DEFAULT 'pending'::text NOT NULL,
    trigger_mode text DEFAULT 'manual'::text NOT NULL,
    tracking_url text,
    tracking_number text,
    ordered_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    shipped_at timestamp with time zone,
    hub_received_at timestamp with time zone,
    quality_ok boolean,
    quality_notes text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    received_qty integer DEFAULT 0 NOT NULL,
    order_item_id uuid,
    product_sku_id uuid,
    supplier_unit_ref text,
    supplier_order_identity jsonb,
    supplier_unit_price numeric(18,4),
    supplier_currency text,
    supplier_total_price numeric(18,4) GENERATED ALWAYS AS ((supplier_unit_price * (qty)::numeric)) STORED,
    procurement_hub_ref text DEFAULT 'DXB'::text NOT NULL,
    market_id uuid,
    sent_at timestamp with time zone,
    sent_channel text,
    sent_by uuid,
    sent_note text,
    CONSTRAINT chk_purchase_orders_header_shape CHECK ((((order_id IS NOT NULL) AND (qty IS NOT NULL) AND (supplier_sku IS NOT NULL)) OR ((order_id IS NULL) AND (order_item_id IS NULL) AND (product_sku_id IS NULL) AND (supplier_unit_ref IS NULL) AND (supplier_order_identity IS NULL) AND (qty IS NULL) AND (supplier_sku IS NULL) AND (supplier_unit_price IS NULL) AND (supplier_currency IS NULL)))),
    CONSTRAINT chk_purchase_orders_hub_ref CHECK ((btrim(procurement_hub_ref) <> ''::text)),
    CONSTRAINT chk_purchase_orders_qty CHECK (((qty IS NULL) OR (qty > 0))),
    CONSTRAINT chk_purchase_orders_sent_proof CHECK ((((sent_at IS NULL) AND (sent_channel IS NULL) AND (sent_by IS NULL)) OR ((sent_at IS NOT NULL) AND (sent_channel IS NOT NULL) AND (sent_channel = ANY (ARRAY['email'::text, 'whatsapp'::text, 'phone'::text, 'api'::text, 'other'::text]))))),
    CONSTRAINT chk_purchase_orders_supplier_money_pair CHECK ((((supplier_unit_price IS NULL) AND (supplier_currency IS NULL)) OR ((supplier_unit_price > (0)::numeric) AND (supplier_currency ~ '^[A-Z]{3}$'::text)))),
    CONSTRAINT chk_purchase_orders_supplier_order_identity_shape CHECK (((supplier_order_identity IS NULL) OR ((product_sku_id IS NOT NULL) AND (supplier_unit_ref IS NOT NULL) AND (jsonb_typeof(supplier_order_identity) = 'object'::text) AND (jsonb_typeof((supplier_order_identity -> 'provider'::text)) = 'string'::text) AND (btrim((supplier_order_identity ->> 'provider'::text)) <> ''::text) AND (jsonb_typeof((supplier_order_identity -> 'version'::text)) = 'number'::text) AND ((supplier_order_identity ->> 'version'::text) ~ '^[0-9]+$'::text) AND (((supplier_order_identity ->> 'version'::text))::integer >= 1) AND (jsonb_typeof((supplier_order_identity -> 'payload'::text)) = 'object'::text) AND ((supplier_order_identity -> 'payload'::text) <> '{}'::jsonb)))),
    CONSTRAINT chk_purchase_orders_supplier_unit_ref_nonempty CHECK (((supplier_unit_ref IS NULL) OR (btrim(supplier_unit_ref) <> ''::text))),
    CONSTRAINT purchase_orders_status_check CHECK ((status = ANY (ARRAY['cancelled'::text, 'confirmed'::text, 'draft'::text, 'hub_received'::text, 'notified'::text, 'pending'::text, 'shipped'::text]))),
    CONSTRAINT purchase_orders_trigger_mode_check CHECK ((trigger_mode = ANY (ARRAY['auto'::text, 'manual'::text, 'whatsapp'::text])))
);


--
-- Name: TABLE purchase_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.purchase_orders IS 'Commandes passÃ©es chez les fournisseurs Dubai â€” liÃ©es aux commandes client';


--
-- Name: COLUMN purchase_orders.trigger_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.trigger_mode IS 'auto = API Â· manual = admin dashboard Â· whatsapp = notif WA';


--
-- Name: COLUMN purchase_orders.hub_received_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.hub_received_at IS 'Date de rÃ©ception Hub Dubai â€” dÃ©clenche SCAN 3 (preparation)';


--
-- Name: COLUMN purchase_orders.received_qty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.received_qty IS 'QuantitÃ© physiquement reÃ§ue au hub. ComplÃ¨te quand received_qty >= qty.';


--
-- Name: COLUMN purchase_orders.order_item_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.order_item_id IS 'Ligne de commande cliente ayant déclenché cette PO. NULL uniquement pour les PO historiques/manuelles antérieures au snapshot exact.';


--
-- Name: COLUMN purchase_orders.product_sku_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.product_sku_id IS 'SKU Komerce exact vendu lorsque la ligne est en mode SKU. Snapshot de traçabilité vers product_skus ; aucune résolution par libellé.';


--
-- Name: COLUMN purchase_orders.supplier_unit_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.supplier_unit_ref IS 'Référence stable de l''unité fournisseur commandable snapshotée au moment de créer la PO.';


--
-- Name: COLUMN purchase_orders.supplier_order_identity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.supplier_order_identity IS 'Supplier Order Identity canonique {provider,version,payload} snapshotée depuis product_skus. Ne contient ni prix, ni stock, ni fret.';


--
-- Name: COLUMN purchase_orders.supplier_unit_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.supplier_unit_price IS 'Prix unitaire fournisseur snapshoté dans la monnaie native au moment de créer la PO.';


--
-- Name: COLUMN purchase_orders.supplier_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.supplier_currency IS 'Code devise ISO 4217 à 3 lettres correspondant à supplier_unit_price.';


--
-- Name: COLUMN purchase_orders.supplier_total_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.supplier_total_price IS 'Total fournisseur natif = supplier_unit_price × qty. Généré, sans conversion implicite.';


--
-- Name: COLUMN purchase_orders.procurement_hub_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.procurement_hub_ref IS 'Hub d''approvisionnement destinataire de la PO (référence logique, ex. DXB). Toutes les lignes d''une PO regroupée partagent cette valeur.';


--
-- Name: COLUMN purchase_orders.market_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.market_id IS 'Marché unique de toute nouvelle PO regroupée. Autorité dérivée des commandes clientes. NULL uniquement pour anciens dossiers multi-marchés à préserver.';


--
-- Name: COLUMN purchase_orders.sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.sent_at IS 'Envoi réellement effectué au fournisseur (déclaré par un opérateur ou un adaptateur API). NULL = bon préparé ou émis, transmission non prouvée.';


--
-- Name: recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipients (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    full_name text NOT NULL,
    phone text NOT NULL,
    relais_id uuid,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refund_execution_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_execution_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    market_id uuid NOT NULL,
    provider text NOT NULL,
    capture_ref text NOT NULL,
    operation_key text NOT NULL,
    amount_eur numeric(12,2) NOT NULL,
    currency character(3) DEFAULT 'EUR'::bpchar NOT NULL,
    status text DEFAULT 'reserved'::text NOT NULL,
    provider_ref text,
    initiated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processing_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_refund_intents_confirmed_ref CHECK (((status <> 'confirmed'::text) OR ((provider_ref IS NOT NULL) AND (length(TRIM(BOTH FROM provider_ref)) > 0)))),
    CONSTRAINT refund_execution_intents_amount_eur_check CHECK ((amount_eur > (0)::numeric)),
    CONSTRAINT refund_execution_intents_capture_ref_check CHECK ((length(TRIM(BOTH FROM capture_ref)) > 0)),
    CONSTRAINT refund_execution_intents_currency_check CHECK ((currency = 'EUR'::bpchar)),
    CONSTRAINT refund_execution_intents_operation_key_check CHECK ((length(TRIM(BOTH FROM operation_key)) > 0)),
    CONSTRAINT refund_execution_intents_provider_check CHECK ((provider = ANY (ARRAY['stripe'::text, 'paypal'::text]))),
    CONSTRAINT refund_execution_intents_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'processing'::text, 'unknown'::text, 'confirmed'::text, 'failed'::text])))
);


--
-- Name: TABLE refund_execution_intents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refund_execution_intents IS 'DURABLE refund intent authority before Stripe/PayPal; no PSP call in migration, no automatic legacy refund backfill. Existing refunds MUST be reconciled before activation.';


--
-- Name: COLUMN refund_execution_intents.operation_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refund_execution_intents.operation_key IS 'Caller event id or explicitly authorized distinct partial refund event; replay keeps same key.';


--
-- Name: refund_receipt_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.refund_receipt_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    amount_eur numeric(10,2),
    refund_type text NOT NULL,
    refund_method text NOT NULL,
    stripe_refund_id text,
    store_credit_id uuid,
    reason text,
    initiated_by uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: relais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relais (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    agent_name text,
    phone text NOT NULL,
    address text NOT NULL,
    zone text,
    hours text,
    island text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    island_code character varying(20),
    market_id uuid NOT NULL,
    latitude numeric(10,7),
    longitude numeric(11,7),
    photo_url text,
    CONSTRAINT relais_gps_pair_check CHECK (((latitude IS NULL) = (longitude IS NULL))),
    CONSTRAINT relais_latitude_range_check CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)))),
    CONSTRAINT relais_longitude_range_check CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))))
);


--
-- Name: COLUMN relais.agent_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.relais.agent_name IS 'Nom de l''agent actuellement affecté au relais. Nullable : le point relais peut être créé avant l''affectation d''une personne.';


--
-- Name: COLUMN relais.island; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.relais.island IS 'Île (nom lisible), pertinent uniquement pour les marchés à géographie insulaire (ex. KM). Nullable — aucune valeur par défaut géographique. Le routage inter-îles (services/routing.js) reste spécifique à KM et exige island_code pour les relais qui en dépendent.';


--
-- Name: COLUMN relais.island_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.relais.island_code IS 'Code île normalisé, consommé par services/routing.js pour le routage inter-îles KM. Nullable — non applicable hors marchés insulaires. Un relais créé sans île sur un marché qui en a besoin restera incomplet pour le routage tant que ce n''est pas renseigné explicitement.';


--
-- Name: COLUMN relais.market_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.relais.market_id IS 'Marché auquel ce relais appartient. NOT NULL — un relais est un lieu physique, il ne peut pas exister sans marché. Backfill KM total au 2026-08 (M1b), voir migrations/137_relais_market_id.sql.';


--
-- Name: COLUMN relais.latitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.relais.latitude IS 'Latitude GPS exacte du point relais. Toujours renseignée avec longitude.';


--
-- Name: COLUMN relais.longitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.relais.longitude IS 'Longitude GPS exacte du point relais. Toujours renseignée avec latitude.';


--
-- Name: COLUMN relais.photo_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.relais.photo_url IS 'Photo publique permettant au client de reconnaître physiquement le relais.';


--
-- Name: revoked_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revoked_tokens (
    jti text NOT NULL,
    user_id uuid,
    user_role text,
    revoked_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    reason text
);


--
-- Name: TABLE revoked_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.revoked_tokens IS 'JWT révoqués avant expiration naturelle. Le cron startJwtRevocationCleanupCron purge les lignes dont expires_at < NOW().';


--
-- Name: risk_provisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_provisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    emoji text,
    rate_pct numeric NOT NULL,
    applies_to text DEFAULT 'all'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_editable boolean DEFAULT true NOT NULL,
    is_deletable boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 100 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scan_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    parcel_id uuid NOT NULL,
    order_id uuid,
    event_type text NOT NULL,
    scan_code text,
    scanned_by uuid,
    actor_name text,
    actor_role text,
    location text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    device_id text,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb,
    qty_before jsonb DEFAULT '{}'::jsonb,
    qty_after jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'applied'::text NOT NULL,
    error_message text,
    corrects_event_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    photo_urls text[] DEFAULT '{}'::text[],
    CONSTRAINT scan_events_actor_role_check CHECK ((actor_role = ANY (ARRAY['hub_agent'::text, 'relay_agent'::text, 'driver'::text, 'system'::text, 'admin'::text]))),
    CONSTRAINT scan_events_status_check CHECK ((status = ANY (ARRAY['applied'::text, 'rejected'::text, 'needs_review'::text, 'reversed'::text])))
);


--
-- Name: COLUMN scan_events.photo_urls; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scan_events.photo_urls IS 'Photos attachées à l''événement de scan (URLs sous /uploads/hub/). Usage doctrinal : event_type=seal_photo au scellé Dubaï = borne 1 des fenêtres de responsabilité (avant : fournisseur ; après : transport). Miroir structurel de disputes.photo_urls.';


--
-- Name: scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scans (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    order_item_id uuid,
    step public.scan_step NOT NULL,
    scanned_by uuid,
    location text,
    device_id text,
    latitude numeric(9,6),
    longitude numeric(9,6),
    scan_code text NOT NULL,
    notes text,
    is_anomaly boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    parcel_id uuid,
    pickup_method text,
    authorization_version integer,
    document_checked boolean DEFAULT false NOT NULL,
    pickup_relais_id uuid,
    CONSTRAINT chk_scans_exceptional_pickup_proof CHECK ((((pickup_method = 'AUTHORIZED_NAME_ID_CHECK'::text) AND (authorization_version IS NOT NULL) AND (authorization_version > 0) AND (document_checked = true) AND (pickup_relais_id IS NOT NULL)) OR ((pickup_method IS DISTINCT FROM 'AUTHORIZED_NAME_ID_CHECK'::text) AND (authorization_version IS NULL) AND (document_checked = false) AND ((pickup_method IS NULL) OR (pickup_relais_id IS NOT NULL))))),
    CONSTRAINT chk_scans_pickup_method CHECK (((pickup_method IS NULL) OR (pickup_method = ANY (ARRAY['PICKUP_CODE'::text, 'AUTHORIZED_NAME_ID_CHECK'::text])))),
    CONSTRAINT scan_target CHECK (((order_id IS NOT NULL) OR (order_item_id IS NOT NULL)))
);


--
-- Name: COLUMN scans.pickup_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scans.pickup_method IS 'Méthode ayant authentifié la remise : PICKUP_CODE ou AUTHORIZED_NAME_ID_CHECK.';


--
-- Name: COLUMN scans.authorization_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scans.authorization_version IS 'Version de l’autorisation nominative contrôlée lors d’un retrait exceptionnel. Aucun nom conservé.';


--
-- Name: COLUMN scans.document_checked; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scans.document_checked IS 'Attestation de l’agent : pièce officielle avec photo contrôlée visuellement. Aucune copie conservée.';


--
-- Name: COLUMN scans.pickup_relais_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scans.pickup_relais_id IS 'Relais dans lequel la remise physique a été enregistrée.';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    checksum text,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    market_id uuid NOT NULL,
    zone text,
    status public.service_listing_status DEFAULT 'draft'::public.service_listing_status NOT NULL,
    commercial_exposure text DEFAULT 'DISABLED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_ref text,
    actions_enabled text[] DEFAULT ARRAY['request'::text] NOT NULL,
    CONSTRAINT services_actions_enabled_allowed CHECK (((cardinality(actions_enabled) > 0) AND (actions_enabled <@ ARRAY['request'::text, 'quote'::text, 'callback'::text, 'call'::text, 'whatsapp'::text]))),
    CONSTRAINT services_commercial_exposure_check CHECK ((commercial_exposure = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text]))),
    CONSTRAINT services_image_ref_public CHECK (((image_ref IS NULL) OR (image_ref ~ '^/[^/]'::text) OR (image_ref ~~ 'https://%'::text)))
);


--
-- Name: TABLE services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.services IS 'Proposition de service local d''un provider (shadow, Vague 1). zone réutilise la granularité déjà en place sur relais (island/zone), aucun nouveau découpage géographique inventé.';


--
-- Name: COLUMN services.commercial_exposure; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.commercial_exposure IS 'Patron déjà en production sur les rails transport (DOCTRINE_TRANSPORT_RAILS.md) : une donnée vivante, valorisée, mais non exposée tant que ce champ reste DISABLED. Attribut de donnée, jamais une branche de code frontend.';


--
-- Name: COLUMN services.image_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.image_ref IS 'Référence média publique optionnelle pour la représentation du service. Chemin public /... (jamais //...) ou URL https:// uniquement. Source owner = providers-services.';


--
-- Name: COLUMN services.actions_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.actions_enabled IS 'Capacités cumulatives de la fiche Komerce : request, quote, callback, call, whatsapp. Le kind décrit ce que l objet est ; ce tableau décrit ce que le client peut faire.';


--
-- Name: shared_cart_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_cart_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shared_cart_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_type text,
    actor_id uuid,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shared_cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shared_cart_id uuid NOT NULL,
    product_id uuid,
    product_name_snapshot text NOT NULL,
    product_image_snapshot text,
    product_category_snapshot text,
    quantity integer NOT NULL,
    unit_price_kmf_snapshot numeric(14,2) NOT NULL,
    line_total_kmf_snapshot numeric(14,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    sku_id uuid,
    variant_combo_snapshot jsonb,
    CONSTRAINT shared_cart_items_line_total_kmf_snapshot_check CHECK ((line_total_kmf_snapshot >= (0)::numeric)),
    CONSTRAINT shared_cart_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT shared_cart_items_unit_price_kmf_snapshot_check CHECK ((unit_price_kmf_snapshot >= (0)::numeric))
);


--
-- Name: COLUMN shared_cart_items.sku_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shared_cart_items.sku_id IS 'Unité vendable canonique (GAP-07 §7) — FK vivante vers product_skus. NULL pour tout produit LEGACY_VARIANTS/sans variante, ou si le SKU a depuis été supprimé (ON DELETE SET NULL) : ne jamais recréer un SKU devinée depuis ce NULL, se référer à variant_combo_snapshot pour l''affichage historique.';


--
-- Name: COLUMN shared_cart_items.variant_combo_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shared_cart_items.variant_combo_snapshot IS 'Copie figée de la combinaison de variante au moment de l''ajout (GAP-07 §7/§11) — ne change plus jamais après écriture, même si product_skus.variant_combo est modifié ou si sku_id devient NULL. Source de vérité pour le renderer panier partagé (« Noir · Taille M »).';


--
-- Name: shared_cart_saved_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_cart_saved_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shared_cart_id uuid NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shared_carts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_carts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    organizer_user_id uuid CONSTRAINT shared_carts_beneficiary_user_id_not_null NOT NULL,
    source_basket_id uuid,
    title text,
    message text,
    delivery_island text,
    delivery_relay_id uuid,
    status public.shared_cart_status DEFAULT 'open'::public.shared_cart_status NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    source_order_id uuid,
    closed_at timestamp with time zone
);


--
-- Name: shipment_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    shipped_at timestamp with time zone,
    notes text
);


--
-- Name: TABLE shipment_batches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.shipment_batches IS 'Lots expÃ©dition groupÃ©s hubâ†’bateau. PeuplÃ© en Phase 2.';


--
-- Name: shipment_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipment_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reference text NOT NULL,
    origin text DEFAULT 'Hub logistique international'::text NOT NULL,
    destination text DEFAULT 'Port de Mutsamudu, Anjouan'::text NOT NULL,
    carrier text,
    container_ref text,
    departed_at timestamp with time zone,
    eta timestamp with time zone,
    arrived_at timestamp with time zone,
    customs_cleared_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customs_total_estimated_kmf numeric(14,2),
    customs_total_real_kmf numeric(14,2),
    customs_notes text
);


--
-- Name: COLUMN shipments.customs_total_estimated_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shipments.customs_total_estimated_kmf IS 'Total douane estimÃ© pour ce lot d expÃ©dition';


--
-- Name: COLUMN shipments.customs_total_real_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shipments.customs_total_real_kmf IS 'Total douane rÃ©el â€” saisi aprÃ¨s dÃ©douanement complet';


--
-- Name: COLUMN shipments.customs_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shipments.customs_notes IS 'Notes transitaire sur le passage douanier du lot';


--
-- Name: signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    signal_type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    summary text,
    source_module text DEFAULT 'signal-service'::text NOT NULL,
    target_shell text DEFAULT 'bo'::text,
    target_view text,
    target_filters jsonb DEFAULT '{}'::jsonb,
    owner_role text DEFAULT 'admin'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    entity_type text,
    entity_id text,
    recommendation text,
    confidence text DEFAULT 'high'::text,
    meta jsonb DEFAULT '{}'::jsonb,
    snoozed_until timestamp with time zone,
    escalated_at timestamp with time zone,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    signal_ref text DEFAULT ('KSG-'::text || lpad((nextval('public.decision_signal_ref_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    market_id uuid,
    CONSTRAINT signals_confidence_check CHECK ((confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT signals_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text, 'urgent'::text]))),
    CONSTRAINT signals_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'snoozed'::text, 'resolved'::text, 'expired'::text])))
);


--
-- Name: COLUMN signals.market_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.signals.market_id IS 'Canonical Market ID scope for a derived signal. NULL = global fact; non-NULL = exact server-resolved market fact. Browser input is never authoritative.';


--
-- Name: sms_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    recipient text NOT NULL,
    type text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    at_message_id text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    priority integer DEFAULT 5,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    next_attempt_at timestamp with time zone DEFAULT now(),
    last_error text,
    queued_at timestamp with time zone DEFAULT now(),
    processing_started_at timestamp with time zone
);


--
-- Name: sourcing_candidate_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_candidate_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    event_type text NOT NULL,
    old_state text,
    new_state text,
    changes jsonb,
    result jsonb,
    notes text,
    triggered_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_candidate_events_event_type_check CHECK ((event_type = ANY (ARRAY['scan'::text, 'state_change'::text, 'data_correction'::text, 'note_added'::text, 'imported'::text, 'rejected'::text])))
);


--
-- Name: sourcing_candidate_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_candidate_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid,
    import_id uuid NOT NULL,
    supplier_name text NOT NULL,
    supplier_product_id text NOT NULL,
    source_index integer NOT NULL,
    profile_id text NOT NULL,
    profile_version integer NOT NULL,
    profile_hash text NOT NULL,
    connector_version text NOT NULL,
    source_sha256 text NOT NULL,
    source_row_sha256 text NOT NULL,
    promotion_status text NOT NULL,
    schema_version_used text,
    contract jsonb,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw_payload jsonb NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sourcing_candidate_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_candidate_ref_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_id uuid,
    supplier_name text NOT NULL,
    supplier_product_id text,
    product_name text NOT NULL,
    supplier_category text,
    purchase_price numeric(12,2),
    currency text DEFAULT 'AED'::text,
    image_url text,
    product_url text,
    description text,
    stock_available integer,
    min_order_qty integer,
    supplier_delay_days integer,
    weight_kg numeric(8,3),
    dim_l_cm numeric(6,1),
    dim_w_cm numeric(6,1),
    dim_h_cm numeric(6,1),
    komerce_category text,
    estimated_weight_kg numeric(8,3),
    estimated_volume_m3 numeric(8,5),
    purchase_price_kmf numeric(14,2),
    target_margin_pct numeric(5,2),
    data_sources jsonb DEFAULT '{}'::jsonb,
    scan_result jsonb,
    scan_at timestamp with time zone,
    confidence text DEFAULT 'low'::text,
    state text DEFAULT 'raw_imported'::text NOT NULL,
    product_id uuid,
    notes text,
    rejected_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    raw_payload jsonb,
    normalized_source_contract jsonb,
    promotion_status text,
    promotion_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    profile_id text,
    profile_version integer,
    profile_hash text,
    source_sha256 text,
    source_row_sha256 text,
    connector_version text,
    observed_at timestamp with time zone,
    candidate_ref text DEFAULT ('KSC-'::text || lpad((nextval('public.sourcing_candidate_ref_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    commercial_taxonomy_review jsonb,
    CONSTRAINT chk_sourcing_candidates_normalized_source_contract_object CHECK (((normalized_source_contract IS NULL) OR (jsonb_typeof(normalized_source_contract) = 'object'::text))),
    CONSTRAINT sourcing_candidates_confidence_check CHECK ((confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT sourcing_candidates_promotion_status_check CHECK (((promotion_status IS NULL) OR (promotion_status = ANY (ARRAY['READY_FOR_PROMOTION'::text, 'QUARANTINED_UNSUPPORTED_MEDIA'::text, 'QUARANTINED_LOSSY_MAPPING'::text, 'QUARANTINED_CURRENCY_POLICY'::text])))),
    CONSTRAINT sourcing_candidates_state_check CHECK ((state = ANY (ARRAY['raw_imported'::text, 'normalized'::text, 'scanned'::text, 'test_ready'::text, 'watchlist'::text, 'imported_to_catalog'::text, 'quarantined'::text, 'rejected'::text, 'archived'::text])))
);


--
-- Name: COLUMN sourcing_candidates.raw_payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_candidates.raw_payload IS 'Payload fournisseur brut intégral (toutes colonnes, y compris non mappées). Jamais lu par la boutique. Sert la rejouabilité et l''éligibilité douane (une colonne inconnue type hazmat_class doit pouvoir matcher une exclusion). NULL = candidat créé avant ING-5 (legacy, pas de brut disponible).';


--
-- Name: COLUMN sourcing_candidates.normalized_source_contract; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_candidates.normalized_source_contract IS 'Snapshot du NormalizedSupplierProduct V2 validé, sans raw_payload. Préserve les mappings media/option_axes/sellable_units du connecteur. NULL pour les contrats V1. Ne constitue pas la vérité catalogue ni stock.';


--
-- Name: COLUMN sourcing_candidates.commercial_taxonomy_review; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_candidates.commercial_taxonomy_review IS 'Boutique classification from confirmed supplier mapping; no customs, pricing, publication or KIR decision authority.';


--
-- Name: sourcing_canonical_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_canonical_entities (
    canonical_entity_id uuid DEFAULT gen_random_uuid() NOT NULL,
    grain public.sourcing_observation_grain NOT NULL,
    parent_entity_id uuid,
    principal_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    superseded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_canonical_entities_lifecycle_chk CHECK ((((status = 'active'::text) AND (superseded_by IS NULL)) OR ((status = 'superseded'::text) AND (superseded_by IS NOT NULL)))),
    CONSTRAINT sourcing_canonical_entities_not_self_parent CHECK (((parent_entity_id IS NULL) OR (parent_entity_id <> canonical_entity_id))),
    CONSTRAINT sourcing_canonical_entities_not_self_superseded CHECK (((superseded_by IS NULL) OR (superseded_by <> canonical_entity_id))),
    CONSTRAINT sourcing_canonical_entities_principal_grain_chk CHECK (((principal_id IS NULL) OR (grain = 'offer'::public.sourcing_observation_grain))),
    CONSTRAINT sourcing_canonical_entities_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text])))
);


--
-- Name: TABLE sourcing_canonical_entities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_canonical_entities IS 'Shadow canonical identity supertype product/offer/unit; stable IDs, not catalog authority in PR 1B.';


--
-- Name: sourcing_canonical_entity_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_canonical_entity_refs (
    canonical_entity_id uuid NOT NULL,
    source_id text NOT NULL,
    ref_kind text NOT NULL,
    ref_value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_canonical_entity_refs_kind_nonempty CHECK ((btrim(ref_kind) <> ''::text)),
    CONSTRAINT sourcing_canonical_entity_refs_value_nonempty CHECK ((btrim(ref_value) <> ''::text))
);


--
-- Name: sourcing_captures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_captures (
    capture_id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_artifact_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_captures_raw_artifact_ref_nonempty CHECK (((raw_artifact_ref IS NULL) OR (btrim(raw_artifact_ref) <> ''::text))),
    CONSTRAINT sourcing_captures_status_chk CHECK ((status = ANY (ARRAY['running'::text, 'complete'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: TABLE sourcing_captures; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_captures IS 'Run ou lot d acquisition d une source; lifecycle operationnel uniquement.';


--
-- Name: sourcing_commercial_principals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_commercial_principals (
    principal_id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text,
    status text DEFAULT 'active'::text NOT NULL,
    superseded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_commercial_principals_lifecycle_chk CHECK ((((status = 'active'::text) AND (superseded_by IS NULL)) OR ((status = 'superseded'::text) AND (superseded_by IS NOT NULL)))),
    CONSTRAINT sourcing_commercial_principals_name_nonempty CHECK (((display_name IS NULL) OR (btrim(display_name) <> ''::text))),
    CONSTRAINT sourcing_commercial_principals_not_self_superseded CHECK (((superseded_by IS NULL) OR (superseded_by <> principal_id))),
    CONSTRAINT sourcing_commercial_principals_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text])))
);


--
-- Name: TABLE sourcing_commercial_principals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_commercial_principals IS 'Shadow commercial identity. One Komerce principal may have refs in many sources.';


--
-- Name: sourcing_global_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_global_access_grants (
    user_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid,
    reason text,
    revoked_at timestamp with time zone
);


--
-- Name: sourcing_identity_constraints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_identity_constraints (
    identity_constraint_id uuid DEFAULT gen_random_uuid() NOT NULL,
    grain public.sourcing_observation_grain NOT NULL,
    left_entity_id uuid NOT NULL,
    right_entity_id uuid NOT NULL,
    constraint_type text NOT NULL,
    asserted_by_decision_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by_decision_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_identity_constraints_pair_chk CHECK ((left_entity_id < right_entity_id)),
    CONSTRAINT sourcing_identity_constraints_state_chk CHECK ((((active = true) AND (revoked_at IS NULL) AND (revoked_by_decision_id IS NULL)) OR ((active = false) AND (revoked_at IS NOT NULL) AND (revoked_by_decision_id IS NOT NULL)))),
    CONSTRAINT sourcing_identity_constraints_type_chk CHECK ((constraint_type = ANY (ARRAY['MUST_LINK'::text, 'CANNOT_LINK'::text])))
);


--
-- Name: TABLE sourcing_identity_constraints; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_identity_constraints IS 'Materialized MUST_LINK/CANNOT_LINK knowledge; reversible only through an audited decision.';


--
-- Name: sourcing_match_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_match_proposals (
    proposal_id uuid DEFAULT gen_random_uuid() NOT NULL,
    proposal_run_id uuid NOT NULL,
    observation_id uuid NOT NULL,
    grain public.sourcing_observation_grain NOT NULL,
    candidate_entity_id uuid NOT NULL,
    matcher_version text NOT NULL,
    support_score numeric(6,5) NOT NULL,
    contradiction_score numeric(6,5) NOT NULL,
    coverage_score numeric(6,5) NOT NULL,
    evidence_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_match_proposals_contradiction_chk CHECK (((contradiction_score >= (0)::numeric) AND (contradiction_score <= (1)::numeric))),
    CONSTRAINT sourcing_match_proposals_coverage_chk CHECK (((coverage_score >= (0)::numeric) AND (coverage_score <= (1)::numeric))),
    CONSTRAINT sourcing_match_proposals_matcher_nonempty CHECK ((btrim(matcher_version) <> ''::text)),
    CONSTRAINT sourcing_match_proposals_support_chk CHECK (((support_score >= (0)::numeric) AND (support_score <= (1)::numeric)))
);


--
-- Name: TABLE sourcing_match_proposals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_match_proposals IS 'Candidate comparison facts: support, contradiction, coverage. Never sovereign truth.';


--
-- Name: sourcing_merge_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_merge_policies (
    policy_id uuid DEFAULT gen_random_uuid() NOT NULL,
    grain public.sourcing_observation_grain NOT NULL,
    field_key text NOT NULL,
    strategy text NOT NULL,
    policy_version text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT sourcing_merge_policies_field_nonempty CHECK ((btrim(field_key) <> ''::text)),
    CONSTRAINT sourcing_merge_policies_state_chk CHECK ((((active = true) AND (retired_at IS NULL)) OR ((active = false) AND (retired_at IS NOT NULL)))),
    CONSTRAINT sourcing_merge_policies_strategy_chk CHECK ((strategy = ANY (ARRAY['prefer_high_confidence'::text, 'latest_observation'::text, 'source_priority'::text, 'require_review'::text, 'preserve_distinct'::text]))),
    CONSTRAINT sourcing_merge_policies_version_nonempty CHECK ((btrim(policy_version) <> ''::text))
);


--
-- Name: TABLE sourcing_merge_policies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_merge_policies IS 'Grain-scoped field projection policy. Does not select a winning supplier offer.';


--
-- Name: sourcing_observation_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_observation_evidence (
    evidence_id bigint NOT NULL,
    observation_id uuid NOT NULL,
    evidence_type text NOT NULL,
    evidence_key text NOT NULL,
    value text NOT NULL,
    extractor_version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_observation_evidence_extractor_nonempty CHECK ((btrim(extractor_version) <> ''::text)),
    CONSTRAINT sourcing_observation_evidence_key_nonempty CHECK ((btrim(evidence_key) <> ''::text)),
    CONSTRAINT sourcing_observation_evidence_type_chk CHECK ((evidence_type = ANY (ARRAY['deterministic_id'::text, 'source_ref'::text, 'lexical'::text, 'perceptual'::text, 'attribute'::text]))),
    CONSTRAINT sourcing_observation_evidence_value_nonempty CHECK ((btrim(value) <> ''::text))
);


--
-- Name: TABLE sourcing_observation_evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_observation_evidence IS 'Index d evidence derive et reconstructible pour candidate retrieval.';


--
-- Name: sourcing_observation_evidence_evidence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_observation_evidence_evidence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_observation_evidence_evidence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sourcing_observation_evidence_evidence_id_seq OWNED BY public.sourcing_observation_evidence.evidence_id;


--
-- Name: sourcing_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_observations (
    observation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    capture_id uuid NOT NULL,
    grain public.sourcing_observation_grain NOT NULL,
    source_ref text,
    principal_ref text,
    parent_observation_id uuid,
    observed_at timestamp with time zone NOT NULL,
    normalized jsonb DEFAULT '{}'::jsonb NOT NULL,
    field_provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_fragment jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_observations_principal_ref_nonempty CHECK (((principal_ref IS NULL) OR (btrim(principal_ref) <> ''::text))),
    CONSTRAINT sourcing_observations_source_ref_nonempty CHECK (((source_ref IS NULL) OR (btrim(source_ref) <> ''::text)))
);


--
-- Name: TABLE sourcing_observations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_observations IS 'Observation immuable d une entite resolvable product, offer ou unit.';


--
-- Name: sourcing_provider_control_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_provider_control_events (
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id text NOT NULL,
    capability text NOT NULL,
    old_value boolean NOT NULL,
    new_value boolean NOT NULL,
    actor_id text,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_provider_control_events_capability_check CHECK ((capability = ANY (ARRAY['discovery'::text, 'sync'::text, 'import'::text, 'production'::text, 'lifecycle'::text, 'credentials'::text])))
);


--
-- Name: sourcing_resolution_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_resolution_bindings (
    binding_id uuid DEFAULT gen_random_uuid() NOT NULL,
    observation_id uuid NOT NULL,
    grain public.sourcing_observation_grain NOT NULL,
    canonical_entity_id uuid NOT NULL,
    asserted_by_decision_id uuid NOT NULL,
    ended_at timestamp with time zone,
    ended_by_decision_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_resolution_bindings_end_state_chk CHECK ((((ended_at IS NULL) AND (ended_by_decision_id IS NULL)) OR ((ended_at IS NOT NULL) AND (ended_by_decision_id IS NOT NULL))))
);


--
-- Name: TABLE sourcing_resolution_bindings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_resolution_bindings IS 'Materialized current Observation -> Canonical binding derived from decisions.';


--
-- Name: sourcing_resolution_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_resolution_decisions (
    decision_id uuid DEFAULT gen_random_uuid() NOT NULL,
    decision_type text NOT NULL,
    grain public.sourcing_observation_grain NOT NULL,
    proposal_id uuid,
    observation_id uuid,
    canonical_entity_id uuid,
    related_entity_id uuid,
    actor_type text NOT NULL,
    actor_ref text,
    rationale text NOT NULL,
    evidence_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_resolution_decisions_actor_chk CHECK ((actor_type = ANY (ARRAY['human'::text, 'rule'::text, 'model'::text, 'system'::text]))),
    CONSTRAINT sourcing_resolution_decisions_actor_ref_nonempty CHECK (((actor_ref IS NULL) OR (btrim(actor_ref) <> ''::text))),
    CONSTRAINT sourcing_resolution_decisions_distinct_entities_chk CHECK (((related_entity_id IS NULL) OR (related_entity_id <> canonical_entity_id))),
    CONSTRAINT sourcing_resolution_decisions_human_actor_ref_chk CHECK (((actor_type <> 'human'::text) OR (actor_ref IS NOT NULL))),
    CONSTRAINT sourcing_resolution_decisions_rationale_nonempty CHECK ((btrim(rationale) <> ''::text)),
    CONSTRAINT sourcing_resolution_decisions_shape_chk CHECK ((((decision_type = 'LINK'::text) AND (observation_id IS NOT NULL) AND (canonical_entity_id IS NOT NULL) AND (related_entity_id IS NULL)) OR ((decision_type = 'DISTINCT'::text) AND (observation_id IS NOT NULL) AND (canonical_entity_id IS NOT NULL) AND (related_entity_id IS NULL)) OR ((decision_type = 'REVIEW_REQUIRED'::text) AND (observation_id IS NOT NULL) AND (related_entity_id IS NULL)) OR ((decision_type = ANY (ARRAY['MERGE'::text, 'SPLIT'::text])) AND (observation_id IS NULL) AND (canonical_entity_id IS NOT NULL) AND (related_entity_id IS NOT NULL)))),
    CONSTRAINT sourcing_resolution_decisions_type_chk CHECK ((decision_type = ANY (ARRAY['LINK'::text, 'DISTINCT'::text, 'REVIEW_REQUIRED'::text, 'MERGE'::text, 'SPLIT'::text])))
);


--
-- Name: TABLE sourcing_resolution_decisions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_resolution_decisions IS 'Append-only sovereign identity decisions LINK/DISTINCT/REVIEW/MERGE/SPLIT.';


--
-- Name: sourcing_source_execution_modes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_source_execution_modes (
    source_id text NOT NULL,
    mode text NOT NULL,
    CONSTRAINT sourcing_source_execution_mode_chk CHECK ((mode = ANY (ARRAY['human'::text, 'api'::text])))
);


--
-- Name: sourcing_source_principal_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_source_principal_refs (
    source_id text NOT NULL,
    principal_ref text NOT NULL,
    principal_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_source_principal_refs_ref_nonempty CHECK ((btrim(principal_ref) <> ''::text))
);


--
-- Name: sourcing_source_provides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_source_provides (
    source_id text NOT NULL,
    layer text NOT NULL,
    CONSTRAINT sourcing_source_provides_layer_chk CHECK ((layer = ANY (ARRAY['catalog'::text, 'offers'::text, 'units'::text])))
);


--
-- Name: sourcing_source_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_source_requests (
    request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_name text NOT NULL,
    requested_label text NOT NULL,
    reference_url text,
    status text DEFAULT 'connector_required'::text NOT NULL,
    requested_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_source_requests_label_nonempty CHECK ((btrim(requested_label) <> ''::text)),
    CONSTRAINT sourcing_source_requests_provider_nonempty CHECK ((btrim(provider_name) <> ''::text)),
    CONSTRAINT sourcing_source_requests_reference_nonempty CHECK (((reference_url IS NULL) OR (btrim(reference_url) <> ''::text))),
    CONSTRAINT sourcing_source_requests_status_chk CHECK ((status = 'connector_required'::text))
);


--
-- Name: TABLE sourcing_source_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_source_requests IS 'Fournisseurs demandés sans connecteur Komerce. Jamais une source : aucun autopilot, aucune capacité, aucune capture, aucun lien avec sourcing_sources.';


--
-- Name: sourcing_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_sources (
    source_id text NOT NULL,
    adapter_type text NOT NULL,
    acquisition text NOT NULL,
    continuity text NOT NULL,
    credential_ref text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    autopilot_enabled boolean DEFAULT false NOT NULL,
    discovery_enabled boolean DEFAULT false NOT NULL,
    sync_enabled boolean DEFAULT false NOT NULL,
    import_enabled boolean DEFAULT false NOT NULL,
    production_enabled boolean DEFAULT false NOT NULL,
    production_certified_capture_id uuid,
    production_certified_at timestamp with time zone,
    connection_test_status text,
    connection_test_code text,
    connection_tested_at timestamp with time zone,
    display_name text,
    CONSTRAINT sourcing_sources_acquisition_chk CHECK ((acquisition = ANY (ARRAY['pull'::text, 'push'::text]))),
    CONSTRAINT sourcing_sources_adapter_type_nonempty CHECK ((btrim(adapter_type) <> ''::text)),
    CONSTRAINT sourcing_sources_connection_test_status_chk CHECK (((connection_test_status IS NULL) OR (connection_test_status = ANY (ARRAY['ok'::text, 'failed'::text])))),
    CONSTRAINT sourcing_sources_continuity_chk CHECK ((continuity = ANY (ARRAY['recurring'::text, 'one_shot'::text]))),
    CONSTRAINT sourcing_sources_credential_ref_nonempty CHECK (((credential_ref IS NULL) OR (btrim(credential_ref) <> ''::text))),
    CONSTRAINT sourcing_sources_display_name_chk CHECK (((display_name IS NULL) OR ((btrim(display_name) <> ''::text) AND (char_length(display_name) <= 80)))),
    CONSTRAINT sourcing_sources_source_id_nonempty CHECK ((btrim(source_id) <> ''::text)),
    CONSTRAINT sourcing_sources_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: TABLE sourcing_sources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_sources IS 'PR 1A shadow foundation. Source instance observable; aucune autorite prod.';


--
-- Name: COLUMN sourcing_sources.autopilot_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_sources.autopilot_enabled IS 'Autorisation explicite de collecte automatique récurrente. Défaut false : aucune source historique ne démarre sans action opérateur.';


--
-- Name: COLUMN sourcing_sources.connection_test_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_sources.connection_test_status IS 'Résultat du dernier test de connexion opérateur (ok/failed). Informatif : ce n''est jamais une certification runtime.';


--
-- Name: COLUMN sourcing_sources.connection_test_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_sources.connection_test_code IS 'Code métier court du dernier échec de test (jamais de message brut fournisseur ni de secret).';


--
-- Name: COLUMN sourcing_sources.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_sources.display_name IS 'Libellé opérateur de la source (affichage uniquement, NULL = libellé du connecteur). Jamais un identifiant.';


--
-- Name: store_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    remaining_kmf numeric(14,2) NOT NULL,
    reason text,
    source_order_id uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stripe_events_processed; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_events_processed (
    stripe_event_id text NOT NULL,
    event_type text NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    payload_summary jsonb DEFAULT '{}'::jsonb
);


--
-- Name: supplier_catalog_import_rejections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_catalog_import_rejections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_id uuid NOT NULL,
    supplier_name text NOT NULL,
    supplier_product_id text,
    source_index integer NOT NULL,
    promotion_status text NOT NULL,
    reason_code text NOT NULL,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw_payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scir_promotion_status_check CHECK ((promotion_status = ANY (ARRAY['REJECTED_SOURCE_DATA_INVALID'::text, 'REJECTED_CONTRACT_INVALID'::text]))),
    CONSTRAINT scir_reason_code_check CHECK ((reason_code = ANY (ARRAY['SOURCE_ROW_NOT_OBJECT'::text, 'MISSING_SUPPLIER_PRODUCT_ID'::text, 'DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH'::text, 'SOURCE_FIELD_TOO_LARGE'::text, 'SOURCE_PRODUCT_TOO_DEEP'::text, 'SOURCE_VALUE_UNPARSABLE'::text, 'CONTRACT_SCHEMA_INVALID'::text, 'SOURCE_WEIGHT_UNIT_UNKNOWN'::text, 'UNSUPPORTED_VIDEO_REJECTED_BY_POLICY'::text, 'LOSSY_MAPPING_REJECTED_BY_POLICY'::text])))
);


--
-- Name: supplier_catalog_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_catalog_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_name text NOT NULL,
    source_type text DEFAULT 'manual'::text NOT NULL,
    source_filename text,
    notes text,
    total_items integer DEFAULT 0 NOT NULL,
    imported_by uuid,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    profile_id text,
    profile_version integer,
    profile_hash text,
    source_sha256 text,
    source_bytes bigint,
    connector_name text,
    connector_version text,
    connector_contract_version text,
    pipeline_version text,
    status text DEFAULT 'COMPLETED'::text NOT NULL,
    ready_count integer DEFAULT 0 NOT NULL,
    quarantined_count integer DEFAULT 0 NOT NULL,
    rejected_count integer DEFAULT 0 NOT NULL,
    invalid_pct numeric(5,2),
    quarantined_pct numeric(5,2),
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    error_code text,
    error_detail text,
    batch_findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    import_ref text DEFAULT ('KSI-'::text || lpad((nextval('public.catalog_import_ref_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    CONSTRAINT supplier_catalog_imports_source_type_check CHECK ((source_type = ANY (ARRAY['csv'::text, 'manual'::text, 'api'::text, 'json'::text]))),
    CONSTRAINT supplier_catalog_imports_status_check CHECK ((status = ANY (ARRAY['PROCESSING'::text, 'COMPLETED'::text, 'COMPLETED_WITH_QUARANTINE'::text, 'BLOCKED_QUARANTINE_THRESHOLD'::text, 'BLOCKED_INVALID_THRESHOLD'::text, 'FAILED'::text])))
);


--
-- Name: supplier_catalog_sync_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_catalog_sync_checkpoints (
    supplier_name text NOT NULL,
    sync_key text NOT NULL,
    category_id text NOT NULL,
    category_path text,
    next_page integer DEFAULT 1 NOT NULL,
    total_pages integer,
    total_records integer,
    api_calls integer DEFAULT 0 NOT NULL,
    accepted_items integer DEFAULT 0 NOT NULL,
    rejected_items integer DEFAULT 0 NOT NULL,
    capped_by_supplier boolean DEFAULT false NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    last_request_id text,
    last_error text,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_catalog_sync_checkpoints_accepted_items_check CHECK ((accepted_items >= 0)),
    CONSTRAINT supplier_catalog_sync_checkpoints_api_calls_check CHECK ((api_calls >= 0)),
    CONSTRAINT supplier_catalog_sync_checkpoints_next_page_check CHECK ((next_page >= 1)),
    CONSTRAINT supplier_catalog_sync_checkpoints_rejected_items_check CHECK ((rejected_items >= 0)),
    CONSTRAINT supplier_catalog_sync_checkpoints_total_pages_check CHECK (((total_pages IS NULL) OR (total_pages >= 0))),
    CONSTRAINT supplier_catalog_sync_checkpoints_total_records_check CHECK (((total_records IS NULL) OR (total_records >= 0)))
);


--
-- Name: supplier_commercial_category_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_commercial_category_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    source_category_id text,
    source_category_path text CONSTRAINT supplier_commercial_category_mapp_source_category_path_not_null NOT NULL,
    source_locale text DEFAULT 'en'::text NOT NULL,
    proposed_label_fr text,
    boutique_category_key text,
    boutique_subcategory_key text,
    status text DEFAULT 'PROPOSED'::text NOT NULL,
    confirmed_by text,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_commercial_category_mappings_status_check CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'CONFIRMED'::text, 'REVIEW_REQUIRED'::text]))),
    CONSTRAINT supplier_commercial_mapping_confirmed CHECK (((status <> 'CONFIRMED'::text) OR ((boutique_category_key IS NOT NULL) AND (boutique_subcategory_key IS NOT NULL) AND (confirmed_at IS NOT NULL)))),
    CONSTRAINT supplier_commercial_mapping_pair CHECK ((((boutique_category_key IS NULL) AND (boutique_subcategory_key IS NULL)) OR ((boutique_category_key IS NOT NULL) AND (boutique_subcategory_key IS NOT NULL))))
);


--
-- Name: TABLE supplier_commercial_category_mappings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_commercial_category_mappings IS 'Source taxonomy mapping and FR merchandising labels; category unknown never rejects a candidate; no customs or pricing authority.';


--
-- Name: supplier_execution_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_execution_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id uuid NOT NULL,
    provider text NOT NULL,
    supplier_execution_order_id uuid,
    supplier_execution_group_id uuid,
    operation text NOT NULL,
    outcome text NOT NULL,
    provider_request_id text,
    provider_code text,
    provider_message text,
    facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_supplier_execution_events_facts_object CHECK ((jsonb_typeof(facts) = 'object'::text)),
    CONSTRAINT chk_supplier_execution_events_operation CHECK ((btrim(operation) <> ''::text)),
    CONSTRAINT chk_supplier_execution_events_outcome CHECK ((outcome = ANY (ARRAY['requested'::text, 'succeeded'::text, 'rejected'::text, 'ambiguous'::text, 'observed'::text]))),
    CONSTRAINT chk_supplier_execution_events_provider CHECK ((btrim(provider) <> ''::text))
);


--
-- Name: TABLE supplier_execution_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_execution_events IS 'Journal append-only du dialogue provider. facts contient uniquement des faits bornés/sanitisés; jamais de secret ni payload brut.';


--
-- Name: supplier_execution_fulfillments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_execution_fulfillments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_execution_order_id uuid CONSTRAINT supplier_execution_fulfillm_supplier_execution_order_i_not_null NOT NULL,
    provider text NOT NULL,
    fulfillment_execution_key text CONSTRAINT supplier_execution_fulfillme_fulfillment_execution_key_not_null NOT NULL,
    expected_quantity integer NOT NULL,
    observed_quantity integer,
    provider_status text,
    carrier text,
    tracking_number text,
    tracking_url text,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    reconciliation_status text DEFAULT 'pending'::text NOT NULL,
    evidence_source text,
    evidence_ref text,
    facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_supplier_execution_fulfillments_delivered_after_shipped CHECK (((delivered_at IS NULL) OR (shipped_at IS NULL) OR (delivered_at >= shipped_at))),
    CONSTRAINT chk_supplier_execution_fulfillments_expected_qty CHECK ((expected_quantity > 0)),
    CONSTRAINT chk_supplier_execution_fulfillments_facts_object CHECK ((jsonb_typeof(facts) = 'object'::text)),
    CONSTRAINT chk_supplier_execution_fulfillments_key CHECK ((btrim(fulfillment_execution_key) <> ''::text)),
    CONSTRAINT chk_supplier_execution_fulfillments_observed_qty CHECK (((observed_quantity IS NULL) OR (observed_quantity >= 0))),
    CONSTRAINT chk_supplier_execution_fulfillments_provider CHECK ((btrim(provider) <> ''::text)),
    CONSTRAINT chk_supplier_execution_fulfillments_status CHECK ((reconciliation_status = ANY (ARRAY['matched'::text, 'not_found'::text, 'mismatch'::text, 'ambiguous'::text, 'pending'::text]))),
    CONSTRAINT chk_supplier_execution_fulfillments_tracking CHECK (((tracking_number IS NULL) OR (btrim(tracking_number) <> ''::text)))
);


--
-- Name: TABLE supplier_execution_fulfillments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_execution_fulfillments IS 'Fait canonique provider-side de fulfillment. Ne prouve pas la réception Hub ni la remise client; celles-ci restent propriétaires de Logistics.';


--
-- Name: supplier_execution_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_execution_group_members (
    supplier_execution_group_id uuid CONSTRAINT supplier_execution_group_me_supplier_execution_group_i_not_null NOT NULL,
    supplier_execution_order_id uuid CONSTRAINT supplier_execution_group_me_supplier_execution_order_i_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supplier_execution_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_execution_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id uuid NOT NULL,
    provider text NOT NULL,
    supplier_parent_order_id text NOT NULL,
    payment_ref text,
    provider_status text,
    payment_status text,
    provider_facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_supplier_execution_groups_facts_object CHECK ((jsonb_typeof(provider_facts) = 'object'::text)),
    CONSTRAINT chk_supplier_execution_groups_parent_id CHECK ((btrim(supplier_parent_order_id) <> ''::text)),
    CONSTRAINT chk_supplier_execution_groups_payment_ref CHECK (((payment_ref IS NULL) OR (btrim(payment_ref) <> ''::text))),
    CONSTRAINT chk_supplier_execution_groups_provider CHECK ((btrim(provider) <> ''::text))
);


--
-- Name: TABLE supplier_execution_groups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_execution_groups IS 'Parent ou groupe natif provider pour une PO Komerce. Ex: un shipmentOrderId CJ est mappé vers supplier_parent_order_id.';


--
-- Name: supplier_execution_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_execution_order_lines (
    supplier_execution_order_id uuid CONSTRAINT supplier_execution_order_li_supplier_execution_order_i_not_null NOT NULL,
    purchase_line_id uuid NOT NULL,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_supplier_execution_order_lines_quantity CHECK ((quantity > 0))
);


--
-- Name: supplier_execution_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_execution_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id uuid NOT NULL,
    provider text NOT NULL,
    supplier_order_id text NOT NULL,
    supplier_order_code text,
    provider_status text,
    provider_facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_supplier_execution_orders_facts_object CHECK ((jsonb_typeof(provider_facts) = 'object'::text)),
    CONSTRAINT chk_supplier_execution_orders_order_code CHECK (((supplier_order_code IS NULL) OR (btrim(supplier_order_code) <> ''::text))),
    CONSTRAINT chk_supplier_execution_orders_provider CHECK ((btrim(provider) <> ''::text)),
    CONSTRAINT chk_supplier_execution_orders_supplier_order_id CHECK ((btrim(supplier_order_id) <> ''::text))
);


--
-- Name: TABLE supplier_execution_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_execution_orders IS 'Sous-ordres natifs provider liés à une PO Komerce. Ex: CJ orderId/orderCode sont mappés vers supplier_order_id/supplier_order_code par l adapter.';


--
-- Name: supplier_execution_payment_proofs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_execution_payment_proofs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_payment_id uuid NOT NULL,
    provider text NOT NULL,
    proof_source text NOT NULL,
    proof_ref text NOT NULL,
    provider_order_id text,
    payment_ref text,
    observed_amount numeric(18,4) NOT NULL,
    currency text NOT NULL,
    debit_confirmed boolean DEFAULT false NOT NULL,
    sandbox boolean DEFAULT false NOT NULL,
    simulated boolean DEFAULT false NOT NULL,
    occurred_at timestamp with time zone,
    provider_facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_supplier_payment_proofs_amount CHECK ((observed_amount > (0)::numeric)),
    CONSTRAINT chk_supplier_payment_proofs_currency CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT chk_supplier_payment_proofs_facts_object CHECK ((jsonb_typeof(provider_facts) = 'object'::text)),
    CONSTRAINT chk_supplier_payment_proofs_provider CHECK ((btrim(provider) <> ''::text)),
    CONSTRAINT chk_supplier_payment_proofs_ref CHECK ((btrim(proof_ref) <> ''::text)),
    CONSTRAINT chk_supplier_payment_proofs_source CHECK ((btrim(proof_source) <> ''::text))
);


--
-- Name: TABLE supplier_execution_payment_proofs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_execution_payment_proofs IS 'Preuves monétaires provider liées à supplier_execution_payments. Faits bornés uniquement; aucun payload brut ni secret.';


--
-- Name: supplier_execution_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_execution_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id uuid NOT NULL,
    provider text NOT NULL,
    payment_execution_key text NOT NULL,
    supplier_execution_order_id uuid,
    supplier_execution_group_id uuid,
    payment_ref text,
    expected_amount numeric(18,4) NOT NULL,
    observed_amount numeric(18,4),
    currency text NOT NULL,
    status text DEFAULT 'prepared'::text NOT NULL,
    reconciliation_status text DEFAULT 'pending'::text NOT NULL,
    real_debit_verified boolean DEFAULT false NOT NULL,
    provider_facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_supplier_execution_payments_currency CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT chk_supplier_execution_payments_expected_amount CHECK ((expected_amount > (0)::numeric)),
    CONSTRAINT chk_supplier_execution_payments_facts_object CHECK ((jsonb_typeof(provider_facts) = 'object'::text)),
    CONSTRAINT chk_supplier_execution_payments_key CHECK ((btrim(payment_execution_key) <> ''::text)),
    CONSTRAINT chk_supplier_execution_payments_observed_amount CHECK (((observed_amount IS NULL) OR (observed_amount > (0)::numeric))),
    CONSTRAINT chk_supplier_execution_payments_provider CHECK ((btrim(provider) <> ''::text)),
    CONSTRAINT chk_supplier_execution_payments_real_debit CHECK (((real_debit_verified = false) OR (status = 'succeeded'::text))),
    CONSTRAINT chk_supplier_execution_payments_reconciliation_status CHECK ((reconciliation_status = ANY (ARRAY['pending'::text, 'matched'::text, 'mismatched'::text, 'unverified'::text]))),
    CONSTRAINT chk_supplier_execution_payments_ref CHECK (((payment_ref IS NULL) OR (btrim(payment_ref) <> ''::text))),
    CONSTRAINT chk_supplier_execution_payments_status CHECK ((status = ANY (ARRAY['prepared'::text, 'requested'::text, 'succeeded'::text, 'ambiguous'::text, 'rejected'::text]))),
    CONSTRAINT chk_supplier_execution_payments_target_xor CHECK ((((supplier_execution_order_id IS NOT NULL) AND (supplier_execution_group_id IS NULL)) OR ((supplier_execution_order_id IS NULL) AND (supplier_execution_group_id IS NOT NULL))))
);


--
-- Name: TABLE supplier_execution_payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_execution_payments IS 'Fait canonique de paiement fournisseur: cible provider, cle idempotente locale, montant attendu/observe, devise et rapprochement. Ne declenche aucun debit a lui seul.';


--
-- Name: COLUMN supplier_execution_payments.payment_execution_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.supplier_execution_payments.payment_execution_key IS 'Cle idempotente locale stable reutilisee lors des retries; unique dans le namespace du provider.';


--
-- Name: COLUMN supplier_execution_payments.real_debit_verified; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.supplier_execution_payments.real_debit_verified IS 'True uniquement lorsqu un debit monetaire reel a ete prouve; sandbox/simulatePay doit rester false.';


--
-- Name: supplier_oauth_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_oauth_connections (
    supplier_key text NOT NULL,
    access_token_ciphertext text NOT NULL,
    access_token_iv text NOT NULL,
    access_token_tag text NOT NULL,
    refresh_token_ciphertext text,
    refresh_token_iv text,
    refresh_token_tag text,
    access_expires_at timestamp with time zone NOT NULL,
    refresh_expires_at timestamp with time zone,
    provider_user_id text,
    provider_user_nick text,
    token_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_refreshed_at timestamp with time zone,
    CONSTRAINT supplier_oauth_connections_refresh_triplet_chk CHECK ((((refresh_token_ciphertext IS NULL) AND (refresh_token_iv IS NULL) AND (refresh_token_tag IS NULL)) OR ((refresh_token_ciphertext IS NOT NULL) AND (refresh_token_iv IS NOT NULL) AND (refresh_token_tag IS NOT NULL)))),
    CONSTRAINT supplier_oauth_connections_supplier_key_chk CHECK ((supplier_key ~ '^[a-z0-9_-]{2,64}$'::text))
);


--
-- Name: TABLE supplier_oauth_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_oauth_connections IS 'Catalog-owned encrypted OAuth session storage for supplier connectors. Secrets are AES-256-GCM ciphertext; provider app secrets remain environment-only.';


--
-- Name: COLUMN supplier_oauth_connections.supplier_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.supplier_oauth_connections.supplier_key IS 'Stable connector identifier, e.g. aliexpress.';


--
-- Name: COLUMN supplier_oauth_connections.access_expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.supplier_oauth_connections.access_expires_at IS 'Provider-declared access-token expiry used to refresh proactively.';


--
-- Name: COLUMN supplier_oauth_connections.refresh_expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.supplier_oauth_connections.refresh_expires_at IS 'Provider-declared or app-policy refresh-token expiry; NULL only when provider does not issue a refresh token.';


--
-- Name: supplier_payment_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_payment_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_execution_payment_id uuid CONSTRAINT supplier_payment_settlement_supplier_execution_payment_not_null NOT NULL,
    kind text NOT NULL,
    amount_currency numeric(18,4) NOT NULL,
    currency text NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    fees_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    proof_ref text NOT NULL,
    idempotency_key text NOT NULL,
    notes text,
    recorded_by uuid,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_sps_amount_currency CHECK ((amount_currency > (0)::numeric)),
    CONSTRAINT chk_sps_amount_kmf CHECK ((amount_kmf > (0)::numeric)),
    CONSTRAINT chk_sps_currency CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT chk_sps_fees CHECK ((fees_kmf >= (0)::numeric)),
    CONSTRAINT chk_sps_fees_only_on_payment CHECK (((kind = 'payment'::text) OR (fees_kmf = (0)::numeric))),
    CONSTRAINT chk_sps_idem CHECK ((btrim(idempotency_key) <> ''::text)),
    CONSTRAINT chk_sps_kind CHECK ((kind = ANY (ARRAY['payment'::text, 'goods_refund'::text, 'fee_refund'::text, 'other_refund'::text]))),
    CONSTRAINT chk_sps_proof CHECK ((btrim(proof_ref) <> ''::text))
);


--
-- Name: TABLE supplier_payment_settlements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_payment_settlements IS 'Règlements fournisseur réellement débités en KMF (append-only) : payment / goods_refund / fee_refund / other_refund ; taux effectif calculé, jamais stocké.';


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    platform text NOT NULL,
    contact_name text,
    contact_phone text,
    contact_email text,
    api_key_enc text,
    api_secret_enc text,
    account_id text,
    auto_order boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    lead_time_days integer DEFAULT 2 NOT NULL,
    orders_count integer DEFAULT 0 NOT NULL,
    avg_delay_days numeric(5,1),
    reliability_pct numeric(5,1),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    requires_secure_transport boolean DEFAULT false NOT NULL,
    secure_transport_fee_pct numeric(4,2) DEFAULT 0 NOT NULL,
    secure_transport_contact character varying(200),
    deleted_at timestamp with time zone,
    CONSTRAINT suppliers_platform_check CHECK ((platform = ANY (ARRAY['noon'::text, 'amazon_uae'::text, 'aliexpress'::text, 'local'::text, 'whatsapp'::text, 'allegro'::text, 'cj'::text])))
);


--
-- Name: TABLE suppliers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.suppliers IS 'Fournisseurs Dubai â€” Noon, Amazon UAE, locaux, WhatsApp';


--
-- Name: COLUMN suppliers.api_key_enc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.suppliers.api_key_enc IS 'ClÃ© API chiffrÃ©e AES-256 cÃ´tÃ© applicatif â€” jamais en clair en base';


--
-- Name: COLUMN suppliers.auto_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.suppliers.auto_order IS 'true = API dispo â†’ commande auto Â· false = notification WhatsApp/email admin';


--
-- Name: COLUMN suppliers.lead_time_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.suppliers.lead_time_days IS 'DÃ©lai estimÃ© entre commande fournisseur et rÃ©ception Hub Dubai';


--
-- Name: suppliers_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.suppliers_stats AS
 SELECT id AS partner_id,
    name,
    partner_type,
    COALESCE(( SELECT count(*) AS count
           FROM public.orders o
          WHERE ((o.supplier_id = p.id) AND (o.status <> ALL (ARRAY['cancelled'::public.order_status, 'refunded'::public.order_status])))), (0)::bigint) AS orders_count_30d,
    COALESCE(( SELECT sum(o.total_kmf) AS sum
           FROM public.orders o
          WHERE ((o.supplier_id = p.id) AND (o.status <> ALL (ARRAY['cancelled'::public.order_status, 'refunded'::public.order_status])) AND (o.created_at >= (now() - '30 days'::interval)))), (0)::numeric) AS orders_revenue_30d_kmf,
    COALESCE(( SELECT avg(o.margin_real_pct) AS avg
           FROM public.orders o
          WHERE ((o.supplier_id = p.id) AND (o.margin_real_pct IS NOT NULL) AND (o.created_at >= (now() - '90 days'::interval)))), (0)::numeric) AS avg_margin_pct_90d,
    COALESCE(( SELECT count(*) AS count
           FROM public.customs_shipments cs
          WHERE ((cs.supplier_id = p.id) AND (cs.is_active = true))), (0)::bigint) AS shipments_count,
    COALESCE(( SELECT avg(cs.effective_rate_pct) AS avg
           FROM public.customs_shipments cs
          WHERE ((cs.supplier_id = p.id) AND (cs.is_active = true) AND (cs.shipment_date >= (CURRENT_DATE - '90 days'::interval)))), (0)::numeric) AS avg_customs_rate_90d
   FROM public.partners p
  WHERE (is_active = true);


--
-- Name: transaction_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type text NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    order_id uuid,
    refund_id uuid,
    reference text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    file_url text,
    file_storage_key text,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    issued_by uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_user_id uuid,
    pdf_content bytea,
    pdf_sha256 text,
    pdf_filename text,
    pdf_generated_at timestamp with time zone,
    template_version text DEFAULT '2026-08-v1'::text NOT NULL,
    CONSTRAINT transaction_documents_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'available'::text, 'error'::text]))),
    CONSTRAINT transaction_documents_type_check CHECK ((document_type = ANY (ARRAY['refund_receipt'::text, 'contribution_receipt'::text, 'wallet_receipt'::text, 'pickup_proof'::text, 'purchase_order'::text, 'customs_invoice'::text])))
);


--
-- Name: unsold_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unsold_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    product_name character varying(200) NOT NULL,
    original_price_kmf numeric(14,2) NOT NULL,
    unsold_price_kmf numeric(14,2) NOT NULL,
    channel character varying(20) DEFAULT 'both'::character varying NOT NULL,
    status character varying(20) DEFAULT 'available'::character varying NOT NULL,
    reseller_id uuid,
    unsold_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_price_kmf numeric(14,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_pickup_authorizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_pickup_authorizations (
    user_id uuid NOT NULL,
    authorized_given_names text,
    authorized_family_name text,
    normalized_given_names text,
    normalized_family_name text,
    version integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT user_pickup_authorizations_active_names_required CHECK (((NOT is_active) OR ((authorized_given_names IS NOT NULL) AND (authorized_family_name IS NOT NULL) AND (normalized_given_names IS NOT NULL) AND (normalized_family_name IS NOT NULL))))
);


--
-- Name: TABLE user_pickup_authorizations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_pickup_authorizations IS 'Lot 5 — autorisation nominative de retrait exceptionnel. Préférence courante du compte (auth-identity), consultée au moment exact de la remise par services/pickup-secret-service.js (logistics). Ne stocke jamais de donnée de pièce d''identité (pas de copie, numéro, date d''expiration ou signature).';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email text,
    phone text,
    full_name text NOT NULL,
    role public.user_role DEFAULT 'client'::public.user_role NOT NULL,
    timezone text,
    currency_pref text DEFAULT 'KMF'::text NOT NULL,
    password_hash text,
    country character(2) DEFAULT 'FR'::bpchar NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    orders_count integer DEFAULT 0 NOT NULL,
    loyalty_tier_id integer,
    loyalty_since timestamp with time zone,
    last_login_at timestamp with time zone,
    magic_token text,
    magic_token_expires_at timestamp with time zone,
    whatsapp_phone text,
    relais_id uuid,
    phone_payer character varying(20),
    big_basket_count integer DEFAULT 0 NOT NULL,
    big_basket_last_notified_count integer DEFAULT 0 NOT NULL
);


--
-- Name: v_active_product_suppliers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_active_product_suppliers AS
 SELECT ps.id,
    ps.product_id,
    ps.supplier_id,
    ps.supplier_sku,
    ps.supplier_url,
    ps.supplier_price_aed,
    ps.min_order_qty,
    ps.priority,
    ps.is_active,
    ps.last_checked_at,
    ps.notes,
    ps.created_at,
    ps.updated_at,
    ps.deleted_at,
    s.name AS supplier_name,
    s.platform AS supplier_platform,
    s.contact_name AS supplier_contact_name,
    s.contact_phone AS supplier_contact_phone,
    s.contact_email AS supplier_contact_email,
    s.auto_order AS supplier_auto_order,
    s.lead_time_days AS supplier_lead_time_days,
    s.requires_secure_transport,
    s.secure_transport_fee_pct,
    s.secure_transport_contact
   FROM (public.product_suppliers ps
     JOIN public.suppliers s ON ((s.id = ps.supplier_id)))
  WHERE ((ps.deleted_at IS NULL) AND (s.deleted_at IS NULL));


--
-- Name: v_ceremony_orders; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_ceremony_orders AS
 SELECT oi.id AS item_id,
    o.id AS order_id,
    o.reference AS order_ref,
    (o.created_at)::date AS order_date,
    o.status AS order_status,
    COALESCE(oi.module_type, o.module_type) AS ceremony_type,
    p.name AS product_name,
    COALESCE(oi.module_fabric_type, o.module_fabric_type) AS fabric_type,
    COALESCE(oi.module_size, o.module_size) AS size,
    COALESCE(oi.module_retouche, o.module_retouche) AS retouche,
    COALESCE(oi.module_qty_meters, o.module_qty_meters) AS qty_meters,
    COALESCE(oi.module_accessories, o.module_accessories) AS accessories,
    oi.price_kmf AS unit_price_kmf,
    oi.quantity,
    (oi.price_kmf * (oi.quantity)::numeric) AS total_item_kmf,
    u.full_name AS client_name,
    u.phone AS client_phone,
    r.name AS relais_name,
    pa.name AS artisan_name,
    pa.phone AS artisan_phone
   FROM (((((public.order_items oi
     JOIN public.orders o ON ((o.id = oi.order_id)))
     JOIN public.products p ON ((p.id = oi.product_id)))
     LEFT JOIN public.users u ON ((u.id = o.user_id)))
     LEFT JOIN public.relais r ON ((r.id = o.relais_id)))
     LEFT JOIN public.partners pa ON ((pa.id = o.confection_artisan_id)))
  WHERE (COALESCE(oi.module_type, o.module_type) IS NOT NULL);


--
-- Name: v_customs_analysis; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_customs_analysis AS
 SELECT sh_category,
    product_category,
    count(*) AS nb_passages,
    (avg(customs_delta_pct))::numeric(6,2) AS avg_delta_pct,
    (max(customs_delta_pct))::numeric(6,2) AS max_delta_pct,
    count(*) FILTER (WHERE is_anomaly) AS nb_anomalies,
    round((((1)::numeric + COALESCE((avg(customs_delta_pct) / (100)::numeric), 0.20)) + 0.05), 3) AS recommended_coeff,
    max(customs_date) AS last_passage
   FROM public.customs_history
  WHERE (customs_real_kmf IS NOT NULL)
  GROUP BY sh_category, product_category
  ORDER BY ((avg(customs_delta_pct))::numeric(6,2)) DESC NULLS LAST;


--
-- Name: v_hub_transit; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_hub_transit AS
 SELECT o.id AS order_id,
    o.reference AS order_ref,
    o.status AS order_status,
    o.created_at AS ordered_at,
    count(po.id) AS total_items,
    sum(po.qty) AS total_qty_ordered,
    sum(po.received_qty) AS total_qty_received,
    sum(
        CASE
            WHEN (po.received_qty >= po.qty) THEN 1
            ELSE 0
        END) AS items_complete,
    sum(
        CASE
            WHEN ((po.received_qty < po.qty) AND (po.status <> 'cancelled'::text)) THEN 1
            ELSE 0
        END) AS items_missing,
    round(((100.0 * (sum(po.received_qty))::numeric) / (NULLIF(sum(po.qty), 0))::numeric), 0) AS pct_received,
    min(po.confirmed_at) AS first_po_confirmed_at,
    max(po.hub_received_at) AS last_item_received_at
   FROM (public.orders o
     JOIN public.purchase_orders po ON ((po.order_id = o.id)))
  WHERE (o.status <> ALL (ARRAY['collected'::public.order_status, 'cancelled'::public.order_status, 'refunded'::public.order_status]))
  GROUP BY o.id, o.reference, o.status, o.created_at;


--
-- Name: v_loyalty_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_loyalty_summary AS
 SELECT u.id,
    u.full_name AS name,
    u.phone,
    u.orders_count,
    lt.label AS tier_label,
    lt.badge AS tier_badge,
    lt.discount_pct,
    u.loyalty_since,
    ( SELECT lt2.label
           FROM public.loyalty_tiers lt2
          WHERE (lt2.min_orders > COALESCE(lt.min_orders, 0))
          ORDER BY lt2.min_orders
         LIMIT 1) AS next_tier_label,
    (( SELECT lt2.min_orders
           FROM public.loyalty_tiers lt2
          WHERE (lt2.min_orders > COALESCE(lt.min_orders, 0))
          ORDER BY lt2.min_orders
         LIMIT 1) - u.orders_count) AS orders_until_next_tier
   FROM (public.users u
     LEFT JOIN public.loyalty_tiers lt ON ((lt.id = u.loyalty_tier_id)))
  WHERE (u.role = 'client'::public.user_role)
  ORDER BY u.orders_count DESC;


--
-- Name: v_order_fulfillment; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_order_fulfillment AS
 SELECT o.id AS order_id,
    o.reference AS order_ref,
    o.status AS order_status,
    o.created_at AS order_date,
    count(DISTINCT p.id) AS total_parcels,
    count(DISTINCT p.id) FILTER (WHERE (p.status = 'collected'::public.parcel_status)) AS parcels_collected,
    count(DISTINCT p.id) FILTER (WHERE (p.status = 'available'::public.parcel_status)) AS parcels_available,
    count(DISTINCT p.id) FILTER (WHERE (p.status = ANY (ARRAY['shipped'::public.parcel_status, 'in_transit'::public.parcel_status]))) AS parcels_in_transit,
    count(DISTINCT p.id) FILTER (WHERE (p.status = ANY (ARRAY['draft'::public.parcel_status, 'preparation'::public.parcel_status]))) AS parcels_pending,
    count(DISTINCT p.id) FILTER (WHERE (p.status = 'cancelled'::public.parcel_status)) AS parcels_cancelled,
    COALESCE(sum(pi.qty_allocated), (0)::bigint) AS total_allocated,
    COALESCE(sum(pi.qty_packed), (0)::bigint) AS total_packed,
    COALESCE(sum(pi.qty_shipped), (0)::bigint) AS total_shipped,
    COALESCE(sum(pi.qty_received), (0)::bigint) AS total_received,
    COALESCE(sum(pi.qty_collected), (0)::bigint) AS total_collected,
    COALESCE(oi_agg.total_ordered, (0)::bigint) AS total_ordered,
    count(DISTINCT inc.id) FILTER (WHERE (inc.status = ANY (ARRAY['open'::text, 'investigating'::text]))) AS open_incidents,
    count(DISTINCT inc.id) FILTER (WHERE ((inc.severity = ANY (ARRAY['high'::text, 'critical'::text])) AND (inc.status = 'open'::text))) AS critical_incidents,
        CASE
            WHEN (count(DISTINCT p.id) = 0) THEN 'awaiting_allocation'::text
            WHEN (count(DISTINCT p.id) FILTER (WHERE (p.status <> 'cancelled'::public.parcel_status)) = 0) THEN 'cancelled'::text
            WHEN (count(DISTINCT p.id) FILTER (WHERE (p.status = 'collected'::public.parcel_status)) = count(DISTINCT p.id) FILTER (WHERE (p.status <> 'cancelled'::public.parcel_status))) THEN 'fulfilled'::text
            WHEN (count(DISTINCT p.id) FILTER (WHERE (p.status = 'collected'::public.parcel_status)) > 0) THEN 'partially_fulfilled'::text
            WHEN (count(DISTINCT p.id) FILTER (WHERE (p.status = ANY (ARRAY['shipped'::public.parcel_status, 'in_transit'::public.parcel_status]))) > 0) THEN 'in_transit'::text
            WHEN (count(DISTINCT p.id) FILTER (WHERE (p.status = ANY (ARRAY['available'::public.parcel_status, 'arrived'::public.parcel_status]))) > 0) THEN 'ready_for_pickup'::text
            WHEN (count(DISTINCT p.id) FILTER (WHERE (p.status = ANY (ARRAY['draft'::public.parcel_status, 'preparation'::public.parcel_status]))) > 0) THEN 'in_preparation'::text
            ELSE 'unknown'::text
        END AS computed_status
   FROM ((((public.orders o
     LEFT JOIN public.parcels p ON ((p.order_id = o.id)))
     LEFT JOIN public.parcel_items pi ON ((pi.parcel_id = p.id)))
     LEFT JOIN public.incidents inc ON ((inc.order_id = o.id)))
     LEFT JOIN LATERAL ( SELECT sum(COALESCE(order_items.qty_ordered, order_items.quantity, 1)) AS total_ordered
           FROM public.order_items
          WHERE (order_items.order_id = o.id)) oi_agg ON (true))
  GROUP BY o.id, o.reference, o.status, o.created_at, oi_agg.total_ordered;


--
-- Name: v_order_margins; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_order_margins AS
 SELECT o.id,
    o.reference,
    (o.created_at)::date AS order_date,
    o.total_kmf,
    o.cost_estimated_kmf,
    o.cost_real_kmf,
    o.margin_estimated_pct,
    o.margin_real_pct,
    o.cost_delta_pct,
    o.margin_alert,
    o.sourcing_blocked,
    o.status,
    o.confection_type,
    o.cost_closed_at,
    p.full_name AS client_name,
    r.name AS relais_name
   FROM ((public.orders o
     LEFT JOIN public.users p ON ((p.id = o.user_id)))
     LEFT JOIN public.relais r ON ((r.id = o.relais_id)))
  WHERE (o.cost_real_kmf IS NOT NULL);


--
-- Name: v_parcel_reconciliation; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_parcel_reconciliation AS
 WITH last_event AS (
         SELECT DISTINCT ON (parcel_events.parcel_id) parcel_events.parcel_id,
            parcel_events.event_type,
            parcel_events.created_at
           FROM public.parcel_events
          ORDER BY parcel_events.parcel_id, parcel_events.created_at DESC
        ), coverage AS (
         SELECT oi.order_id,
            count(oi.id) AS items_total,
            count(pi.order_item_id) FILTER (WHERE (pa.status <> 'cancelled'::public.parcel_status)) AS items_packed
           FROM ((public.order_items oi
             LEFT JOIN public.parcel_items pi ON ((pi.order_item_id = oi.id)))
             LEFT JOIN public.parcels pa ON ((pa.id = pi.parcel_id)))
          GROUP BY oi.order_id
        )
 SELECT p.id AS parcel_id,
    p.reference AS parcel_ref,
    o.reference AS order_ref,
    p.status AS parcel_status,
    o.status AS order_status,
    le.event_type AS last_event,
    le.created_at AS last_event_at,
    cov.items_packed,
    cov.items_total,
    (p.seal_code IS NOT NULL) AS has_seal,
    array_remove(ARRAY[
        CASE
            WHEN ((le.event_type IS NOT NULL) AND (le.event_type <> (p.status)::text)) THEN 'projection_vs_event_drift'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((p.status = ANY (ARRAY['shipped'::public.parcel_status, 'in_transit'::public.parcel_status, 'arrived'::public.parcel_status, 'available'::public.parcel_status, 'collected'::public.parcel_status])) AND (cov.items_packed < cov.items_total)) THEN 'shipped_incomplete'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((p.status = 'draft'::public.parcel_status) AND (o.status = ANY (ARRAY['shipped'::public.order_status, 'in_transit'::public.order_status, 'available'::public.order_status, 'collected'::public.order_status]))) THEN 'order_ahead_of_parcel'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (p.seal_code IS NULL) THEN 'no_seal'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((p.status <> 'draft'::public.parcel_status) AND (le.event_type IS NULL)) THEN 'no_event_trace'::text
            ELSE NULL::text
        END], NULL::text) AS issues
   FROM (((public.parcels p
     JOIN public.orders o ON ((o.id = p.order_id)))
     LEFT JOIN last_event le ON ((le.parcel_id = p.id)))
     LEFT JOIN coverage cov ON ((cov.order_id = p.order_id)))
  WHERE (p.status <> 'cancelled'::public.parcel_status);


--
-- Name: v_parcel_trace; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_parcel_trace AS
 SELECT p.id AS parcel_id,
    p.reference AS parcel_ref,
    p.status AS parcel_status,
    p.order_id,
    o.reference AS order_ref,
    p.relais_id,
    r.name AS relais_name,
    p.verification_status,
    p.expected_weight_kg,
    p.actual_weight_kg,
    p.items_count,
    p.total_qty,
    p.created_at AS parcel_created,
    p.shipped_at,
    ( SELECT min(se2.created_at) AS min
           FROM public.scan_events se2
          WHERE ((se2.parcel_id = p.id) AND (se2.event_type = 'relais_received'::text) AND (se2.status = 'applied'::text))) AS received_at,
    ( SELECT min(se3.created_at) AS min
           FROM public.scan_events se3
          WHERE ((se3.parcel_id = p.id) AND (se3.event_type = 'customer_collected'::text) AND (se3.status = 'applied'::text))) AS collected_at,
    last_scan.event_type AS last_event_type,
    last_scan.created_at AS last_event_at,
    last_scan.actor_name AS last_actor,
    ( SELECT count(*) AS count
           FROM public.scan_events se
          WHERE ((se.parcel_id = p.id) AND (se.status = 'applied'::text))) AS scan_count,
    ( SELECT count(*) AS count
           FROM public.incidents i
          WHERE ((i.parcel_id = p.id) AND (i.status = ANY (ARRAY['open'::text, 'investigating'::text])))) AS open_incidents
   FROM (((public.parcels p
     LEFT JOIN public.orders o ON ((o.id = p.order_id)))
     LEFT JOIN public.relais r ON ((r.id = p.relais_id)))
     LEFT JOIN LATERAL ( SELECT scan_events.event_type,
            scan_events.created_at,
            scan_events.actor_name
           FROM public.scan_events
          WHERE ((scan_events.parcel_id = p.id) AND (scan_events.status = 'applied'::text))
          ORDER BY scan_events.created_at DESC
         LIMIT 1) last_scan ON (true));


--
-- Name: v_purchase_line_market; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_purchase_line_market AS
 SELECT pl.id AS line_id,
    pl.purchase_order_id,
    pl.order_item_id,
    oi.order_id,
    o.market_id,
    pl.supplier_id,
    pl.procurement_hub_ref,
    pl.quantity,
    public.purchase_line_effective_quantity(pl.cancelled_at, pl.settled_quantity, pl.confirmed_quantity, pl.quantity) AS effective_quantity,
    (pl.cancelled_at IS NOT NULL) AS cancelled
   FROM ((public.purchase_lines pl
     JOIN public.order_items oi ON ((oi.id = pl.order_item_id)))
     JOIN public.orders o ON ((o.id = oi.order_id)));


--
-- Name: VIEW v_purchase_line_market; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_purchase_line_market IS 'Marché d''origine de chaque ligne d''achat (order_item → order → market_id). Lecture seule : le marché ne se réassigne jamais via Purchasing et n''est pas une clé de regroupement des PO.';


--
-- Name: v_purchase_line_progress; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_purchase_line_progress AS
 SELECT pl.id AS line_id,
    pl.order_item_id,
    oi.order_id,
    pl.purchase_order_id,
    po.status AS po_status,
        CASE
            WHEN (po.id IS NULL) THEN NULL::text
            WHEN (po.order_id IS NULL) THEN 'grouped'::text
            ELSE 'historical'::text
        END AS po_shape,
    public.purchase_line_effective_quantity(pl.cancelled_at, pl.settled_quantity, pl.confirmed_quantity, pl.quantity) AS effective_quantity,
    COALESCE(( SELECT (sum(p.quantity))::integer AS sum
           FROM ((public.hub_purchase_allocations a
             JOIN public.hub_physical_unit_placements p ON (((p.allocation_id = a.id) AND (p.removed_at IS NULL))))
             JOIN public.hub_physical_units u ON (((u.id = p.physical_unit_id) AND (u.state <> ALL (ARRAY['QUARANTINED'::text, 'SUPERSEDED'::text])) AND (u.outcome_type IS NULL))))
          WHERE ((a.purchase_line_id = pl.id) OR ((a.purchase_line_id IS NULL) AND (a.purchase_order_id = pl.purchase_order_id) AND (a.order_item_id = pl.order_item_id)))), 0) AS received_quantity,
    (pl.cancelled_at IS NOT NULL) AS cancelled,
    pl.product_supplier_id,
    po.hub_received_at,
    pl.quantity,
    COALESCE(po.received_qty, 0) AS declared_received_quantity
   FROM ((public.purchase_lines pl
     JOIN public.order_items oi ON ((oi.id = pl.order_item_id)))
     LEFT JOIN public.purchase_orders po ON ((po.id = pl.purchase_order_id)))
UNION ALL
 SELECT NULL::uuid AS line_id,
    po.order_item_id,
    po.order_id,
    po.id AS purchase_order_id,
    po.status AS po_status,
    'historical_no_line'::text AS po_shape,
        CASE
            WHEN (po.status = 'cancelled'::text) THEN 0
            ELSE po.qty
        END AS effective_quantity,
    COALESCE(( SELECT (sum(p.quantity))::integer AS sum
           FROM ((public.hub_purchase_allocations a
             JOIN public.hub_physical_unit_placements p ON (((p.allocation_id = a.id) AND (p.removed_at IS NULL))))
             JOIN public.hub_physical_units u ON (((u.id = p.physical_unit_id) AND (u.state <> ALL (ARRAY['QUARANTINED'::text, 'SUPERSEDED'::text])) AND (u.outcome_type IS NULL))))
          WHERE ((a.purchase_order_id = po.id) AND (a.purchase_line_id IS NULL))), 0) AS received_quantity,
    (po.status = 'cancelled'::text) AS cancelled,
    po.product_supplier_id,
    po.hub_received_at,
    po.qty AS quantity,
    COALESCE(po.received_qty, 0) AS declared_received_quantity
   FROM public.purchase_orders po
  WHERE ((po.order_id IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.purchase_lines pl
          WHERE (pl.purchase_order_id = po.id)))));


--
-- Name: VIEW v_purchase_line_progress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_purchase_line_progress IS 'Progression d''achat par ligne. received_quantity = matière physique utilisable (placements actifs, hors quarantaine/superseded/outcome) pour toutes les formes de PO ; declared_received_quantity = ancien compteur déclaratif, informatif uniquement.';


--
-- Name: v_shipment_density; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_shipment_density AS
 WITH parcel_vol AS (
         SELECT csp.shipment_id,
            csp.parcel_id,
            csp.parcel_weight_kg,
            COALESCE(csp.parcel_volume_cm3, p.volume_cm3) AS volume_cm3
           FROM (public.customs_shipment_parcels csp
             LEFT JOIN public.parcels p ON ((p.id = csp.parcel_id)))
        ), margin_embarked AS (
         SELECT pv_1.shipment_id,
            sum(((COALESCE(oi.price_kmf, (0)::numeric) * (COALESCE(pi.quantity, 1))::numeric) - (COALESCE(pr.cost_kmf, (oi.price_kmf)::numeric, (0)::numeric) * (COALESCE(pi.quantity, 1))::numeric))) AS margin_kmf
           FROM (((parcel_vol pv_1
             JOIN public.parcel_items pi ON ((pi.parcel_id = pv_1.parcel_id)))
             JOIN public.order_items oi ON ((oi.id = pi.order_item_id)))
             LEFT JOIN public.products pr ON ((pr.id = pi.product_id)))
          GROUP BY pv_1.shipment_id
        )
 SELECT cs.id AS shipment_id,
    cs.reference,
    cs.transport_mode,
    cs.total_weight_kg,
    cs.total_volume_m3,
    sum(pv.parcel_weight_kg) AS parcels_weight_kg,
    (sum(pv.volume_cm3) / 1000000.0) AS parcels_volume_m3,
    GREATEST((COALESCE(cs.total_weight_kg, sum(pv.parcel_weight_kg)) / 1000.0), COALESCE(cs.total_volume_m3, (sum(pv.volume_cm3) / 1000000.0))) AS chargeable_wm,
        CASE
            WHEN ((cs.total_volume_m3 > (0)::numeric) AND (sum(pv.volume_cm3) > (0)::numeric)) THEN round((((sum(pv.volume_cm3) / 1000000.0) / cs.total_volume_m3) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS fill_rate_pct,
    me.margin_kmf AS margin_embarked_kmf,
        CASE
            WHEN (cs.total_volume_m3 > (0)::numeric) THEN round((me.margin_kmf / cs.total_volume_m3), 0)
            ELSE NULL::numeric
        END AS margin_kmf_per_m3,
    cs.freight_kmf,
    cs.status
   FROM ((public.customs_shipments cs
     LEFT JOIN parcel_vol pv ON ((pv.shipment_id = cs.id)))
     LEFT JOIN margin_embarked me ON ((me.shipment_id = cs.id)))
  WHERE (cs.is_active = true)
  GROUP BY cs.id, cs.reference, cs.transport_mode, cs.total_weight_kg, cs.total_volume_m3, cs.freight_kmf, cs.status, me.margin_kmf;


--
-- Name: v_sourcing_pipeline; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_sourcing_pipeline AS
 SELECT o.reference AS order_ref,
    o.status AS order_status,
    po.id AS purchase_order_id,
    po.status AS purchase_status,
    po.trigger_mode,
    s.name AS supplier_name,
    s.platform,
    s.auto_order,
    po.supplier_sku,
    po.supplier_order_id,
    po.qty,
    po.unit_price_aed,
    po.total_price_aed,
    po.ordered_at,
    po.hub_received_at,
    po.tracking_url,
    po.quality_ok,
    o.created_at AS order_created_at
   FROM ((public.purchase_orders po
     JOIN public.orders o ON ((o.id = po.order_id)))
     LEFT JOIN public.suppliers s ON ((s.id = po.supplier_id)));


--
-- Name: v_unsold_pipeline; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_unsold_pipeline AS
 SELECT ui.id,
    ui.product_name,
    ui.original_price_kmf,
    ui.unsold_price_kmf,
    round((((1)::numeric - ((ui.unsold_price_kmf)::numeric / (NULLIF(ui.original_price_kmf, (0)::numeric))::numeric)) * (100)::numeric)) AS remise_pct,
    ui.channel,
    ui.status,
    ui.unsold_at,
    (EXTRACT(epoch FROM (now() - ui.unsold_at)) / (86400)::numeric) AS jours_en_stock,
    o.reference AS order_ref,
    u.full_name AS client_name,
    u.phone AS client_phone
   FROM ((public.unsold_items ui
     JOIN public.orders o ON ((o.id = ui.order_id)))
     JOIN public.users u ON ((u.id = o.user_id)))
  WHERE ((ui.status)::text = 'available'::text)
  ORDER BY ui.unsold_at;


--
-- Name: wallet_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_consumptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    credit_lot_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    reversed_at timestamp with time zone,
    reversal_reason character varying(50),
    CONSTRAINT wallet_consumptions_amount_kmf_check CHECK ((amount_kmf > (0)::numeric))
);


--
-- Name: COLUMN wallet_consumptions.reversed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.wallet_consumptions.reversed_at IS 'NULL = consommation active. Non-NULL = reversÃ©e lors d''une annulation de commande.';


--
-- Name: COLUMN wallet_consumptions.reversal_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.wallet_consumptions.reversal_reason IS 'Raison de la reversal (order_cancel, admin_correction, ...).';


--
-- Name: wallet_credit_lots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_credit_lots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    original_amount_kmf numeric(14,2) NOT NULL,
    remaining_kmf numeric(14,2) NOT NULL,
    reason character varying(50) NOT NULL,
    source_order_id uuid,
    expires_at timestamp with time zone,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT wallet_credit_lots_remaining_kmf_check CHECK ((remaining_kmf >= (0)::numeric)),
    CONSTRAINT wallet_credit_lots_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'used'::character varying, 'expired'::character varying, 'reversed'::character varying])::text[])))
);


--
-- Name: wallet_receipt_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallet_receipt_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    amount_kmf numeric(14,2) NOT NULL,
    balance_after_kmf numeric(14,2) NOT NULL,
    reason character varying(50) NOT NULL,
    reference_id uuid,
    idempotency_key character varying(100),
    note text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT wallet_transactions_amount_kmf_check CHECK ((amount_kmf > (0)::numeric)),
    CONSTRAINT wallet_transactions_type_check CHECK (((type)::text = ANY ((ARRAY['credit'::character varying, 'debit'::character varying, 'reversal'::character varying, 'expiration'::character varying])::text[])))
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    balance_kmf numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_balance_non_negative CHECK ((balance_kmf >= (0)::numeric))
);


--
-- Name: webauthn_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge text NOT NULL,
    ceremony_type text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT webauthn_challenges_ceremony_type_check CHECK ((ceremony_type = ANY (ARRAY['register'::text, 'login'::text, 'step_up'::text])))
);


--
-- Name: TABLE webauthn_challenges; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.webauthn_challenges IS 'Challenges register/login à usage unique, TTL court (2 min), consommés atomiquement via UPDATE ... WHERE consumed_at IS NULL RETURNING (voir services/webauthn-service.js).';


--
-- Name: COLUMN webauthn_challenges.ceremony_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.webauthn_challenges.ceremony_type IS 'Cérémonie WebAuthn : register, login ou step_up. AUTH-7 interdit le croisement des challenges.';


--
-- Name: webauthn_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id text NOT NULL,
    public_key text NOT NULL,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports text[] DEFAULT '{}'::text[] NOT NULL,
    aaguid text,
    backup_eligible boolean DEFAULT false NOT NULL,
    backup_state boolean DEFAULT false NOT NULL,
    device_label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone
);


--
-- Name: TABLE webauthn_credentials; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.webauthn_credentials IS 'Passkeys WebAuthn (AUTH-2). Owner exclusif : feature auth-passkey. Jamais de DDL runtime.';


--
-- Name: boutique_subcategories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boutique_subcategories ALTER COLUMN id SET DEFAULT nextval('public.boutique_subcategories_id_seq'::regclass);


--
-- Name: cost_benchmarks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_benchmarks ALTER COLUMN id SET DEFAULT nextval('public.cost_benchmarks_id_seq'::regclass);


--
-- Name: customs_shipment_financial_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_financial_audit ALTER COLUMN id SET DEFAULT nextval('public.customs_shipment_financial_audit_id_seq'::regclass);


--
-- Name: customs_shipment_parcel_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_parcel_events ALTER COLUMN id SET DEFAULT nextval('public.customs_shipment_parcel_events_id_seq'::regclass);


--
-- Name: loyalty_tiers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers ALTER COLUMN id SET DEFAULT nextval('public.loyalty_tiers_id_seq'::regclass);


--
-- Name: otp_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_codes ALTER COLUMN id SET DEFAULT nextval('public.otp_codes_id_seq'::regclass);


--
-- Name: pricing_benchmarks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_benchmarks ALTER COLUMN id SET DEFAULT nextval('public.pricing_benchmarks_id_seq'::regclass);


--
-- Name: pricing_matrices_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_matrices_audit ALTER COLUMN id SET DEFAULT nextval('public.pricing_matrices_audit_id_seq'::regclass);


--
-- Name: sourcing_observation_evidence evidence_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_observation_evidence ALTER COLUMN evidence_id SET DEFAULT nextval('public.sourcing_observation_evidence_evidence_id_seq'::regclass);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: assignment_capability_ceiling assignment_capability_ceiling_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_capability_ceiling
    ADD CONSTRAINT assignment_capability_ceiling_pkey PRIMARY KEY (id);


--
-- Name: assignment_memberships assignment_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_memberships
    ADD CONSTRAINT assignment_memberships_pkey PRIMARY KEY (id);


--
-- Name: basket_items basket_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basket_items
    ADD CONSTRAINT basket_items_pkey PRIMARY KEY (id);


--
-- Name: baskets baskets_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baskets
    ADD CONSTRAINT baskets_code_key UNIQUE (code);


--
-- Name: baskets baskets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baskets
    ADD CONSTRAINT baskets_pkey PRIMARY KEY (id);


--
-- Name: boutique_categories boutique_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boutique_categories
    ADD CONSTRAINT boutique_categories_pkey PRIMARY KEY (key);


--
-- Name: boutique_subcategories boutique_subcategories_category_key_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boutique_subcategories
    ADD CONSTRAINT boutique_subcategories_category_key_key_key UNIQUE (category_key, key);


--
-- Name: boutique_subcategories boutique_subcategories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boutique_subcategories
    ADD CONSTRAINT boutique_subcategories_pkey PRIMARY KEY (id);


--
-- Name: business_rules_history business_rules_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rules_history
    ADD CONSTRAINT business_rules_history_pkey PRIMARY KEY (id);


--
-- Name: business_rules business_rules_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rules
    ADD CONSTRAINT business_rules_key_key UNIQUE (key);


--
-- Name: business_rules business_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rules
    ADD CONSTRAINT business_rules_pkey PRIMARY KEY (id);


--
-- Name: capability_registry capability_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_registry
    ADD CONSTRAINT capability_registry_pkey PRIMARY KEY (capability);


--
-- Name: carriers carriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carriers
    ADD CONSTRAINT carriers_pkey PRIMARY KEY (id);


--
-- Name: cart_shares cart_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_shares
    ADD CONSTRAINT cart_shares_pkey PRIMARY KEY (id);


--
-- Name: cash_collections cash_collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_collections
    ADD CONSTRAINT cash_collections_pkey PRIMARY KEY (id);


--
-- Name: cash_confirmation_controls cash_confirmation_controls_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_confirmation_controls
    ADD CONSTRAINT cash_confirmation_controls_order_id_key UNIQUE (order_id);


--
-- Name: cash_confirmation_controls cash_confirmation_controls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_confirmation_controls
    ADD CONSTRAINT cash_confirmation_controls_pkey PRIMARY KEY (id);


--
-- Name: cash_custody_losses cash_custody_losses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_losses
    ADD CONSTRAINT cash_custody_losses_pkey PRIMARY KEY (id);


--
-- Name: cash_custody_provenance_edges cash_custody_provenance_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_provenance_edges
    ADD CONSTRAINT cash_custody_provenance_edges_pkey PRIMARY KEY (id);


--
-- Name: cash_custody_receipts cash_custody_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_receipts
    ADD CONSTRAINT cash_custody_receipts_pkey PRIMARY KEY (id);


--
-- Name: cash_deposit_allocations cash_deposit_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposit_allocations
    ADD CONSTRAINT cash_deposit_allocations_pkey PRIMARY KEY (id);


--
-- Name: cash_deposit_allocations cash_deposit_allocations_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposit_allocations
    ADD CONSTRAINT cash_deposit_allocations_unique UNIQUE (deposit_id, collection_id);


--
-- Name: cash_deposits cash_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_pkey PRIMARY KEY (id);


--
-- Name: cash_reconciliation cash_reconciliation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_reconciliation
    ADD CONSTRAINT cash_reconciliation_pkey PRIMARY KEY (id);


--
-- Name: catalog_enrichment_runs catalog_enrichment_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_enrichment_runs
    ADD CONSTRAINT catalog_enrichment_runs_pkey PRIMARY KEY (id);


--
-- Name: catalog_exclusions catalog_exclusions_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_exclusions
    ADD CONSTRAINT catalog_exclusions_label_key UNIQUE (label);


--
-- Name: catalog_exclusions catalog_exclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_exclusions
    ADD CONSTRAINT catalog_exclusions_pkey PRIMARY KEY (id);


--
-- Name: catalog_field_overrides catalog_field_overrides_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_field_overrides
    ADD CONSTRAINT catalog_field_overrides_key UNIQUE (product_id, field_name);


--
-- Name: catalog_field_overrides catalog_field_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_field_overrides
    ADD CONSTRAINT catalog_field_overrides_pkey PRIMARY KEY (id);


--
-- Name: catalog_field_sync_state catalog_field_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_field_sync_state
    ADD CONSTRAINT catalog_field_sync_state_pkey PRIMARY KEY (subject_type, subject_id, field_name);


--
-- Name: catalog_global_access_grants catalog_global_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_global_access_grants
    ADD CONSTRAINT catalog_global_access_grants_pkey PRIMARY KEY (id);


--
-- Name: catalog_glossary catalog_glossary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_glossary
    ADD CONSTRAINT catalog_glossary_pkey PRIMARY KEY (id);


--
-- Name: catalog_glossary catalog_glossary_term_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_glossary
    ADD CONSTRAINT catalog_glossary_term_key UNIQUE (term_source);


--
-- Name: catalog_media catalog_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_media
    ADD CONSTRAINT catalog_media_pkey PRIMARY KEY (id);


--
-- Name: catalog_media_recovery_audit catalog_media_recovery_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_media_recovery_audit
    ADD CONSTRAINT catalog_media_recovery_audit_pkey PRIMARY KEY (id);


--
-- Name: catalog_media_visual_fr_reviews catalog_media_visual_fr_one_review_per_media; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_media_visual_fr_reviews
    ADD CONSTRAINT catalog_media_visual_fr_one_review_per_media UNIQUE (media_id);


--
-- Name: catalog_media_visual_fr_reviews catalog_media_visual_fr_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_media_visual_fr_reviews
    ADD CONSTRAINT catalog_media_visual_fr_reviews_pkey PRIMARY KEY (id);


--
-- Name: catalog_publication_decision_audit catalog_publication_decision_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_publication_decision_audit
    ADD CONSTRAINT catalog_publication_decision_audit_pkey PRIMARY KEY (id);


--
-- Name: catalog_stock_sync_state catalog_stock_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_stock_sync_state
    ADD CONSTRAINT catalog_stock_sync_state_pkey PRIMARY KEY (product_sku_id);


--
-- Name: catalog_taxonomy_audit catalog_taxonomy_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_taxonomy_audit
    ADD CONSTRAINT catalog_taxonomy_audit_pkey PRIMARY KEY (id);


--
-- Name: catalog_terminology_reference catalog_terminology_reference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_terminology_reference
    ADD CONSTRAINT catalog_terminology_reference_pkey PRIMARY KEY (id);


--
-- Name: catalog_terminology_reference catalog_terminology_reference_reference_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_terminology_reference
    ADD CONSTRAINT catalog_terminology_reference_reference_key_key UNIQUE (reference_key);


--
-- Name: ceiling_template_capabilities ceiling_template_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ceiling_template_capabilities
    ADD CONSTRAINT ceiling_template_capabilities_pkey PRIMARY KEY (template_id, capability);


--
-- Name: ceiling_templates ceiling_templates_name_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ceiling_templates
    ADD CONSTRAINT ceiling_templates_name_version_key UNIQUE (name, version);


--
-- Name: ceiling_templates ceiling_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ceiling_templates
    ADD CONSTRAINT ceiling_templates_pkey PRIMARY KEY (id);


--
-- Name: charges charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_pkey PRIMARY KEY (id);


--
-- Name: client_notifications client_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notifications
    ADD CONSTRAINT client_notifications_pkey PRIMARY KEY (id);


--
-- Name: client_notifications client_notifications_user_id_event_key_entity_type_entity_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notifications
    ADD CONSTRAINT client_notifications_user_id_event_key_entity_type_entity_i_key UNIQUE (user_id, event_key, entity_type, entity_id);


--
-- Name: competitor_prices competitor_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_prices
    ADD CONSTRAINT competitor_prices_pkey PRIMARY KEY (id);


--
-- Name: cost_benchmarks cost_benchmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_benchmarks
    ADD CONSTRAINT cost_benchmarks_pkey PRIMARY KEY (id);


--
-- Name: cost_benchmarks cost_benchmarks_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_benchmarks
    ADD CONSTRAINT cost_benchmarks_unique UNIQUE (category, cost_family);


--
-- Name: cost_component_events cost_component_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_events
    ADD CONSTRAINT cost_component_events_pkey PRIMARY KEY (id);


--
-- Name: cost_component_market_override_events cost_component_market_override_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_override_events
    ADD CONSTRAINT cost_component_market_override_events_pkey PRIMARY KEY (id);


--
-- Name: cost_component_market_overrides cost_component_market_overrides_market_id_component_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_overrides
    ADD CONSTRAINT cost_component_market_overrides_market_id_component_id_key UNIQUE (market_id, component_id);


--
-- Name: cost_component_market_overrides cost_component_market_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_overrides
    ADD CONSTRAINT cost_component_market_overrides_pkey PRIMARY KEY (id);


--
-- Name: cost_components cost_components_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_components
    ADD CONSTRAINT cost_components_key_key UNIQUE (key);


--
-- Name: cost_components cost_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_components
    ADD CONSTRAINT cost_components_pkey PRIMARY KEY (id);


--
-- Name: currency_parities currency_parities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_parities
    ADD CONSTRAINT currency_parities_pkey PRIMARY KEY (currency);


--
-- Name: customs_categories customs_categories_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_categories
    ADD CONSTRAINT customs_categories_key_key UNIQUE (key);


--
-- Name: customs_categories customs_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_categories
    ADD CONSTRAINT customs_categories_pkey PRIMARY KEY (id);


--
-- Name: customs_history customs_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_history
    ADD CONSTRAINT customs_history_pkey PRIMARY KEY (id);


--
-- Name: customs_shipment_fees customs_shipment_fees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_fees
    ADD CONSTRAINT customs_shipment_fees_pkey PRIMARY KEY (id);


--
-- Name: customs_shipment_financial_audit customs_shipment_financial_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_financial_audit
    ADD CONSTRAINT customs_shipment_financial_audit_pkey PRIMARY KEY (id);


--
-- Name: customs_shipment_parcel_events customs_shipment_parcel_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_parcel_events
    ADD CONSTRAINT customs_shipment_parcel_events_pkey PRIMARY KEY (id);


--
-- Name: customs_shipment_parcels customs_shipment_parcels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_parcels
    ADD CONSTRAINT customs_shipment_parcels_pkey PRIMARY KEY (shipment_id, parcel_id);


--
-- Name: customs_shipments customs_shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipments
    ADD CONSTRAINT customs_shipments_pkey PRIMARY KEY (id);


--
-- Name: customs_shipments customs_shipments_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipments
    ADD CONSTRAINT customs_shipments_reference_key UNIQUE (reference);


--
-- Name: dashboard_global_access_grants dashboard_global_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_global_access_grants
    ADD CONSTRAINT dashboard_global_access_grants_pkey PRIMARY KEY (id);


--
-- Name: decision_signal_global_access_grants decision_signal_global_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_signal_global_access_grants
    ADD CONSTRAINT decision_signal_global_access_grants_pkey PRIMARY KEY (user_id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);


--
-- Name: economic_risk_cost_events economic_risk_cost_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_risk_cost_events
    ADD CONSTRAINT economic_risk_cost_events_pkey PRIMARY KEY (id);


--
-- Name: economic_risk_watermark_events economic_risk_watermark_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_risk_watermark_events
    ADD CONSTRAINT economic_risk_watermark_events_pkey PRIMARY KEY (id);


--
-- Name: economic_snapshots economic_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_snapshots
    ADD CONSTRAINT economic_snapshots_pkey PRIMARY KEY (id);


--
-- Name: economic_structure_cost_events economic_structure_cost_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_structure_cost_events
    ADD CONSTRAINT economic_structure_cost_events_pkey PRIMARY KEY (id);


--
-- Name: economic_variables economic_variables_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_variables
    ADD CONSTRAINT economic_variables_key_key UNIQUE (key);


--
-- Name: economic_variables economic_variables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_variables
    ADD CONSTRAINT economic_variables_pkey PRIMARY KEY (id);


--
-- Name: exchange_rates exchange_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_pkey PRIMARY KEY (id);


--
-- Name: fabrics fabrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabrics
    ADD CONSTRAINT fabrics_pkey PRIMARY KEY (id);


--
-- Name: finance_config finance_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_config
    ADD CONSTRAINT finance_config_pkey PRIMARY KEY (id);


--
-- Name: fx_rate_observations fx_obs_unique_as_of; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fx_rate_observations
    ADD CONSTRAINT fx_obs_unique_as_of UNIQUE (as_of);


--
-- Name: fx_pegs fx_peg_unique_quote_valid_from; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fx_pegs
    ADD CONSTRAINT fx_peg_unique_quote_valid_from UNIQUE (quote_ccy, valid_from);


--
-- Name: fx_pegs fx_pegs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fx_pegs
    ADD CONSTRAINT fx_pegs_pkey PRIMARY KEY (id);


--
-- Name: fx_public_reference_quotes fx_public_reference_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fx_public_reference_quotes
    ADD CONSTRAINT fx_public_reference_quotes_pkey PRIMARY KEY (id);


--
-- Name: fx_public_reference_quotes fx_public_reference_quotes_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fx_public_reference_quotes
    ADD CONSTRAINT fx_public_reference_quotes_unique UNIQUE (base_ccy, quote_ccy, as_of);


--
-- Name: fx_rate_observations fx_rate_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fx_rate_observations
    ADD CONSTRAINT fx_rate_observations_pkey PRIMARY KEY (id);


--
-- Name: garment_models garment_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.garment_models
    ADD CONSTRAINT garment_models_pkey PRIMARY KEY (id);


--
-- Name: hub_custody_events hub_custody_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_custody_events
    ADD CONSTRAINT hub_custody_events_pkey PRIMARY KEY (id);


--
-- Name: hub_physical_unit_placements hub_physical_unit_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_physical_unit_placements
    ADD CONSTRAINT hub_physical_unit_placements_pkey PRIMARY KEY (id);


--
-- Name: hub_physical_units hub_physical_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_physical_units
    ADD CONSTRAINT hub_physical_units_pkey PRIMARY KEY (id);


--
-- Name: hub_physical_units hub_physical_units_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_physical_units
    ADD CONSTRAINT hub_physical_units_reference_key UNIQUE (reference);


--
-- Name: hub_purchase_allocations hub_purchase_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_purchase_allocations
    ADD CONSTRAINT hub_purchase_allocations_pkey PRIMARY KEY (id);


--
-- Name: import_runtime_item_events import_runtime_item_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runtime_item_events
    ADD CONSTRAINT import_runtime_item_events_pkey PRIMARY KEY (id);


--
-- Name: import_runtime_runs import_runtime_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runtime_runs
    ADD CONSTRAINT import_runtime_runs_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: inquiries inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiries
    ADD CONSTRAINT inquiries_pkey PRIMARY KEY (id);


--
-- Name: international_n1_allocation_links international_n1_allocation_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_n1_allocation_links
    ADD CONSTRAINT international_n1_allocation_links_pkey PRIMARY KEY (allocation_id);


--
-- Name: international_n1_reconciliations international_n1_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_n1_reconciliations
    ADD CONSTRAINT international_n1_reconciliations_pkey PRIMARY KEY (shipment_id);


--
-- Name: international_shipment_charges international_shipment_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_charges
    ADD CONSTRAINT international_shipment_charges_pkey PRIMARY KEY (id);


--
-- Name: international_shipment_events international_shipment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_events
    ADD CONSTRAINT international_shipment_events_pkey PRIMARY KEY (id);


--
-- Name: international_shipment_hub_units international_shipment_hub_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_hub_units
    ADD CONSTRAINT international_shipment_hub_units_pkey PRIMARY KEY (shipment_id, physical_unit_id);


--
-- Name: international_shipment_parcels international_shipment_parcels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_parcels
    ADD CONSTRAINT international_shipment_parcels_pkey PRIMARY KEY (shipment_id, parcel_id);


--
-- Name: international_shipments international_shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipments
    ADD CONSTRAINT international_shipments_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_order_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_unique UNIQUE (order_id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: local_stock_allocations local_stock_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_stock_allocations
    ADD CONSTRAINT local_stock_allocations_pkey PRIMARY KEY (id);


--
-- Name: local_stock local_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_stock
    ADD CONSTRAINT local_stock_pkey PRIMARY KEY (id);


--
-- Name: loyalty_rewards loyalty_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rewards
    ADD CONSTRAINT loyalty_rewards_pkey PRIMARY KEY (id);


--
-- Name: loyalty_tiers loyalty_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT loyalty_tiers_pkey PRIMARY KEY (id);


--
-- Name: market_cash_control_policies market_cash_control_policies_assignment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_control_policies
    ADD CONSTRAINT market_cash_control_policies_assignment_id_key UNIQUE (assignment_id);


--
-- Name: market_cash_control_policies market_cash_control_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_control_policies
    ADD CONSTRAINT market_cash_control_policies_pkey PRIMARY KEY (id);


--
-- Name: market_cash_destinations market_cash_destinations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_destinations
    ADD CONSTRAINT market_cash_destinations_pkey PRIMARY KEY (id);


--
-- Name: market_central_collection_modes market_central_collection_modes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_central_collection_modes
    ADD CONSTRAINT market_central_collection_modes_pkey PRIMARY KEY (market_id, payment_mode);


--
-- Name: market_cost_attributions market_cost_attributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cost_attributions
    ADD CONSTRAINT market_cost_attributions_pkey PRIMARY KEY (id);


--
-- Name: market_delegation_audit market_delegation_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delegation_audit
    ADD CONSTRAINT market_delegation_audit_pkey PRIMARY KEY (id);


--
-- Name: market_delivery_attestations market_delivery_attestations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delivery_attestations
    ADD CONSTRAINT market_delivery_attestations_pkey PRIMARY KEY (id);


--
-- Name: market_operating_assignments market_operating_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_operating_assignments
    ADD CONSTRAINT market_operating_assignments_pkey PRIMARY KEY (id);


--
-- Name: market_payment_accounts market_payment_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_payment_accounts
    ADD CONSTRAINT market_payment_accounts_pkey PRIMARY KEY (id);


--
-- Name: market_payment_providers market_payment_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_payment_providers
    ADD CONSTRAINT market_payment_providers_pkey PRIMARY KEY (market_id, provider);


--
-- Name: market_price_observation_events market_price_observation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observation_events
    ADD CONSTRAINT market_price_observation_events_pkey PRIMARY KEY (id);


--
-- Name: market_price_observations market_price_observations_observation_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observations
    ADD CONSTRAINT market_price_observations_observation_ref_key UNIQUE (observation_ref);


--
-- Name: market_price_observations market_price_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observations
    ADD CONSTRAINT market_price_observations_pkey PRIMARY KEY (id);


--
-- Name: market_settlement_events market_settlement_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlement_events
    ADD CONSTRAINT market_settlement_events_pkey PRIMARY KEY (id);


--
-- Name: market_settlements market_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlements
    ADD CONSTRAINT market_settlements_pkey PRIMARY KEY (id);


--
-- Name: market_team_invitations market_team_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_team_invitations
    ADD CONSTRAINT market_team_invitations_pkey PRIMARY KEY (id);


--
-- Name: market_team_invitations market_team_invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_team_invitations
    ADD CONSTRAINT market_team_invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: market_transport_sale_rates market_transport_sale_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_transport_sale_rates
    ADD CONSTRAINT market_transport_sale_rates_pkey PRIMARY KEY (id);


--
-- Name: markets markets_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_code_key UNIQUE (code);


--
-- Name: markets markets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_pkey PRIMARY KEY (id);


--
-- Name: membership_capabilities membership_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_capabilities
    ADD CONSTRAINT membership_capabilities_pkey PRIMARY KEY (id);


--
-- Name: mobile_money_transactions mobile_money_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_money_transactions
    ADD CONSTRAINT mobile_money_transactions_pkey PRIMARY KEY (id);


--
-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (id);


--
-- Name: operator_market_scopes operator_market_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_market_scopes
    ADD CONSTRAINT operator_market_scopes_pkey PRIMARY KEY (id);


--
-- Name: operator_market_scopes operator_market_scopes_projection_or_revoked_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.operator_market_scopes
    ADD CONSTRAINT operator_market_scopes_projection_or_revoked_chk CHECK (((projected_from_membership_id IS NOT NULL) OR (revoked_at IS NOT NULL))) NOT VALID;


--
-- Name: order_comments order_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_comments
    ADD CONSTRAINT order_comments_pkey PRIMARY KEY (id);


--
-- Name: order_cost_entry_events order_cost_entry_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_cost_entry_events
    ADD CONSTRAINT order_cost_entry_events_pkey PRIMARY KEY (id);


--
-- Name: order_incidents order_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_incidents
    ADD CONSTRAINT order_incidents_pkey PRIMARY KEY (id);


--
-- Name: order_item_cost_imputations order_item_cost_imputations_order_item_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_cost_imputations
    ADD CONSTRAINT order_item_cost_imputations_order_item_id_unique UNIQUE (order_item_id);


--
-- Name: order_item_cost_imputations order_item_cost_imputations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_cost_imputations
    ADD CONSTRAINT order_item_cost_imputations_pkey PRIMARY KEY (id);


--
-- Name: order_item_real_cost_allocations order_item_real_cost_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_real_cost_allocations
    ADD CONSTRAINT order_item_real_cost_allocations_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_scan_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_scan_code_key UNIQUE (scan_code);


--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: orders orders_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_reference_key UNIQUE (reference);


--
-- Name: otp_codes otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: parcel_events parcel_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_events
    ADD CONSTRAINT parcel_events_pkey PRIMARY KEY (id);


--
-- Name: parcel_items parcel_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_items
    ADD CONSTRAINT parcel_items_pkey PRIMARY KEY (id);


--
-- Name: parcels parcels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_pkey PRIMARY KEY (id);


--
-- Name: parcels parcels_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_reference_key UNIQUE (reference);


--
-- Name: partners partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_pkey PRIMARY KEY (id);


--
-- Name: paypal_events_processed paypal_events_processed_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paypal_events_processed
    ADD CONSTRAINT paypal_events_processed_pkey PRIMARY KEY (event_id);


--
-- Name: physical_offers physical_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_offers
    ADD CONSTRAINT physical_offers_pkey PRIMARY KEY (id);


--
-- Name: physical_outcome_receipts physical_outcome_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_outcome_receipts
    ADD CONSTRAINT physical_outcome_receipts_pkey PRIMARY KEY (id);


--
-- Name: pickup_print_tokens pickup_print_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_print_tokens
    ADD CONSTRAINT pickup_print_tokens_pkey PRIMARY KEY (token);


--
-- Name: pickup_reveal_codes pickup_reveal_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_reveal_codes
    ADD CONSTRAINT pickup_reveal_codes_pkey PRIMARY KEY (order_id);


--
-- Name: pickup_verify_attempts pickup_verify_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_verify_attempts
    ADD CONSTRAINT pickup_verify_attempts_pkey PRIMARY KEY (attempt_key);


--
-- Name: price_history price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_pkey PRIMARY KEY (id);


--
-- Name: pricing_benchmarks pricing_benchmarks_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_benchmarks
    ADD CONSTRAINT pricing_benchmarks_key_key UNIQUE (key);


--
-- Name: pricing_benchmarks pricing_benchmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_benchmarks
    ADD CONSTRAINT pricing_benchmarks_pkey PRIMARY KEY (id);


--
-- Name: pricing_category_dims pricing_category_dims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_category_dims
    ADD CONSTRAINT pricing_category_dims_pkey PRIMARY KEY (category);


--
-- Name: pricing_category_taxes pricing_category_taxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_category_taxes
    ADD CONSTRAINT pricing_category_taxes_pkey PRIMARY KEY (category);


--
-- Name: pricing_components pricing_components_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_components
    ADD CONSTRAINT pricing_components_key_key UNIQUE (key);


--
-- Name: pricing_components pricing_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_components
    ADD CONSTRAINT pricing_components_pkey PRIMARY KEY (id);


--
-- Name: pricing_global_access_grants pricing_global_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_global_access_grants
    ADD CONSTRAINT pricing_global_access_grants_pkey PRIMARY KEY (user_id);


--
-- Name: pricing_market_decision_policy_events pricing_market_decision_policy_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_market_decision_policy_events
    ADD CONSTRAINT pricing_market_decision_policy_events_pkey PRIMARY KEY (id);


--
-- Name: pricing_market_decision_policy_events pricing_market_decision_policy_start_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_market_decision_policy_events
    ADD CONSTRAINT pricing_market_decision_policy_start_unique UNIQUE (market_id, effective_from);


--
-- Name: pricing_market_decision_policy_events pricing_market_decision_policy_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_market_decision_policy_events
    ADD CONSTRAINT pricing_market_decision_policy_version_unique UNIQUE (market_id, version);


--
-- Name: pricing_matrices_audit pricing_matrices_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_matrices_audit
    ADD CONSTRAINT pricing_matrices_audit_pkey PRIMARY KEY (id);


--
-- Name: pricing_maturity_disposition_events pricing_maturity_disposition_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_maturity_disposition_events
    ADD CONSTRAINT pricing_maturity_disposition_events_pkey PRIMARY KEY (id);


--
-- Name: pricing_strategies pricing_strategies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_strategies
    ADD CONSTRAINT pricing_strategies_pkey PRIMARY KEY (id);


--
-- Name: pricing_strategy_history pricing_strategy_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_strategy_history
    ADD CONSTRAINT pricing_strategy_history_pkey PRIMARY KEY (id);


--
-- Name: product_attributes product_attributes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attributes
    ADD CONSTRAINT product_attributes_pkey PRIMARY KEY (id);


--
-- Name: product_content_profile product_content_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_content_profile
    ADD CONSTRAINT product_content_profile_pkey PRIMARY KEY (id);


--
-- Name: product_content_sections product_content_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_content_sections
    ADD CONSTRAINT product_content_sections_pkey PRIMARY KEY (id);


--
-- Name: product_market_exposure product_market_exposure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_exposure
    ADD CONSTRAINT product_market_exposure_pkey PRIMARY KEY (id);


--
-- Name: product_market_exposure product_market_exposure_product_id_market_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_exposure
    ADD CONSTRAINT product_market_exposure_product_id_market_id_key UNIQUE (product_id, market_id);


--
-- Name: product_market_price_draft_events product_market_price_draft_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_price_draft_events
    ADD CONSTRAINT product_market_price_draft_events_pkey PRIMARY KEY (id);


--
-- Name: product_market_price_drafts product_market_price_drafts_market_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_price_drafts
    ADD CONSTRAINT product_market_price_drafts_market_id_product_id_key UNIQUE (market_id, product_id);


--
-- Name: product_market_price_drafts product_market_price_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_price_drafts
    ADD CONSTRAINT product_market_price_drafts_pkey PRIMARY KEY (id);


--
-- Name: product_sku_media product_sku_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sku_media
    ADD CONSTRAINT product_sku_media_pkey PRIMARY KEY (id);


--
-- Name: product_skus product_skus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_skus
    ADD CONSTRAINT product_skus_pkey PRIMARY KEY (id);


--
-- Name: product_suppliers product_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_suppliers
    ADD CONSTRAINT product_suppliers_pkey PRIMARY KEY (id);


--
-- Name: product_suppliers product_suppliers_product_id_supplier_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_suppliers
    ADD CONSTRAINT product_suppliers_product_id_supplier_id_key UNIQUE (product_id, supplier_id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_unique_value; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_unique_value UNIQUE (product_id, variant_type, variant_value);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_product_ref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_product_ref_unique UNIQUE (product_ref);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: provider_credentials provider_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_credentials
    ADD CONSTRAINT provider_credentials_pkey PRIMARY KEY (credential_ref);


--
-- Name: providers providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);


--
-- Name: purchase_lines purchase_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_lines
    ADD CONSTRAINT purchase_lines_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: recipients recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipients
    ADD CONSTRAINT recipients_pkey PRIMARY KEY (id);


--
-- Name: refund_execution_intents refund_execution_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_execution_intents
    ADD CONSTRAINT refund_execution_intents_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_order_refund_type_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_order_refund_type_unique UNIQUE (order_id, refund_type);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_stripe_refund_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_stripe_refund_id_unique UNIQUE (stripe_refund_id);


--
-- Name: relais relais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relais
    ADD CONSTRAINT relais_pkey PRIMARY KEY (id);


--
-- Name: revoked_tokens revoked_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revoked_tokens
    ADD CONSTRAINT revoked_tokens_pkey PRIMARY KEY (jti);


--
-- Name: risk_provisions risk_provisions_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_provisions
    ADD CONSTRAINT risk_provisions_key_key UNIQUE (key);


--
-- Name: risk_provisions risk_provisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_provisions
    ADD CONSTRAINT risk_provisions_pkey PRIMARY KEY (id);


--
-- Name: scan_events scan_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_events
    ADD CONSTRAINT scan_events_pkey PRIMARY KEY (id);


--
-- Name: scans scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: supplier_catalog_import_rejections scir_import_source_index_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_catalog_import_rejections
    ADD CONSTRAINT scir_import_source_index_unique UNIQUE (import_id, source_index);


--
-- Name: sourcing_candidate_observations sco_import_source_index_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidate_observations
    ADD CONSTRAINT sco_import_source_index_unique UNIQUE (import_id, source_index);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: shared_cart_events shared_cart_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_cart_events
    ADD CONSTRAINT shared_cart_events_pkey PRIMARY KEY (id);


--
-- Name: shared_cart_items shared_cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_cart_items
    ADD CONSTRAINT shared_cart_items_pkey PRIMARY KEY (id);


--
-- Name: shared_cart_saved_access shared_cart_saved_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_cart_saved_access
    ADD CONSTRAINT shared_cart_saved_access_pkey PRIMARY KEY (id);


--
-- Name: shared_carts shared_carts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_carts
    ADD CONSTRAINT shared_carts_pkey PRIMARY KEY (id);


--
-- Name: shared_carts shared_carts_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_carts
    ADD CONSTRAINT shared_carts_token_key UNIQUE (token);


--
-- Name: shipment_batches shipment_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_batches
    ADD CONSTRAINT shipment_batches_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_reference_key UNIQUE (reference);


--
-- Name: signals signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_pkey PRIMARY KEY (id);


--
-- Name: sms_log sms_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_log
    ADD CONSTRAINT sms_log_pkey PRIMARY KEY (id);


--
-- Name: sourcing_candidate_events sourcing_candidate_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidate_events
    ADD CONSTRAINT sourcing_candidate_events_pkey PRIMARY KEY (id);


--
-- Name: sourcing_candidate_observations sourcing_candidate_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidate_observations
    ADD CONSTRAINT sourcing_candidate_observations_pkey PRIMARY KEY (id);


--
-- Name: sourcing_candidates sourcing_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidates
    ADD CONSTRAINT sourcing_candidates_pkey PRIMARY KEY (id);


--
-- Name: sourcing_canonical_entities sourcing_canonical_entities_id_grain_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_canonical_entities
    ADD CONSTRAINT sourcing_canonical_entities_id_grain_uniq UNIQUE (canonical_entity_id, grain);


--
-- Name: sourcing_canonical_entities sourcing_canonical_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_canonical_entities
    ADD CONSTRAINT sourcing_canonical_entities_pkey PRIMARY KEY (canonical_entity_id);


--
-- Name: sourcing_canonical_entity_refs sourcing_canonical_entity_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_canonical_entity_refs
    ADD CONSTRAINT sourcing_canonical_entity_refs_pkey PRIMARY KEY (source_id, ref_kind, ref_value);


--
-- Name: sourcing_captures sourcing_captures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_captures
    ADD CONSTRAINT sourcing_captures_pkey PRIMARY KEY (capture_id);


--
-- Name: sourcing_commercial_principals sourcing_commercial_principals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_commercial_principals
    ADD CONSTRAINT sourcing_commercial_principals_pkey PRIMARY KEY (principal_id);


--
-- Name: sourcing_global_access_grants sourcing_global_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_global_access_grants
    ADD CONSTRAINT sourcing_global_access_grants_pkey PRIMARY KEY (user_id);


--
-- Name: sourcing_identity_constraints sourcing_identity_constraints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_identity_constraints
    ADD CONSTRAINT sourcing_identity_constraints_pkey PRIMARY KEY (identity_constraint_id);


--
-- Name: sourcing_match_proposals sourcing_match_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_match_proposals
    ADD CONSTRAINT sourcing_match_proposals_pkey PRIMARY KEY (proposal_id);


--
-- Name: sourcing_match_proposals sourcing_match_proposals_run_candidate_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_match_proposals
    ADD CONSTRAINT sourcing_match_proposals_run_candidate_uniq UNIQUE (proposal_run_id, observation_id, candidate_entity_id);


--
-- Name: sourcing_merge_policies sourcing_merge_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_merge_policies
    ADD CONSTRAINT sourcing_merge_policies_pkey PRIMARY KEY (policy_id);


--
-- Name: sourcing_observation_evidence sourcing_observation_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_observation_evidence
    ADD CONSTRAINT sourcing_observation_evidence_pkey PRIMARY KEY (evidence_id);


--
-- Name: sourcing_observation_evidence sourcing_observation_evidence_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_observation_evidence
    ADD CONSTRAINT sourcing_observation_evidence_unique UNIQUE (observation_id, evidence_type, evidence_key, value, extractor_version);


--
-- Name: sourcing_observations sourcing_observations_identity_capture_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_observations
    ADD CONSTRAINT sourcing_observations_identity_capture_uniq UNIQUE (observation_id, capture_id);


--
-- Name: sourcing_observations sourcing_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_observations
    ADD CONSTRAINT sourcing_observations_pkey PRIMARY KEY (observation_id);


--
-- Name: sourcing_provider_control_events sourcing_provider_control_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_provider_control_events
    ADD CONSTRAINT sourcing_provider_control_events_pkey PRIMARY KEY (event_id);


--
-- Name: sourcing_resolution_bindings sourcing_resolution_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_bindings
    ADD CONSTRAINT sourcing_resolution_bindings_pkey PRIMARY KEY (binding_id);


--
-- Name: sourcing_resolution_decisions sourcing_resolution_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_decisions
    ADD CONSTRAINT sourcing_resolution_decisions_pkey PRIMARY KEY (decision_id);


--
-- Name: sourcing_source_execution_modes sourcing_source_execution_modes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_source_execution_modes
    ADD CONSTRAINT sourcing_source_execution_modes_pkey PRIMARY KEY (source_id, mode);


--
-- Name: sourcing_source_principal_refs sourcing_source_principal_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_source_principal_refs
    ADD CONSTRAINT sourcing_source_principal_refs_pkey PRIMARY KEY (source_id, principal_ref);


--
-- Name: sourcing_source_provides sourcing_source_provides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_source_provides
    ADD CONSTRAINT sourcing_source_provides_pkey PRIMARY KEY (source_id, layer);


--
-- Name: sourcing_source_requests sourcing_source_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_source_requests
    ADD CONSTRAINT sourcing_source_requests_pkey PRIMARY KEY (request_id);


--
-- Name: sourcing_sources sourcing_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_sources
    ADD CONSTRAINT sourcing_sources_pkey PRIMARY KEY (source_id);


--
-- Name: store_credits store_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_credits
    ADD CONSTRAINT store_credits_pkey PRIMARY KEY (id);


--
-- Name: stripe_events_processed stripe_events_processed_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events_processed
    ADD CONSTRAINT stripe_events_processed_pkey PRIMARY KEY (stripe_event_id);


--
-- Name: supplier_catalog_import_rejections supplier_catalog_import_rejections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_catalog_import_rejections
    ADD CONSTRAINT supplier_catalog_import_rejections_pkey PRIMARY KEY (id);


--
-- Name: supplier_catalog_imports supplier_catalog_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_catalog_imports
    ADD CONSTRAINT supplier_catalog_imports_pkey PRIMARY KEY (id);


--
-- Name: supplier_catalog_imports supplier_catalog_imports_profile_traceability_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.supplier_catalog_imports
    ADD CONSTRAINT supplier_catalog_imports_profile_traceability_check CHECK (((source_type <> 'json'::text) OR ((profile_id IS NOT NULL) AND (profile_version IS NOT NULL) AND (profile_hash IS NOT NULL)))) NOT VALID;


--
-- Name: supplier_catalog_sync_checkpoints supplier_catalog_sync_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_catalog_sync_checkpoints
    ADD CONSTRAINT supplier_catalog_sync_checkpoints_pkey PRIMARY KEY (supplier_name, sync_key, category_id);


--
-- Name: supplier_commercial_category_mappings supplier_commercial_category_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_commercial_category_mappings
    ADD CONSTRAINT supplier_commercial_category_mappings_pkey PRIMARY KEY (id);


--
-- Name: supplier_commercial_category_mappings supplier_commercial_mapping_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_commercial_category_mappings
    ADD CONSTRAINT supplier_commercial_mapping_unique UNIQUE (provider, source_category_path);


--
-- Name: supplier_execution_events supplier_execution_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_events
    ADD CONSTRAINT supplier_execution_events_pkey PRIMARY KEY (id);


--
-- Name: supplier_execution_fulfillments supplier_execution_fulfillments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_fulfillments
    ADD CONSTRAINT supplier_execution_fulfillments_pkey PRIMARY KEY (id);


--
-- Name: supplier_execution_group_members supplier_execution_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_group_members
    ADD CONSTRAINT supplier_execution_group_members_pkey PRIMARY KEY (supplier_execution_group_id, supplier_execution_order_id);


--
-- Name: supplier_execution_groups supplier_execution_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_groups
    ADD CONSTRAINT supplier_execution_groups_pkey PRIMARY KEY (id);


--
-- Name: supplier_execution_order_lines supplier_execution_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_order_lines
    ADD CONSTRAINT supplier_execution_order_lines_pkey PRIMARY KEY (supplier_execution_order_id, purchase_line_id);


--
-- Name: supplier_execution_orders supplier_execution_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_orders
    ADD CONSTRAINT supplier_execution_orders_pkey PRIMARY KEY (id);


--
-- Name: supplier_execution_payment_proofs supplier_execution_payment_proofs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_payment_proofs
    ADD CONSTRAINT supplier_execution_payment_proofs_pkey PRIMARY KEY (id);


--
-- Name: supplier_execution_payments supplier_execution_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_payments
    ADD CONSTRAINT supplier_execution_payments_pkey PRIMARY KEY (id);


--
-- Name: supplier_oauth_connections supplier_oauth_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_oauth_connections
    ADD CONSTRAINT supplier_oauth_connections_pkey PRIMARY KEY (supplier_key);


--
-- Name: supplier_payment_settlements supplier_payment_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payment_settlements
    ADD CONSTRAINT supplier_payment_settlements_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: transaction_documents transaction_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents
    ADD CONSTRAINT transaction_documents_pkey PRIMARY KEY (id);


--
-- Name: transaction_documents transaction_documents_subject_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents
    ADD CONSTRAINT transaction_documents_subject_unique UNIQUE (document_type, subject_type, subject_id);


--
-- Name: parcel_items unique_order_item_per_parcel; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_items
    ADD CONSTRAINT unique_order_item_per_parcel UNIQUE (order_item_id);


--
-- Name: cart_shares unique_share_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_shares
    ADD CONSTRAINT unique_share_token UNIQUE (share_token);


--
-- Name: unsold_items unsold_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unsold_items
    ADD CONSTRAINT unsold_items_pkey PRIMARY KEY (id);


--
-- Name: customs_shipment_fees uq_csf_shipment_idem; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_fees
    ADD CONSTRAINT uq_csf_shipment_idem UNIQUE (shipment_id, idempotency_key);


--
-- Name: import_runtime_item_events uq_import_runtime_item_events_run_seq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runtime_item_events
    ADD CONSTRAINT uq_import_runtime_item_events_run_seq UNIQUE (run_id, seq);


--
-- Name: international_shipment_charges uq_international_charge_idem; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_charges
    ADD CONSTRAINT uq_international_charge_idem UNIQUE (shipment_id, idempotency_key);


--
-- Name: international_shipments uq_international_customs_shipment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipments
    ADD CONSTRAINT uq_international_customs_shipment UNIQUE (customs_shipment_id);


--
-- Name: international_shipments uq_international_market_reference; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipments
    ADD CONSTRAINT uq_international_market_reference UNIQUE (market_id, reference);


--
-- Name: international_n1_allocation_links uq_international_n1_share; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_n1_allocation_links
    ADD CONSTRAINT uq_international_n1_share UNIQUE (shipment_id, component, fee_type, parcel_id, order_item_id);


--
-- Name: international_shipment_parcels uq_international_parcel; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_parcels
    ADD CONSTRAINT uq_international_parcel UNIQUE (parcel_id);


--
-- Name: international_shipment_hub_units uq_international_shipment_hub_unit; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_hub_units
    ADD CONSTRAINT uq_international_shipment_hub_unit UNIQUE (physical_unit_id);


--
-- Name: orders uq_orders_reference; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT uq_orders_reference UNIQUE (reference);


--
-- Name: outbox_events uq_outbox_events_aggregate_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT uq_outbox_events_aggregate_sequence UNIQUE (aggregate_type, aggregate_id, aggregate_sequence);


--
-- Name: physical_outcome_receipts uq_physical_outcome_receipts_event_consumer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_outcome_receipts
    ADD CONSTRAINT uq_physical_outcome_receipts_event_consumer UNIQUE (event_id, consumer_key);


--
-- Name: refund_execution_intents uq_refund_intents_provider_operation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_execution_intents
    ADD CONSTRAINT uq_refund_intents_provider_operation UNIQUE (provider, operation_key);


--
-- Name: supplier_payment_settlements uq_sps_payment_idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payment_settlements
    ADD CONSTRAINT uq_sps_payment_idempotency UNIQUE (supplier_execution_payment_id, idempotency_key);


--
-- Name: user_pickup_authorizations user_pickup_authorizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pickup_authorizations
    ADD CONSTRAINT user_pickup_authorizations_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wallet_consumptions wallet_consumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_consumptions
    ADD CONSTRAINT wallet_consumptions_pkey PRIMARY KEY (id);


--
-- Name: wallet_credit_lots wallet_credit_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_credit_lots
    ADD CONSTRAINT wallet_credit_lots_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_key UNIQUE (user_id);


--
-- Name: webauthn_challenges webauthn_challenges_challenge_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_challenge_key UNIQUE (challenge);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_credential_id_key UNIQUE (credential_id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: catalog_media_visual_fr_reviews_reviewed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_media_visual_fr_reviews_reviewed_at_idx ON public.catalog_media_visual_fr_reviews USING btree (reviewed_at);


--
-- Name: idx_alerts_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_entity ON public.alerts USING btree (entity_type, entity_id);


--
-- Name: idx_alerts_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_open ON public.alerts USING btree (resolved_at) WHERE (resolved_at IS NULL);


--
-- Name: idx_alerts_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_severity ON public.alerts USING btree (severity);


--
-- Name: idx_assignment_memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_memberships_user ON public.assignment_memberships USING btree (user_id, status);


--
-- Name: idx_basket_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_basket_code ON public.baskets USING btree (code);


--
-- Name: idx_benchmarks_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_category ON public.pricing_benchmarks USING btree (category, display_order);


--
-- Name: idx_benchmarks_importance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_importance ON public.pricing_benchmarks USING btree (importance);


--
-- Name: idx_boutique_subcategories_customs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_boutique_subcategories_customs_category ON public.boutique_subcategories USING btree (customs_category_key) WHERE (customs_category_key IS NOT NULL);


--
-- Name: idx_carriers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carriers_active ON public.carriers USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_cart_shares_converted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_shares_converted ON public.cart_shares USING btree (converted_order_id) WHERE (converted_order_id IS NOT NULL);


--
-- Name: idx_cart_shares_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_shares_created ON public.cart_shares USING btree (created_at DESC);


--
-- Name: idx_cart_shares_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_shares_token ON public.cart_shares USING btree (share_token);


--
-- Name: idx_cash_alloc_collection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_alloc_collection ON public.cash_deposit_allocations USING btree (collection_id);


--
-- Name: idx_cash_alloc_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_alloc_market ON public.cash_deposit_allocations USING btree (market_id);


--
-- Name: idx_cash_coll_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_coll_agent ON public.cash_collections USING btree (collected_by);


--
-- Name: idx_cash_coll_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_coll_date ON public.cash_collections USING btree (confirmed_at DESC);


--
-- Name: idx_cash_coll_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_cash_coll_order ON public.cash_collections USING btree (order_id);


--
-- Name: idx_cash_confirmation_controls_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_confirmation_controls_market ON public.cash_confirmation_controls USING btree (market_id, state, updated_at DESC);


--
-- Name: idx_cash_confirmation_controls_relais; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_confirmation_controls_relais ON public.cash_confirmation_controls USING btree (relais_id, state, updated_at DESC);


--
-- Name: idx_cash_custody_losses_holder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_custody_losses_holder ON public.cash_custody_losses USING btree (holder_id, market_id);


--
-- Name: idx_cash_custody_receipts_deposit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_custody_receipts_deposit ON public.cash_custody_receipts USING btree (deposit_id, kind);


--
-- Name: idx_cash_custody_receipts_reverses; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_custody_receipts_reverses ON public.cash_custody_receipts USING btree (reverses_id) WHERE (reverses_id IS NOT NULL);


--
-- Name: idx_cash_dep_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_dep_agent ON public.cash_deposits USING btree (agent_id);


--
-- Name: idx_cash_dep_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_dep_market ON public.cash_deposits USING btree (market_id) WHERE (market_id IS NOT NULL);


--
-- Name: idx_cash_dep_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_dep_period ON public.cash_deposits USING btree (period_start, period_end);


--
-- Name: idx_cash_dep_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_dep_recipient ON public.cash_deposits USING btree (recipient_user_id) WHERE (recipient_user_id IS NOT NULL);


--
-- Name: idx_cash_dep_regularizes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_dep_regularizes ON public.cash_deposits USING btree (regularizes_deposit_id) WHERE (regularizes_deposit_id IS NOT NULL);


--
-- Name: idx_cash_dep_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_dep_status ON public.cash_deposits USING btree (status);


--
-- Name: idx_cash_provenance_collection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_provenance_collection ON public.cash_custody_provenance_edges USING btree (collection_id);


--
-- Name: idx_cash_provenance_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_provenance_parent ON public.cash_custody_provenance_edges USING btree (parent_id);


--
-- Name: idx_cash_provenance_receipt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_provenance_receipt ON public.cash_custody_provenance_edges USING btree (receipt_id);


--
-- Name: idx_cash_recon_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_recon_agent ON public.cash_reconciliation USING btree (agent_id);


--
-- Name: idx_cash_recon_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_recon_period ON public.cash_reconciliation USING btree (period_start, period_end);


--
-- Name: idx_cash_recon_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_recon_status ON public.cash_reconciliation USING btree (status);


--
-- Name: idx_catalog_field_sync_state_observation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_catalog_field_sync_state_observation ON public.catalog_field_sync_state USING btree (last_observation_id, field_name);


--
-- Name: idx_catalog_global_access_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_global_access_user ON public.catalog_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_catalog_media_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_media_product ON public.catalog_media USING btree (product_id, display_order);


--
-- Name: idx_catalog_media_recovery_audit_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_media_recovery_audit_product ON public.catalog_media_recovery_audit USING btree (product_id, created_at DESC);


--
-- Name: idx_catalog_overrides_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_overrides_product ON public.catalog_field_overrides USING btree (product_id);


--
-- Name: idx_catalog_publication_decision_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_publication_decision_audit_actor ON public.catalog_publication_decision_audit USING btree (actor_user_id, created_at DESC) WHERE (actor_user_id IS NOT NULL);


--
-- Name: idx_catalog_publication_decision_audit_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_publication_decision_audit_product ON public.catalog_publication_decision_audit USING btree (product_id, created_at DESC);


--
-- Name: idx_catalog_stock_sync_state_observation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_catalog_stock_sync_state_observation ON public.catalog_stock_sync_state USING btree (last_observation_id);


--
-- Name: idx_catalog_taxonomy_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_taxonomy_audit_actor ON public.catalog_taxonomy_audit USING btree (actor_user_id, created_at DESC) WHERE (actor_user_id IS NOT NULL);


--
-- Name: idx_catalog_taxonomy_audit_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_taxonomy_audit_category ON public.catalog_taxonomy_audit USING btree (category_key, created_at DESC);


--
-- Name: idx_catalog_taxonomy_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_taxonomy_audit_created ON public.catalog_taxonomy_audit USING btree (created_at DESC);


--
-- Name: idx_catalog_terminology_reference_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_terminology_reference_domain ON public.catalog_terminology_reference USING btree (source, dataset_domain) WHERE (is_active = true);


--
-- Name: idx_catalog_terminology_reference_subject_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_terminology_reference_subject_en ON public.catalog_terminology_reference USING btree (subject_en) WHERE (is_active = true);


--
-- Name: idx_catalog_terminology_reference_term_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_terminology_reference_term_en ON public.catalog_terminology_reference USING btree (term_en_normalized) WHERE (is_active = true);


--
-- Name: idx_charges_market_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_charges_market_name_unique ON public.charges USING btree (market_owner_id, lower(name)) WHERE ((market_owner_id IS NOT NULL) AND (is_active = true));


--
-- Name: idx_charges_market_owner_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charges_market_owner_active ON public.charges USING btree (market_owner_id, is_active) WHERE (market_owner_id IS NOT NULL);


--
-- Name: idx_client_notifications_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_notifications_entity ON public.client_notifications USING btree (entity_type, entity_id);


--
-- Name: idx_client_notifications_user_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_notifications_user_open ON public.client_notifications USING btree (user_id, severity, created_at DESC) WHERE (status = 'open'::text);


--
-- Name: idx_comments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_order ON public.order_comments USING btree (order_id);


--
-- Name: idx_competitor_prices_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_prices_category ON public.competitor_prices USING btree (category, observed_at DESC) WHERE ((is_active = true) AND (category IS NOT NULL));


--
-- Name: idx_competitor_prices_competitor_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_competitor_prices_competitor_ref ON public.competitor_prices USING btree (competitor_ref);


--
-- Name: idx_competitor_prices_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_prices_product ON public.competitor_prices USING btree (product_id, observed_at DESC) WHERE (is_active = true);


--
-- Name: idx_cost_benchmarks_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_benchmarks_active ON public.cost_benchmarks USING btree (category, cost_family) WHERE (is_active = true);


--
-- Name: idx_cost_component_events_component; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_component_events_component ON public.cost_component_events USING btree (component_id, created_at DESC);


--
-- Name: idx_cost_component_market_override_events_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_component_market_override_events_market ON public.cost_component_market_override_events USING btree (market_id, created_at DESC);


--
-- Name: idx_cost_component_market_overrides_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_component_market_overrides_market ON public.cost_component_market_overrides USING btree (market_id, component_id);


--
-- Name: idx_cost_components_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_components_active ON public.cost_components USING btree (is_active, family, category, display_order);


--
-- Name: idx_cost_components_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_components_channel ON public.cost_components USING btree (channel) WHERE is_active;


--
-- Name: idx_cost_components_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_components_scope ON public.cost_components USING btree (scope, scope_value) WHERE is_active;


--
-- Name: idx_csf_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_csf_shipment ON public.customs_shipment_fees USING btree (shipment_id, fee_type);


--
-- Name: idx_csp_parcel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_csp_parcel ON public.customs_shipment_parcels USING btree (parcel_id);


--
-- Name: idx_csp_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_csp_shipment ON public.customs_shipment_parcels USING btree (shipment_id);


--
-- Name: idx_customs_categories_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_categories_key ON public.customs_categories USING btree (key) WHERE (is_active = true);


--
-- Name: idx_customs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_date ON public.customs_history USING btree (customs_date DESC);


--
-- Name: idx_customs_financial_audit_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_financial_audit_shipment ON public.customs_shipment_financial_audit USING btree (shipment_id, changed_at DESC);


--
-- Name: idx_customs_history_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_history_agent ON public.customs_history USING btree (customs_agent_id) WHERE (customs_agent_id IS NOT NULL);


--
-- Name: idx_customs_history_anomaly; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_history_anomaly ON public.customs_history USING btree (is_anomaly) WHERE (is_anomaly = true);


--
-- Name: idx_customs_history_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_history_category ON public.customs_history USING btree (sh_category);


--
-- Name: idx_customs_history_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_history_date ON public.customs_history USING btree (customs_date);


--
-- Name: idx_customs_history_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_history_order ON public.customs_history USING btree (order_id);


--
-- Name: idx_customs_history_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_history_shipment ON public.customs_history USING btree (shipment_id);


--
-- Name: idx_customs_parcel_events_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_parcel_events_shipment ON public.customs_shipment_parcel_events USING btree (shipment_id, created_at DESC);


--
-- Name: idx_customs_ship_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_ship_active ON public.customs_shipments USING btree (is_active) WHERE is_active;


--
-- Name: idx_customs_ship_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_ship_date ON public.customs_shipments USING btree (shipment_date DESC);


--
-- Name: idx_customs_ship_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_ship_ref ON public.customs_shipments USING btree (reference);


--
-- Name: idx_customs_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_shipment ON public.customs_history USING btree (shipment_id) WHERE (shipment_id IS NOT NULL);


--
-- Name: idx_customs_shipments_market_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_shipments_market_id ON public.customs_shipments USING btree (market_id, shipment_date DESC);


--
-- Name: idx_customs_shipments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_shipments_status ON public.customs_shipments USING btree (status) WHERE (status = 'pending'::public.customs_shipment_status);


--
-- Name: idx_customs_shipments_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_shipments_supplier ON public.customs_shipments USING btree (supplier_id) WHERE (supplier_id IS NOT NULL);


--
-- Name: idx_customs_statut; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customs_statut ON public.customs_history USING btree (statut) WHERE (statut IS NOT NULL);


--
-- Name: idx_dashboard_global_access_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_global_access_user ON public.dashboard_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_decision_signal_global_access_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_decision_signal_global_access_active ON public.decision_signal_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_disputes_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputes_order ON public.disputes USING btree (order_id);


--
-- Name: idx_disputes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputes_status ON public.disputes USING btree (status);


--
-- Name: idx_economic_risk_cost_adjusts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_risk_cost_adjusts ON public.economic_risk_cost_events USING btree (adjusts_event_id) WHERE (adjusts_event_id IS NOT NULL);


--
-- Name: idx_economic_risk_cost_market_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_risk_cost_market_time ON public.economic_risk_cost_events USING btree (market_id, economic_at, recorded_at);


--
-- Name: idx_economic_risk_cost_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_risk_cost_order ON public.economic_risk_cost_events USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_economic_risk_cost_provision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_risk_cost_provision ON public.economic_risk_cost_events USING btree (risk_provision_id) WHERE (risk_provision_id IS NOT NULL);


--
-- Name: idx_economic_risk_watermark_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_risk_watermark_market ON public.economic_risk_watermark_events USING btree (market_id, closed_through DESC, recorded_at DESC, id DESC);


--
-- Name: idx_economic_snapshots_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_snapshots_created_at ON public.economic_snapshots USING btree (created_at);


--
-- Name: idx_enrichment_runs_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_runs_product ON public.catalog_enrichment_runs USING btree (product_id, created_at DESC);


--
-- Name: idx_fabrics_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fabrics_available ON public.fabrics USING btree (fabric_type, sort_order) WHERE (is_available = true);


--
-- Name: idx_fx_public_reference_quote_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fx_public_reference_quote_latest ON public.fx_public_reference_quotes USING btree (quote_ccy, as_of DESC);


--
-- Name: idx_hub_custody_events_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_custody_events_operation ON public.hub_custody_events USING btree (operation_id) WHERE (operation_id IS NOT NULL);


--
-- Name: idx_hub_custody_events_unit_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_custody_events_unit_time ON public.hub_custody_events USING btree (physical_unit_id, created_at, id);


--
-- Name: idx_hub_physical_units_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_physical_units_market ON public.hub_physical_units USING btree (market_id) WHERE (market_id IS NOT NULL);


--
-- Name: idx_hub_physical_units_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_physical_units_state ON public.hub_physical_units USING btree (state);


--
-- Name: idx_hub_placements_allocation_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_placements_allocation_active ON public.hub_physical_unit_placements USING btree (allocation_id, physical_unit_id) WHERE (removed_at IS NULL);


--
-- Name: idx_hub_placements_unit_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_placements_unit_active ON public.hub_physical_unit_placements USING btree (physical_unit_id, allocation_id) WHERE (removed_at IS NULL);


--
-- Name: idx_hub_purchase_allocations_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_purchase_allocations_market ON public.hub_purchase_allocations USING btree (market_id);


--
-- Name: idx_hub_purchase_allocations_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_purchase_allocations_order ON public.hub_purchase_allocations USING btree (order_id, order_item_id);


--
-- Name: idx_import_runtime_item_events_run_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_runtime_item_events_run_seq ON public.import_runtime_item_events USING btree (run_id, seq DESC);


--
-- Name: idx_import_runtime_runs_import; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_runtime_runs_import ON public.import_runtime_runs USING btree (import_id);


--
-- Name: idx_import_runtime_runs_run_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_import_runtime_runs_run_ref ON public.import_runtime_runs USING btree (run_ref);


--
-- Name: idx_import_runtime_runs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_runtime_runs_started ON public.import_runtime_runs USING btree (started_at DESC);


--
-- Name: idx_incidents_critical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_critical ON public.incidents USING btree (severity, status) WHERE ((severity = ANY (ARRAY['high'::text, 'critical'::text])) AND (status = 'open'::text));


--
-- Name: idx_incidents_governance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_governance ON public.incidents USING btree (origin_domain, resolution_class) WHERE (status = ANY (ARRAY['open'::text, 'investigating'::text]));


--
-- Name: idx_incidents_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_open ON public.incidents USING btree (status) WHERE (status = ANY (ARRAY['open'::text, 'investigating'::text]));


--
-- Name: idx_incidents_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_order ON public.order_incidents USING btree (order_id);


--
-- Name: idx_incidents_overdue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_overdue ON public.incidents USING btree (due_at) WHERE ((status = ANY (ARRAY['open'::text, 'investigating'::text])) AND (due_at IS NOT NULL));


--
-- Name: idx_incidents_parcel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_parcel ON public.incidents USING btree (parcel_id);


--
-- Name: idx_incidents_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_severity ON public.incidents USING btree (severity);


--
-- Name: idx_incidents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_status ON public.order_incidents USING btree (status);


--
-- Name: idx_incidents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_type ON public.incidents USING btree (incident_type);


--
-- Name: idx_inquiries_physical_offer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inquiries_physical_offer ON public.inquiries USING btree (physical_offer_id);


--
-- Name: idx_inquiries_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inquiries_service ON public.inquiries USING btree (service_id);


--
-- Name: idx_international_charges_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_international_charges_shipment ON public.international_shipment_charges USING btree (shipment_id, recorded_at DESC);


--
-- Name: idx_international_events_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_international_events_shipment ON public.international_shipment_events USING btree (shipment_id, occurred_at DESC);


--
-- Name: idx_international_n1_links_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_international_n1_links_shipment ON public.international_n1_allocation_links USING btree (shipment_id);


--
-- Name: idx_international_shipment_hub_units_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_international_shipment_hub_units_shipment ON public.international_shipment_hub_units USING btree (shipment_id);


--
-- Name: idx_international_shipments_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_international_shipments_market ON public.international_shipments USING btree (market_id, created_at DESC);


--
-- Name: idx_inventory_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_order ON public.inventory_items USING btree (order_id);


--
-- Name: idx_inventory_order_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_order_item ON public.inventory_items USING btree (order_item_id);


--
-- Name: idx_inventory_parcel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_parcel ON public.inventory_items USING btree (parcel_id);


--
-- Name: idx_inventory_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_status ON public.inventory_items USING btree (status);


--
-- Name: idx_invoices_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_number ON public.invoices USING btree (invoice_number);


--
-- Name: idx_invoices_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_order ON public.invoices USING btree (order_id);


--
-- Name: idx_invoices_owner_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_owner_created ON public.invoices USING btree (owner_user_id, created_at DESC) WHERE (owner_user_id IS NOT NULL);


--
-- Name: idx_invoices_public_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_invoices_public_token ON public.invoices USING btree (public_token) WHERE (public_token IS NOT NULL);


--
-- Name: idx_local_stock_allocations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_stock_allocations_active ON public.local_stock_allocations USING btree (local_stock_id) WHERE ((consumed_at IS NULL) AND (released_at IS NULL));


--
-- Name: idx_local_stock_allocations_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_stock_allocations_order ON public.local_stock_allocations USING btree (order_id);


--
-- Name: idx_local_stock_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_stock_market ON public.local_stock USING btree (market_id);


--
-- Name: idx_loyalty_rewards_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_rewards_status ON public.loyalty_rewards USING btree (status);


--
-- Name: idx_loyalty_rewards_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_rewards_user ON public.loyalty_rewards USING btree (user_id);


--
-- Name: idx_market_cash_control_policies_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_cash_control_policies_market ON public.market_cash_control_policies USING btree (market_id, updated_at DESC);


--
-- Name: idx_market_cash_destinations_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_cash_destinations_market ON public.market_cash_destinations USING btree (market_id, status);


--
-- Name: idx_market_delegation_audit_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_delegation_audit_assignment ON public.market_delegation_audit USING btree (assignment_id, occurred_at DESC);


--
-- Name: idx_market_delegation_audit_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_delegation_audit_market ON public.market_delegation_audit USING btree (market_id, occurred_at DESC);


--
-- Name: idx_market_delivery_attestations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_delivery_attestations_active ON public.market_delivery_attestations USING btree (market_id, valid_until) WHERE (revoked_at IS NULL);


--
-- Name: idx_market_operating_assignments_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_operating_assignments_market ON public.market_operating_assignments USING btree (market_id, status, effective_from DESC);


--
-- Name: idx_market_payment_accounts_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_payment_accounts_market ON public.market_payment_accounts USING btree (market_id, status);


--
-- Name: idx_market_price_observation_events_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_price_observation_events_market ON public.market_price_observation_events USING btree (market_id, created_at DESC);


--
-- Name: idx_market_price_observations_market_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_price_observations_market_category ON public.market_price_observations USING btree (market_id, category, observed_at DESC) WHERE (is_active = true);


--
-- Name: idx_market_price_observations_market_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_price_observations_market_product ON public.market_price_observations USING btree (market_id, product_id, observed_at DESC) WHERE (is_active = true);


--
-- Name: idx_market_settlement_events_settlement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_settlement_events_settlement ON public.market_settlement_events USING btree (settlement_id, occurred_at);


--
-- Name: idx_market_settlements_assignment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_settlements_assignment_status ON public.market_settlements USING btree (assignment_id, status, created_at DESC);


--
-- Name: idx_market_settlements_market_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_settlements_market_status ON public.market_settlements USING btree (market_id, status, created_at DESC);


--
-- Name: idx_market_team_invitations_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_team_invitations_assignment ON public.market_team_invitations USING btree (assignment_id, status, created_at DESC);


--
-- Name: idx_market_team_invitations_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_team_invitations_expiry ON public.market_team_invitations USING btree (expires_at) WHERE (status = 'PENDING'::text);


--
-- Name: idx_mca_market_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mca_market_period ON public.market_cost_attributions USING btree (market_id, recorded_at);


--
-- Name: idx_mca_reversal_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mca_reversal_unique ON public.market_cost_attributions USING btree (reverses_id) WHERE (reverses_id IS NOT NULL);


--
-- Name: idx_mca_source_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mca_source_event ON public.market_cost_attributions USING btree (source_event_id);


--
-- Name: idx_mobile_money_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mobile_money_order ON public.mobile_money_transactions USING btree (order_id, created_at DESC);


--
-- Name: idx_mobile_money_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mobile_money_pending ON public.mobile_money_transactions USING btree (provider, status, created_at) WHERE (status = ANY (ARRAY['initiated'::text, 'pending'::text]));


--
-- Name: idx_notif_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_channel ON public.notification_log USING btree (channel);


--
-- Name: idx_notif_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_created ON public.notification_log USING btree (created_at DESC);


--
-- Name: idx_notif_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_log_created_at ON public.notification_log USING btree (created_at DESC);


--
-- Name: idx_notif_log_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_log_event ON public.notification_log USING btree (event);


--
-- Name: idx_notif_log_order_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_log_order_ref ON public.notification_log USING btree (order_ref);


--
-- Name: idx_notif_log_parcel_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_log_parcel_ref ON public.notification_log USING btree (parcel_ref);


--
-- Name: idx_notif_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_order ON public.notification_log USING btree (order_ref);


--
-- Name: idx_notif_parcel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_parcel ON public.notification_log USING btree (parcel_ref);


--
-- Name: idx_oc_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oc_order ON public.order_comments USING btree (order_id);


--
-- Name: idx_oi_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_order ON public.order_incidents USING btree (order_id);


--
-- Name: idx_oi_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_status ON public.order_incidents USING btree (status);


--
-- Name: idx_oici_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oici_created_at ON public.order_item_cost_imputations USING btree (created_at);


--
-- Name: idx_oici_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oici_order ON public.order_item_cost_imputations USING btree (order_id);


--
-- Name: idx_oici_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oici_product ON public.order_item_cost_imputations USING btree (product_id);


--
-- Name: idx_oirca_cost_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oirca_cost_type ON public.order_item_real_cost_allocations USING btree (cost_type);


--
-- Name: idx_oirca_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oirca_created_at ON public.order_item_real_cost_allocations USING btree (created_at);


--
-- Name: idx_oirca_is_actual; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oirca_is_actual ON public.order_item_real_cost_allocations USING btree (is_actual);


--
-- Name: idx_oirca_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oirca_item ON public.order_item_real_cost_allocations USING btree (order_item_id);


--
-- Name: idx_oirca_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oirca_order ON public.order_item_real_cost_allocations USING btree (order_id);


--
-- Name: idx_oirca_order_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oirca_order_item ON public.order_item_real_cost_allocations USING btree (order_item_id);


--
-- Name: idx_oirca_parcel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oirca_parcel ON public.order_item_real_cost_allocations USING btree (parcel_id) WHERE (parcel_id IS NOT NULL);


--
-- Name: idx_oirca_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oirca_shipment ON public.order_item_real_cost_allocations USING btree (shipment_id) WHERE (shipment_id IS NOT NULL);


--
-- Name: idx_operator_market_scopes_projected_membership; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operator_market_scopes_projected_membership ON public.operator_market_scopes USING btree (projected_from_membership_id) WHERE (projected_from_membership_id IS NOT NULL);


--
-- Name: idx_operator_scope_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operator_scope_market ON public.operator_market_scopes USING btree (market_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_order_cost_entry_events_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_cost_entry_events_order ON public.order_cost_entry_events USING btree (order_id, created_at);


--
-- Name: idx_order_items_allocated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_allocated ON public.order_items USING btree (qty_allocated) WHERE (qty_allocated > 0);


--
-- Name: idx_order_items_ceremony_retouche; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_ceremony_retouche ON public.order_items USING btree (module_retouche) WHERE (module_retouche = true);


--
-- Name: idx_order_items_ceremony_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_ceremony_type ON public.order_items USING btree (module_type) WHERE (module_type IS NOT NULL);


--
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product ON public.order_items USING btree (product_id);


--
-- Name: idx_order_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product_id ON public.order_items USING btree (product_id);


--
-- Name: idx_order_items_scan_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_scan_code ON public.order_items USING btree (scan_code);


--
-- Name: idx_order_items_sku_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_sku_id ON public.order_items USING btree (sku_id) WHERE (sku_id IS NOT NULL);


--
-- Name: idx_order_items_variant_combo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_variant_combo ON public.order_items USING gin (variant_combo) WHERE (variant_combo IS NOT NULL);


--
-- Name: idx_order_status_history_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_status_history_order_id ON public.order_status_history USING btree (order_id);


--
-- Name: idx_orders_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_active ON public.orders USING btree (created_at DESC) WHERE (status <> ALL (ARRAY['collected'::public.order_status, 'cancelled'::public.order_status]));


--
-- Name: idx_orders_cash_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_cash_pending ON public.orders USING btree (created_at) WHERE ((payment_mode = 'cash_relais'::public.payment_mode) AND (payment_status = 'pending'::public.payment_status));


--
-- Name: idx_orders_cash_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_cash_ref ON public.orders USING btree (cash_ref_code);


--
-- Name: idx_orders_cash_ref_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_cash_ref_code ON public.orders USING btree (cash_ref_code) WHERE (cash_ref_code IS NOT NULL);


--
-- Name: idx_orders_ceremony_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_ceremony_type ON public.orders USING btree (module_type) WHERE (module_type IS NOT NULL);


--
-- Name: idx_orders_confection_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_confection_type ON public.orders USING btree (confection_type) WHERE ((confection_type)::text <> 'aucun'::text);


--
-- Name: idx_orders_confirmed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_confirmed_at ON public.orders USING btree (confirmed_at) WHERE (confirmed_at IS NOT NULL);


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at);


--
-- Name: idx_orders_created_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_status ON public.orders USING btree (created_at DESC, status);


--
-- Name: idx_orders_margin_alert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_margin_alert ON public.orders USING btree (margin_alert) WHERE (margin_alert = true);


--
-- Name: idx_orders_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_market ON public.orders USING btree (market_id);


--
-- Name: idx_orders_occasion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_occasion ON public.orders USING btree (order_occasion) WHERE (order_occasion IS NOT NULL);


--
-- Name: idx_orders_payment_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_mode ON public.orders USING btree (payment_mode);


--
-- Name: idx_orders_payment_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_received ON public.orders USING btree (payment_received_at);


--
-- Name: idx_orders_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_status ON public.orders USING btree (payment_status);


--
-- Name: idx_orders_paypal_capture_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_paypal_capture_id ON public.orders USING btree (paypal_capture_id) WHERE (paypal_capture_id IS NOT NULL);


--
-- Name: idx_orders_paypal_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_paypal_order_id ON public.orders USING btree (paypal_order_id) WHERE (paypal_order_id IS NOT NULL);


--
-- Name: idx_orders_pickup_blocked_until; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_pickup_blocked_until ON public.orders USING btree (pickup_secret_blocked_until) WHERE (pickup_secret_blocked_until IS NOT NULL);


--
-- Name: idx_orders_pickup_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_pickup_channel ON public.orders USING btree (pickup_secret_channel);


--
-- Name: idx_orders_pickup_code_recipient_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_pickup_code_recipient_user ON public.orders USING btree (pickup_code_recipient_user_id) WHERE (pickup_code_recipient_user_id IS NOT NULL);


--
-- Name: idx_orders_pickup_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_pickup_created ON public.orders USING btree (pickup_secret_created_at);


--
-- Name: idx_orders_pickup_last4_relais; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_pickup_last4_relais ON public.orders USING btree (relais_id, pickup_secret_last4) WHERE (pickup_secret_last4 IS NOT NULL);


--
-- Name: idx_orders_qr_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_qr_token ON public.orders USING btree (qr_token) WHERE (qr_token IS NOT NULL);


--
-- Name: idx_orders_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_reference ON public.orders USING btree (reference);


--
-- Name: idx_orders_relais; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_relais ON public.orders USING btree (relais_id);


--
-- Name: idx_orders_relais_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_relais_status ON public.orders USING btree (relais_id, status);


--
-- Name: idx_orders_shared_cart; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_shared_cart ON public.orders USING btree (shared_cart_id);


--
-- Name: idx_orders_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_shipment ON public.orders USING btree (shipment_id);


--
-- Name: idx_orders_shipment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_shipment_id ON public.orders USING btree (shipment_id) WHERE (shipment_id IS NOT NULL);


--
-- Name: idx_orders_simulation_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_simulation_scope ON public.orders USING btree (simulation_scope) WHERE (simulation_scope IS NOT NULL);


--
-- Name: idx_orders_sourcing_blocked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_sourcing_blocked ON public.orders USING btree (sourcing_blocked) WHERE (sourcing_blocked = true);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_orders_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_created_at ON public.orders USING btree (status, created_at);


--
-- Name: idx_orders_status_created_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_created_desc ON public.orders USING btree (status, created_at DESC);


--
-- Name: idx_orders_status_ordered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_ordered ON public.orders USING btree (status, created_at) WHERE (status = ANY (ARRAY['ordered'::public.order_status, 'preparation'::public.order_status]));


--
-- Name: idx_orders_status_payment_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_payment_created ON public.orders USING btree (status, payment_status, created_at);


--
-- Name: idx_orders_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_supplier ON public.orders USING btree (supplier_id) WHERE (supplier_id IS NOT NULL);


--
-- Name: idx_orders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);


--
-- Name: idx_orders_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user_id ON public.orders USING btree (user_id);


--
-- Name: idx_osh_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_osh_order ON public.order_status_history USING btree (order_id);


--
-- Name: idx_otp_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_expires ON public.otp_codes USING btree (expires_at);


--
-- Name: idx_otp_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_phone ON public.otp_codes USING btree (phone);


--
-- Name: idx_otp_phone_purpose_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_phone_purpose_created ON public.otp_codes USING btree (phone, purpose, created_at DESC);


--
-- Name: idx_outbox_events_aggregate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_events_aggregate ON public.outbox_events USING btree (aggregate_type, aggregate_id, created_at);


--
-- Name: idx_outbox_events_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_events_pending ON public.outbox_events USING btree (created_at) WHERE (processed_at IS NULL);


--
-- Name: idx_parcel_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_events_created ON public.parcel_events USING btree (created_at);


--
-- Name: idx_parcel_events_parcel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_events_parcel_id ON public.parcel_events USING btree (parcel_id);


--
-- Name: idx_parcel_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_events_type ON public.parcel_events USING btree (event_type);


--
-- Name: idx_parcel_items_order_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_items_order_item ON public.parcel_items USING btree (order_item_id);


--
-- Name: idx_parcel_items_order_item_parcel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_items_order_item_parcel ON public.parcel_items USING btree (order_item_id, parcel_id);


--
-- Name: idx_parcel_items_parcel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_items_parcel ON public.parcel_items USING btree (parcel_id);


--
-- Name: idx_parcel_items_parcel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_items_parcel_id ON public.parcel_items USING btree (parcel_id);


--
-- Name: idx_parcel_items_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_items_verified ON public.parcel_items USING btree (verified);


--
-- Name: idx_parcels_backorder_reminder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_backorder_reminder ON public.parcels USING btree (backorder_reminder_sent) WHERE (backorder_reminder_sent = false);


--
-- Name: idx_parcels_external_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_parcels_external_code ON public.parcels USING btree (external_code) WHERE (external_code IS NOT NULL);


--
-- Name: idx_parcels_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_order ON public.parcels USING btree (order_id);


--
-- Name: idx_parcels_order_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_order_active ON public.parcels USING btree (order_id) WHERE (status <> 'cancelled'::public.parcel_status);


--
-- Name: idx_parcels_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_order_id ON public.parcels USING btree (order_id);


--
-- Name: idx_parcels_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_reference ON public.parcels USING btree (reference);


--
-- Name: idx_parcels_relais; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_relais ON public.parcels USING btree (relais_id);


--
-- Name: idx_parcels_relais_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_relais_id ON public.parcels USING btree (relais_id);


--
-- Name: idx_parcels_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_shipment ON public.parcels USING btree (shipment_id);


--
-- Name: idx_parcels_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_status ON public.parcels USING btree (status);


--
-- Name: idx_parcels_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_type ON public.parcels USING btree (type);


--
-- Name: idx_parcels_verification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcels_verification ON public.parcels USING btree (verification_status);


--
-- Name: idx_partners_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partners_active ON public.partners USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_partners_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partners_country ON public.partners USING btree (country_code) WHERE (is_active = true);


--
-- Name: idx_partners_partner_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_partners_partner_ref ON public.partners USING btree (partner_ref);


--
-- Name: idx_partners_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partners_type ON public.partners USING btree (partner_type);


--
-- Name: idx_paypal_events_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_paypal_events_type_time ON public.paypal_events_processed USING btree (event_type, processed_at DESC);


--
-- Name: idx_physical_offers_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_physical_offers_market ON public.physical_offers USING btree (market_id);


--
-- Name: idx_physical_offers_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_physical_offers_provider ON public.physical_offers USING btree (provider_id);


--
-- Name: idx_pickup_verify_attempts_reset_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pickup_verify_attempts_reset_at ON public.pickup_verify_attempts USING btree (reset_at);


--
-- Name: idx_pma_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pma_created ON public.pricing_matrices_audit USING btree (created_at DESC);


--
-- Name: idx_pma_matrix_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pma_matrix_cat ON public.pricing_matrices_audit USING btree (matrix_type, category);


--
-- Name: idx_ppt_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppt_expires_at ON public.pickup_print_tokens USING btree (expires_at);


--
-- Name: idx_ppt_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppt_order_id ON public.pickup_print_tokens USING btree (order_id);


--
-- Name: idx_prc_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prc_expires_at ON public.pickup_reveal_codes USING btree (expires_at);


--
-- Name: idx_price_history_applied_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_applied_at ON public.price_history USING btree (applied_at DESC);


--
-- Name: idx_price_history_levier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_levier ON public.price_history USING btree (levier) WHERE (levier IS NOT NULL);


--
-- Name: idx_price_history_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_product ON public.price_history USING btree (product_id, applied_at DESC);


--
-- Name: idx_price_history_scenario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_scenario ON public.price_history USING btree (scenario_id) WHERE (scenario_id IS NOT NULL);


--
-- Name: idx_price_history_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_source ON public.price_history USING btree (source, applied_at DESC);


--
-- Name: idx_pricing_components_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_components_active ON public.pricing_components USING btree (is_active, category, display_order);


--
-- Name: idx_pricing_global_access_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_global_access_active ON public.pricing_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_pricing_market_decision_policy_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_market_decision_policy_current ON public.pricing_market_decision_policy_events USING btree (market_id, effective_from DESC, recorded_at DESC, id DESC);


--
-- Name: idx_pricing_maturity_disposition_market_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_maturity_disposition_market_time ON public.pricing_maturity_disposition_events USING btree (market_id, decided_at DESC, id DESC);


--
-- Name: idx_pricing_maturity_disposition_order_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_maturity_disposition_order_time ON public.pricing_maturity_disposition_events USING btree (order_id, decided_at DESC, id DESC);


--
-- Name: idx_pricing_strategies_category_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pricing_strategies_category_active ON public.pricing_strategies USING btree (category) WHERE ((product_id IS NULL) AND (category IS NOT NULL) AND (is_active = true));


--
-- Name: idx_pricing_strategies_product_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pricing_strategies_product_active ON public.pricing_strategies USING btree (product_id) WHERE ((product_id IS NOT NULL) AND (is_active = true));


--
-- Name: idx_product_attributes_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_attributes_product ON public.product_attributes USING btree (product_id, kind, display_order) WHERE (is_active = true);


--
-- Name: idx_product_content_sections_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_content_sections_product ON public.product_content_sections USING btree (product_id, display_order) WHERE (is_active = true);


--
-- Name: idx_product_market_exposure_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_market_exposure_market ON public.product_market_exposure USING btree (market_id) WHERE (commercial_exposure = 'ENABLED'::text);


--
-- Name: idx_product_market_price_draft_events_market_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_market_price_draft_events_market_product ON public.product_market_price_draft_events USING btree (market_id, product_id, created_at DESC);


--
-- Name: idx_product_market_price_drafts_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_market_price_drafts_market ON public.product_market_price_drafts USING btree (market_id, updated_at DESC);


--
-- Name: idx_product_market_price_drafts_market_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_market_price_drafts_market_status ON public.product_market_price_drafts USING btree (market_id, status, updated_at DESC);


--
-- Name: idx_product_sku_media_media; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_sku_media_media ON public.product_sku_media USING btree (media_id);


--
-- Name: idx_product_sku_media_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_sku_media_sku ON public.product_sku_media USING btree (sku_id);


--
-- Name: idx_product_skus_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_skus_product ON public.product_skus USING btree (product_id);


--
-- Name: idx_product_skus_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_skus_source ON public.product_skus USING btree (source);


--
-- Name: idx_product_suppliers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_suppliers_active ON public.product_suppliers USING btree (product_id, priority) WHERE (deleted_at IS NULL);


--
-- Name: idx_product_suppliers_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_suppliers_product ON public.product_suppliers USING btree (product_id, priority, is_active);


--
-- Name: idx_product_variants_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_lookup ON public.product_variants USING btree (product_id, variant_type, display_order);


--
-- Name: idx_product_variants_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product ON public.product_variants USING btree (product_id);


--
-- Name: idx_products_boutique_taxonomy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_boutique_taxonomy ON public.products USING btree (boutique_category_key, boutique_subcategory_key) WHERE (boutique_category_key IS NOT NULL);


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.products USING btree (category);


--
-- Name: idx_products_category_subcategory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category_subcategory ON public.products USING btree (category, subcategory) WHERE (is_available = true);


--
-- Name: idx_products_fragile_bulky; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_fragile_bulky ON public.products USING btree (is_fragile, is_bulky);


--
-- Name: idx_products_inventory_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_inventory_model ON public.products USING btree (inventory_model) WHERE (inventory_model = 'SKU'::text);


--
-- Name: idx_products_lifecycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_lifecycle ON public.products USING btree (lifecycle_status) WHERE (is_active = true);


--
-- Name: idx_products_price_eur; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_price_eur ON public.products USING btree (price_eur);


--
-- Name: idx_products_sourcing_rail; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sourcing_rail ON public.products USING btree (sourcing_rail) WHERE (sourcing_rail IS NOT NULL);


--
-- Name: idx_products_weight_kg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_weight_kg ON public.products USING btree (weight_kg);


--
-- Name: idx_provider_credentials_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_credentials_provider ON public.provider_credentials USING btree (provider_key, status);


--
-- Name: idx_purchase_lines_open_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_lines_open_group ON public.purchase_lines USING btree (supplier_id, procurement_hub_ref) WHERE ((purchase_order_id IS NULL) AND (cancelled_at IS NULL));


--
-- Name: idx_purchase_lines_order_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_lines_order_item ON public.purchase_lines USING btree (order_item_id);


--
-- Name: idx_purchase_lines_purchase_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_lines_purchase_order ON public.purchase_lines USING btree (purchase_order_id) WHERE (purchase_order_id IS NOT NULL);


--
-- Name: idx_purchase_orders_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_order ON public.purchase_orders USING btree (order_id);


--
-- Name: idx_purchase_orders_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_order_id ON public.purchase_orders USING btree (order_id);


--
-- Name: idx_purchase_orders_order_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_order_item_id ON public.purchase_orders USING btree (order_item_id) WHERE (order_item_id IS NOT NULL);


--
-- Name: idx_purchase_orders_product_sku_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_product_sku_id ON public.purchase_orders USING btree (product_sku_id) WHERE (product_sku_id IS NOT NULL);


--
-- Name: idx_purchase_orders_received_qty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_received_qty ON public.purchase_orders USING btree (received_qty);


--
-- Name: idx_purchase_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_status ON public.purchase_orders USING btree (status);


--
-- Name: idx_purchase_orders_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_supplier ON public.purchase_orders USING btree (supplier_id, status);


--
-- Name: idx_purchase_orders_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_supplier_id ON public.purchase_orders USING btree (supplier_id);


--
-- Name: idx_real_cost_alloc_source_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_real_cost_alloc_source_created ON public.order_item_real_cost_allocations USING btree (source, created_at) WHERE (source = 'monthly_recalc'::text);


--
-- Name: idx_recipients_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recipients_user ON public.recipients USING btree (user_id);


--
-- Name: idx_refund_intents_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refund_intents_order ON public.refund_execution_intents USING btree (order_id, created_at);


--
-- Name: idx_relais_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_relais_market ON public.relais USING btree (market_id);


--
-- Name: idx_risk_provisions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_provisions_active ON public.risk_provisions USING btree (is_active, display_order);


--
-- Name: idx_rt_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rt_expires_at ON public.revoked_tokens USING btree (expires_at);


--
-- Name: idx_rt_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rt_user_id ON public.revoked_tokens USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_sc_decision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sc_decision ON public.sourcing_candidates USING btree (((scan_result ->> 'sourcing_decision'::text))) WHERE (scan_result IS NOT NULL);


--
-- Name: idx_sc_import; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sc_import ON public.sourcing_candidates USING btree (import_id);


--
-- Name: idx_sc_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sc_state ON public.sourcing_candidates USING btree (state);


--
-- Name: idx_sc_state_import; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sc_state_import ON public.sourcing_candidates USING btree (state, import_id);


--
-- Name: idx_sc_state_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sc_state_supplier ON public.sourcing_candidates USING btree (state, supplier_name);


--
-- Name: idx_sc_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sc_supplier ON public.sourcing_candidates USING btree (supplier_name);


--
-- Name: idx_scan_events_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_events_actor ON public.scan_events USING btree (scanned_by);


--
-- Name: idx_scan_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_events_created ON public.scan_events USING btree (created_at DESC);


--
-- Name: idx_scan_events_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_events_order ON public.scan_events USING btree (order_id);


--
-- Name: idx_scan_events_parcel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_events_parcel ON public.scan_events USING btree (parcel_id);


--
-- Name: idx_scan_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_events_status ON public.scan_events USING btree (status);


--
-- Name: idx_scan_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_events_type ON public.scan_events USING btree (event_type);


--
-- Name: idx_scans_anomaly; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scans_anomaly ON public.scans USING btree (is_anomaly) WHERE (is_anomaly = true);


--
-- Name: idx_scans_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scans_code ON public.scans USING btree (scan_code);


--
-- Name: idx_scans_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scans_order ON public.scans USING btree (order_id);


--
-- Name: idx_scans_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scans_order_id ON public.scans USING btree (order_id);


--
-- Name: idx_scans_parcel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scans_parcel ON public.scans USING btree (parcel_id);


--
-- Name: idx_scans_parcel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scans_parcel_id ON public.scans USING btree (parcel_id);


--
-- Name: idx_scans_parcel_id_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scans_parcel_id_active ON public.scans USING btree (parcel_id) WHERE (parcel_id IS NOT NULL);


--
-- Name: idx_scans_step; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scans_step ON public.scans USING btree (step);


--
-- Name: idx_sce_candidate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sce_candidate ON public.sourcing_candidate_events USING btree (candidate_id, created_at DESC);


--
-- Name: idx_sce_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sce_type ON public.sourcing_candidate_events USING btree (event_type);


--
-- Name: idx_sci_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sci_profile ON public.supplier_catalog_imports USING btree (profile_id, profile_version);


--
-- Name: idx_sci_source_sha256; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sci_source_sha256 ON public.supplier_catalog_imports USING btree (source_sha256);


--
-- Name: idx_sci_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sci_status ON public.supplier_catalog_imports USING btree (status, imported_at DESC);


--
-- Name: idx_sci_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sci_supplier ON public.supplier_catalog_imports USING btree (supplier_name, imported_at DESC);


--
-- Name: idx_scir_import; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scir_import ON public.supplier_catalog_import_rejections USING btree (import_id);


--
-- Name: idx_scir_reason_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scir_reason_code ON public.supplier_catalog_import_rejections USING btree (reason_code);


--
-- Name: idx_scir_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scir_supplier ON public.supplier_catalog_import_rejections USING btree (supplier_name, supplier_product_id);


--
-- Name: idx_sco_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sco_identity ON public.sourcing_candidate_observations USING btree (supplier_name, supplier_product_id, observed_at DESC);


--
-- Name: idx_sco_import; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sco_import ON public.sourcing_candidate_observations USING btree (import_id);


--
-- Name: idx_sco_row_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sco_row_hash ON public.sourcing_candidate_observations USING btree (source_row_sha256);


--
-- Name: idx_sep_processed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sep_processed_at ON public.stripe_events_processed USING btree (processed_at);


--
-- Name: idx_services_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_market ON public.services USING btree (market_id);


--
-- Name: idx_services_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_provider ON public.services USING btree (provider_id);


--
-- Name: idx_shared_cart_events_cart; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_cart_events_cart ON public.shared_cart_events USING btree (shared_cart_id, created_at DESC);


--
-- Name: idx_shared_cart_items_cart; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_cart_items_cart ON public.shared_cart_items USING btree (shared_cart_id);


--
-- Name: idx_shared_cart_items_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_cart_items_sku ON public.shared_cart_items USING btree (sku_id) WHERE (sku_id IS NOT NULL);


--
-- Name: idx_shared_cart_saved_access_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_cart_saved_access_user ON public.shared_cart_saved_access USING btree (user_id, saved_at DESC);


--
-- Name: idx_shared_carts_organizer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_carts_organizer ON public.shared_carts USING btree (organizer_user_id, status);


--
-- Name: idx_shared_carts_source_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_carts_source_order ON public.shared_carts USING btree (source_order_id) WHERE (source_order_id IS NOT NULL);


--
-- Name: idx_shared_carts_status_v41; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_carts_status_v41 ON public.shared_carts USING btree (status, created_at DESC);


--
-- Name: idx_shared_carts_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_carts_token ON public.shared_carts USING btree (token);


--
-- Name: idx_shipments_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_reference ON public.shipments USING btree (reference);


--
-- Name: idx_signals_active_fact_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_signals_active_fact_unique ON public.signals USING btree (signal_type, market_id, entity_type, entity_id) NULLS NOT DISTINCT WHERE (status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'snoozed'::text]));


--
-- Name: idx_signals_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_signals_dedup ON public.signals USING btree (signal_type, entity_type, entity_id) WHERE (status = 'open'::text);


--
-- Name: idx_signals_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_entity ON public.signals USING btree (entity_type, entity_id);


--
-- Name: idx_signals_market_active_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_market_active_created ON public.signals USING btree (market_id, status, created_at DESC) WHERE (status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'snoozed'::text]));


--
-- Name: idx_signals_market_severity_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_market_severity_created ON public.signals USING btree (market_id, severity, created_at DESC);


--
-- Name: idx_signals_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_owner ON public.signals USING btree (owner_role);


--
-- Name: idx_signals_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_severity ON public.signals USING btree (severity);


--
-- Name: idx_signals_severity_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_severity_created ON public.signals USING btree (severity, created_at DESC);


--
-- Name: idx_signals_severity_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_severity_status ON public.signals USING btree (severity, status) WHERE (status = 'open'::text);


--
-- Name: idx_signals_signal_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_signals_signal_ref ON public.signals USING btree (signal_ref);


--
-- Name: idx_signals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_status ON public.signals USING btree (status) WHERE (status = ANY (ARRAY['open'::text, 'acknowledged'::text]));


--
-- Name: idx_signals_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_type ON public.signals USING btree (signal_type);


--
-- Name: idx_sms_log_failed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_log_failed ON public.sms_log USING btree (created_at DESC) WHERE (status = 'failed'::text);


--
-- Name: idx_sms_log_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_log_order ON public.sms_log USING btree (order_id);


--
-- Name: idx_sms_log_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_log_order_id ON public.sms_log USING btree (order_id);


--
-- Name: idx_sms_log_queue_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_log_queue_pending ON public.sms_log USING btree (priority, next_attempt_at) WHERE ((status = 'pending'::text) AND (attempts < 3));


--
-- Name: idx_sms_log_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_log_recent ON public.sms_log USING btree (created_at DESC) WHERE (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text]));


--
-- Name: idx_sourcing_candidates_candidate_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sourcing_candidates_candidate_ref ON public.sourcing_candidates USING btree (candidate_ref);


--
-- Name: idx_sourcing_global_access_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_global_access_active ON public.sourcing_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_sourcing_sources_autopilot_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_sources_autopilot_enabled ON public.sourcing_sources USING btree (updated_at, source_id) WHERE ((autopilot_enabled = true) AND (status = 'active'::text) AND (acquisition = 'pull'::text) AND (continuity = 'recurring'::text));


--
-- Name: idx_sps_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sps_payment ON public.supplier_payment_settlements USING btree (supplier_execution_payment_id);


--
-- Name: idx_strategy_history_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_strategy_history_category ON public.pricing_strategy_history USING btree (category, applied_at DESC);


--
-- Name: idx_strategy_history_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_strategy_history_product ON public.pricing_strategy_history USING btree (product_id, applied_at DESC);


--
-- Name: idx_structure_cost_events_charge_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_structure_cost_events_charge_time ON public.economic_structure_cost_events USING btree (charge_id, recorded_at DESC, id DESC);


--
-- Name: idx_structure_cost_events_family_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_structure_cost_events_family_period ON public.economic_structure_cost_events USING btree (charge_family_snapshot, economic_from, economic_to);


--
-- Name: idx_structure_cost_events_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_structure_cost_events_period ON public.economic_structure_cost_events USING btree (economic_from, economic_to);


--
-- Name: idx_structure_cost_events_scope_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_structure_cost_events_scope_period ON public.economic_structure_cost_events USING btree (scope_kind, market_id, economic_from, economic_to);


--
-- Name: idx_supplier_catalog_imports_import_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_supplier_catalog_imports_import_ref ON public.supplier_catalog_imports USING btree (import_ref);


--
-- Name: idx_supplier_catalog_sync_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_catalog_sync_pending ON public.supplier_catalog_sync_checkpoints USING btree (supplier_name, sync_key, completed, updated_at);


--
-- Name: idx_supplier_commercial_mapping_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_commercial_mapping_status ON public.supplier_commercial_category_mappings USING btree (provider, status);


--
-- Name: idx_supplier_execution_events_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_events_group ON public.supplier_execution_events USING btree (supplier_execution_group_id) WHERE (supplier_execution_group_id IS NOT NULL);


--
-- Name: idx_supplier_execution_events_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_events_order ON public.supplier_execution_events USING btree (supplier_execution_order_id) WHERE (supplier_execution_order_id IS NOT NULL);


--
-- Name: idx_supplier_execution_events_purchase_order_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_events_purchase_order_time ON public.supplier_execution_events USING btree (purchase_order_id, created_at);


--
-- Name: idx_supplier_execution_fulfillments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_fulfillments_order ON public.supplier_execution_fulfillments USING btree (supplier_execution_order_id);


--
-- Name: idx_supplier_execution_group_members_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_group_members_order ON public.supplier_execution_group_members USING btree (supplier_execution_order_id);


--
-- Name: idx_supplier_execution_groups_purchase_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_groups_purchase_order ON public.supplier_execution_groups USING btree (purchase_order_id);


--
-- Name: idx_supplier_execution_order_lines_purchase_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_order_lines_purchase_line ON public.supplier_execution_order_lines USING btree (purchase_line_id);


--
-- Name: idx_supplier_execution_orders_purchase_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_orders_purchase_order ON public.supplier_execution_orders USING btree (purchase_order_id);


--
-- Name: idx_supplier_execution_payments_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_payments_group ON public.supplier_execution_payments USING btree (supplier_execution_group_id) WHERE (supplier_execution_group_id IS NOT NULL);


--
-- Name: idx_supplier_execution_payments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_payments_order ON public.supplier_execution_payments USING btree (supplier_execution_order_id) WHERE (supplier_execution_order_id IS NOT NULL);


--
-- Name: idx_supplier_execution_payments_purchase_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_execution_payments_purchase_order ON public.supplier_execution_payments USING btree (purchase_order_id);


--
-- Name: idx_supplier_payment_proofs_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_payment_proofs_payment ON public.supplier_execution_payment_proofs USING btree (supplier_payment_id);


--
-- Name: idx_suppliers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_active ON public.suppliers USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_txdoc_issued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_txdoc_issued ON public.transaction_documents USING btree (issued_at DESC);


--
-- Name: idx_txdoc_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_txdoc_order ON public.transaction_documents USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_txdoc_owner_issued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_txdoc_owner_issued ON public.transaction_documents USING btree (owner_user_id, issued_at DESC) WHERE (owner_user_id IS NOT NULL);


--
-- Name: idx_txdoc_refund; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_txdoc_refund ON public.transaction_documents USING btree (refund_id) WHERE (refund_id IS NOT NULL);


--
-- Name: idx_txdoc_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_txdoc_type ON public.transaction_documents USING btree (document_type);


--
-- Name: idx_unsold_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unsold_order ON public.unsold_items USING btree (order_id);


--
-- Name: idx_unsold_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unsold_status ON public.unsold_items USING btree (status);


--
-- Name: idx_users_big_basket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_big_basket ON public.users USING btree (big_basket_count) WHERE (big_basket_count > 0);


--
-- Name: idx_users_loyalty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_loyalty ON public.users USING btree (loyalty_tier_id);


--
-- Name: idx_users_phone_payer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone_payer ON public.users USING btree (phone_payer);


--
-- Name: idx_wallets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallets_user ON public.wallets USING btree (user_id);


--
-- Name: idx_wcons_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wcons_active ON public.wallet_consumptions USING btree (order_id) WHERE (reversed_at IS NULL);


--
-- Name: idx_wcons_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wcons_order ON public.wallet_consumptions USING btree (order_id);


--
-- Name: idx_webauthn_challenges_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webauthn_challenges_lookup ON public.webauthn_challenges USING btree (challenge) WHERE (consumed_at IS NULL);


--
-- Name: idx_webauthn_credentials_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webauthn_credentials_user ON public.webauthn_credentials USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_wlots_wallet_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wlots_wallet_active ON public.wallet_credit_lots USING btree (wallet_id) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_wtx_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_wtx_idempotency ON public.wallet_transactions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_wtx_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wtx_wallet ON public.wallet_transactions USING btree (wallet_id);


--
-- Name: one_draft_per_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_draft_per_order ON public.parcels USING btree (order_id) WHERE (status = 'draft'::public.parcel_status);


--
-- Name: order_items_shared_cart_item_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_items_shared_cart_item_id_unique ON public.order_items USING btree (shared_cart_item_id);


--
-- Name: shared_cart_saved_access_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shared_cart_saved_access_unique ON public.shared_cart_saved_access USING btree (user_id, shared_cart_id);


--
-- Name: shared_carts_one_open_per_organizer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shared_carts_one_open_per_organizer ON public.shared_carts USING btree (organizer_user_id) WHERE (status = 'open'::public.shared_cart_status);


--
-- Name: sourcing_canonical_entities_grain_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_canonical_entities_grain_status_idx ON public.sourcing_canonical_entities USING btree (grain, status);


--
-- Name: sourcing_canonical_entities_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_canonical_entities_parent_idx ON public.sourcing_canonical_entities USING btree (parent_entity_id) WHERE (parent_entity_id IS NOT NULL);


--
-- Name: sourcing_canonical_entities_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_canonical_entities_principal_idx ON public.sourcing_canonical_entities USING btree (principal_id) WHERE (principal_id IS NOT NULL);


--
-- Name: sourcing_canonical_entity_refs_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_canonical_entity_refs_entity_idx ON public.sourcing_canonical_entity_refs USING btree (canonical_entity_id);


--
-- Name: sourcing_captures_source_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_captures_source_started_idx ON public.sourcing_captures USING btree (source_id, started_at DESC);


--
-- Name: sourcing_identity_constraints_one_active_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sourcing_identity_constraints_one_active_pair ON public.sourcing_identity_constraints USING btree (grain, left_entity_id, right_entity_id) WHERE (active = true);


--
-- Name: sourcing_match_proposals_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_match_proposals_candidate_idx ON public.sourcing_match_proposals USING btree (candidate_entity_id, created_at DESC);


--
-- Name: sourcing_match_proposals_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_match_proposals_observation_idx ON public.sourcing_match_proposals USING btree (observation_id, created_at DESC);


--
-- Name: sourcing_merge_policies_one_active_field; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sourcing_merge_policies_one_active_field ON public.sourcing_merge_policies USING btree (grain, field_key) WHERE (active = true);


--
-- Name: sourcing_observation_evidence_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_observation_evidence_lookup_idx ON public.sourcing_observation_evidence USING btree (evidence_type, evidence_key, value);


--
-- Name: sourcing_observation_evidence_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_observation_evidence_observation_idx ON public.sourcing_observation_evidence USING btree (observation_id);


--
-- Name: sourcing_observations_capture_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_observations_capture_idx ON public.sourcing_observations USING btree (capture_id);


--
-- Name: sourcing_observations_grain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_observations_grain_idx ON public.sourcing_observations USING btree (grain);


--
-- Name: sourcing_observations_observed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_observations_observed_at_idx ON public.sourcing_observations USING btree (observed_at DESC);


--
-- Name: sourcing_observations_source_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_observations_source_ref_idx ON public.sourcing_observations USING btree (source_ref) WHERE (source_ref IS NOT NULL);


--
-- Name: sourcing_resolution_bindings_entity_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_resolution_bindings_entity_active_idx ON public.sourcing_resolution_bindings USING btree (canonical_entity_id) WHERE (ended_at IS NULL);


--
-- Name: sourcing_resolution_bindings_one_active_observation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sourcing_resolution_bindings_one_active_observation ON public.sourcing_resolution_bindings USING btree (observation_id) WHERE (ended_at IS NULL);


--
-- Name: sourcing_resolution_decisions_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_resolution_decisions_entity_idx ON public.sourcing_resolution_decisions USING btree (canonical_entity_id, created_at DESC) WHERE (canonical_entity_id IS NOT NULL);


--
-- Name: sourcing_resolution_decisions_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_resolution_decisions_observation_idx ON public.sourcing_resolution_decisions USING btree (observation_id, created_at DESC) WHERE (observation_id IS NOT NULL);


--
-- Name: sourcing_source_principal_refs_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sourcing_source_principal_refs_principal_idx ON public.sourcing_source_principal_refs USING btree (principal_id);


--
-- Name: uniq_active_assignment_ceiling_capability; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_assignment_ceiling_capability ON public.assignment_capability_ceiling USING btree (assignment_id, capability) WHERE (revoked_at IS NULL);


--
-- Name: uniq_active_assignment_membership; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_assignment_membership ON public.assignment_memberships USING btree (assignment_id, user_id) WHERE (status = 'ACTIVE'::text);


--
-- Name: uniq_active_assignment_operating_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_assignment_operating_lead ON public.assignment_memberships USING btree (assignment_id) WHERE ((status = 'ACTIVE'::text) AND (is_operating_lead = true));


--
-- Name: uniq_active_catalog_global_access; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_catalog_global_access ON public.catalog_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: uniq_active_dashboard_global_access; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_dashboard_global_access ON public.dashboard_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: uniq_active_market_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_market_assignment ON public.market_operating_assignments USING btree (market_id) WHERE (status = 'ACTIVE'::text);


--
-- Name: uniq_active_membership_capability; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_membership_capability ON public.membership_capabilities USING btree (membership_id, capability) WHERE (revoked_at IS NULL);


--
-- Name: uniq_active_operator_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_operator_scope ON public.operator_market_scopes USING btree (user_id, market_id) WHERE (revoked_at IS NULL);


--
-- Name: uniq_cash_custody_receipts_control; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_cash_custody_receipts_control ON public.cash_custody_receipts USING btree (deposit_id) WHERE (kind = 'CONTROL'::text);


--
-- Name: uniq_cash_custody_receipts_resolution; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_cash_custody_receipts_resolution ON public.cash_custody_receipts USING btree (deposit_id) WHERE (kind = ANY (ARRAY['RECEIVED'::text, 'REFUSED'::text]));


--
-- Name: uniq_cash_deposits_deposit_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_cash_deposits_deposit_ref ON public.cash_deposits USING btree (deposit_ref);


--
-- Name: uniq_current_ceiling_template; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_current_ceiling_template ON public.ceiling_templates USING btree ((1)) WHERE (is_current = true);


--
-- Name: uniq_market_cash_destinations_live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_market_cash_destinations_live ON public.market_cash_destinations USING btree (market_id, kind, account_ref) WHERE (status = ANY (ARRAY['PROPOSED'::text, 'ACTIVE'::text, 'SUSPENDED'::text]));


--
-- Name: uniq_market_payment_accounts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_market_payment_accounts_active ON public.market_payment_accounts USING btree (market_id, provider, currency) WHERE (status = 'ACTIVE'::text);


--
-- Name: uniq_pending_market_team_invitation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_pending_market_team_invitation ON public.market_team_invitations USING btree (assignment_id, email_normalized) WHERE (status = 'PENDING'::text);


--
-- Name: uniq_pending_market_team_invitation_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_pending_market_team_invitation_phone ON public.market_team_invitations USING btree (assignment_id, phone_e164) WHERE ((status = 'PENDING'::text) AND (phone_e164 IS NOT NULL));


--
-- Name: uniq_sc_supplier_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_sc_supplier_ref ON public.sourcing_candidates USING btree (supplier_name, supplier_product_id) WHERE (supplier_product_id IS NOT NULL);


--
-- Name: uq_market_transport_sale_rates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_market_transport_sale_rates_active ON public.market_transport_sale_rates USING btree (market_id, rate_key) WHERE (revoked_at IS NULL);


--
-- Name: uq_mobile_money_active_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mobile_money_active_attempt ON public.mobile_money_transactions USING btree (order_id, provider) WHERE (status = ANY (ARRAY['initiated'::text, 'pending'::text]));


--
-- Name: uq_mobile_money_provider_external_tx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mobile_money_provider_external_tx ON public.mobile_money_transactions USING btree (provider, external_transaction_id) WHERE (external_transaction_id IS NOT NULL);


--
-- Name: uq_order_cost_entry_events_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_order_cost_entry_events_idem ON public.order_cost_entry_events USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_orders_cash_ref_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_orders_cash_ref_active ON public.orders USING btree (cash_ref_code) WHERE ((payment_status = 'pending'::public.payment_status) AND (cash_ref_code IS NOT NULL));


--
-- Name: uq_orders_qr_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_orders_qr_token ON public.orders USING btree (qr_token) WHERE (qr_token IS NOT NULL);


--
-- Name: uq_products_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_products_sku ON public.products USING btree (sku) WHERE (sku IS NOT NULL);


--
-- Name: uq_refund_intents_one_unresolved_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_refund_intents_one_unresolved_order ON public.refund_execution_intents USING btree (order_id) WHERE (status = ANY (ARRAY['reserved'::text, 'processing'::text, 'unknown'::text]));


--
-- Name: uq_refund_intents_provider_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_refund_intents_provider_ref ON public.refund_execution_intents USING btree (provider, provider_ref) WHERE (provider_ref IS NOT NULL);


--
-- Name: INDEX uq_refund_intents_provider_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_refund_intents_provider_ref IS 'One external provider refund operation must settle at most one Komerce intent';


--
-- Name: uq_sourcing_source_requests_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sourcing_source_requests_provider ON public.sourcing_source_requests USING btree (lower(btrim(provider_name)));


--
-- Name: uq_supplier_execution_fulfillments_evidence; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_execution_fulfillments_evidence ON public.supplier_execution_fulfillments USING btree (provider, evidence_source, evidence_ref) WHERE ((evidence_source IS NOT NULL) AND (evidence_ref IS NOT NULL));


--
-- Name: uq_supplier_execution_fulfillments_execution_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_execution_fulfillments_execution_key ON public.supplier_execution_fulfillments USING btree (provider, fulfillment_execution_key);


--
-- Name: uq_supplier_execution_groups_provider_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_execution_groups_provider_parent ON public.supplier_execution_groups USING btree (provider, supplier_parent_order_id);


--
-- Name: uq_supplier_execution_groups_provider_payment_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_execution_groups_provider_payment_ref ON public.supplier_execution_groups USING btree (provider, payment_ref) WHERE (payment_ref IS NOT NULL);


--
-- Name: uq_supplier_execution_orders_provider_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_execution_orders_provider_code ON public.supplier_execution_orders USING btree (provider, supplier_order_code) WHERE (supplier_order_code IS NOT NULL);


--
-- Name: uq_supplier_execution_orders_provider_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_execution_orders_provider_order ON public.supplier_execution_orders USING btree (provider, supplier_order_id);


--
-- Name: uq_supplier_execution_payments_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_execution_payments_provider_key ON public.supplier_execution_payments USING btree (provider, payment_execution_key);


--
-- Name: uq_supplier_execution_payments_provider_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_execution_payments_provider_ref ON public.supplier_execution_payments USING btree (provider, payment_ref) WHERE (payment_ref IS NOT NULL);


--
-- Name: uq_supplier_payment_proofs_native_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_payment_proofs_native_ref ON public.supplier_execution_payment_proofs USING btree (provider, proof_source, proof_ref);


--
-- Name: uq_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: ux_catalog_media_source_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_catalog_media_source_identity ON public.catalog_media USING btree (product_id, source_media_id) WHERE (source_media_id IS NOT NULL);


--
-- Name: ux_hub_purchase_allocations_line; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_hub_purchase_allocations_line ON public.hub_purchase_allocations USING btree (purchase_line_id) WHERE (purchase_line_id IS NOT NULL);


--
-- Name: ux_hub_purchase_allocations_po_historical; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_hub_purchase_allocations_po_historical ON public.hub_purchase_allocations USING btree (purchase_order_id) WHERE (purchase_line_id IS NULL);


--
-- Name: ux_local_stock_product_market_location; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_local_stock_product_market_location ON public.local_stock USING btree (product_id, market_id, location);


--
-- Name: ux_product_attributes_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_product_attributes_identity ON public.product_attributes USING btree (product_id, kind, group_key, attribute_key);


--
-- Name: ux_product_content_profile_product; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_product_content_profile_product ON public.product_content_profile USING btree (product_id);


--
-- Name: ux_product_content_sections_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_product_content_sections_key ON public.product_content_sections USING btree (product_id, section_key);


--
-- Name: ux_product_sku_media_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_product_sku_media_pair ON public.product_sku_media USING btree (sku_id, media_id);


--
-- Name: ux_product_skus_combo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_product_skus_combo ON public.product_skus USING btree (product_id, variant_combo) WHERE (variant_combo IS NOT NULL);


--
-- Name: ux_product_skus_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_product_skus_default ON public.product_skus USING btree (product_id) WHERE (variant_combo IS NULL);


--
-- Name: ux_product_skus_supplier_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_product_skus_supplier_identity ON public.product_skus USING btree (product_id, supplier_sku) WHERE (supplier_sku IS NOT NULL);


--
-- Name: ux_product_skus_supplier_unit_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_product_skus_supplier_unit_ref ON public.product_skus USING btree (product_id, supplier_unit_ref) WHERE (supplier_unit_ref IS NOT NULL);


--
-- Name: ux_purchase_orders_order_item_supplier_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_purchase_orders_order_item_supplier_active ON public.purchase_orders USING btree (order_item_id, product_supplier_id) WHERE ((order_item_id IS NOT NULL) AND (product_supplier_id IS NOT NULL) AND (status <> 'cancelled'::text));


--
-- Name: currency_parities currency_parities_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER currency_parities_no_truncate BEFORE TRUNCATE ON public.currency_parities FOR EACH STATEMENT EXECUTE FUNCTION public.currency_parities_no_truncate();


--
-- Name: currency_parities currency_parities_value_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER currency_parities_value_guard BEFORE UPDATE ON public.currency_parities FOR EACH ROW EXECUTE FUNCTION public.currency_parities_value_guard();


--
-- Name: fx_pegs fx_pegs_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fx_pegs_append_only BEFORE DELETE OR UPDATE ON public.fx_pegs FOR EACH ROW EXECUTE FUNCTION public.fx_append_only_guard();


--
-- Name: fx_pegs fx_pegs_insert_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fx_pegs_insert_guard BEFORE INSERT ON public.fx_pegs FOR EACH ROW EXECUTE FUNCTION public.fx_insert_guard();


--
-- Name: fx_pegs fx_pegs_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fx_pegs_no_truncate BEFORE TRUNCATE ON public.fx_pegs FOR EACH STATEMENT EXECUTE FUNCTION public.fx_no_truncate_guard();


--
-- Name: fx_public_reference_quotes fx_public_reference_quotes_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fx_public_reference_quotes_append_only BEFORE DELETE OR UPDATE ON public.fx_public_reference_quotes FOR EACH ROW EXECUTE FUNCTION public.fx_append_only_guard();


--
-- Name: fx_public_reference_quotes fx_public_reference_quotes_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fx_public_reference_quotes_no_truncate BEFORE TRUNCATE ON public.fx_public_reference_quotes FOR EACH STATEMENT EXECUTE FUNCTION public.fx_no_truncate_guard();


--
-- Name: fx_rate_observations fx_rate_observations_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fx_rate_observations_append_only BEFORE DELETE OR UPDATE ON public.fx_rate_observations FOR EACH ROW EXECUTE FUNCTION public.fx_append_only_guard();


--
-- Name: fx_rate_observations fx_rate_observations_insert_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fx_rate_observations_insert_guard BEFORE INSERT ON public.fx_rate_observations FOR EACH ROW EXECUTE FUNCTION public.fx_insert_guard();


--
-- Name: fx_rate_observations fx_rate_observations_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fx_rate_observations_no_truncate BEFORE TRUNCATE ON public.fx_rate_observations FOR EACH STATEMENT EXECUTE FUNCTION public.fx_no_truncate_guard();


--
-- Name: customs_shipment_fees guard_customs_fee_after_international_n1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_customs_fee_after_international_n1 BEFORE INSERT ON public.customs_shipment_fees FOR EACH ROW EXECUTE FUNCTION public.guard_international_n1_against_legacy_duplicate();


--
-- Name: customs_shipments guard_customs_freight_after_international_n1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_customs_freight_after_international_n1 BEFORE UPDATE OF freight_kmf ON public.customs_shipments FOR EACH ROW EXECUTE FUNCTION public.guard_international_n1_against_legacy_duplicate();


--
-- Name: international_shipment_charges international_charges_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER international_charges_immutable BEFORE DELETE OR UPDATE ON public.international_shipment_charges FOR EACH ROW EXECUTE FUNCTION public.international_facts_immutable();


--
-- Name: international_shipment_events international_events_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER international_events_immutable BEFORE DELETE OR UPDATE ON public.international_shipment_events FOR EACH ROW EXECUTE FUNCTION public.international_facts_immutable();


--
-- Name: orders orders_snapshots_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_snapshots_immutable BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.orders_snapshots_immutable();


--
-- Name: sourcing_canonical_entities sourcing_canonical_entities_hierarchy_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER sourcing_canonical_entities_hierarchy_guard AFTER INSERT OR UPDATE ON public.sourcing_canonical_entities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.sourcing_check_canonical_hierarchy();


--
-- Name: sourcing_match_proposals sourcing_match_proposals_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sourcing_match_proposals_append_only BEFORE DELETE OR UPDATE ON public.sourcing_match_proposals FOR EACH ROW EXECUTE FUNCTION public.sourcing_forbid_resolution_audit_mutation();


--
-- Name: sourcing_match_proposals sourcing_match_proposals_grain_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER sourcing_match_proposals_grain_guard AFTER INSERT OR UPDATE ON public.sourcing_match_proposals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.sourcing_check_proposal_grain();


--
-- Name: sourcing_observations sourcing_observations_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sourcing_observations_append_only BEFORE DELETE OR UPDATE ON public.sourcing_observations FOR EACH ROW EXECUTE FUNCTION public.sourcing_forbid_observation_mutation();


--
-- Name: sourcing_resolution_bindings sourcing_resolution_bindings_grain_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER sourcing_resolution_bindings_grain_guard AFTER INSERT OR UPDATE ON public.sourcing_resolution_bindings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.sourcing_check_binding_grain();


--
-- Name: sourcing_resolution_decisions sourcing_resolution_decisions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sourcing_resolution_decisions_append_only BEFORE DELETE OR UPDATE ON public.sourcing_resolution_decisions FOR EACH ROW EXECUTE FUNCTION public.sourcing_forbid_resolution_audit_mutation();


--
-- Name: sourcing_resolution_decisions sourcing_resolution_decisions_grain_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER sourcing_resolution_decisions_grain_guard AFTER INSERT OR UPDATE ON public.sourcing_resolution_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.sourcing_check_decision_grain();


--
-- Name: sourcing_source_execution_modes sourcing_source_exec_api_requires_units; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER sourcing_source_exec_api_requires_units AFTER INSERT OR DELETE OR UPDATE ON public.sourcing_source_execution_modes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.sourcing_check_api_requires_units();


--
-- Name: sourcing_source_provides sourcing_source_provides_units_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER sourcing_source_provides_units_guard AFTER DELETE OR UPDATE ON public.sourcing_source_provides DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.sourcing_check_api_requires_units();


--
-- Name: assignment_capability_ceiling trg_assignment_ceiling_amount_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assignment_ceiling_amount_limit BEFORE INSERT OR UPDATE OF capability, limit_amount ON public.assignment_capability_ceiling FOR EACH ROW EXECUTE FUNCTION public.enforce_assignment_ceiling_amount_limit();


--
-- Name: assignment_capability_ceiling trg_assignment_ceiling_capability_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assignment_ceiling_capability_guard BEFORE INSERT OR UPDATE OF capability, assignment_id ON public.assignment_capability_ceiling FOR EACH ROW EXECUTE FUNCTION public.enforce_assignment_ceiling_capability();


--
-- Name: cash_deposit_allocations trg_cash_alloc_enforce; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_alloc_enforce AFTER INSERT ON public.cash_deposit_allocations FOR EACH ROW EXECUTE FUNCTION public.cash_alloc_enforce();


--
-- Name: cash_custody_losses trg_cash_custody_losses_after; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_custody_losses_after AFTER INSERT ON public.cash_custody_losses FOR EACH ROW EXECUTE FUNCTION public.cash_custody_losses_after();


--
-- Name: cash_custody_losses trg_cash_custody_losses_enforce; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_custody_losses_enforce BEFORE INSERT ON public.cash_custody_losses FOR EACH ROW EXECUTE FUNCTION public.cash_custody_losses_enforce();


--
-- Name: cash_custody_receipts trg_cash_custody_receipts_after; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_custody_receipts_after AFTER INSERT ON public.cash_custody_receipts FOR EACH ROW EXECUTE FUNCTION public.cash_custody_receipts_after();


--
-- Name: cash_custody_receipts trg_cash_custody_receipts_enforce; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_custody_receipts_enforce BEFORE INSERT ON public.cash_custody_receipts FOR EACH ROW EXECUTE FUNCTION public.cash_custody_receipts_enforce();


--
-- Name: cash_deposits trg_cash_deposits_derive_market; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_deposits_derive_market BEFORE INSERT ON public.cash_deposits FOR EACH ROW EXECUTE FUNCTION public.cash_deposits_derive_market();


--
-- Name: cash_deposits trg_cash_deposits_guard_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_deposits_guard_update BEFORE UPDATE ON public.cash_deposits FOR EACH ROW EXECUTE FUNCTION public.cash_deposits_guard_update();


--
-- Name: cash_deposits trg_cash_deposits_zcustody_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_deposits_zcustody_guard BEFORE INSERT ON public.cash_deposits FOR EACH ROW EXECUTE FUNCTION public.cash_deposits_custody_guard();


--
-- Name: market_cash_control_policies trg_cash_policy_assignment_market; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_policy_assignment_market BEFORE INSERT OR UPDATE OF assignment_id, market_id ON public.market_cash_control_policies FOR EACH ROW EXECUTE FUNCTION public.enforce_cash_policy_assignment_market();


--
-- Name: cash_custody_provenance_edges trg_cash_provenance_enforce_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_provenance_enforce_insert BEFORE INSERT ON public.cash_custody_provenance_edges FOR EACH ROW EXECUTE FUNCTION public.cash_provenance_enforce_insert();


--
-- Name: cash_custody_provenance_edges trg_cash_provenance_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_provenance_no_update BEFORE DELETE OR UPDATE ON public.cash_custody_provenance_edges FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_prevent_mutation();


--
-- Name: catalog_media trg_catalog_media_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_catalog_media_updated BEFORE UPDATE ON public.catalog_media FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: assignment_capability_ceiling trg_ceiling_removal_member_grants_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ceiling_removal_member_grants_guard BEFORE DELETE OR UPDATE OF revoked_at ON public.assignment_capability_ceiling FOR EACH ROW EXECUTE FUNCTION public.prevent_ceiling_removal_with_active_member_grants();


--
-- Name: parcel_items trg_check_parcel_item_qty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_parcel_item_qty BEFORE INSERT OR UPDATE ON public.parcel_items FOR EACH ROW EXECUTE FUNCTION public.check_parcel_item_quantities();


--
-- Name: orders trg_compute_real_margin; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_compute_real_margin BEFORE UPDATE OF cost_real_kmf ON public.orders FOR EACH ROW EXECUTE FUNCTION public.compute_real_margin();


--
-- Name: cost_components trg_cost_components_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cost_components_updated BEFORE UPDATE ON public.cost_components FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customs_shipment_fees trg_csf_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_csf_immutable BEFORE DELETE OR UPDATE ON public.customs_shipment_fees FOR EACH ROW EXECUTE FUNCTION public.customs_shipment_fees_immutable();


--
-- Name: customs_shipment_parcels trg_csp_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_csp_updated BEFORE UPDATE ON public.customs_shipment_parcels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customs_history trg_customs_anomaly; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customs_anomaly BEFORE INSERT OR UPDATE OF customs_real_kmf ON public.customs_history FOR EACH ROW EXECUTE FUNCTION public.flag_customs_anomaly();


--
-- Name: customs_categories trg_customs_categories_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customs_categories_updated BEFORE UPDATE ON public.customs_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customs_shipment_financial_audit trg_customs_financial_audit_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customs_financial_audit_immutable BEFORE DELETE OR UPDATE ON public.customs_shipment_financial_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_customs_financial_audit_mutation();


--
-- Name: customs_shipment_parcel_events trg_customs_parcel_events_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customs_parcel_events_immutable BEFORE DELETE OR UPDATE ON public.customs_shipment_parcel_events FOR EACH ROW EXECUTE FUNCTION public.customs_shipment_parcel_events_immutable();


--
-- Name: customs_shipments trg_customs_shipment_financial_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customs_shipment_financial_change AFTER UPDATE OF customs_paid_kmf, freight_kmf, allocation_method, allocation_config ON public.customs_shipments FOR EACH ROW EXECUTE FUNCTION public.audit_customs_shipment_financial_change();


--
-- Name: customs_shipments trg_customs_shipments_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customs_shipments_updated BEFORE UPDATE ON public.customs_shipments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customs_history trg_customs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customs_updated_at BEFORE UPDATE ON public.customs_history FOR EACH ROW EXECUTE FUNCTION public.update_customs_updated_at();


--
-- Name: disputes trg_disputes_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_disputes_updated BEFORE UPDATE ON public.disputes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: fabrics trg_fabrics_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fabrics_updated BEFORE UPDATE ON public.fabrics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: hub_purchase_allocations trg_hub_allocation_purchase_line; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hub_allocation_purchase_line BEFORE INSERT ON public.hub_purchase_allocations FOR EACH ROW EXECUTE FUNCTION public.hub_guard_allocation_purchase_line();


--
-- Name: hub_custody_events trg_hub_custody_event_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hub_custody_event_append_only BEFORE DELETE OR UPDATE ON public.hub_custody_events FOR EACH ROW EXECUTE FUNCTION public.hub_reject_custody_event_mutation();


--
-- Name: hub_physical_units trg_hub_physical_unit_insert_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hub_physical_unit_insert_guard BEFORE INSERT ON public.hub_physical_units FOR EACH ROW EXECUTE FUNCTION public.hub_guard_physical_unit_insert();


--
-- Name: hub_physical_units trg_hub_physical_unit_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hub_physical_unit_update_guard BEFORE UPDATE ON public.hub_physical_units FOR EACH ROW EXECUTE FUNCTION public.hub_guard_physical_unit_update();


--
-- Name: hub_physical_unit_placements trg_hub_placement_insert_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hub_placement_insert_guard BEFORE INSERT ON public.hub_physical_unit_placements FOR EACH ROW EXECUTE FUNCTION public.hub_guard_placement_insert();


--
-- Name: hub_physical_unit_placements trg_hub_placement_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hub_placement_no_delete BEFORE DELETE ON public.hub_physical_unit_placements FOR EACH ROW EXECUTE FUNCTION public.hub_reject_placement_delete();


--
-- Name: hub_physical_unit_placements trg_hub_placement_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hub_placement_update_guard BEFORE UPDATE ON public.hub_physical_unit_placements FOR EACH ROW EXECUTE FUNCTION public.hub_guard_placement_update();


--
-- Name: hub_purchase_allocations trg_hub_purchase_allocation_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hub_purchase_allocation_immutable BEFORE DELETE OR UPDATE ON public.hub_purchase_allocations FOR EACH ROW EXECUTE FUNCTION public.hub_reject_purchase_allocation_mutation();


--
-- Name: hub_physical_units trg_hub_quarantine_incident_required; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_hub_quarantine_incident_required AFTER INSERT OR UPDATE OF state, outcome_type ON public.hub_physical_units DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hub_require_quarantine_incident();


--
-- Name: incidents trg_incidents_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incidents_updated BEFORE UPDATE ON public.incidents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: international_shipment_hub_units trg_international_shipment_hub_units_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_international_shipment_hub_units_guard BEFORE INSERT OR DELETE OR UPDATE ON public.international_shipment_hub_units FOR EACH ROW EXECUTE FUNCTION public.international_shipment_hub_units_guard();


--
-- Name: market_cash_destinations trg_market_cash_destinations_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_market_cash_destinations_guard BEFORE INSERT OR UPDATE ON public.market_cash_destinations FOR EACH ROW EXECUTE FUNCTION public.market_cash_destinations_guard();


--
-- Name: market_delegation_audit trg_market_delegation_audit_market_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_market_delegation_audit_market_guard BEFORE INSERT OR UPDATE OF market_id, assignment_id, membership_id ON public.market_delegation_audit FOR EACH ROW EXECUTE FUNCTION public.enforce_market_delegation_audit_market();


--
-- Name: market_settlements trg_market_settlement_invariants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_market_settlement_invariants BEFORE INSERT OR UPDATE ON public.market_settlements FOR EACH ROW EXECUTE FUNCTION public.enforce_market_settlement_invariants();


--
-- Name: market_cost_attributions trg_mca_conservation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_mca_conservation AFTER INSERT ON public.market_cost_attributions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.market_cost_attributions_check_conservation();


--
-- Name: market_cost_attributions trg_mca_guard_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mca_guard_immutable BEFORE DELETE OR UPDATE ON public.market_cost_attributions FOR EACH ROW EXECUTE FUNCTION public.market_cost_attributions_guard_immutable();


--
-- Name: market_cost_attributions trg_mca_guard_reversal_target; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mca_guard_reversal_target BEFORE INSERT ON public.market_cost_attributions FOR EACH ROW EXECUTE FUNCTION public.market_cost_attributions_guard_reversal_target();


--
-- Name: membership_capabilities trg_membership_capability_amount_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_membership_capability_amount_limit BEFORE INSERT OR UPDATE OF capability, membership_id, limit_amount ON public.membership_capabilities FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_capability_amount_limit();


--
-- Name: membership_capabilities trg_membership_capability_ceiling_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_membership_capability_ceiling_guard BEFORE INSERT OR UPDATE OF capability, membership_id ON public.membership_capabilities FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_capability_within_ceiling();


--
-- Name: parcels trg_no_delete_parcels; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_no_delete_parcels BEFORE DELETE ON public.parcels FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete_parcels();


--
-- Name: order_items trg_order_items_fulfillment_source_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_items_fulfillment_source_immutable BEFORE UPDATE OF fulfillment_source ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.prevent_order_item_fulfillment_source_change();


--
-- Name: orders trg_orders_market_id_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_market_id_immutable BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.prevent_orders_market_id_mutation();


--
-- Name: orders trg_orders_relais_market_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_relais_market_consistency BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.prevent_orders_relais_market_mismatch();


--
-- Name: orders trg_orders_simulation_scope_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_simulation_scope_immutable BEFORE UPDATE OF simulation_scope ON public.orders FOR EACH ROW EXECUTE FUNCTION public.prevent_order_simulation_scope_change();


--
-- Name: orders trg_orders_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: parcels trg_parcel_ship_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_parcel_ship_guard BEFORE UPDATE ON public.parcels FOR EACH ROW EXECUTE FUNCTION public.check_parcel_ship_guard();


--
-- Name: parcels trg_parcels_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_parcels_updated BEFORE UPDATE ON public.parcels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: partners trg_partners_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_partners_updated BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cash_deposit_allocations trg_prevent_cash_alloc_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_cash_alloc_delete BEFORE DELETE ON public.cash_deposit_allocations FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_prevent_mutation();


--
-- Name: cash_deposit_allocations trg_prevent_cash_alloc_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_cash_alloc_update BEFORE UPDATE ON public.cash_deposit_allocations FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_prevent_mutation();


--
-- Name: cash_custody_losses trg_prevent_cash_custody_losses_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_cash_custody_losses_delete BEFORE DELETE ON public.cash_custody_losses FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_prevent_mutation();


--
-- Name: cash_custody_losses trg_prevent_cash_custody_losses_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_cash_custody_losses_update BEFORE UPDATE ON public.cash_custody_losses FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_prevent_mutation();


--
-- Name: cash_custody_receipts trg_prevent_cash_custody_receipts_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_cash_custody_receipts_delete BEFORE DELETE ON public.cash_custody_receipts FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_prevent_mutation();


--
-- Name: cash_custody_receipts trg_prevent_cash_custody_receipts_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_cash_custody_receipts_update BEFORE UPDATE ON public.cash_custody_receipts FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_prevent_mutation();


--
-- Name: cash_deposits trg_prevent_cash_deposits_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_cash_deposits_delete BEFORE DELETE ON public.cash_deposits FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_prevent_mutation();


--
-- Name: economic_risk_cost_events trg_prevent_economic_risk_cost_event_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_economic_risk_cost_event_mutation BEFORE DELETE OR UPDATE ON public.economic_risk_cost_events FOR EACH ROW EXECUTE FUNCTION public.prevent_economic_risk_truth_mutation();


--
-- Name: economic_risk_watermark_events trg_prevent_economic_risk_watermark_event_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_economic_risk_watermark_event_mutation BEFORE DELETE OR UPDATE ON public.economic_risk_watermark_events FOR EACH ROW EXECUTE FUNCTION public.prevent_economic_risk_truth_mutation();


--
-- Name: economic_structure_cost_events trg_prevent_economic_structure_cost_event_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_economic_structure_cost_event_mutation BEFORE DELETE OR UPDATE ON public.economic_structure_cost_events FOR EACH ROW EXECUTE FUNCTION public.prevent_economic_structure_cost_event_mutation();


--
-- Name: incidents trg_prevent_incident_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_incident_delete BEFORE DELETE ON public.incidents FOR EACH ROW EXECUTE FUNCTION public.prevent_incident_delete();


--
-- Name: market_cash_destinations trg_prevent_market_cash_destinations_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_market_cash_destinations_delete BEFORE DELETE ON public.market_cash_destinations FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_prevent_mutation();


--
-- Name: market_settlements trg_prevent_market_settlement_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_market_settlement_delete BEFORE DELETE ON public.market_settlements FOR EACH ROW EXECUTE FUNCTION public.prevent_market_settlement_delete();


--
-- Name: market_settlement_events trg_prevent_market_settlement_event_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_market_settlement_event_mutation BEFORE DELETE OR UPDATE ON public.market_settlement_events FOR EACH ROW EXECUTE FUNCTION public.prevent_market_settlement_event_mutation();


--
-- Name: outbox_events trg_prevent_outbox_event_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_outbox_event_delete BEFORE DELETE ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION public.prevent_outbox_event_delete();


--
-- Name: pricing_market_decision_policy_events trg_prevent_pricing_market_decision_policy_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_pricing_market_decision_policy_mutation BEFORE DELETE OR UPDATE ON public.pricing_market_decision_policy_events FOR EACH ROW EXECUTE FUNCTION public.prevent_pricing_market_decision_policy_mutation();


--
-- Name: scan_events trg_prevent_scan_event_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_scan_event_delete BEFORE DELETE ON public.scan_events FOR EACH ROW EXECUTE FUNCTION public.prevent_scan_event_delete();


--
-- Name: pricing_components trg_pricing_components_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pricing_components_updated BEFORE UPDATE ON public.pricing_components FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_attributes trg_product_attributes_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_product_attributes_updated BEFORE UPDATE ON public.product_attributes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_content_profile trg_product_content_profile_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_product_content_profile_updated BEFORE UPDATE ON public.product_content_profile FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_content_sections trg_product_content_sections_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_product_content_sections_updated BEFORE UPDATE ON public.product_content_sections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_skus trg_product_skus_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_product_skus_updated BEFORE UPDATE ON public.product_skus FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_variants trg_product_variants_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_product_variants_updated BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products trg_products_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: purchase_lines trg_purchase_lines_a_groupable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_lines_a_groupable BEFORE INSERT OR UPDATE OF purchase_order_id ON public.purchase_lines FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_groupable();


--
-- Name: purchase_lines trg_purchase_lines_b_market_scope; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_lines_b_market_scope BEFORE INSERT OR UPDATE OF purchase_order_id, order_item_id ON public.purchase_lines FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_market_scope();


--
-- Name: purchase_lines trg_purchase_lines_guard_attachment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_lines_guard_attachment BEFORE INSERT OR UPDATE ON public.purchase_lines FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_attachment();


--
-- Name: purchase_lines trg_purchase_lines_guard_commitment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_lines_guard_commitment BEFORE INSERT OR UPDATE ON public.purchase_lines FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_commitment();


--
-- Name: purchase_lines trg_purchase_lines_guard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_lines_guard_delete BEFORE DELETE ON public.purchase_lines FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_delete();


--
-- Name: purchase_lines trg_purchase_lines_guard_freeze; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_lines_guard_freeze BEFORE UPDATE ON public.purchase_lines FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_freeze();


--
-- Name: purchase_orders trg_purchase_orders_cancel_lines; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_orders_cancel_lines AFTER UPDATE OF status ON public.purchase_orders FOR EACH ROW WHEN (((new.status = 'cancelled'::text) AND (old.status IS DISTINCT FROM 'cancelled'::text))) EXECUTE FUNCTION public.purchase_orders_cancel_lines();


--
-- Name: purchase_orders trg_purchase_orders_market_scope; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_orders_market_scope BEFORE INSERT OR UPDATE OF market_id ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_guard_market_scope();


--
-- Name: purchase_orders trg_purchase_orders_sent_proof; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_orders_sent_proof BEFORE UPDATE OF sent_at, sent_channel, sent_by ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_guard_sent_proof();


--
-- Name: relais trg_relais_market_id_drift_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_relais_market_id_drift_guard BEFORE UPDATE ON public.relais FOR EACH ROW EXECUTE FUNCTION public.prevent_referenced_relais_market_drift();


--
-- Name: risk_provisions trg_risk_provisions_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_risk_provisions_updated BEFORE UPDATE ON public.risk_provisions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sourcing_candidates trg_sc_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sc_updated BEFORE UPDATE ON public.sourcing_candidates FOR EACH ROW EXECUTE FUNCTION public.sc_set_updated();


--
-- Name: shared_carts trg_shared_carts_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_shared_carts_updated BEFORE UPDATE ON public.shared_carts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: shipments trg_shipments_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_shipments_updated BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: supplier_payment_settlements trg_sps_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sps_immutable BEFORE DELETE OR UPDATE ON public.supplier_payment_settlements FOR EACH ROW EXECUTE FUNCTION public.supplier_payment_settlements_immutable();


--
-- Name: supplier_execution_group_members trg_supplier_execution_group_members_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_supplier_execution_group_members_guard BEFORE INSERT OR UPDATE ON public.supplier_execution_group_members FOR EACH ROW EXECUTE FUNCTION public.supplier_execution_group_members_guard();


--
-- Name: supplier_execution_payments trg_supplier_execution_payments_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_supplier_execution_payments_guard BEFORE INSERT OR UPDATE OF purchase_order_id, provider, supplier_execution_order_id, supplier_execution_group_id ON public.supplier_execution_payments FOR EACH ROW EXECUTE FUNCTION public.supplier_execution_payments_guard();


--
-- Name: product_variants trg_sync_has_variants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_has_variants AFTER INSERT OR DELETE OR UPDATE OF product_id ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.sync_has_variants();


--
-- Name: users trg_users_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: alerts alerts_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: assignment_capability_ceiling assignment_capability_ceiling_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_capability_ceiling
    ADD CONSTRAINT assignment_capability_ceiling_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.market_operating_assignments(id) ON DELETE CASCADE;


--
-- Name: assignment_capability_ceiling assignment_capability_ceiling_capability_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_capability_ceiling
    ADD CONSTRAINT assignment_capability_ceiling_capability_fkey FOREIGN KEY (capability) REFERENCES public.capability_registry(capability);


--
-- Name: assignment_capability_ceiling assignment_capability_ceiling_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_capability_ceiling
    ADD CONSTRAINT assignment_capability_ceiling_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: assignment_capability_ceiling assignment_capability_ceiling_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_capability_ceiling
    ADD CONSTRAINT assignment_capability_ceiling_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: assignment_memberships assignment_memberships_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_memberships
    ADD CONSTRAINT assignment_memberships_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.market_operating_assignments(id) ON DELETE CASCADE;


--
-- Name: assignment_memberships assignment_memberships_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_memberships
    ADD CONSTRAINT assignment_memberships_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: assignment_memberships assignment_memberships_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_memberships
    ADD CONSTRAINT assignment_memberships_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: assignment_memberships assignment_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_memberships
    ADD CONSTRAINT assignment_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: basket_items basket_items_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basket_items
    ADD CONSTRAINT basket_items_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: basket_items basket_items_basket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basket_items
    ADD CONSTRAINT basket_items_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;


--
-- Name: basket_items basket_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basket_items
    ADD CONSTRAINT basket_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: baskets baskets_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baskets
    ADD CONSTRAINT baskets_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: boutique_subcategories boutique_subcategories_category_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boutique_subcategories
    ADD CONSTRAINT boutique_subcategories_category_key_fkey FOREIGN KEY (category_key) REFERENCES public.boutique_categories(key) ON DELETE CASCADE;


--
-- Name: boutique_subcategories boutique_subcategories_customs_category_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boutique_subcategories
    ADD CONSTRAINT boutique_subcategories_customs_category_fk FOREIGN KEY (customs_category_key) REFERENCES public.customs_categories(key) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: business_rules_history business_rules_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rules_history
    ADD CONSTRAINT business_rules_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: business_rules_history business_rules_history_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rules_history
    ADD CONSTRAINT business_rules_history_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.business_rules(id);


--
-- Name: cart_shares cart_shares_converted_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_shares
    ADD CONSTRAINT cart_shares_converted_order_id_fkey FOREIGN KEY (converted_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: cash_collections cash_collections_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_collections
    ADD CONSTRAINT cash_collections_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: cash_confirmation_controls cash_confirmation_controls_first_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_confirmation_controls
    ADD CONSTRAINT cash_confirmation_controls_first_actor_user_id_fkey FOREIGN KEY (first_actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: cash_confirmation_controls cash_confirmation_controls_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_confirmation_controls
    ADD CONSTRAINT cash_confirmation_controls_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: cash_confirmation_controls cash_confirmation_controls_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_confirmation_controls
    ADD CONSTRAINT cash_confirmation_controls_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: cash_confirmation_controls cash_confirmation_controls_policy_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_confirmation_controls
    ADD CONSTRAINT cash_confirmation_controls_policy_assignment_id_fkey FOREIGN KEY (policy_assignment_id) REFERENCES public.market_operating_assignments(id) ON DELETE SET NULL;


--
-- Name: cash_confirmation_controls cash_confirmation_controls_relais_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_confirmation_controls
    ADD CONSTRAINT cash_confirmation_controls_relais_id_fkey FOREIGN KEY (relais_id) REFERENCES public.relais(id) ON DELETE RESTRICT;


--
-- Name: cash_confirmation_controls cash_confirmation_controls_second_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_confirmation_controls
    ADD CONSTRAINT cash_confirmation_controls_second_actor_user_id_fkey FOREIGN KEY (second_actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: cash_custody_losses cash_custody_losses_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_losses
    ADD CONSTRAINT cash_custody_losses_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: cash_custody_losses cash_custody_losses_deposit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_losses
    ADD CONSTRAINT cash_custody_losses_deposit_id_fkey FOREIGN KEY (deposit_id) REFERENCES public.cash_deposits(id);


--
-- Name: cash_custody_losses cash_custody_losses_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_losses
    ADD CONSTRAINT cash_custody_losses_holder_id_fkey FOREIGN KEY (holder_id) REFERENCES public.users(id);


--
-- Name: cash_custody_losses cash_custody_losses_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_losses
    ADD CONSTRAINT cash_custody_losses_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: cash_custody_losses cash_custody_losses_reverses_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_losses
    ADD CONSTRAINT cash_custody_losses_reverses_id_fkey FOREIGN KEY (reverses_id) REFERENCES public.cash_custody_losses(id);


--
-- Name: cash_custody_provenance_edges cash_custody_provenance_edges_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_provenance_edges
    ADD CONSTRAINT cash_custody_provenance_edges_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.cash_collections(id);


--
-- Name: cash_custody_provenance_edges cash_custody_provenance_edges_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_provenance_edges
    ADD CONSTRAINT cash_custody_provenance_edges_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: cash_custody_provenance_edges cash_custody_provenance_edges_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_provenance_edges
    ADD CONSTRAINT cash_custody_provenance_edges_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.cash_custody_provenance_edges(id);


--
-- Name: cash_custody_provenance_edges cash_custody_provenance_edges_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_provenance_edges
    ADD CONSTRAINT cash_custody_provenance_edges_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.cash_custody_receipts(id);


--
-- Name: cash_custody_receipts cash_custody_receipts_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_receipts
    ADD CONSTRAINT cash_custody_receipts_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: cash_custody_receipts cash_custody_receipts_deposit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_receipts
    ADD CONSTRAINT cash_custody_receipts_deposit_id_fkey FOREIGN KEY (deposit_id) REFERENCES public.cash_deposits(id);


--
-- Name: cash_custody_receipts cash_custody_receipts_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_receipts
    ADD CONSTRAINT cash_custody_receipts_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: cash_custody_receipts cash_custody_receipts_reverses_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_receipts
    ADD CONSTRAINT cash_custody_receipts_reverses_id_fkey FOREIGN KEY (reverses_id) REFERENCES public.cash_custody_receipts(id);


--
-- Name: cash_deposit_allocations cash_deposit_allocations_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposit_allocations
    ADD CONSTRAINT cash_deposit_allocations_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.cash_collections(id);


--
-- Name: cash_deposit_allocations cash_deposit_allocations_deposit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposit_allocations
    ADD CONSTRAINT cash_deposit_allocations_deposit_id_fkey FOREIGN KEY (deposit_id) REFERENCES public.cash_deposits(id);


--
-- Name: cash_deposit_allocations cash_deposit_allocations_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposit_allocations
    ADD CONSTRAINT cash_deposit_allocations_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: cash_deposits cash_deposits_destination_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_destination_id_fkey FOREIGN KEY (destination_id) REFERENCES public.market_cash_destinations(id);


--
-- Name: cash_deposits cash_deposits_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: cash_deposits cash_deposits_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(id);


--
-- Name: cash_deposits cash_deposits_regularizes_deposit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_regularizes_deposit_id_fkey FOREIGN KEY (regularizes_deposit_id) REFERENCES public.cash_deposits(id);


--
-- Name: catalog_enrichment_runs catalog_enrichment_runs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_enrichment_runs
    ADD CONSTRAINT catalog_enrichment_runs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: catalog_field_overrides catalog_field_overrides_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_field_overrides
    ADD CONSTRAINT catalog_field_overrides_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: catalog_global_access_grants catalog_global_access_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_global_access_grants
    ADD CONSTRAINT catalog_global_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: catalog_global_access_grants catalog_global_access_grants_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_global_access_grants
    ADD CONSTRAINT catalog_global_access_grants_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: catalog_global_access_grants catalog_global_access_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_global_access_grants
    ADD CONSTRAINT catalog_global_access_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: catalog_media catalog_media_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_media
    ADD CONSTRAINT catalog_media_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: catalog_media_recovery_audit catalog_media_recovery_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_media_recovery_audit
    ADD CONSTRAINT catalog_media_recovery_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: catalog_media_recovery_audit catalog_media_recovery_audit_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_media_recovery_audit
    ADD CONSTRAINT catalog_media_recovery_audit_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: catalog_media_visual_fr_reviews catalog_media_visual_fr_reviews_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_media_visual_fr_reviews
    ADD CONSTRAINT catalog_media_visual_fr_reviews_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.catalog_media(id) ON DELETE CASCADE;


--
-- Name: catalog_publication_decision_audit catalog_publication_decision_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_publication_decision_audit
    ADD CONSTRAINT catalog_publication_decision_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: catalog_publication_decision_audit catalog_publication_decision_audit_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_publication_decision_audit
    ADD CONSTRAINT catalog_publication_decision_audit_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: catalog_stock_sync_state catalog_stock_sync_state_product_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_stock_sync_state
    ADD CONSTRAINT catalog_stock_sync_state_product_sku_id_fkey FOREIGN KEY (product_sku_id) REFERENCES public.product_skus(id) ON DELETE CASCADE;


--
-- Name: catalog_taxonomy_audit catalog_taxonomy_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_taxonomy_audit
    ADD CONSTRAINT catalog_taxonomy_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ceiling_template_capabilities ceiling_template_capabilities_capability_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ceiling_template_capabilities
    ADD CONSTRAINT ceiling_template_capabilities_capability_fkey FOREIGN KEY (capability) REFERENCES public.capability_registry(capability);


--
-- Name: ceiling_template_capabilities ceiling_template_capabilities_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ceiling_template_capabilities
    ADD CONSTRAINT ceiling_template_capabilities_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.ceiling_templates(id) ON DELETE CASCADE;


--
-- Name: charges charges_market_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_market_owner_id_fkey FOREIGN KEY (market_owner_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: client_notifications client_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notifications
    ADD CONSTRAINT client_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: competitor_prices competitor_prices_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_prices
    ADD CONSTRAINT competitor_prices_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: cost_component_events cost_component_events_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_events
    ADD CONSTRAINT cost_component_events_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.cost_components(id) ON DELETE SET NULL;


--
-- Name: cost_component_events cost_component_events_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_events
    ADD CONSTRAINT cost_component_events_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cost_component_market_override_events cost_component_market_override_events_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_override_events
    ADD CONSTRAINT cost_component_market_override_events_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.cost_components(id) ON DELETE SET NULL;


--
-- Name: cost_component_market_override_events cost_component_market_override_events_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_override_events
    ADD CONSTRAINT cost_component_market_override_events_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: cost_component_market_override_events cost_component_market_override_events_override_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_override_events
    ADD CONSTRAINT cost_component_market_override_events_override_id_fkey FOREIGN KEY (override_id) REFERENCES public.cost_component_market_overrides(id) ON DELETE SET NULL;


--
-- Name: cost_component_market_override_events cost_component_market_override_events_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_override_events
    ADD CONSTRAINT cost_component_market_override_events_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cost_component_market_overrides cost_component_market_overrides_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_overrides
    ADD CONSTRAINT cost_component_market_overrides_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.cost_components(id);


--
-- Name: cost_component_market_overrides cost_component_market_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_overrides
    ADD CONSTRAINT cost_component_market_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cost_component_market_overrides cost_component_market_overrides_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_overrides
    ADD CONSTRAINT cost_component_market_overrides_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: cost_component_market_overrides cost_component_market_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_component_market_overrides
    ADD CONSTRAINT cost_component_market_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cost_components cost_components_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_components
    ADD CONSTRAINT cost_components_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cost_components cost_components_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_components
    ADD CONSTRAINT cost_components_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customs_history customs_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_history
    ADD CONSTRAINT customs_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: customs_history customs_history_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_history
    ADD CONSTRAINT customs_history_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customs_history customs_history_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_history
    ADD CONSTRAINT customs_history_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;


--
-- Name: customs_shipment_fees customs_shipment_fees_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_fees
    ADD CONSTRAINT customs_shipment_fees_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.customs_shipments(id) ON DELETE RESTRICT;


--
-- Name: customs_shipment_parcels customs_shipment_parcels_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_parcels
    ADD CONSTRAINT customs_shipment_parcels_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id) ON DELETE CASCADE;


--
-- Name: customs_shipment_parcels customs_shipment_parcels_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipment_parcels
    ADD CONSTRAINT customs_shipment_parcels_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.customs_shipments(id) ON DELETE CASCADE;


--
-- Name: customs_shipments customs_shipments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipments
    ADD CONSTRAINT customs_shipments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: customs_shipments customs_shipments_declared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipments
    ADD CONSTRAINT customs_shipments_declared_by_fkey FOREIGN KEY (declared_by) REFERENCES public.users(id);


--
-- Name: customs_shipments customs_shipments_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipments
    ADD CONSTRAINT customs_shipments_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: customs_shipments customs_shipments_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_shipments
    ADD CONSTRAINT customs_shipments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.partners(id) ON DELETE SET NULL;


--
-- Name: dashboard_global_access_grants dashboard_global_access_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_global_access_grants
    ADD CONSTRAINT dashboard_global_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: dashboard_global_access_grants dashboard_global_access_grants_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_global_access_grants
    ADD CONSTRAINT dashboard_global_access_grants_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: dashboard_global_access_grants dashboard_global_access_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_global_access_grants
    ADD CONSTRAINT dashboard_global_access_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: decision_signal_global_access_grants decision_signal_global_access_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_signal_global_access_grants
    ADD CONSTRAINT decision_signal_global_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: decision_signal_global_access_grants decision_signal_global_access_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_signal_global_access_grants
    ADD CONSTRAINT decision_signal_global_access_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: disputes disputes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: disputes disputes_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: disputes disputes_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: economic_risk_cost_events economic_risk_cost_events_adjusts_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_risk_cost_events
    ADD CONSTRAINT economic_risk_cost_events_adjusts_event_id_fkey FOREIGN KEY (adjusts_event_id) REFERENCES public.economic_risk_cost_events(id) ON DELETE RESTRICT;


--
-- Name: economic_risk_cost_events economic_risk_cost_events_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_risk_cost_events
    ADD CONSTRAINT economic_risk_cost_events_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: economic_risk_cost_events economic_risk_cost_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_risk_cost_events
    ADD CONSTRAINT economic_risk_cost_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: economic_risk_cost_events economic_risk_cost_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_risk_cost_events
    ADD CONSTRAINT economic_risk_cost_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: economic_risk_cost_events economic_risk_cost_events_risk_provision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_risk_cost_events
    ADD CONSTRAINT economic_risk_cost_events_risk_provision_id_fkey FOREIGN KEY (risk_provision_id) REFERENCES public.risk_provisions(id) ON DELETE RESTRICT;


--
-- Name: economic_risk_watermark_events economic_risk_watermark_events_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_risk_watermark_events
    ADD CONSTRAINT economic_risk_watermark_events_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: economic_risk_watermark_events economic_risk_watermark_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_risk_watermark_events
    ADD CONSTRAINT economic_risk_watermark_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: economic_structure_cost_events economic_structure_cost_events_adjusts_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_structure_cost_events
    ADD CONSTRAINT economic_structure_cost_events_adjusts_event_id_fkey FOREIGN KEY (adjusts_event_id) REFERENCES public.economic_structure_cost_events(id) ON DELETE RESTRICT;


--
-- Name: economic_structure_cost_events economic_structure_cost_events_charge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_structure_cost_events
    ADD CONSTRAINT economic_structure_cost_events_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES public.charges(id) ON DELETE RESTRICT;


--
-- Name: economic_structure_cost_events economic_structure_cost_events_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_structure_cost_events
    ADD CONSTRAINT economic_structure_cost_events_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: economic_structure_cost_events economic_structure_cost_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_structure_cost_events
    ADD CONSTRAINT economic_structure_cost_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: hub_custody_events hub_custody_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_custody_events
    ADD CONSTRAINT hub_custody_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: hub_custody_events hub_custody_events_allocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_custody_events
    ADD CONSTRAINT hub_custody_events_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES public.hub_purchase_allocations(id) ON DELETE RESTRICT;


--
-- Name: hub_custody_events hub_custody_events_physical_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_custody_events
    ADD CONSTRAINT hub_custody_events_physical_unit_id_fkey FOREIGN KEY (physical_unit_id) REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT;


--
-- Name: hub_physical_unit_placements hub_physical_unit_placements_allocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_physical_unit_placements
    ADD CONSTRAINT hub_physical_unit_placements_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES public.hub_purchase_allocations(id) ON DELETE RESTRICT;


--
-- Name: hub_physical_unit_placements hub_physical_unit_placements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_physical_unit_placements
    ADD CONSTRAINT hub_physical_unit_placements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: hub_physical_unit_placements hub_physical_unit_placements_physical_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_physical_unit_placements
    ADD CONSTRAINT hub_physical_unit_placements_physical_unit_id_fkey FOREIGN KEY (physical_unit_id) REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT;


--
-- Name: hub_physical_units hub_physical_units_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_physical_units
    ADD CONSTRAINT hub_physical_units_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: hub_physical_units hub_physical_units_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_physical_units
    ADD CONSTRAINT hub_physical_units_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: hub_purchase_allocations hub_purchase_allocations_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_purchase_allocations
    ADD CONSTRAINT hub_purchase_allocations_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: hub_purchase_allocations hub_purchase_allocations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_purchase_allocations
    ADD CONSTRAINT hub_purchase_allocations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: hub_purchase_allocations hub_purchase_allocations_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_purchase_allocations
    ADD CONSTRAINT hub_purchase_allocations_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE RESTRICT;


--
-- Name: hub_purchase_allocations hub_purchase_allocations_product_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_purchase_allocations
    ADD CONSTRAINT hub_purchase_allocations_product_sku_id_fkey FOREIGN KEY (product_sku_id) REFERENCES public.product_skus(id) ON DELETE RESTRICT;


--
-- Name: hub_purchase_allocations hub_purchase_allocations_purchase_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_purchase_allocations
    ADD CONSTRAINT hub_purchase_allocations_purchase_line_id_fkey FOREIGN KEY (purchase_line_id) REFERENCES public.purchase_lines(id) ON DELETE RESTRICT;


--
-- Name: hub_purchase_allocations hub_purchase_allocations_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_purchase_allocations
    ADD CONSTRAINT hub_purchase_allocations_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;


--
-- Name: hub_purchase_allocations hub_purchase_allocations_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_purchase_allocations
    ADD CONSTRAINT hub_purchase_allocations_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: import_runtime_item_events import_runtime_item_events_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runtime_item_events
    ADD CONSTRAINT import_runtime_item_events_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.sourcing_candidates(id) ON DELETE SET NULL;


--
-- Name: import_runtime_item_events import_runtime_item_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runtime_item_events
    ADD CONSTRAINT import_runtime_item_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.import_runtime_runs(id) ON DELETE CASCADE;


--
-- Name: import_runtime_runs import_runtime_runs_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runtime_runs
    ADD CONSTRAINT import_runtime_runs_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.supplier_catalog_imports(id) ON DELETE SET NULL;


--
-- Name: import_runtime_runs import_runtime_runs_started_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runtime_runs
    ADD CONSTRAINT import_runtime_runs_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: incidents incidents_detected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_detected_by_fkey FOREIGN KEY (detected_by) REFERENCES public.users(id);


--
-- Name: incidents incidents_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: incidents incidents_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id) ON DELETE SET NULL;


--
-- Name: incidents incidents_parent_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_parent_incident_id_fkey FOREIGN KEY (parent_incident_id) REFERENCES public.incidents(id);


--
-- Name: incidents incidents_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: incidents incidents_scan_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_scan_event_id_fkey FOREIGN KEY (scan_event_id) REFERENCES public.scan_events(id) ON DELETE SET NULL;


--
-- Name: inquiries inquiries_physical_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiries
    ADD CONSTRAINT inquiries_physical_offer_id_fkey FOREIGN KEY (physical_offer_id) REFERENCES public.physical_offers(id) ON DELETE CASCADE;


--
-- Name: inquiries inquiries_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiries
    ADD CONSTRAINT inquiries_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: international_n1_allocation_links international_n1_allocation_links_allocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_n1_allocation_links
    ADD CONSTRAINT international_n1_allocation_links_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES public.order_item_real_cost_allocations(id) ON DELETE CASCADE;


--
-- Name: international_n1_allocation_links international_n1_allocation_links_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_n1_allocation_links
    ADD CONSTRAINT international_n1_allocation_links_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id);


--
-- Name: international_n1_allocation_links international_n1_allocation_links_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_n1_allocation_links
    ADD CONSTRAINT international_n1_allocation_links_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id);


--
-- Name: international_n1_allocation_links international_n1_allocation_links_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_n1_allocation_links
    ADD CONSTRAINT international_n1_allocation_links_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.international_shipments(id) ON DELETE RESTRICT;


--
-- Name: international_n1_reconciliations international_n1_reconciliations_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_n1_reconciliations
    ADD CONSTRAINT international_n1_reconciliations_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.international_shipments(id) ON DELETE RESTRICT;


--
-- Name: international_shipment_charges international_shipment_charges_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_charges
    ADD CONSTRAINT international_shipment_charges_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.international_shipments(id) ON DELETE RESTRICT;


--
-- Name: international_shipment_events international_shipment_events_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_events
    ADD CONSTRAINT international_shipment_events_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.international_shipments(id) ON DELETE RESTRICT;


--
-- Name: international_shipment_hub_units international_shipment_hub_units_attached_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_hub_units
    ADD CONSTRAINT international_shipment_hub_units_attached_by_fkey FOREIGN KEY (attached_by) REFERENCES public.users(id);


--
-- Name: international_shipment_hub_units international_shipment_hub_units_physical_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_hub_units
    ADD CONSTRAINT international_shipment_hub_units_physical_unit_id_fkey FOREIGN KEY (physical_unit_id) REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT;


--
-- Name: international_shipment_hub_units international_shipment_hub_units_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_hub_units
    ADD CONSTRAINT international_shipment_hub_units_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.international_shipments(id) ON DELETE RESTRICT;


--
-- Name: international_shipment_parcels international_shipment_parcels_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_parcels
    ADD CONSTRAINT international_shipment_parcels_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id) ON DELETE RESTRICT;


--
-- Name: international_shipment_parcels international_shipment_parcels_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipment_parcels
    ADD CONSTRAINT international_shipment_parcels_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.international_shipments(id) ON DELETE RESTRICT;


--
-- Name: international_shipments international_shipments_customs_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipments
    ADD CONSTRAINT international_shipments_customs_shipment_id_fkey FOREIGN KEY (customs_shipment_id) REFERENCES public.customs_shipments(id) ON DELETE RESTRICT;


--
-- Name: international_shipments international_shipments_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.international_shipments
    ADD CONSTRAINT international_shipments_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: invoices invoices_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: invoices invoices_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id);


--
-- Name: local_stock_allocations local_stock_allocations_local_stock_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_stock_allocations
    ADD CONSTRAINT local_stock_allocations_local_stock_id_fkey FOREIGN KEY (local_stock_id) REFERENCES public.local_stock(id) ON DELETE CASCADE;


--
-- Name: local_stock_allocations local_stock_allocations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_stock_allocations
    ADD CONSTRAINT local_stock_allocations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: local_stock local_stock_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_stock
    ADD CONSTRAINT local_stock_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: local_stock local_stock_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_stock
    ADD CONSTRAINT local_stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: local_stock local_stock_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_stock
    ADD CONSTRAINT local_stock_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: loyalty_rewards loyalty_rewards_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rewards
    ADD CONSTRAINT loyalty_rewards_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: loyalty_rewards loyalty_rewards_triggered_by_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rewards
    ADD CONSTRAINT loyalty_rewards_triggered_by_order_id_fkey FOREIGN KEY (triggered_by_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: loyalty_rewards loyalty_rewards_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rewards
    ADD CONSTRAINT loyalty_rewards_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: market_cash_control_policies market_cash_control_policies_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_control_policies
    ADD CONSTRAINT market_cash_control_policies_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.market_operating_assignments(id) ON DELETE RESTRICT;


--
-- Name: market_cash_control_policies market_cash_control_policies_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_control_policies
    ADD CONSTRAINT market_cash_control_policies_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: market_cash_control_policies market_cash_control_policies_updated_by_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_control_policies
    ADD CONSTRAINT market_cash_control_policies_updated_by_membership_id_fkey FOREIGN KEY (updated_by_membership_id) REFERENCES public.assignment_memberships(id) ON DELETE SET NULL;


--
-- Name: market_cash_destinations market_cash_destinations_activated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_destinations
    ADD CONSTRAINT market_cash_destinations_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: market_cash_destinations market_cash_destinations_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_destinations
    ADD CONSTRAINT market_cash_destinations_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: market_cash_destinations market_cash_destinations_payment_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_destinations
    ADD CONSTRAINT market_cash_destinations_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.market_payment_accounts(id) ON DELETE RESTRICT;


--
-- Name: market_cash_destinations market_cash_destinations_proposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cash_destinations
    ADD CONSTRAINT market_cash_destinations_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: market_central_collection_modes market_central_collection_modes_authorized_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_central_collection_modes
    ADD CONSTRAINT market_central_collection_modes_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES public.users(id);


--
-- Name: market_central_collection_modes market_central_collection_modes_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_central_collection_modes
    ADD CONSTRAINT market_central_collection_modes_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: market_cost_attributions market_cost_attributions_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cost_attributions
    ADD CONSTRAINT market_cost_attributions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: market_cost_attributions market_cost_attributions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cost_attributions
    ADD CONSTRAINT market_cost_attributions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: market_cost_attributions market_cost_attributions_reverses_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cost_attributions
    ADD CONSTRAINT market_cost_attributions_reverses_id_fkey FOREIGN KEY (reverses_id) REFERENCES public.market_cost_attributions(id);


--
-- Name: market_cost_attributions market_cost_attributions_source_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cost_attributions
    ADD CONSTRAINT market_cost_attributions_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES public.economic_structure_cost_events(id);


--
-- Name: market_delegation_audit market_delegation_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delegation_audit
    ADD CONSTRAINT market_delegation_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: market_delegation_audit market_delegation_audit_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delegation_audit
    ADD CONSTRAINT market_delegation_audit_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.market_operating_assignments(id) ON DELETE SET NULL;


--
-- Name: market_delegation_audit market_delegation_audit_capability_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delegation_audit
    ADD CONSTRAINT market_delegation_audit_capability_fkey FOREIGN KEY (capability) REFERENCES public.capability_registry(capability);


--
-- Name: market_delegation_audit market_delegation_audit_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delegation_audit
    ADD CONSTRAINT market_delegation_audit_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: market_delegation_audit market_delegation_audit_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delegation_audit
    ADD CONSTRAINT market_delegation_audit_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.assignment_memberships(id) ON DELETE SET NULL;


--
-- Name: market_delivery_attestations market_delivery_attestations_attested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delivery_attestations
    ADD CONSTRAINT market_delivery_attestations_attested_by_fkey FOREIGN KEY (attested_by) REFERENCES public.users(id);


--
-- Name: market_delivery_attestations market_delivery_attestations_carrier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delivery_attestations
    ADD CONSTRAINT market_delivery_attestations_carrier_id_fkey FOREIGN KEY (carrier_id) REFERENCES public.carriers(id);


--
-- Name: market_delivery_attestations market_delivery_attestations_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delivery_attestations
    ADD CONSTRAINT market_delivery_attestations_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: market_delivery_attestations market_delivery_attestations_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delivery_attestations
    ADD CONSTRAINT market_delivery_attestations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: market_operating_assignments market_operating_assignments_central_referent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_operating_assignments
    ADD CONSTRAINT market_operating_assignments_central_referent_user_id_fkey FOREIGN KEY (central_referent_user_id) REFERENCES public.users(id);


--
-- Name: market_operating_assignments market_operating_assignments_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_operating_assignments
    ADD CONSTRAINT market_operating_assignments_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: market_operating_assignments market_operating_assignments_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_operating_assignments
    ADD CONSTRAINT market_operating_assignments_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: market_payment_accounts market_payment_accounts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_payment_accounts
    ADD CONSTRAINT market_payment_accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: market_payment_accounts market_payment_accounts_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_payment_accounts
    ADD CONSTRAINT market_payment_accounts_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: market_payment_accounts market_payment_accounts_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_payment_accounts
    ADD CONSTRAINT market_payment_accounts_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: market_payment_providers market_payment_providers_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_payment_providers
    ADD CONSTRAINT market_payment_providers_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_price_observation_events market_price_observation_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observation_events
    ADD CONSTRAINT market_price_observation_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: market_price_observation_events market_price_observation_events_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observation_events
    ADD CONSTRAINT market_price_observation_events_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_price_observation_events market_price_observation_events_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observation_events
    ADD CONSTRAINT market_price_observation_events_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.market_price_observations(id) ON DELETE SET NULL;


--
-- Name: market_price_observation_events market_price_observation_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observation_events
    ADD CONSTRAINT market_price_observation_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: market_price_observations market_price_observations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observations
    ADD CONSTRAINT market_price_observations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: market_price_observations market_price_observations_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observations
    ADD CONSTRAINT market_price_observations_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_price_observations market_price_observations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price_observations
    ADD CONSTRAINT market_price_observations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: market_settlement_events market_settlement_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlement_events
    ADD CONSTRAINT market_settlement_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: market_settlement_events market_settlement_events_settlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlement_events
    ADD CONSTRAINT market_settlement_events_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.market_settlements(id) ON DELETE RESTRICT;


--
-- Name: market_settlements market_settlements_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlements
    ADD CONSTRAINT market_settlements_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.market_operating_assignments(id) ON DELETE RESTRICT;


--
-- Name: market_settlements market_settlements_attested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlements
    ADD CONSTRAINT market_settlements_attested_by_fkey FOREIGN KEY (attested_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: market_settlements market_settlements_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlements
    ADD CONSTRAINT market_settlements_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: market_settlements market_settlements_paid_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlements
    ADD CONSTRAINT market_settlements_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: market_settlements market_settlements_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlements
    ADD CONSTRAINT market_settlements_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: market_settlements market_settlements_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_settlements
    ADD CONSTRAINT market_settlements_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: market_team_invitations market_team_invitations_accepted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_team_invitations
    ADD CONSTRAINT market_team_invitations_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES public.users(id);


--
-- Name: market_team_invitations market_team_invitations_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_team_invitations
    ADD CONSTRAINT market_team_invitations_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.market_operating_assignments(id) ON DELETE CASCADE;


--
-- Name: market_team_invitations market_team_invitations_invited_by_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_team_invitations
    ADD CONSTRAINT market_team_invitations_invited_by_membership_id_fkey FOREIGN KEY (invited_by_membership_id) REFERENCES public.assignment_memberships(id);


--
-- Name: market_team_invitations market_team_invitations_invited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_team_invitations
    ADD CONSTRAINT market_team_invitations_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id);


--
-- Name: market_team_invitations market_team_invitations_revoked_by_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_team_invitations
    ADD CONSTRAINT market_team_invitations_revoked_by_membership_id_fkey FOREIGN KEY (revoked_by_membership_id) REFERENCES public.assignment_memberships(id);


--
-- Name: market_transport_sale_rates market_transport_sale_rates_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_transport_sale_rates
    ADD CONSTRAINT market_transport_sale_rates_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: market_transport_sale_rates market_transport_sale_rates_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_transport_sale_rates
    ADD CONSTRAINT market_transport_sale_rates_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: membership_capabilities membership_capabilities_capability_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_capabilities
    ADD CONSTRAINT membership_capabilities_capability_fkey FOREIGN KEY (capability) REFERENCES public.capability_registry(capability);


--
-- Name: membership_capabilities membership_capabilities_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_capabilities
    ADD CONSTRAINT membership_capabilities_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: membership_capabilities membership_capabilities_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_capabilities
    ADD CONSTRAINT membership_capabilities_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.assignment_memberships(id) ON DELETE CASCADE;


--
-- Name: membership_capabilities membership_capabilities_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_capabilities
    ADD CONSTRAINT membership_capabilities_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: mobile_money_transactions mobile_money_transactions_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_money_transactions
    ADD CONSTRAINT mobile_money_transactions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: mobile_money_transactions mobile_money_transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_money_transactions
    ADD CONSTRAINT mobile_money_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: operator_market_scopes operator_market_scopes_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_market_scopes
    ADD CONSTRAINT operator_market_scopes_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: operator_market_scopes operator_market_scopes_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_market_scopes
    ADD CONSTRAINT operator_market_scopes_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: operator_market_scopes operator_market_scopes_projected_from_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_market_scopes
    ADD CONSTRAINT operator_market_scopes_projected_from_membership_id_fkey FOREIGN KEY (projected_from_membership_id) REFERENCES public.assignment_memberships(id);


--
-- Name: operator_market_scopes operator_market_scopes_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_market_scopes
    ADD CONSTRAINT operator_market_scopes_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: operator_market_scopes operator_market_scopes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_market_scopes
    ADD CONSTRAINT operator_market_scopes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: order_comments order_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_comments
    ADD CONSTRAINT order_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: order_comments order_comments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_comments
    ADD CONSTRAINT order_comments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_incidents order_incidents_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_incidents
    ADD CONSTRAINT order_incidents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_incidents order_incidents_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_incidents
    ADD CONSTRAINT order_incidents_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);


--
-- Name: order_incidents order_incidents_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_incidents
    ADD CONSTRAINT order_incidents_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: order_item_cost_imputations order_item_cost_imputations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_cost_imputations
    ADD CONSTRAINT order_item_cost_imputations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_item_cost_imputations order_item_cost_imputations_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_cost_imputations
    ADD CONSTRAINT order_item_cost_imputations_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


--
-- Name: order_item_cost_imputations order_item_cost_imputations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_cost_imputations
    ADD CONSTRAINT order_item_cost_imputations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: order_item_real_cost_allocations order_item_real_cost_allocations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_real_cost_allocations
    ADD CONSTRAINT order_item_real_cost_allocations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: order_item_real_cost_allocations order_item_real_cost_allocations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_real_cost_allocations
    ADD CONSTRAINT order_item_real_cost_allocations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_item_real_cost_allocations order_item_real_cost_allocations_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_real_cost_allocations
    ADD CONSTRAINT order_item_real_cost_allocations_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


--
-- Name: order_item_real_cost_allocations order_item_real_cost_allocations_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_real_cost_allocations
    ADD CONSTRAINT order_item_real_cost_allocations_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id) ON DELETE SET NULL;


--
-- Name: order_item_real_cost_allocations order_item_real_cost_allocations_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_real_cost_allocations
    ADD CONSTRAINT order_item_real_cost_allocations_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.customs_shipments(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_ceremony_fabric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_ceremony_fabric_id_fkey FOREIGN KEY (module_fabric_id) REFERENCES public.fabrics(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: order_items order_items_shared_cart_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_shared_cart_item_id_fkey FOREIGN KEY (shared_cart_item_id) REFERENCES public.shared_cart_items(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES public.product_skus(id) ON DELETE SET NULL;


--
-- Name: order_status_history order_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: order_status_history order_status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_status_history order_status_history_scan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_scan_id_fkey FOREIGN KEY (scan_id) REFERENCES public.scans(id);


--
-- Name: orders orders_basket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE SET NULL;


--
-- Name: orders orders_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.shipment_batches(id) ON DELETE SET NULL;


--
-- Name: orders orders_ceremony_fabric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_ceremony_fabric_id_fkey FOREIGN KEY (module_fabric_id) REFERENCES public.fabrics(id) ON DELETE SET NULL;


--
-- Name: orders orders_confection_artisan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_confection_artisan_id_fkey FOREIGN KEY (confection_artisan_id) REFERENCES public.partners(id) ON DELETE SET NULL;


--
-- Name: orders orders_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: orders orders_payment_received_by_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_payment_received_by_agent_id_fkey FOREIGN KEY (payment_received_by_agent_id) REFERENCES public.users(id);


--
-- Name: orders orders_pickup_code_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pickup_code_recipient_user_id_fkey FOREIGN KEY (pickup_code_recipient_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: orders orders_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.recipients(id);


--
-- Name: orders orders_relais_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_relais_id_fkey FOREIGN KEY (relais_id) REFERENCES public.relais(id);


--
-- Name: orders orders_shared_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shared_cart_id_fkey FOREIGN KEY (shared_cart_id) REFERENCES public.shared_carts(id) ON DELETE SET NULL;


--
-- Name: orders orders_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id);


--
-- Name: orders orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.partners(id) ON DELETE SET NULL;


--
-- Name: orders orders_tracking_phone_confirmed_by_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_tracking_phone_confirmed_by_agent_id_fkey FOREIGN KEY (tracking_phone_confirmed_by_agent_id) REFERENCES public.users(id);


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: parcel_events parcel_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_events
    ADD CONSTRAINT parcel_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: parcel_events parcel_events_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_events
    ADD CONSTRAINT parcel_events_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id) ON DELETE CASCADE;


--
-- Name: parcel_items parcel_items_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_items
    ADD CONSTRAINT parcel_items_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id);


--
-- Name: parcel_items parcel_items_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_items
    ADD CONSTRAINT parcel_items_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id) ON DELETE CASCADE;


--
-- Name: parcel_items parcel_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_items
    ADD CONSTRAINT parcel_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: parcels parcels_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: parcels parcels_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: parcels parcels_relais_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_relais_id_fkey FOREIGN KEY (relais_id) REFERENCES public.relais(id);


--
-- Name: parcels parcels_relay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_relay_id_fkey FOREIGN KEY (relay_id) REFERENCES public.relais(id);


--
-- Name: parcels parcels_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id);


--
-- Name: partners partners_relais_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_relais_id_fkey FOREIGN KEY (relais_id) REFERENCES public.relais(id) ON DELETE SET NULL;


--
-- Name: physical_offers physical_offers_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_offers
    ADD CONSTRAINT physical_offers_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: physical_offers physical_offers_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_offers
    ADD CONSTRAINT physical_offers_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: physical_outcome_receipts physical_outcome_receipts_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_outcome_receipts
    ADD CONSTRAINT physical_outcome_receipts_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.outbox_events(id) ON DELETE RESTRICT;


--
-- Name: pickup_print_tokens pickup_print_tokens_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_print_tokens
    ADD CONSTRAINT pickup_print_tokens_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: pickup_reveal_codes pickup_reveal_codes_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_reveal_codes
    ADD CONSTRAINT pickup_reveal_codes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: price_history price_history_applied_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: price_history price_history_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: pricing_category_dims pricing_category_dims_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_category_dims
    ADD CONSTRAINT pricing_category_dims_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pricing_category_taxes pricing_category_taxes_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_category_taxes
    ADD CONSTRAINT pricing_category_taxes_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pricing_global_access_grants pricing_global_access_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_global_access_grants
    ADD CONSTRAINT pricing_global_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pricing_global_access_grants pricing_global_access_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_global_access_grants
    ADD CONSTRAINT pricing_global_access_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pricing_market_decision_policy_events pricing_market_decision_policy_events_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_market_decision_policy_events
    ADD CONSTRAINT pricing_market_decision_policy_events_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: pricing_market_decision_policy_events pricing_market_decision_policy_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_market_decision_policy_events
    ADD CONSTRAINT pricing_market_decision_policy_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: pricing_matrices_audit pricing_matrices_audit_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_matrices_audit
    ADD CONSTRAINT pricing_matrices_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pricing_maturity_disposition_events pricing_maturity_disposition_events_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_maturity_disposition_events
    ADD CONSTRAINT pricing_maturity_disposition_events_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: pricing_maturity_disposition_events pricing_maturity_disposition_events_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_maturity_disposition_events
    ADD CONSTRAINT pricing_maturity_disposition_events_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: pricing_maturity_disposition_events pricing_maturity_disposition_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_maturity_disposition_events
    ADD CONSTRAINT pricing_maturity_disposition_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: pricing_strategies pricing_strategies_applied_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_strategies
    ADD CONSTRAINT pricing_strategies_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pricing_strategies pricing_strategies_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_strategies
    ADD CONSTRAINT pricing_strategies_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: pricing_strategy_history pricing_strategy_history_applied_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_strategy_history
    ADD CONSTRAINT pricing_strategy_history_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pricing_strategy_history pricing_strategy_history_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_strategy_history
    ADD CONSTRAINT pricing_strategy_history_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_attributes product_attributes_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attributes
    ADD CONSTRAINT product_attributes_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_content_profile product_content_profile_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_content_profile
    ADD CONSTRAINT product_content_profile_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_content_sections product_content_sections_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_content_sections
    ADD CONSTRAINT product_content_sections_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_market_exposure product_market_exposure_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_exposure
    ADD CONSTRAINT product_market_exposure_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: product_market_exposure product_market_exposure_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_exposure
    ADD CONSTRAINT product_market_exposure_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: product_market_exposure product_market_exposure_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_exposure
    ADD CONSTRAINT product_market_exposure_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_market_price_draft_events product_market_price_draft_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_price_draft_events
    ADD CONSTRAINT product_market_price_draft_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: product_market_price_draft_events product_market_price_draft_events_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_price_draft_events
    ADD CONSTRAINT product_market_price_draft_events_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: product_market_price_draft_events product_market_price_draft_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_price_draft_events
    ADD CONSTRAINT product_market_price_draft_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_market_price_drafts product_market_price_drafts_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_price_drafts
    ADD CONSTRAINT product_market_price_drafts_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: product_market_price_drafts product_market_price_drafts_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_price_drafts
    ADD CONSTRAINT product_market_price_drafts_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: product_market_price_drafts product_market_price_drafts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_market_price_drafts
    ADD CONSTRAINT product_market_price_drafts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_sku_media product_sku_media_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sku_media
    ADD CONSTRAINT product_sku_media_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.catalog_media(id) ON DELETE CASCADE;


--
-- Name: product_sku_media product_sku_media_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sku_media
    ADD CONSTRAINT product_sku_media_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES public.product_skus(id) ON DELETE CASCADE;


--
-- Name: product_skus product_skus_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_skus
    ADD CONSTRAINT product_skus_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_suppliers product_suppliers_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_suppliers
    ADD CONSTRAINT product_suppliers_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_suppliers product_suppliers_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_suppliers
    ADD CONSTRAINT product_suppliers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: provider_credentials provider_credentials_replaces_ref_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_credentials
    ADD CONSTRAINT provider_credentials_replaces_ref_fkey FOREIGN KEY (replaces_ref) REFERENCES public.provider_credentials(credential_ref);


--
-- Name: providers providers_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: purchase_lines purchase_lines_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_lines
    ADD CONSTRAINT purchase_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: purchase_lines purchase_lines_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_lines
    ADD CONSTRAINT purchase_lines_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


--
-- Name: purchase_lines purchase_lines_parent_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_lines
    ADD CONSTRAINT purchase_lines_parent_line_id_fkey FOREIGN KEY (parent_line_id) REFERENCES public.purchase_lines(id);


--
-- Name: purchase_lines purchase_lines_product_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_lines
    ADD CONSTRAINT purchase_lines_product_sku_id_fkey FOREIGN KEY (product_sku_id) REFERENCES public.product_skus(id);


--
-- Name: purchase_lines purchase_lines_product_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_lines
    ADD CONSTRAINT purchase_lines_product_supplier_id_fkey FOREIGN KEY (product_supplier_id) REFERENCES public.product_suppliers(id) ON DELETE SET NULL;


--
-- Name: purchase_lines purchase_lines_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_lines
    ADD CONSTRAINT purchase_lines_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: purchase_lines purchase_lines_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_lines
    ADD CONSTRAINT purchase_lines_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: purchase_orders purchase_orders_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: purchase_orders purchase_orders_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: purchase_orders purchase_orders_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_product_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_product_sku_id_fkey FOREIGN KEY (product_sku_id) REFERENCES public.product_skus(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_product_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_product_supplier_id_fkey FOREIGN KEY (product_supplier_id) REFERENCES public.product_suppliers(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id);


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: recipients recipients_relais_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipients
    ADD CONSTRAINT recipients_relais_id_fkey FOREIGN KEY (relais_id) REFERENCES public.relais(id);


--
-- Name: recipients recipients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipients
    ADD CONSTRAINT recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: refund_execution_intents refund_execution_intents_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_execution_intents
    ADD CONSTRAINT refund_execution_intents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: refunds refunds_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: refunds refunds_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: relais relais_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relais
    ADD CONSTRAINT relais_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: scan_events scan_events_corrects_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_events
    ADD CONSTRAINT scan_events_corrects_event_id_fkey FOREIGN KEY (corrects_event_id) REFERENCES public.scan_events(id);


--
-- Name: scan_events scan_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_events
    ADD CONSTRAINT scan_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: scan_events scan_events_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_events
    ADD CONSTRAINT scan_events_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id) ON DELETE RESTRICT;


--
-- Name: scan_events scan_events_scanned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_events
    ADD CONSTRAINT scan_events_scanned_by_fkey FOREIGN KEY (scanned_by) REFERENCES public.users(id);


--
-- Name: scans scans_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: scans scans_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


--
-- Name: scans scans_parcel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id);


--
-- Name: scans scans_pickup_relais_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_pickup_relais_id_fkey FOREIGN KEY (pickup_relais_id) REFERENCES public.relais(id);


--
-- Name: scans scans_scanned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_scanned_by_fkey FOREIGN KEY (scanned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: services services_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: services services_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: shared_cart_events shared_cart_events_shared_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_cart_events
    ADD CONSTRAINT shared_cart_events_shared_cart_id_fkey FOREIGN KEY (shared_cart_id) REFERENCES public.shared_carts(id) ON DELETE CASCADE;


--
-- Name: shared_cart_items shared_cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_cart_items
    ADD CONSTRAINT shared_cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: shared_cart_items shared_cart_items_shared_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_cart_items
    ADD CONSTRAINT shared_cart_items_shared_cart_id_fkey FOREIGN KEY (shared_cart_id) REFERENCES public.shared_carts(id) ON DELETE CASCADE;


--
-- Name: shared_cart_items shared_cart_items_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_cart_items
    ADD CONSTRAINT shared_cart_items_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES public.product_skus(id) ON DELETE SET NULL;


--
-- Name: shared_cart_saved_access shared_cart_saved_access_shared_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_cart_saved_access
    ADD CONSTRAINT shared_cart_saved_access_shared_cart_id_fkey FOREIGN KEY (shared_cart_id) REFERENCES public.shared_carts(id) ON DELETE CASCADE;


--
-- Name: shared_cart_saved_access shared_cart_saved_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_cart_saved_access
    ADD CONSTRAINT shared_cart_saved_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: shared_carts shared_carts_beneficiary_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_carts
    ADD CONSTRAINT shared_carts_beneficiary_user_id_fkey FOREIGN KEY (organizer_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: shared_carts shared_carts_delivery_relay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_carts
    ADD CONSTRAINT shared_carts_delivery_relay_id_fkey FOREIGN KEY (delivery_relay_id) REFERENCES public.relais(id) ON DELETE SET NULL;


--
-- Name: shared_carts shared_carts_source_basket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_carts
    ADD CONSTRAINT shared_carts_source_basket_id_fkey FOREIGN KEY (source_basket_id) REFERENCES public.baskets(id) ON DELETE SET NULL;


--
-- Name: shared_carts shared_carts_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_carts
    ADD CONSTRAINT shared_carts_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: signals signals_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;


--
-- Name: sms_log sms_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_log
    ADD CONSTRAINT sms_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: sourcing_candidate_events sourcing_candidate_events_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidate_events
    ADD CONSTRAINT sourcing_candidate_events_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.sourcing_candidates(id) ON DELETE CASCADE;


--
-- Name: sourcing_candidate_events sourcing_candidate_events_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidate_events
    ADD CONSTRAINT sourcing_candidate_events_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sourcing_candidate_observations sourcing_candidate_observations_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidate_observations
    ADD CONSTRAINT sourcing_candidate_observations_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.sourcing_candidates(id) ON DELETE SET NULL;


--
-- Name: sourcing_candidate_observations sourcing_candidate_observations_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidate_observations
    ADD CONSTRAINT sourcing_candidate_observations_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.supplier_catalog_imports(id) ON DELETE CASCADE;


--
-- Name: sourcing_candidates sourcing_candidates_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidates
    ADD CONSTRAINT sourcing_candidates_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.supplier_catalog_imports(id) ON DELETE SET NULL;


--
-- Name: sourcing_candidates sourcing_candidates_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidates
    ADD CONSTRAINT sourcing_candidates_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: sourcing_candidates sourcing_candidates_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_candidates
    ADD CONSTRAINT sourcing_candidates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sourcing_canonical_entities sourcing_canonical_entities_parent_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_canonical_entities
    ADD CONSTRAINT sourcing_canonical_entities_parent_fk FOREIGN KEY (parent_entity_id) REFERENCES public.sourcing_canonical_entities(canonical_entity_id);


--
-- Name: sourcing_canonical_entities sourcing_canonical_entities_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_canonical_entities
    ADD CONSTRAINT sourcing_canonical_entities_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.sourcing_commercial_principals(principal_id);


--
-- Name: sourcing_canonical_entities sourcing_canonical_entities_superseded_same_grain_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_canonical_entities
    ADD CONSTRAINT sourcing_canonical_entities_superseded_same_grain_fk FOREIGN KEY (superseded_by, grain) REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain);


--
-- Name: sourcing_canonical_entity_refs sourcing_canonical_entity_refs_canonical_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_canonical_entity_refs
    ADD CONSTRAINT sourcing_canonical_entity_refs_canonical_entity_id_fkey FOREIGN KEY (canonical_entity_id) REFERENCES public.sourcing_canonical_entities(canonical_entity_id) ON DELETE CASCADE;


--
-- Name: sourcing_canonical_entity_refs sourcing_canonical_entity_refs_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_canonical_entity_refs
    ADD CONSTRAINT sourcing_canonical_entity_refs_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sourcing_sources(source_id);


--
-- Name: sourcing_captures sourcing_captures_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_captures
    ADD CONSTRAINT sourcing_captures_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sourcing_sources(source_id);


--
-- Name: sourcing_commercial_principals sourcing_commercial_principals_superseded_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_commercial_principals
    ADD CONSTRAINT sourcing_commercial_principals_superseded_fk FOREIGN KEY (superseded_by) REFERENCES public.sourcing_commercial_principals(principal_id);


--
-- Name: sourcing_global_access_grants sourcing_global_access_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_global_access_grants
    ADD CONSTRAINT sourcing_global_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sourcing_global_access_grants sourcing_global_access_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_global_access_grants
    ADD CONSTRAINT sourcing_global_access_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sourcing_identity_constraints sourcing_identity_constraints_asserted_by_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_identity_constraints
    ADD CONSTRAINT sourcing_identity_constraints_asserted_by_decision_id_fkey FOREIGN KEY (asserted_by_decision_id) REFERENCES public.sourcing_resolution_decisions(decision_id);


--
-- Name: sourcing_identity_constraints sourcing_identity_constraints_left_grain_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_identity_constraints
    ADD CONSTRAINT sourcing_identity_constraints_left_grain_fk FOREIGN KEY (left_entity_id, grain) REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain);


--
-- Name: sourcing_identity_constraints sourcing_identity_constraints_revoked_by_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_identity_constraints
    ADD CONSTRAINT sourcing_identity_constraints_revoked_by_decision_id_fkey FOREIGN KEY (revoked_by_decision_id) REFERENCES public.sourcing_resolution_decisions(decision_id);


--
-- Name: sourcing_identity_constraints sourcing_identity_constraints_right_grain_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_identity_constraints
    ADD CONSTRAINT sourcing_identity_constraints_right_grain_fk FOREIGN KEY (right_entity_id, grain) REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain);


--
-- Name: sourcing_match_proposals sourcing_match_proposals_candidate_grain_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_match_proposals
    ADD CONSTRAINT sourcing_match_proposals_candidate_grain_fk FOREIGN KEY (candidate_entity_id, grain) REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain);


--
-- Name: sourcing_match_proposals sourcing_match_proposals_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_match_proposals
    ADD CONSTRAINT sourcing_match_proposals_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.sourcing_observations(observation_id);


--
-- Name: sourcing_observation_evidence sourcing_observation_evidence_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_observation_evidence
    ADD CONSTRAINT sourcing_observation_evidence_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.sourcing_observations(observation_id) ON DELETE CASCADE;


--
-- Name: sourcing_observations sourcing_observations_capture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_observations
    ADD CONSTRAINT sourcing_observations_capture_id_fkey FOREIGN KEY (capture_id) REFERENCES public.sourcing_captures(capture_id);


--
-- Name: sourcing_observations sourcing_observations_parent_same_capture; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_observations
    ADD CONSTRAINT sourcing_observations_parent_same_capture FOREIGN KEY (parent_observation_id, capture_id) REFERENCES public.sourcing_observations(observation_id, capture_id);


--
-- Name: sourcing_provider_control_events sourcing_provider_control_events_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_provider_control_events
    ADD CONSTRAINT sourcing_provider_control_events_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sourcing_sources(source_id);


--
-- Name: sourcing_resolution_bindings sourcing_resolution_bindings_asserted_by_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_bindings
    ADD CONSTRAINT sourcing_resolution_bindings_asserted_by_decision_id_fkey FOREIGN KEY (asserted_by_decision_id) REFERENCES public.sourcing_resolution_decisions(decision_id);


--
-- Name: sourcing_resolution_bindings sourcing_resolution_bindings_ended_by_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_bindings
    ADD CONSTRAINT sourcing_resolution_bindings_ended_by_decision_id_fkey FOREIGN KEY (ended_by_decision_id) REFERENCES public.sourcing_resolution_decisions(decision_id);


--
-- Name: sourcing_resolution_bindings sourcing_resolution_bindings_entity_grain_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_bindings
    ADD CONSTRAINT sourcing_resolution_bindings_entity_grain_fk FOREIGN KEY (canonical_entity_id, grain) REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain);


--
-- Name: sourcing_resolution_bindings sourcing_resolution_bindings_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_bindings
    ADD CONSTRAINT sourcing_resolution_bindings_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.sourcing_observations(observation_id);


--
-- Name: sourcing_resolution_decisions sourcing_resolution_decisions_entity_grain_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_decisions
    ADD CONSTRAINT sourcing_resolution_decisions_entity_grain_fk FOREIGN KEY (canonical_entity_id, grain) REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain);


--
-- Name: sourcing_resolution_decisions sourcing_resolution_decisions_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_decisions
    ADD CONSTRAINT sourcing_resolution_decisions_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.sourcing_observations(observation_id);


--
-- Name: sourcing_resolution_decisions sourcing_resolution_decisions_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_decisions
    ADD CONSTRAINT sourcing_resolution_decisions_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.sourcing_match_proposals(proposal_id);


--
-- Name: sourcing_resolution_decisions sourcing_resolution_decisions_related_grain_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_resolution_decisions
    ADD CONSTRAINT sourcing_resolution_decisions_related_grain_fk FOREIGN KEY (related_entity_id, grain) REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain);


--
-- Name: sourcing_source_execution_modes sourcing_source_execution_modes_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_source_execution_modes
    ADD CONSTRAINT sourcing_source_execution_modes_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sourcing_sources(source_id) ON DELETE CASCADE;


--
-- Name: sourcing_source_principal_refs sourcing_source_principal_refs_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_source_principal_refs
    ADD CONSTRAINT sourcing_source_principal_refs_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.sourcing_commercial_principals(principal_id);


--
-- Name: sourcing_source_principal_refs sourcing_source_principal_refs_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_source_principal_refs
    ADD CONSTRAINT sourcing_source_principal_refs_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sourcing_sources(source_id) ON DELETE CASCADE;


--
-- Name: sourcing_source_provides sourcing_source_provides_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_source_provides
    ADD CONSTRAINT sourcing_source_provides_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sourcing_sources(source_id) ON DELETE CASCADE;


--
-- Name: sourcing_sources sourcing_sources_credential_ref_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_sources
    ADD CONSTRAINT sourcing_sources_credential_ref_fk FOREIGN KEY (credential_ref) REFERENCES public.provider_credentials(credential_ref) NOT VALID;


--
-- Name: sourcing_sources sourcing_sources_production_certified_capture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_sources
    ADD CONSTRAINT sourcing_sources_production_certified_capture_id_fkey FOREIGN KEY (production_certified_capture_id) REFERENCES public.sourcing_captures(capture_id) ON DELETE SET NULL;


--
-- Name: store_credits store_credits_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_credits
    ADD CONSTRAINT store_credits_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.orders(id);


--
-- Name: store_credits store_credits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_credits
    ADD CONSTRAINT store_credits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: supplier_catalog_import_rejections supplier_catalog_import_rejections_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_catalog_import_rejections
    ADD CONSTRAINT supplier_catalog_import_rejections_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.supplier_catalog_imports(id) ON DELETE CASCADE;


--
-- Name: supplier_catalog_imports supplier_catalog_imports_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_catalog_imports
    ADD CONSTRAINT supplier_catalog_imports_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_execution_events supplier_execution_events_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_events
    ADD CONSTRAINT supplier_execution_events_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_events supplier_execution_events_supplier_execution_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_events
    ADD CONSTRAINT supplier_execution_events_supplier_execution_group_id_fkey FOREIGN KEY (supplier_execution_group_id) REFERENCES public.supplier_execution_groups(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_events supplier_execution_events_supplier_execution_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_events
    ADD CONSTRAINT supplier_execution_events_supplier_execution_order_id_fkey FOREIGN KEY (supplier_execution_order_id) REFERENCES public.supplier_execution_orders(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_fulfillments supplier_execution_fulfillment_supplier_execution_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_fulfillments
    ADD CONSTRAINT supplier_execution_fulfillment_supplier_execution_order_id_fkey FOREIGN KEY (supplier_execution_order_id) REFERENCES public.supplier_execution_orders(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_group_members supplier_execution_group_membe_supplier_execution_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_group_members
    ADD CONSTRAINT supplier_execution_group_membe_supplier_execution_group_id_fkey FOREIGN KEY (supplier_execution_group_id) REFERENCES public.supplier_execution_groups(id) ON DELETE CASCADE;


--
-- Name: supplier_execution_group_members supplier_execution_group_membe_supplier_execution_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_group_members
    ADD CONSTRAINT supplier_execution_group_membe_supplier_execution_order_id_fkey FOREIGN KEY (supplier_execution_order_id) REFERENCES public.supplier_execution_orders(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_groups supplier_execution_groups_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_groups
    ADD CONSTRAINT supplier_execution_groups_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_order_lines supplier_execution_order_lines_purchase_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_order_lines
    ADD CONSTRAINT supplier_execution_order_lines_purchase_line_id_fkey FOREIGN KEY (purchase_line_id) REFERENCES public.purchase_lines(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_order_lines supplier_execution_order_lines_supplier_execution_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_order_lines
    ADD CONSTRAINT supplier_execution_order_lines_supplier_execution_order_id_fkey FOREIGN KEY (supplier_execution_order_id) REFERENCES public.supplier_execution_orders(id) ON DELETE CASCADE;


--
-- Name: supplier_execution_orders supplier_execution_orders_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_orders
    ADD CONSTRAINT supplier_execution_orders_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_payment_proofs supplier_execution_payment_proofs_supplier_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_payment_proofs
    ADD CONSTRAINT supplier_execution_payment_proofs_supplier_payment_id_fkey FOREIGN KEY (supplier_payment_id) REFERENCES public.supplier_execution_payments(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_payments supplier_execution_payments_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_payments
    ADD CONSTRAINT supplier_execution_payments_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_payments supplier_execution_payments_supplier_execution_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_payments
    ADD CONSTRAINT supplier_execution_payments_supplier_execution_group_id_fkey FOREIGN KEY (supplier_execution_group_id) REFERENCES public.supplier_execution_groups(id) ON DELETE RESTRICT;


--
-- Name: supplier_execution_payments supplier_execution_payments_supplier_execution_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_execution_payments
    ADD CONSTRAINT supplier_execution_payments_supplier_execution_order_id_fkey FOREIGN KEY (supplier_execution_order_id) REFERENCES public.supplier_execution_orders(id) ON DELETE RESTRICT;


--
-- Name: supplier_payment_settlements supplier_payment_settlements_supplier_execution_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payment_settlements
    ADD CONSTRAINT supplier_payment_settlements_supplier_execution_payment_id_fkey FOREIGN KEY (supplier_execution_payment_id) REFERENCES public.supplier_execution_payments(id) ON DELETE RESTRICT;


--
-- Name: transaction_documents transaction_documents_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents
    ADD CONSTRAINT transaction_documents_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: transaction_documents transaction_documents_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents
    ADD CONSTRAINT transaction_documents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: transaction_documents transaction_documents_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents
    ADD CONSTRAINT transaction_documents_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: transaction_documents transaction_documents_refund_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents
    ADD CONSTRAINT transaction_documents_refund_id_fkey FOREIGN KEY (refund_id) REFERENCES public.refunds(id) ON DELETE SET NULL;


--
-- Name: unsold_items unsold_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unsold_items
    ADD CONSTRAINT unsold_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: unsold_items unsold_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unsold_items
    ADD CONSTRAINT unsold_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: unsold_items unsold_items_reseller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unsold_items
    ADD CONSTRAINT unsold_items_reseller_id_fkey FOREIGN KEY (reseller_id) REFERENCES public.users(id);


--
-- Name: user_pickup_authorizations user_pickup_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pickup_authorizations
    ADD CONSTRAINT user_pickup_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_loyalty_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_loyalty_tier_id_fkey FOREIGN KEY (loyalty_tier_id) REFERENCES public.loyalty_tiers(id);


--
-- Name: users users_relais_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_relais_id_fkey FOREIGN KEY (relais_id) REFERENCES public.relais(id);


--
-- Name: wallet_consumptions wallet_consumptions_credit_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_consumptions
    ADD CONSTRAINT wallet_consumptions_credit_lot_id_fkey FOREIGN KEY (credit_lot_id) REFERENCES public.wallet_credit_lots(id);


--
-- Name: wallet_consumptions wallet_consumptions_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_consumptions
    ADD CONSTRAINT wallet_consumptions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.wallet_transactions(id);


--
-- Name: wallet_credit_lots wallet_credit_lots_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_credit_lots
    ADD CONSTRAINT wallet_credit_lots_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.wallet_transactions(id);


--
-- Name: wallet_credit_lots wallet_credit_lots_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_credit_lots
    ADD CONSTRAINT wallet_credit_lots_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);


--
-- Name: wallet_transactions wallet_transactions_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);


--
-- Name: wallets wallets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
