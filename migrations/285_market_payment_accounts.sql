-- @migration 285_market_payment_accounts.sql
-- @domain    payments
-- @purpose   Configuration de paiement par Market, indépendante du prestataire (D4a).
--
-- Owner: payments
-- Un compte de paiement de Market distingue explicitement quatre rôles qui ne sont pas
-- nécessairement la même entité : titulaire du compte, vendeur juridique, opérateur du
-- Market et entité qui supporte les remboursements.
-- AUCUN secret n'est stocké : credentials_ref est une référence opaque vers un coffre de
-- secrets (jamais une clé). La contrainte refuse les motifs de clés connus (sk_, rk_, pk_, whsec_).
-- Migration additive : aucune ligne existante modifiée, aucun flux de paiement rebranché
-- (le résolveur par Market est le lot D4b). Stripe Connect n'est qu'un adaptateur possible.

CREATE TABLE IF NOT EXISTS public.market_payment_accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id              uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  provider               text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
  adapter                text NULL CHECK (adapter IS NULL OR adapter ~ '^[a-z][a-z0-9_]{1,40}$'),
  currency               text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  account_holder         text NOT NULL CHECK (char_length(btrim(account_holder)) BETWEEN 2 AND 200),
  legal_seller           text NOT NULL CHECK (char_length(btrim(legal_seller)) BETWEEN 2 AND 200),
  market_operator_entity text NULL CHECK (market_operator_entity IS NULL OR char_length(btrim(market_operator_entity)) BETWEEN 2 AND 200),
  refund_bearer          text NOT NULL CHECK (refund_bearer IN ('MARKET', 'PLATFORM')),
  external_account_id    text NULL CHECK (external_account_id IS NULL OR char_length(btrim(external_account_id)) BETWEEN 2 AND 200),
  credentials_ref        text NULL CHECK (
    credentials_ref IS NULL
    OR (credentials_ref ~ '^[a-z0-9][a-z0-9:_./-]{2,200}$' AND credentials_ref !~* '(^|[^a-z])(sk|rk|pk|whsec)_')
  ),
  legal_basis_ref        text NULL CHECK (legal_basis_ref IS NULL OR char_length(btrim(legal_basis_ref)) BETWEEN 3 AND 300),
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  verification_ref       text NULL CHECK (verification_ref IS NULL OR char_length(btrim(verification_ref)) BETWEEN 3 AND 300),
  verified_at            timestamptz NULL,
  verified_by            uuid NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_by             uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- La vérification administrative est une preuve tracée à part (acteur, date, référence de preuve),
  -- jamais produite par l'activation. Elle ne garantit pas la validité du secret : la vérification
  -- effective du coffre relève de D4b.
  CONSTRAINT market_payment_accounts_verification_chk CHECK (
    (verified_at IS NULL AND verified_by IS NULL AND verification_ref IS NULL)
    OR (verified_at IS NOT NULL AND verified_by IS NOT NULL AND verification_ref IS NOT NULL)
  ),
  -- Un compte ne devient ACTIF qu'avec référence de coffre, base juridique et vérification tracée.
  CONSTRAINT market_payment_accounts_active_complete_chk CHECK (
    status <> 'ACTIVE'
    OR (credentials_ref IS NOT NULL AND legal_basis_ref IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND verification_ref IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_market_payment_accounts_active
  ON public.market_payment_accounts (market_id, provider, currency)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_market_payment_accounts_market
  ON public.market_payment_accounts (market_id, status);
