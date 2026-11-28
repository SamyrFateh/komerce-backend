-- @migration 457_on_demand_conversations.sql
-- @domain market-delegation, notifications
-- @purpose On Demand V1 dossiers, conversation messages and private photos
CREATE TABLE public.client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  motif text NOT NULL CHECK (motif IN ('auto_parts','express','other')),
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  sku_id uuid REFERENCES public.product_skus(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','closed')),
  hub_shared boolean NOT NULL DEFAULT false,
  first_staff_reply_at timestamptz,
  closed_at timestamptz,
  closed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (motif = 'express' OR (product_id IS NULL AND sku_id IS NULL)),
  CHECK (sku_id IS NULL OR product_id IS NOT NULL),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  CHECK (status = 'closed' OR (closed_at IS NULL AND closed_by IS NULL))
);
CREATE INDEX client_requests_user_created_idx ON public.client_requests(user_id,created_at DESC,id);
CREATE INDEX client_requests_market_status_idx ON public.client_requests(market_id,status,created_at DESC);
CREATE INDEX client_requests_hub_idx ON public.client_requests(created_at DESC) WHERE hub_shared;

CREATE TABLE public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL DEFAULT 'client_request' CHECK(subject_type = 'client_request'),
  subject_id uuid NOT NULL REFERENCES public.client_requests(id) ON DELETE RESTRICT,
  visibility text NOT NULL CHECK(visibility IN ('client','internal')),
  author_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  author_side text NOT NULL CHECK(author_side IN ('client','staff')),
  event_type text NOT NULL DEFAULT 'message' CHECK(event_type IN ('message','hub_shared','hub_revoked','started','closed','reopened','callback')),
  body text NOT NULL DEFAULT '' CHECK(char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_by_client_at timestamptz,
  read_by_staff_at timestamptz,
  CHECK(author_side <> 'client' OR (visibility = 'client' AND event_type = 'message')),
  CHECK(event_type = 'message' OR (visibility = 'internal' AND author_side = 'staff')),
  CHECK(visibility = 'client' OR read_by_client_at IS NULL)
);
CREATE INDEX conversation_messages_subject_idx ON public.conversation_messages(subject_id,created_at,id);
CREATE INDEX conversation_messages_client_idx ON public.conversation_messages(subject_id,created_at,id) WHERE visibility = 'client';

CREATE TABLE public.conversation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.conversation_messages(id) ON DELETE RESTRICT,
  mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  content bytea NOT NULL CHECK(octet_length(content) = size_bytes),
  created_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz,
  UNIQUE(message_id,sha256)
);
CREATE INDEX conversation_attachments_purge_idx ON public.conversation_attachments(purge_after) WHERE purge_after IS NOT NULL;

ALTER TABLE public.client_notifications
  DROP CONSTRAINT client_notifications_entity_type_check,
  DROP CONSTRAINT client_notifications_action_target_check,
  ADD CONSTRAINT client_notifications_entity_type_check CHECK(entity_type IN ('order','client_request')),
  ADD CONSTRAINT client_notifications_action_target_check CHECK(action_target IN ('orders','client_requests')),
  ADD CONSTRAINT client_notifications_entity_target_check CHECK(
    (entity_type='order' AND action_target='orders') OR
    (entity_type='client_request' AND action_target='client_requests')
  );
