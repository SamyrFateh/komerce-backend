-- 288_cash_custody_recipients.sql
-- PR 4a — Destinataires habilités, destinations finales, délai de garde (additif).
--
-- * Personnes habilitées à recevoir des fonds : capability existante-style
--   `cash.custody.receive` (montant porté : membership_capabilities.limit_amount =
--   plafond de détention de la personne, en KMF), accordée par les API d'équipe
--   existantes, sous le ceiling du Market. Aucun agent Relais ne s'ajoute lui-même.
-- * Destinations finales (banque, Mobile Money) : market_cash_destinations,
--   PROPOSED → ACTIVE par DEUX acteurs distincts, jamais supprimées.
-- * Délai de garde par Market : colonne sur la politique cash existante.
-- Plafonds et délais restent bornés par des limites centrales (business_rules,
-- appliquées par le service). Aucun compte de paiement électronique n'est modifié :
-- une destination Mobile Money peut seulement le RÉFÉRENCER (même Market, même devise).

-- ─── Capability d'habilitation à recevoir des fonds ────────────────────────
INSERT INTO capability_registry
  (capability, class, domain, authority_scope, delegation_mode, requires_audit, status, effect, amount_bearing)
VALUES
  ('cash.custody.receive', 'DELEGATION', 'finance', 'MARKET', 'DELEGABLE', TRUE, 'LIVE', 'ACT', TRUE)
ON CONFLICT (capability) DO NOTHING;

-- Template de ceiling courant + assignments actifs (la détention reste une habilitation
-- explicite : on n'accorde la capability à PERSONNE, on la rend seulement accordable).
INSERT INTO ceiling_template_capabilities (template_id, capability)
SELECT t.id, 'cash.custody.receive' FROM ceiling_templates t WHERE t.is_current
ON CONFLICT DO NOTHING;

INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'cash.custody.receive', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1 FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id AND acc.capability = 'cash.custody.receive' AND acc.revoked_at IS NULL
   );

-- ─── Délai de garde par Market (NULL = défaut central) ─────────────────────
ALTER TABLE market_cash_control_policies
  ADD COLUMN IF NOT EXISTS custody_max_days integer
    CONSTRAINT market_cash_control_policies_custody_days_chk CHECK (custody_max_days IS NULL OR custody_max_days BETWEEN 1 AND 365);

-- ─── Destinations finales autorisées ───────────────────────────────────────
CREATE TABLE market_cash_destinations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id          uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  kind               text NOT NULL,
  label              text NOT NULL,
  currency           text NOT NULL,
  account_ref        text NOT NULL,
  payment_account_id uuid NULL REFERENCES market_payment_accounts(id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'PROPOSED',
  proposed_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activated_by       uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  activated_at       timestamptz NULL,
  status_reason      text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_cash_destinations_kind_chk CHECK (kind IN ('BANK', 'MOBILE_MONEY')),
  CONSTRAINT market_cash_destinations_label_chk CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
  CONSTRAINT market_cash_destinations_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  -- Référence d'affichage (ex. « BIC …1234 »), jamais un secret ni des identifiants de connexion.
  CONSTRAINT market_cash_destinations_account_ref_chk CHECK (
    char_length(btrim(account_ref)) BETWEEN 3 AND 120 AND account_ref !~* '(^|[^a-z])(sk|rk|pk|whsec)_'
  ),
  CONSTRAINT market_cash_destinations_status_chk CHECK (status IN ('PROPOSED', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  -- Deux acteurs distincts : celui qui propose n'active jamais lui-même.
  CONSTRAINT market_cash_destinations_two_actors_chk CHECK (
    (activated_by IS NULL AND activated_at IS NULL AND status IN ('PROPOSED', 'CLOSED'))
    OR (activated_by IS NOT NULL AND activated_at IS NOT NULL AND activated_by <> proposed_by)
  ),
  CONSTRAINT market_cash_destinations_reason_chk CHECK (
    status NOT IN ('SUSPENDED', 'CLOSED') OR (status_reason IS NOT NULL AND char_length(btrim(status_reason)) >= 3)
  )
);

CREATE UNIQUE INDEX uniq_market_cash_destinations_live
  ON market_cash_destinations (market_id, kind, account_ref)
  WHERE status IN ('PROPOSED', 'ACTIVE', 'SUSPENDED');
CREATE INDEX idx_market_cash_destinations_market ON market_cash_destinations (market_id, status);

CREATE OR REPLACE FUNCTION market_cash_destinations_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
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
$f$;

CREATE TRIGGER trg_market_cash_destinations_guard
  BEFORE INSERT OR UPDATE ON market_cash_destinations
  FOR EACH ROW EXECUTE FUNCTION market_cash_destinations_guard();
CREATE TRIGGER trg_prevent_market_cash_destinations_delete
  BEFORE DELETE ON market_cash_destinations
  FOR EACH ROW EXECUTE FUNCTION cash_ledger_prevent_mutation();

COMMENT ON TABLE market_cash_destinations IS
  'Destinations finales autorisées (banque, Mobile Money) par Market : proposée par un acteur, activée par un autre, jamais supprimée. Peut référencer un compte de paiement sans le modifier.';
COMMENT ON COLUMN market_cash_control_policies.custody_max_days IS
  'Délai de garde maximal des espèces dans ce Market (jours) ; NULL = défaut central ; borné par la limite centrale côté service.';
