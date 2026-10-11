-- 287_cash_custody_ledger.sql
-- PR 3 — Grand livre de garde cash (additif, aucune responsabilité transférée).
--
-- * cash_deposits reste l'unique autorité des remises (colonnes market_id,
--   market_id_source, movement_kind ajoutées).
-- * cash_deposit_allocations = quelle part de quel encaissement une remise
--   couvre. Une allocation est RECONSTRUCTED (FIFO serveur / historique) ou
--   CONFIRMED (PR 4, désignée explicitement). Aucune clôture sur approximation.
-- * Une allocation ne décharge pas l'agent : seule une réception finale
--   prouvée (PR 4b) le fera. Jusqu'là, la couverture reste PROVISOIRE.
--
-- Invariants portés par la base (J1–J8) :
--   J1 Σ lignes vivantes d'un encaissement ≤ son montant (jamais de double comptage)
--   J2 Σ lignes d'une remise ≤ son montant (écart/surplus jamais alloué)
--   J3 montants et devises d'origine immuables (agent, montant, snapshot déclaré)
--   J4 une remise ne se supprime jamais ; une allocation est append-only
--   J5 statut jamais ramené à 'pending' ; réactivation d'une remise contestée
--      revérifie J1 (pas de résurrection qui double-compterait)
--   J6 même Market (remise = encaissement = allocation) et même agent
--   J7 fonds ouverts / clôturés / pertes : movement_kind LEGACY seul autorisé
--      en PR 3 (TRANSFER/FINAL/LOSS réservés, créés en PR 4)
--   J8 préconditions et conservation vérifiées avant/après toute écriture ;
--      échec = ROLLBACK complet (le runner enveloppe le fichier en transaction)

-- ─── Préconditions (fail-closed, avant toute écriture) ─────────────────────
DO $pre$
DECLARE
  n_dep bigint;
  n_col bigint;
  n_bad bigint;
BEGIN
  IF to_regclass('public.cash_deposits') IS NULL
     OR to_regclass('public.cash_collections') IS NULL
     OR to_regclass('public.markets') IS NULL
     OR to_regclass('public.relais') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION '287 precondition: tables cash_deposits/cash_collections/markets/relais/users requises';
  END IF;
  IF to_regclass('public.cash_deposit_allocations') IS NOT NULL THEN
    RAISE EXCEPTION '287 precondition: cash_deposit_allocations existe déjà (état inattendu)';
  END IF;

  SELECT count(*) INTO n_dep FROM cash_deposits;
  SELECT count(*) INTO n_col FROM cash_collections;
  RAISE NOTICE '287 volumes: % remise(s), % encaissement(s)', n_dep, n_col;

  SELECT count(*) INTO n_bad FROM cash_deposits
   WHERE status NOT IN ('pending', 'verified', 'disputed') OR status IS NULL;
  IF n_bad > 0 THEN
    RAISE EXCEPTION '287 precondition: % remise(s) avec statut hors domaine', n_bad;
  END IF;
  SELECT count(*) INTO n_bad FROM cash_deposits WHERE amount_kmf <= 0;
  IF n_bad > 0 THEN
    RAISE EXCEPTION '287 precondition: % remise(s) de montant <= 0', n_bad;
  END IF;
  SELECT count(*) INTO n_bad FROM cash_collections WHERE amount_kmf <= 0;
  IF n_bad > 0 THEN
    RAISE EXCEPTION '287 precondition: % encaissement(s) de montant <= 0', n_bad;
  END IF;
END
$pre$;

-- ─── cash_deposits : autorité unique des remises ───────────────────────────
ALTER TABLE cash_deposits
  ADD COLUMN IF NOT EXISTS market_id uuid REFERENCES markets(id),
  ADD COLUMN IF NOT EXISTS market_id_source text,
  ADD COLUMN IF NOT EXISTS movement_kind text NOT NULL DEFAULT 'LEGACY';

