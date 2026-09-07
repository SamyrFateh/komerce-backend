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
    'paypal_eur'
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
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'client',
    'admin',
    'agent_relais',
    'agent_hub',
    'agent_transitaire',
    'sourcing',
    'market_operator'
);


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
-- Name: is_order_complete(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_order_complete(p_order_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM purchase_orders
    WHERE order_id = p_order_id
      AND status != 'cancelled'
      AND received_qty < qty
  );
$$;


--
-- Name: FUNCTION is_order_complete(p_order_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_order_complete(p_order_id uuid) IS 'Retourne TRUE si tous les POs non annulÃ©s ont received_qty >= qty.';


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
-- Name: basket_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.basket_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    basket_id uuid NOT NULL,
    product_id uuid NOT NULL,
    added_by uuid,
    quantity integer DEFAULT 1 NOT NULL,
    price_kmf integer NOT NULL,
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
    is_active boolean DEFAULT true NOT NULL
);


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
    cart_total_kmf bigint NOT NULL,
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
    contributed_kmf integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: cash_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    amount_kmf integer NOT NULL,
    collected_by uuid NOT NULL,
    relais_id uuid,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


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
    amount_kmf integer NOT NULL,
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
    deposit_ref text DEFAULT ('KDP-'::text || lpad((nextval('public.cash_deposit_ref_seq'::regclass))::text, 6, '0'::text)) NOT NULL
);


--
-- Name: COLUMN cash_deposits.deposit_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_deposits.deposit_ref IS 'Référence métier stable du dépôt cash exposable au navigateur (KDP-xxxxxx). L UUID interne reste serveur-only.';


