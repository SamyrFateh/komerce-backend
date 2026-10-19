-- @migration 303_cash_custody_provenance_edges.sql
-- @domain payment
-- Golden 1D-B: registre additif de provenance, sans modifier l'autorité des soldes.
-- Aucun backfill, aucune attribution implicite, aucun branchement clôture 1C.
-- Les arêtes représentent des revendications de provenance explicites et ne
-- constituent PAS à elles seules une preuve de reversement final certifiée.

DO $pre$
BEGIN
  IF to_regclass('public.cash_custody_receipts') IS NULL
     OR to_regclass('public.cash_collections') IS NULL
     OR to_regclass('public.cash_deposits') IS NULL THEN
    RAISE EXCEPTION '303: migrations 287/289 requises';
  END IF;
END
$pre$;

CREATE TABLE cash_custody_provenance_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES cash_collections(id),
  parent_id uuid REFERENCES cash_custody_provenance_edges(id),
  receipt_id uuid NOT NULL REFERENCES cash_custody_receipts(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  amount_kmf numeric(14,2) NOT NULL CHECK (amount_kmf > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_provenance_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_cash_provenance_collection ON cash_custody_provenance_edges(collection_id);
CREATE INDEX idx_cash_provenance_parent ON cash_custody_provenance_edges(parent_id);
CREATE INDEX idx_cash_provenance_receipt ON cash_custody_provenance_edges(receipt_id);

CREATE OR REPLACE FUNCTION cash_provenance_enforce_insert()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE
  src cash_collections%ROWTYPE;
  parent cash_custody_provenance_edges%ROWTYPE;
  receipt cash_custody_receipts%ROWTYPE;
  dep cash_deposits%ROWTYPE;
  used numeric;
  limit_amount numeric;
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
  SELECT receipt.amount_kmf - COALESCE(SUM(rv.amount_kmf),0)
    INTO limit_amount FROM cash_custody_receipts rv
    WHERE rv.reverses_id = receipt.id;
  SELECT COALESCE(SUM(amount_kmf),0) INTO used
    FROM cash_custody_provenance_edges WHERE receipt_id = NEW.receipt_id;
  IF used + NEW.amount_kmf > limit_amount THEN
    RAISE EXCEPTION '303: provenance excède le reçu/contrôle net';
  END IF;
  RETURN NEW;
END
$f$;
CREATE TRIGGER trg_cash_provenance_enforce_insert
BEFORE INSERT ON cash_custody_provenance_edges
FOR EACH ROW EXECUTE FUNCTION cash_provenance_enforce_insert();

CREATE TRIGGER trg_cash_provenance_no_update
BEFORE UPDATE OR DELETE ON cash_custody_provenance_edges
FOR EACH ROW EXECUTE FUNCTION cash_ledger_prevent_mutation();

COMMENT ON TABLE cash_custody_provenance_edges IS
  'Golden 1D-B: revendications de provenance explicites, append-only; ne certifie pas la clôture financière. Les inversions de réception nécessitent une projection nette avant activation.';