ALTER TABLE cash_deposits
  ADD CONSTRAINT cash_deposits_status_domain_chk
    CHECK (status IN ('pending', 'verified', 'disputed')),
  ADD CONSTRAINT cash_deposits_amount_positive_chk
    CHECK (amount_kmf > 0),
  ADD CONSTRAINT cash_deposits_movement_kind_chk
    CHECK (movement_kind IN ('LEGACY', 'TRANSFER', 'FINAL', 'LOSS')),
  ADD CONSTRAINT cash_deposits_movement_kind_pr3_only_legacy_chk
    CHECK (movement_kind = 'LEGACY'),
  ADD CONSTRAINT cash_deposits_market_source_chk
    CHECK (market_id_source IS NULL OR market_id_source IN ('DERIVED_RELAIS', 'NONE'));

CREATE INDEX IF NOT EXISTS idx_cash_dep_market ON cash_deposits(market_id) WHERE market_id IS NOT NULL;

-- Market d'un encaissement : relais de l'encaissement, sinon relais de l'agent.
CREATE OR REPLACE FUNCTION cash_collection_market(p_relais_id uuid, p_collected_by uuid)
RETURNS uuid
LANGUAGE sql STABLE
AS $f$
  SELECT COALESCE(
    (SELECT r.market_id FROM relais r WHERE r.id = p_relais_id),
    (SELECT r.market_id FROM users u JOIN relais r ON r.id = u.relais_id WHERE u.id = p_collected_by)
  )
$f$;

-- Dérivation du Market d'une remise à l'insertion (J6). Jamais fourni librement.
CREATE OR REPLACE FUNCTION cash_deposits_derive_market()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
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
$f$;

CREATE TRIGGER trg_cash_deposits_derive_market
  BEFORE INSERT ON cash_deposits
  FOR EACH ROW EXECUTE FUNCTION cash_deposits_derive_market();

-- ─── cash_deposit_allocations : quelle remise couvre quel encaissement ─────
CREATE TABLE cash_deposit_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id        uuid NOT NULL REFERENCES cash_deposits(id),
  collection_id     uuid NOT NULL REFERENCES cash_collections(id),
  market_id         uuid NOT NULL REFERENCES markets(id),
  amount_kmf        numeric(14,2) NOT NULL,
  allocation_basis  text NOT NULL DEFAULT 'RECONSTRUCTED',
  allocation_source text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_deposit_allocations_amount_chk CHECK (amount_kmf > 0),
  CONSTRAINT cash_deposit_allocations_basis_chk
    CHECK (allocation_basis IN ('RECONSTRUCTED', 'CONFIRMED')),
  CONSTRAINT cash_deposit_allocations_source_chk
    CHECK (allocation_source IN ('SERVER_FIFO', 'LEGACY_BACKFILL', 'AGENT_DESIGNATED')),
  CONSTRAINT cash_deposit_allocations_unique UNIQUE (deposit_id, collection_id)
);

CREATE INDEX idx_cash_alloc_collection ON cash_deposit_allocations(collection_id);
CREATE INDEX idx_cash_alloc_market ON cash_deposit_allocations(market_id);

-- J6 : même Market et même agent ; J1/J2 : conservation avec verrous de lignes
-- (la ligne parent est verrouillée AVANT la somme → les concurrents se
-- sérialisent, le second voit le commit du premier).
CREATE OR REPLACE FUNCTION cash_alloc_enforce()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
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
$f$;

CREATE TRIGGER trg_cash_alloc_enforce
  AFTER INSERT ON cash_deposit_allocations
  FOR EACH ROW EXECUTE FUNCTION cash_alloc_enforce();

-- J4 : allocations append-only, remises non supprimables.
CREATE OR REPLACE FUNCTION cash_ledger_prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $f$
BEGIN
  RAISE EXCEPTION '% est append-only : % interdit (contre-passer, ne pas supprimer)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$f$;

CREATE TRIGGER trg_prevent_cash_alloc_update
  BEFORE UPDATE ON cash_deposit_allocations
  FOR EACH ROW EXECUTE FUNCTION cash_ledger_prevent_mutation();