--
-- Name: cash_reconciliation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_reconciliation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    expected_kmf integer DEFAULT 0 NOT NULL,
    declared_kmf integer DEFAULT 0 NOT NULL,
    deposited_kmf integer DEFAULT 0 NOT NULL,
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
    is_deletable boolean DEFAULT true
);


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
    price_kmf integer NOT NULL,
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
    CONSTRAINT cost_components_allocation_check CHECK ((allocation_method = ANY (ARRAY['none'::text, 'per_order'::text, 'per_item'::text, 'by_value'::text, 'by_weight'::text, 'by_volume'::text, 'by_taxable_weight'::text, 'by_quantity'::text, 'by_category_risk'::text, 'manual'::text]))),
    CONSTRAINT cost_components_category_check CHECK ((category = ANY (ARRAY['product_purchase'::text, 'sourcing'::text, 'hub'::text, 'packaging'::text, 'freight'::text, 'customs'::text, 'port_transitary'::text, 'local_distribution'::text, 'relay'::text, 'payment'::text, 'risk_provision'::text, 'fixed_overhead'::text, 'incident'::text, 'marketing_campaign'::text]))),
    CONSTRAINT cost_components_channel_check CHECK (((channel IS NULL) OR (channel = ANY (ARRAY['cash_relais'::text, 'diaspora'::text, 'mobile_money'::text])))),
    CONSTRAINT cost_components_confidence_check CHECK ((confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT cost_components_family_category_consistency CHECK ((((family = 'landed_relay'::text) AND (category = ANY (ARRAY['product_purchase'::text, 'sourcing'::text, 'hub'::text, 'packaging'::text, 'freight'::text, 'customs'::text, 'port_transitary'::text, 'local_distribution'::text, 'relay'::text]))) OR ((family = 'business'::text) AND (category = ANY (ARRAY['payment'::text, 'risk_provision'::text, 'fixed_overhead'::text]))) OR ((family = 'exceptional'::text) AND (category = ANY (ARRAY['incident'::text, 'marketing_campaign'::text]))))),
    CONSTRAINT cost_components_family_check CHECK ((family = ANY (ARRAY['landed_relay'::text, 'business'::text, 'exceptional'::text]))),
    CONSTRAINT cost_components_island_check CHECK (((island IS NULL) OR (island = ANY (ARRAY['grande_comore'::text, 'moheli'::text, 'anjouan'::text, 'mayotte'::text])))),
    CONSTRAINT cost_components_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'category'::text, 'product'::text, 'order'::text, 'parcel'::text, 'shipment'::text, 'supplier'::text, 'relay'::text]))),
    CONSTRAINT cost_components_source_check CHECK ((source = ANY (ARRAY['default'::text, 'category'::text, 'manual'::text, 'supplier'::text, 'real'::text, 'missing'::text]))),
    CONSTRAINT cost_components_unit_check CHECK ((unit = ANY (ARRAY['kmf'::text, 'pct'::text, 'kmf_per_kg'::text, 'kmf_per_m3'::text, 'kmf_per_order'::text, 'kmf_per_parcel'::text, 'kmf_per_shipment'::text, 'aed'::text, 'eur'::text, 'usd'::text])))
);


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
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


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
 SELECT 'last_30d'::text AS period,
    count(*) AS nb_shipments,
    COALESCE(sum(customs_shipments.cif_value_kmf), (0)::numeric) AS total_cif_kmf,
    COALESCE(sum(customs_shipments.customs_paid_kmf), (0)::numeric) AS total_customs_kmf,
        CASE
            WHEN (COALESCE(sum(customs_shipments.cif_value_kmf), (0)::numeric) > (0)::numeric) THEN round(((sum(customs_shipments.customs_paid_kmf) / sum(customs_shipments.cif_value_kmf)) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS rate_pct
   FROM public.customs_shipments
  WHERE ((customs_shipments.is_active = true) AND (customs_shipments.shipment_date >= (CURRENT_DATE - '30 days'::interval)))
UNION ALL
 SELECT 'last_90d'::text AS period,
    count(*) AS nb_shipments,
    COALESCE(sum(customs_shipments.cif_value_kmf), (0)::numeric) AS total_cif_kmf,
    COALESCE(sum(customs_shipments.customs_paid_kmf), (0)::numeric) AS total_customs_kmf,
        CASE
            WHEN (COALESCE(sum(customs_shipments.cif_value_kmf), (0)::numeric) > (0)::numeric) THEN round(((sum(customs_shipments.customs_paid_kmf) / sum(customs_shipments.cif_value_kmf)) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS rate_pct
   FROM public.customs_shipments
  WHERE ((customs_shipments.is_active = true) AND (customs_shipments.shipment_date >= (CURRENT_DATE - '90 days'::interval)))
UNION ALL
 SELECT 'last_365d'::text AS period,
    count(*) AS nb_shipments,
    COALESCE(sum(customs_shipments.cif_value_kmf), (0)::numeric) AS total_cif_kmf,
    COALESCE(sum(customs_shipments.customs_paid_kmf), (0)::numeric) AS total_customs_kmf,
        CASE
            WHEN (COALESCE(sum(customs_shipments.cif_value_kmf), (0)::numeric) > (0)::numeric) THEN round(((sum(customs_shipments.customs_paid_kmf) / sum(customs_shipments.cif_value_kmf)) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS rate_pct
   FROM public.customs_shipments
  WHERE ((customs_shipments.is_active = true) AND (customs_shipments.shipment_date >= (CURRENT_DATE - '365 days'::interval)));


--
-- Name: customs_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    shipment_id uuid,
    sh_category text NOT NULL,
    product_category text,
    customs_estimated_kmf integer NOT NULL,
    customs_real_kmf integer,
    customs_delta_kmf integer GENERATED ALWAYS AS ((customs_real_kmf - customs_estimated_kmf)) STORED,
    customs_delta_pct numeric(8,4) GENERATED ALWAYS AS (
CASE
    WHEN (customs_estimated_kmf > 0) THEN round(((((customs_real_kmf)::numeric / (customs_estimated_kmf)::numeric) - (1)::numeric) * (100)::numeric), 4)
    ELSE NULL::numeric
END) STORED,
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
    CONSTRAINT customs_history_statut_check CHECK ((statut = ANY (ARRAY['validated'::text, 'contested'::text, 'pending'::text, 'anomaly'::text])))
);


--
-- Name: TABLE customs_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customs_history IS 'Historique de chaque passage douanier â€” source de vÃ©ritÃ© pour le coefficient de risque';


--
-- Name: COLUMN customs_history.customs_delta_kmf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_history.customs_delta_kmf IS 'Colonne calculÃ©e : customs_real_kmf - customs_estimated_kmf';


--
-- Name: COLUMN customs_history.customs_delta_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customs_history.customs_delta_pct IS 'Colonne calculÃ©e : Ã©cart en % â€” alimentation coefficient de risque mensuel';


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
  WHERE (customs_real_kmf > 0)
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
    refund_kmf integer DEFAULT 0,
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
    price_per_meter_kmf integer,
    price_per_yard_kmf integer,
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
    cost_fixed_sourcing_kmf integer DEFAULT 1000 NOT NULL,
    cost_fixed_transit_kmf integer DEFAULT 500 NOT NULL,
    cost_fixed_hub_kmf integer DEFAULT 400 NOT NULL,
    cost_fixed_relais_kmf integer DEFAULT 300 NOT NULL,
    cost_fixed_support_kmf integer DEFAULT 200 NOT NULL,
    target_marge_brute_pct numeric(5,2) DEFAULT 40.00 NOT NULL,
    target_panier_moyen_kmf integer DEFAULT 15000 NOT NULL,
    objectif_commandes_mois integer DEFAULT 100 NOT NULL,
    objectif_ca_mensuel_kmf integer DEFAULT 1500000 NOT NULL,
    taux_change_eur_kmf numeric(10,2) DEFAULT 491.96 NOT NULL,
    markup_cible_pct numeric(5,2) DEFAULT 250.00 NOT NULL,
    cout_achat_moyen_eur numeric(10,2) DEFAULT 5.00 NOT NULL,
    delai_transit_jours integer DEFAULT 25 NOT NULL,
    commission_relais_pct numeric(5,2) DEFAULT 5.00 NOT NULL,
    frais_livraison_defaut_kmf integer DEFAULT 1500 NOT NULL,
    seuil_livraison_gratuite_kmf integer DEFAULT 25000 NOT NULL,
    taux_conversion_pct numeric(5,2) DEFAULT 3.00 NOT NULL,
    taux_retour_pct numeric(5,2) DEFAULT 2.00 NOT NULL,
    loyalty_active boolean DEFAULT true NOT NULL,
    loyalty_threshold_kmf integer DEFAULT 20000 NOT NULL,
    loyalty_trigger_count integer DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    taux_aed_kmf numeric(10,2) DEFAULT 138.00 NOT NULL,
    fret_eur_per_m3 integer DEFAULT 180 NOT NULL,
    frais_stripe_pct numeric(5,2) DEFAULT 2.5 NOT NULL,
    frais_stripe_fixed_kmf integer DEFAULT 150 NOT NULL,
    commission_relais_standard_kmf integer DEFAULT 500 NOT NULL,
    commission_relais_showroom_kmf integer DEFAULT 750 NOT NULL,
    transitaire_pct numeric(5,2) DEFAULT 2.0 NOT NULL,
    transitaire_fixed_kmf integer DEFAULT 450 NOT NULL,
    portuaires_kmf integer DEFAULT 1200 NOT NULL,
    commission_agent_pct numeric(5,2) DEFAULT 5.0 NOT NULL,
    hub_monthly_cost_aed integer DEFAULT 7000 NOT NULL,
    sante_seuil_cash_retard_pct numeric(5,2) DEFAULT 15.00 NOT NULL,
    sante_seuil_pipeline_block_pct numeric(5,2) DEFAULT 15.00 NOT NULL,
    sante_seuil_vip_kmf integer DEFAULT 200000 NOT NULL,
    sante_seuil_atrisk_ltv_kmf integer DEFAULT 500000 NOT NULL,
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
    CONSTRAINT finance_config_allocation_confidence_check CHECK ((allocation_confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT finance_config_id_check CHECK ((id = 1))
);


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
    CONSTRAINT incidents_client_impact_check CHECK ((client_impact = ANY (ARRAY['none'::text, 'delayed'::text, 'partial_delivery'::text, 'wrong_item'::text, 'blocked'::text]))),
    CONSTRAINT incidents_detected_source_check CHECK ((detected_source = ANY (ARRAY['system'::text, 'hub_agent'::text, 'relay_agent'::text, 'driver'::text, 'customer'::text, 'admin'::text, 'reconciliation'::text]))),
    CONSTRAINT incidents_incident_type_check CHECK ((incident_type = ANY (ARRAY['content_mismatch'::text, 'missing_item'::text, 'unexpected_item'::text, 'damaged_item'::text, 'weight_mismatch'::text, 'quantity_mismatch'::text, 'scan_anomaly'::text, 'sequence_violation'::text, 'delay'::text, 'blocked'::text, 'payment_issue'::text, 'reconciliation_error'::text]))),
    CONSTRAINT incidents_resolution_type_check CHECK ((resolution_type = ANY (ARRAY['reship'::text, 'refund'::text, 'manual_fix'::text, 'dismissed'::text, 'auto_resolved'::text, NULL::text]))),
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
    subtotal_kmf integer NOT NULL,
    shipping_kmf integer DEFAULT 0 NOT NULL,
    total_kmf integer NOT NULL,
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
    total_eur numeric(10,2)
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
    CONSTRAINT markets_minor_unit_check CHECK (((minor_unit >= 0) AND (minor_unit <= 4)))
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
    created_by uuid
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    price_kmf integer NOT NULL,
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
    CONSTRAINT chk_order_items_price CHECK ((price_kmf > 0)),
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
    total_kmf integer NOT NULL,
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
    cost_transport_kmf integer DEFAULT 0 NOT NULL,
    cost_douane_kmf integer DEFAULT 0 NOT NULL,
    reminder_h12_sent boolean DEFAULT false NOT NULL,
    reminder_h36_sent boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cost_estimated_kmf integer,
    cost_real_kmf integer,
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
    discount_kmf integer DEFAULT 0 NOT NULL,
    loyalty_label character varying(50),
    unsold_at timestamp with time zone,
    unsold_price_kmf integer,
    batch_id uuid,
    qr_token character varying(64),
    qr_expires_at timestamp without time zone,
    computed_status text,
    wallet_applied_kmf integer DEFAULT 0,
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
    prepaid_amount_kmf integer DEFAULT 0 NOT NULL,
    remaining_cash_kmf integer DEFAULT 0 NOT NULL,
    paypal_order_id text,
    paypal_capture_id text,
    paypal_payer_email text,
    paypal_payer_id text,
    paypal_pay_in_4_used boolean DEFAULT false,
    transport_price_kmf integer DEFAULT 0 NOT NULL,
    exceptional_pickup_attempts integer DEFAULT 0 NOT NULL,
    exceptional_pickup_blocked_until timestamp with time zone,
    pickup_collected_via text,
    pickup_code_recipient character varying(16) DEFAULT 'buyer'::character varying NOT NULL,
    pickup_code_recipient_user_id uuid,
    market_id uuid NOT NULL,
    display_total_amount numeric(14,2),
    display_currency text,
    display_parity_snapshot jsonb,
    CONSTRAINT chk_orders_discount CHECK (((discount_pct >= (0)::numeric) AND (discount_pct <= (100)::numeric))),
    CONSTRAINT chk_orders_total CHECK ((total_kmf >= 0)),
    CONSTRAINT orders_pickup_code_recipient_check CHECK (((pickup_code_recipient)::text = ANY ((ARRAY['buyer'::character varying, 'organizer'::character varying])::text[])))
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
    commission_kmf integer,
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
    applied_price_kmf integer,
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
    old_price_kmf integer,
    new_price_kmf integer NOT NULL,
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
    price_kmf integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_sku text,
    source character varying(20) DEFAULT 'MANUAL'::character varying NOT NULL,
    CONSTRAINT chk_product_skus_source CHECK (((source)::text = ANY ((ARRAY['MANUAL'::character varying, 'SUPPLIER'::character varying])::text[]))),
    CONSTRAINT product_skus_prix_non_negatif CHECK (((price_kmf IS NULL) OR (price_kmf >= 0))),
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
-- Name: product_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    supplier_sku text NOT NULL,
    supplier_url text,
    supplier_price_aed numeric(10,2) NOT NULL,
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

COMMENT ON COLUMN public.product_suppliers.supplier_price_aed IS 'Prix achat AED â€” utilisÃ© pour calculer cost_real_kmf';


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
    price_kmf integer,
    image_url text,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    images jsonb DEFAULT '[]'::jsonb NOT NULL,
    display_name text,
    CONSTRAINT product_variants_prix_non_negatif CHECK (((price_kmf IS NULL) OR (price_kmf >= 0))),
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
-- Name: VIEW product_variants_ordered; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.product_variants_ordered IS 'Variantes triées display_order ASC — inclut images[] (Lot 2)';


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
    price_kmf integer NOT NULL,
    cost_kmf integer,
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
    unsold_price_kmf integer,
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
    CONSTRAINT chk_products_inventory_model CHECK ((inventory_model = ANY (ARRAY['LEGACY_VARIANTS'::text, 'SKU'::text]))),
    CONSTRAINT chk_products_price CHECK ((price_kmf > 0)),
    CONSTRAINT chk_products_sourcing_rail CHECK (((sourcing_rail IS NULL) OR (sourcing_rail = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])))),
    CONSTRAINT chk_products_stock CHECK ((stock >= 0)),
    CONSTRAINT chk_stock_nonneg CHECK (((stock >= 0) OR (stock IS NULL))),
    CONSTRAINT price_eur_positive CHECK (((price_eur IS NULL) OR (price_eur >= (0)::numeric)))
);


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
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    product_supplier_id uuid,
    supplier_order_id text,
    supplier_sku text NOT NULL,
    qty integer DEFAULT 1 NOT NULL,
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
    CONSTRAINT chk_purchase_orders_qty CHECK ((qty > 0)),
    CONSTRAINT purchase_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'notified'::text, 'confirmed'::text, 'shipped'::text, 'hub_received'::text, 'cancelled'::text]))),
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
    amount_kmf integer NOT NULL,
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
    agent_name text NOT NULL,
    phone text NOT NULL,
    address text NOT NULL,
    zone text,
    hours text,
    island text DEFAULT 'Anjouan'::text NOT NULL,
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
    unit_price_kmf_snapshot integer NOT NULL,
    line_total_kmf_snapshot integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    sku_id uuid,
    variant_combo_snapshot jsonb,
    CONSTRAINT shared_cart_items_line_total_kmf_snapshot_check CHECK ((line_total_kmf_snapshot >= 0)),
    CONSTRAINT shared_cart_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT shared_cart_items_unit_price_kmf_snapshot_check CHECK ((unit_price_kmf_snapshot >= 0))
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
    customs_total_estimated_kmf integer,
    customs_total_real_kmf integer,
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
    CONSTRAINT signals_confidence_check CHECK ((confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT signals_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text, 'urgent'::text]))),
    CONSTRAINT signals_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'snoozed'::text, 'resolved'::text, 'expired'::text])))
);


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
    purchase_price_kmf integer,
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
-- Name: store_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount_kmf integer NOT NULL,
    remaining_kmf integer NOT NULL,
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
    CONSTRAINT suppliers_platform_check CHECK ((platform = ANY (ARRAY['noon'::text, 'amazon_uae'::text, 'aliexpress'::text, 'local'::text, 'whatsapp'::text])))
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
          WHERE ((o.supplier_id = p.id) AND (o.status <> ALL (ARRAY['cancelled'::public.order_status, 'refunded'::public.order_status])) AND (o.created_at >= (now() - '30 days'::interval)))), (0)::bigint) AS orders_revenue_30d_kmf,
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
    original_price_kmf integer NOT NULL,
    unsold_price_kmf integer NOT NULL,
    channel character varying(20) DEFAULT 'both'::character varying NOT NULL,
    status character varying(20) DEFAULT 'available'::character varying NOT NULL,
    reseller_id uuid,
    unsold_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_price_kmf integer,
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
    (oi.price_kmf * oi.quantity) AS total_item_kmf,
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
-- Name: VIEW v_customs_analysis; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_customs_analysis IS 'Analyse douane par catÃ©gorie SH â€” calcul du coefficient de risque recommandÃ©';


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
            sum(((COALESCE(oi.price_kmf, 0) * COALESCE(pi.quantity, 1)) - (COALESCE(pr.cost_kmf, oi.price_kmf, 0) * COALESCE(pi.quantity, 1)))) AS margin_kmf
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
            WHEN (cs.total_volume_m3 > (0)::numeric) THEN round(((me.margin_kmf)::numeric / cs.total_volume_m3), 0)
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
    round((((1)::numeric - ((ui.unsold_price_kmf)::numeric / (NULLIF(ui.original_price_kmf, 0))::numeric)) * (100)::numeric)) AS remise_pct,
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
    amount_kmf integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    reversed_at timestamp with time zone,
    reversal_reason character varying(50),
    CONSTRAINT wallet_consumptions_amount_kmf_check CHECK ((amount_kmf > 0))
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
    original_amount_kmf integer NOT NULL,
    remaining_kmf integer NOT NULL,
    reason character varying(50) NOT NULL,
    source_order_id uuid,
    expires_at timestamp with time zone,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT wallet_credit_lots_remaining_kmf_check CHECK ((remaining_kmf >= 0)),
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
    amount_kmf integer NOT NULL,
    balance_after_kmf integer NOT NULL,
    reason character varying(50) NOT NULL,
    reference_id uuid,
    idempotency_key character varying(100),
    note text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT wallet_transactions_amount_kmf_check CHECK ((amount_kmf > 0)),
    CONSTRAINT wallet_transactions_type_check CHECK (((type)::text = ANY ((ARRAY['credit'::character varying, 'debit'::character varying, 'reversal'::character varying, 'expiration'::character varying])::text[])))
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    balance_kmf integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_balance_non_negative CHECK ((balance_kmf >= 0))
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
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


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
-- Name: garment_models garment_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.garment_models
    ADD CONSTRAINT garment_models_pkey PRIMARY KEY (id);


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
-- Name: order_comments order_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_comments
    ADD CONSTRAINT order_comments_pkey PRIMARY KEY (id);


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
-- Name: providers providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);


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
-- Name: sourcing_global_access_grants sourcing_global_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_global_access_grants
    ADD CONSTRAINT sourcing_global_access_grants_pkey PRIMARY KEY (user_id);


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
-- Name: orders uq_orders_reference; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT uq_orders_reference UNIQUE (reference);


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
-- Name: idx_cash_dep_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_dep_agent ON public.cash_deposits USING btree (agent_id);


