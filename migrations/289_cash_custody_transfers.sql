-- 289_cash_custody_transfers.sql
-- PR 4b — Transferts de garde, réception, contrôle indépendant, pertes (additif).
--
-- Autorité unique conservée : cash_deposits reste LE fait « remise ». Une remise est
--   LEGACY   remise historique (admin la vérifie ; « à régulariser », jamais clôturante)
--   TRANSFER remise vers une personne habilitée (cash.custody.receive) du même Market
--   FINAL    remise vers une destination finale ACTIVE (banque / Mobile Money)
-- Une déclaration n'est PAS un transfert : le solde ne bouge qu'à l'acceptation
-- (cash_custody_receipts, append-only). Aucun transfert intermédiaire ne clôture :
-- la clôture n'existe qu'avec un CONTRÔLE indépendant d'une réception finale prouvée.
-- Les pertes (cash_custody_losses) sont une décision centrale distincte des montants reçus.
-- Tout solde de garde dérive d'UNE seule vue (cash_custody_movements) ; aucun compteur stocké.
--
-- Invariants portés par la base :
--   K1 montant annoncé ≠ montant reçu ; devise et taux figés à la déclaration
--   K2 reçu ≤ annoncé ; contrôlé ≤ reçu net ; contre-écriture ≤ cible (conservation stricte)
--   K3 solde d'un détenteur jamais négatif (verrous ordonnés, vérifié après chaque écriture)
--   K4 receveur = destinataire désigné (TRANSFER) ; réception finale par un tiers habilité ≠ remettant
--   K5 contrôle final par un acteur ≠ remettant ≠ receveur
--   K6 faits append-only ; correction = contre-écriture motivée
--   K7 statut d'une remise non-LEGACY dérivé des seuls reçus (aucune revue admin parallèle)
--   K8 régularisation d'une remise historique : même agent/Market, Σ ≤ montant historique

DO $pre$
BEGIN
  IF to_regclass('public.cash_deposits') IS NULL
     OR to_regclass('public.cash_deposit_allocations') IS NULL
     OR to_regclass('public.market_cash_destinations') IS NULL
     OR to_regclass('public.membership_capabilities') IS NULL THEN
    RAISE EXCEPTION '289 precondition: migrations 287 et 288 requises';
  END IF;
  IF to_regclass('public.cash_custody_receipts') IS NOT NULL OR to_regclass('public.cash_custody_losses') IS NOT NULL THEN
    RAISE EXCEPTION '289 precondition: tables de transferts déjà présentes (état inattendu)';
  END IF;
  IF EXISTS (SELECT 1 FROM cash_deposits WHERE movement_kind <> 'LEGACY') THEN
    RAISE EXCEPTION '289 precondition: remises non-LEGACY inattendues';
  END IF;
END
$pre$;

-- ─── cash_deposits : cible de la remise ────────────────────────────────────
ALTER TABLE cash_deposits
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS destination_id uuid REFERENCES market_cash_destinations(id),
  ADD COLUMN IF NOT EXISTS regularizes_deposit_id uuid REFERENCES cash_deposits(id);

ALTER TABLE cash_deposits DROP CONSTRAINT cash_deposits_movement_kind_pr3_only_legacy_chk;
ALTER TABLE cash_deposits DROP CONSTRAINT cash_deposits_movement_kind_chk;
ALTER TABLE cash_deposits DROP CONSTRAINT cash_deposits_market_source_chk;
ALTER TABLE cash_deposits
  ADD CONSTRAINT cash_deposits_movement_kind_chk CHECK (movement_kind IN ('LEGACY', 'TRANSFER', 'FINAL')),
  ADD CONSTRAINT cash_deposits_market_source_chk
    CHECK (market_id_source IS NULL OR market_id_source IN ('DERIVED_RELAIS', 'DERIVED_MEMBERSHIP', 'NONE')),
  ADD CONSTRAINT cash_deposits_custody_target_chk CHECK (
    (movement_kind = 'LEGACY' AND recipient_user_id IS NULL AND destination_id IS NULL AND regularizes_deposit_id IS NULL)
    OR (movement_kind = 'TRANSFER' AND recipient_user_id IS NOT NULL AND destination_id IS NULL
        AND recipient_user_id <> agent_id AND declared_currency IS NOT NULL AND market_id IS NOT NULL)
    OR (movement_kind = 'FINAL' AND destination_id IS NOT NULL AND recipient_user_id IS NULL
        AND declared_currency IS NOT NULL AND market_id IS NOT NULL)
  );
CREATE INDEX IF NOT EXISTS idx_cash_dep_recipient ON cash_deposits(recipient_user_id) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_dep_regularizes ON cash_deposits(regularizes_deposit_id) WHERE regularizes_deposit_id IS NOT NULL;

