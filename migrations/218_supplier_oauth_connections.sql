-- @migration 218_supplier_oauth_connections.sql
-- @domain    catalog
-- @purpose   Persist provider OAuth sessions without storing bearer tokens in plaintext.
--             First consumer: AliExpress Drop Shipping sourcing connector.

BEGIN;

CREATE TABLE IF NOT EXISTS supplier_oauth_connections (
  supplier_key                 text PRIMARY KEY,
  access_token_ciphertext      text NOT NULL,
  access_token_iv              text NOT NULL,
  access_token_tag             text NOT NULL,
  refresh_token_ciphertext     text,
  refresh_token_iv             text,
  refresh_token_tag            text,
  access_expires_at            timestamptz NOT NULL,
  refresh_expires_at           timestamptz,
  provider_user_id             text,
  provider_user_nick           text,
  token_type                   text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at            timestamptz,
  CONSTRAINT supplier_oauth_connections_supplier_key_chk
    CHECK (supplier_key ~ '^[a-z0-9_-]{2,64}$'),
  CONSTRAINT supplier_oauth_connections_refresh_triplet_chk
    CHECK (
      (refresh_token_ciphertext IS NULL AND refresh_token_iv IS NULL AND refresh_token_tag IS NULL)
      OR
      (refresh_token_ciphertext IS NOT NULL AND refresh_token_iv IS NOT NULL AND refresh_token_tag IS NOT NULL)
    )
);

COMMENT ON TABLE supplier_oauth_connections IS
  'Catalog-owned encrypted OAuth session storage for supplier connectors. Secrets are AES-256-GCM ciphertext; provider app secrets remain environment-only.';
COMMENT ON COLUMN supplier_oauth_connections.supplier_key IS
  'Stable connector identifier, e.g. aliexpress.';
COMMENT ON COLUMN supplier_oauth_connections.access_expires_at IS
  'Provider-declared access-token expiry used to refresh proactively.';
COMMENT ON COLUMN supplier_oauth_connections.refresh_expires_at IS
  'Provider-declared or app-policy refresh-token expiry; NULL only when provider does not issue a refresh token.';

COMMIT;