--
-- Name: idx_cash_dep_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_dep_period ON public.cash_deposits USING btree (period_start, period_end);


--
-- Name: idx_cash_dep_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_dep_status ON public.cash_deposits USING btree (status);


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
-- Name: idx_catalog_global_access_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_global_access_user ON public.catalog_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_catalog_media_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_media_product ON public.catalog_media USING btree (product_id, display_order);


--
-- Name: idx_catalog_overrides_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_overrides_product ON public.catalog_field_overrides USING btree (product_id);


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
-- Name: idx_incidents_critical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_critical ON public.incidents USING btree (severity, status) WHERE ((severity = ANY (ARRAY['high'::text, 'critical'::text])) AND (status = 'open'::text));


--
-- Name: idx_incidents_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_open ON public.incidents USING btree (status) WHERE (status = ANY (ARRAY['open'::text, 'investigating'::text]));


--
-- Name: idx_incidents_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_order ON public.order_incidents USING btree (order_id);


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
-- Name: idx_operator_scope_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operator_scope_market ON public.operator_market_scopes USING btree (market_id) WHERE (revoked_at IS NULL);


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
-- Name: idx_purchase_orders_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_order ON public.purchase_orders USING btree (order_id);


--
-- Name: idx_purchase_orders_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_order_id ON public.purchase_orders USING btree (order_id);


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