-- ─── Fonctions d'appui ─────────────────────────────────────────────────────
-- Habilitation à recevoir des fonds (même jointure que le service : assignment actif,
-- membership actif, capability non révoquée).
CREATE OR REPLACE FUNCTION cash_custody_authorized(p_user uuid, p_market uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $f$
  SELECT EXISTS (
    SELECT 1
      FROM market_operating_assignments a
      JOIN assignment_memberships am ON am.assignment_id = a.id AND am.status = 'ACTIVE'
      JOIN membership_capabilities mc ON mc.membership_id = am.id
           AND mc.capability = 'cash.custody.receive' AND mc.revoked_at IS NULL
     WHERE a.market_id = p_market AND a.status = 'ACTIVE' AND am.user_id = p_user)
$f$;

-- Verrous de détenteurs dans un ordre déterministe (pas d'interblocage).
CREATE OR REPLACE FUNCTION cash_custody_lock(p_a uuid, p_b uuid)
RETURNS void
LANGUAGE plpgsql
AS $f$
DECLARE
  k text;
BEGIN
  FOR k IN SELECT DISTINCT x FROM unnest(ARRAY[p_a::text, p_b::text]) AS x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtext('cash_hold:' || k));
  END LOOP;
END
$f$;

-- ─── cash_custody_receipts : faits de réception (append-only) ──────────────
CREATE TABLE cash_custody_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id      uuid NOT NULL REFERENCES cash_deposits(id),
  market_id       uuid NOT NULL REFERENCES markets(id),
  kind            text NOT NULL,
  actor_id        uuid NOT NULL REFERENCES users(id),
  amount_kmf      numeric(14,2) NOT NULL DEFAULT 0,
  received_amount numeric(18,2) NULL,
  received_currency text NULL,
  fx_rate_to_kmf  numeric(18,6) NULL,
  proof_ref       text NULL,
  proof_url       text NULL,
  reason          text NULL,
  reverses_id     uuid NULL REFERENCES cash_custody_receipts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_custody_receipts_kind_chk CHECK (kind IN ('RECEIVED', 'REFUSED', 'CONTROL', 'REVERSAL')),
  CONSTRAINT cash_custody_receipts_amount_chk CHECK (amount_kmf >= 0),
  CONSTRAINT cash_custody_receipts_shape_chk CHECK (
    (kind = 'RECEIVED' AND amount_kmf > 0 AND received_amount > 0 AND reverses_id IS NULL)
    OR (kind = 'REFUSED' AND amount_kmf = 0 AND char_length(btrim(COALESCE(reason, ''))) >= 3 AND reverses_id IS NULL)
    OR (kind = 'CONTROL' AND reverses_id IS NULL AND (amount_kmf > 0 OR char_length(btrim(COALESCE(reason, ''))) >= 3))
    OR (kind = 'REVERSAL' AND amount_kmf > 0 AND reverses_id IS NOT NULL AND char_length(btrim(COALESCE(reason, ''))) >= 3)
  ),
  CONSTRAINT cash_custody_receipts_proof_chk CHECK (
    (proof_ref IS NULL OR (char_length(btrim(proof_ref)) BETWEEN 3 AND 200 AND proof_ref !~* '(^|[^a-z])(sk|rk|pk|whsec)_'))
  )
);
CREATE UNIQUE INDEX uniq_cash_custody_receipts_resolution ON cash_custody_receipts (deposit_id) WHERE kind IN ('RECEIVED', 'REFUSED');
CREATE UNIQUE INDEX uniq_cash_custody_receipts_control ON cash_custody_receipts (deposit_id) WHERE kind = 'CONTROL';
CREATE INDEX idx_cash_custody_receipts_deposit ON cash_custody_receipts (deposit_id, kind);
CREATE INDEX idx_cash_custody_receipts_reverses ON cash_custody_receipts (reverses_id) WHERE reverses_id IS NOT NULL;

-- ─── cash_custody_losses : décision centrale de perte (append-only) ────────
CREATE TABLE cash_custody_losses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   uuid NOT NULL REFERENCES markets(id),
  holder_id   uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL,
  amount_kmf  numeric(14,2) NOT NULL,
  reason      text NOT NULL,
  decided_by  uuid NOT NULL REFERENCES users(id),
  deposit_id  uuid NULL REFERENCES cash_deposits(id),
  reverses_id uuid NULL REFERENCES cash_custody_losses(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_custody_losses_kind_chk CHECK (kind IN ('LOSS', 'LOSS_REVERSAL')),
  CONSTRAINT cash_custody_losses_amount_chk CHECK (amount_kmf > 0),
  CONSTRAINT cash_custody_losses_reason_chk CHECK (char_length(btrim(reason)) >= 10),
  CONSTRAINT cash_custody_losses_decider_chk CHECK (decided_by <> holder_id),
  CONSTRAINT cash_custody_losses_reversal_chk CHECK (
    (kind = 'LOSS' AND reverses_id IS NULL) OR (kind = 'LOSS_REVERSAL' AND reverses_id IS NOT NULL)
  )
);
CREATE INDEX idx_cash_custody_losses_holder ON cash_custody_losses (holder_id, market_id);

