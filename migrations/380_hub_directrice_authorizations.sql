-- P04 (L4) — Deux autorisations métier distinctes de la directrice du Hub :
--   purchase_commitment : valider l'engagement d'achat fournisseur (soumission d'une PO) ;
--   supplier_payment    : autoriser le paiement fournisseur.
-- Pas de nouvelle architecture de rôles : une table minimale de grants (attribués/révoqués par l'Admin central)
-- et une table de décisions append-only (décideur, horodatage, montant, devise, pièce).
CREATE TABLE IF NOT EXISTS public.hub_authorization_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, -- droit rattaché au compte : disparaît avec lui (reset utilisateurs)
  authorization_type text NOT NULL CHECK (authorization_type IN ('purchase_commitment','supplier_payment')),
  granted_by         uuid NOT NULL REFERENCES public.users(id),
  granted_at         timestamptz NOT NULL DEFAULT now(),
  revoked_by         uuid REFERENCES public.users(id),
  revoked_at         timestamptz,
  revoke_reason      text,
  CONSTRAINT chk_hub_auth_grants_revocation CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hub_auth_grants_active ON public.hub_authorization_grants (user_id, authorization_type) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.purchase_order_authorizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  authorization_type text NOT NULL CHECK (authorization_type IN ('purchase_commitment','supplier_payment')),
  decided_by         uuid NOT NULL REFERENCES public.users(id),
  decided_at         timestamptz NOT NULL DEFAULT now(),
  amount             numeric(18,4) NOT NULL CHECK (amount > 0),
  currency           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  proof_ref          text NOT NULL CHECK (btrim(proof_ref) <> ''),
  CONSTRAINT ux_po_authorizations_type UNIQUE (purchase_order_id, authorization_type)
);

CREATE OR REPLACE FUNCTION public.purchase_order_authorizations_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'purchase_order_authorization_immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS trg_po_authorizations_immutable ON public.purchase_order_authorizations;
CREATE TRIGGER trg_po_authorizations_immutable
  BEFORE UPDATE OR DELETE ON public.purchase_order_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.purchase_order_authorizations_immutable();