CREATE UNIQUE INDEX idx_signals_active_fact_unique ON public.signals USING btree (signal_type, entity_type, entity_id) NULLS NOT DISTINCT WHERE (status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'snoozed'::text]));


--
-- Name: idx_signals_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_signals_dedup ON public.signals USING btree (signal_type, entity_type, entity_id) WHERE (status = 'open'::text);


--
-- Name: idx_signals_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_entity ON public.signals USING btree (entity_type, entity_id);


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
-- Name: uniq_active_catalog_global_access; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_catalog_global_access ON public.catalog_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: uniq_active_dashboard_global_access; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_dashboard_global_access ON public.dashboard_global_access_grants USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: uniq_active_operator_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_operator_scope ON public.operator_market_scopes USING btree (user_id, market_id) WHERE (revoked_at IS NULL);


--
-- Name: uniq_cash_deposits_deposit_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_cash_deposits_deposit_ref ON public.cash_deposits USING btree (deposit_ref);


--
-- Name: uniq_sc_supplier_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_sc_supplier_ref ON public.sourcing_candidates USING btree (supplier_name, supplier_product_id) WHERE (supplier_product_id IS NOT NULL);


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
-- Name: uq_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: ux_catalog_media_source_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_catalog_media_source_identity ON public.catalog_media USING btree (product_id, source_media_id) WHERE (source_media_id IS NOT NULL);


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
-- Name: catalog_media trg_catalog_media_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_catalog_media_updated BEFORE UPDATE ON public.catalog_media FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- Name: incidents trg_incidents_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incidents_updated BEFORE UPDATE ON public.incidents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: parcels trg_no_delete_parcels; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_no_delete_parcels BEFORE DELETE ON public.parcels FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete_parcels();


--
-- Name: order_items trg_order_items_fulfillment_source_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_items_fulfillment_source_immutable BEFORE UPDATE OF fulfillment_source ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.prevent_order_item_fulfillment_source_change();


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
-- Name: economic_structure_cost_events trg_prevent_economic_structure_cost_event_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_economic_structure_cost_event_mutation BEFORE DELETE OR UPDATE ON public.economic_structure_cost_events FOR EACH ROW EXECUTE FUNCTION public.prevent_economic_structure_cost_event_mutation();


--
-- Name: incidents trg_prevent_incident_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_incident_delete BEFORE DELETE ON public.incidents FOR EACH ROW EXECUTE FUNCTION public.prevent_incident_delete();


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
-- Name: providers providers_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: purchase_orders purchase_orders_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: purchase_orders purchase_orders_product_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_product_supplier_id_fkey FOREIGN KEY (product_supplier_id) REFERENCES public.product_suppliers(id) ON DELETE SET NULL;


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