-- ─── Vue unique : mouvements de responsabilité (seule source de solde) ─────
CREATE VIEW cash_custody_movements AS
  SELECT 'COLLECTION'::text AS source, cc.id AS ref_id, NULL::uuid AS deposit_id,
         cc.collected_by AS holder_id,
         cash_collection_market(cc.relais_id, cc.collected_by) AS market_id,
         cc.amount_kmf::numeric AS delta_kmf, cc.confirmed_at AS occurred_at
    FROM cash_collections cc
  UNION ALL
  SELECT 'TRANSFER_OUT', r.id, d.id, d.agent_id, d.market_id,
         -(CASE WHEN r.kind = 'REVERSAL' THEN -r.amount_kmf ELSE r.amount_kmf END), r.created_at
    FROM cash_custody_receipts r
    JOIN cash_deposits d ON d.id = r.deposit_id
    LEFT JOIN cash_custody_receipts t ON t.id = r.reverses_id
   WHERE d.movement_kind = 'TRANSFER' AND COALESCE(t.kind, r.kind) = 'RECEIVED'
  UNION ALL
  SELECT 'TRANSFER_IN', r.id, d.id, d.recipient_user_id, d.market_id,
         (CASE WHEN r.kind = 'REVERSAL' THEN -r.amount_kmf ELSE r.amount_kmf END), r.created_at
    FROM cash_custody_receipts r
    JOIN cash_deposits d ON d.id = r.deposit_id
    LEFT JOIN cash_custody_receipts t ON t.id = r.reverses_id
   WHERE d.movement_kind = 'TRANSFER' AND COALESCE(t.kind, r.kind) = 'RECEIVED'
  UNION ALL
  SELECT 'FINAL_CLOSURE', r.id, d.id, d.agent_id, d.market_id,
         -(CASE WHEN r.kind = 'REVERSAL' THEN -r.amount_kmf ELSE r.amount_kmf END), r.created_at
    FROM cash_custody_receipts r
    JOIN cash_deposits d ON d.id = r.deposit_id
    LEFT JOIN cash_custody_receipts t ON t.id = r.reverses_id
   WHERE d.movement_kind = 'FINAL' AND COALESCE(t.kind, r.kind) = 'CONTROL'
  UNION ALL
  SELECT 'LOSS', l.id, l.deposit_id, l.holder_id, l.market_id,
         (CASE WHEN l.kind = 'LOSS' THEN -l.amount_kmf ELSE l.amount_kmf END), l.created_at
    FROM cash_custody_losses l;

COMMENT ON VIEW cash_custody_movements IS
  'Autorité unique des soldes de garde : encaissements (+), transferts acceptés (−/+), clôtures finales contrôlées (−), pertes décidées (−), contre-écritures. Une déclaration seule ne bouge rien.';

CREATE OR REPLACE FUNCTION cash_custody_assert_nonnegative(p_holder uuid, p_market uuid)
RETURNS void
LANGUAGE plpgsql
AS $f$
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
$f$;

-- ─── Statut dérivé d'une remise non-LEGACY (K7) ────────────────────────────
CREATE OR REPLACE FUNCTION cash_custody_expected_status(p_deposit_id uuid)
RETURNS text
LANGUAGE sql STABLE
AS $f$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cash_custody_receipts r WHERE r.deposit_id = d.id AND r.kind = 'REFUSED') THEN 'disputed'
    WHEN d.movement_kind = 'TRANSFER' THEN
      CASE WHEN EXISTS (SELECT 1 FROM cash_custody_receipts r WHERE r.deposit_id = d.id AND r.kind = 'RECEIVED') THEN 'verified' ELSE 'pending' END
    ELSE
      COALESCE((SELECT CASE WHEN r.amount_kmf > 0 THEN 'verified' ELSE 'disputed' END
                  FROM cash_custody_receipts r WHERE r.deposit_id = d.id AND r.kind = 'CONTROL'), 'pending')
  END
  FROM cash_deposits d WHERE d.id = p_deposit_id
$f$;

-- ─── Garde d'insertion des remises non-LEGACY (K4/K8) ──────────────────────
CREATE OR REPLACE FUNCTION cash_deposits_custody_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
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
$f$;