CREATE TRIGGER trg_prevent_cash_alloc_delete
  BEFORE DELETE ON cash_deposit_allocations
  FOR EACH ROW EXECUTE FUNCTION cash_ledger_prevent_mutation();
CREATE TRIGGER trg_prevent_cash_deposits_delete
  BEFORE DELETE ON cash_deposits
  FOR EACH ROW EXECUTE FUNCTION cash_ledger_prevent_mutation();

-- J3/J5 : immutabilité des champs d'origine ; statut jamais 'pending' ensuite ;
-- réactivation d'une remise contestée = revérification J1 par ligne.
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
     OR (OLD.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM OLD.market_id) THEN
    RAISE EXCEPTION 'cash_deposits: champs d''origine immuables (agent, montant, devise, référence, Market)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending' THEN
      RAISE EXCEPTION 'cash_deposits: retour à pending interdit (%→pending)', OLD.status
        USING ERRCODE = 'check_violation';
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

CREATE TRIGGER trg_cash_deposits_guard_update
  BEFORE UPDATE ON cash_deposits
  FOR EACH ROW EXECUTE FUNCTION cash_deposits_guard_update();

-- ─── Allocation FIFO serveur : seule autorité, partagée service + backfill ──
-- Alloue au plus min(montant de la remise, reste des encaissements de l'agent
-- dans le même Market), du plus ancien au plus récent. Le surplus n'est jamais
-- alloué. Retourne le montant alloué. Idempotent (aucune ligne si déjà alloué).
CREATE OR REPLACE FUNCTION cash_allocate_fifo(p_deposit_id uuid, p_source text)
RETURNS numeric
LANGUAGE plpgsql
AS $f$
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
$f$;

-- ─── Backfill historique (reconstruit, jamais confirmé) ─────────────────────
-- Remises vivantes d'abord (pending/verified) puis contestées sur le reste.
CREATE OR REPLACE FUNCTION cash_ledger_backfill_legacy()
RETURNS bigint
LANGUAGE plpgsql
AS $f$
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
$f$;

DO $bf$
DECLARE
  lines bigint;
  n_bad bigint;
BEGIN
  lines := cash_ledger_backfill_legacy();
  RAISE NOTICE '287 backfill: % ligne(s) d''allocation reconstruite(s)', lines;

  SELECT count(*) INTO n_bad FROM (
    SELECT a.collection_id
      FROM cash_deposit_allocations a JOIN cash_deposits d ON d.id = a.deposit_id
      JOIN cash_collections cc ON cc.id = a.collection_id
     WHERE d.status IN ('pending', 'verified')
     GROUP BY a.collection_id, cc.amount_kmf
    HAVING SUM(a.amount_kmf) > cc.amount_kmf) x;
  IF n_bad > 0 THEN
    RAISE EXCEPTION '287 postcondition: % encaissement(s) sur-alloué(s)', n_bad;
  END IF;
  SELECT count(*) INTO n_bad FROM (
    SELECT a.deposit_id FROM cash_deposit_allocations a
      JOIN cash_deposits d ON d.id = a.deposit_id
     GROUP BY a.deposit_id, d.amount_kmf HAVING SUM(a.amount_kmf) > d.amount_kmf) x;
  IF n_bad > 0 THEN
    RAISE EXCEPTION '287 postcondition: % remise(s) sur-allouée(s)', n_bad;
  END IF;
END
$bf$;

COMMENT ON TABLE cash_deposit_allocations IS
  'Grand livre de garde: part de chaque encaissement couverte par une remise (append-only). RECONSTRUCTED = FIFO serveur/historique, non confirmé; ne décharge jamais l''agent.';
COMMENT ON COLUMN cash_deposits.movement_kind IS
  'LEGACY = remise historique ; TRANSFER/FINAL/LOSS réservés PR 4 (contrainte PR3-only à lever alors).';
COMMENT ON COLUMN cash_deposits.market_id IS
  'Market dérivé du relais de l''agent (trigger), jamais fourni librement ; NULL = agent sans relais (aucune allocation).';