-- Nommé pour s'exécuter après trg_cash_deposits_derive_market (ordre alphabétique).
CREATE TRIGGER trg_cash_deposits_zcustody_guard
  BEFORE INSERT ON cash_deposits
  FOR EACH ROW EXECUTE FUNCTION cash_deposits_custody_guard();

-- Garde de mise à jour : champs d'origine + cible immuables ; statut non-LEGACY = dérivé (K7).
CREATE OR REPLACE FUNCTION cash_deposits_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
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
$f$;

-- ─── Garde des réceptions (K1, K2, K4, K5) ─────────────────────────────────
CREATE OR REPLACE FUNCTION cash_custody_receipts_enforce()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
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
$f$;

CREATE TRIGGER trg_cash_custody_receipts_enforce
  BEFORE INSERT ON cash_custody_receipts
  FOR EACH ROW EXECUTE FUNCTION cash_custody_receipts_enforce();

-- Après écriture : statut dérivé de la remise + solde jamais négatif (K3/K7).
CREATE OR REPLACE FUNCTION cash_custody_receipts_after()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
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
$f$;

CREATE TRIGGER trg_cash_custody_receipts_after
  AFTER INSERT ON cash_custody_receipts
  FOR EACH ROW EXECUTE FUNCTION cash_custody_receipts_after();

-- ─── Garde des pertes ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cash_custody_losses_enforce()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
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
$f$;

CREATE TRIGGER trg_cash_custody_losses_enforce
  BEFORE INSERT ON cash_custody_losses
  FOR EACH ROW EXECUTE FUNCTION cash_custody_losses_enforce();

CREATE OR REPLACE FUNCTION cash_custody_losses_after()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
BEGIN
  PERFORM cash_custody_assert_nonnegative(NEW.holder_id, NEW.market_id);
  RETURN NEW;
END
$f$;

CREATE TRIGGER trg_cash_custody_losses_after
  AFTER INSERT ON cash_custody_losses
  FOR EACH ROW EXECUTE FUNCTION cash_custody_losses_after();

-- K6 : append-only.
CREATE TRIGGER trg_prevent_cash_custody_receipts_update
  BEFORE UPDATE ON cash_custody_receipts FOR EACH ROW EXECUTE FUNCTION cash_ledger_prevent_mutation();
CREATE TRIGGER trg_prevent_cash_custody_receipts_delete
  BEFORE DELETE ON cash_custody_receipts FOR EACH ROW EXECUTE FUNCTION cash_ledger_prevent_mutation();
CREATE TRIGGER trg_prevent_cash_custody_losses_update
  BEFORE UPDATE ON cash_custody_losses FOR EACH ROW EXECUTE FUNCTION cash_ledger_prevent_mutation();
CREATE TRIGGER trg_prevent_cash_custody_losses_delete
  BEFORE DELETE ON cash_custody_losses FOR EACH ROW EXECUTE FUNCTION cash_ledger_prevent_mutation();

-- ─── Postconditions : aucun solde négatif, aucune clôture fabriquée ────────
DO $post$
DECLARE
  n_bad bigint;
BEGIN
  SELECT count(*) INTO n_bad FROM (
    SELECT holder_id, market_id FROM cash_custody_movements GROUP BY holder_id, market_id HAVING SUM(delta_kmf) < 0) x;
  IF n_bad > 0 THEN RAISE EXCEPTION '289 postcondition: % solde(s) négatif(s)', n_bad; END IF;
  IF EXISTS (SELECT 1 FROM cash_custody_movements WHERE source <> 'COLLECTION') THEN
    RAISE EXCEPTION '289 postcondition: aucune responsabilité ne doit être transférée ou clôturée par la migration';
  END IF;
END
$post$;

COMMENT ON TABLE cash_custody_receipts IS
  'Faits de réception d''une remise de garde (append-only) : RECEIVED (montant et devise/taux figés), REFUSED, CONTROL (final, acteur indépendant), REVERSAL (contre-écriture motivée).';
COMMENT ON TABLE cash_custody_losses IS
  'Décisions centrales de perte (append-only, motivées, distinctes des montants reçus) ; correction par LOSS_REVERSAL.';
COMMENT ON COLUMN cash_deposits.recipient_user_id IS 'TRANSFER : personne habilitée désignée ; le solde ne bouge qu''à son acceptation.';
COMMENT ON COLUMN cash_deposits.destination_id IS 'FINAL : destination finale ACTIVE ; la clôture exige réception prouvée + contrôle indépendant.';
COMMENT ON COLUMN cash_deposits.regularizes_deposit_id IS 'Remise historique vérifiée que ce transfert régularise (jamais clôturée automatiquement).';
