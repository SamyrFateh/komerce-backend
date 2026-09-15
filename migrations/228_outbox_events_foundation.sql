-- @migration 228_outbox_events_foundation.sql
-- @domain    infrastructure
-- @purpose   HUB-000 / F0 — Transactional Outbox Lite. Rend exécutable la
--            doctrine "Hub records a physical fact AND the event describing
--            that fact in the SAME database transaction."
--
--            Scope STRICT (arbitrage F0, 2026-09) : une seule famille
--            d'événement, physical_outcome_reported. Ce n'est PAS un event
--            bus générique — voir scripts/lib/hub-authority.js pour le même
--            principe de scope étroit appliqué à F4.
--
-- Preuve du besoin :
--   tests/integration/r6-crash-window.test.js démontre la fenêtre crash
--   post-COMMIT (DEBT-07) et le remède outbox, mais créait sa table dans
--   beforeAll() — jamais une primitive prod (migrations/122 confirme le
--   nettoyage du résidu de test). Ce lot ferme cet écart.
--
-- Garanties portées par ce schéma (pas par la seule discipline applicative) :
--   - écriture atomique avec le fait métier      -> même transaction, côté appelant
--   - livraison at-least-once                    -> processed_at NULL = à (re)livrer
--   - retry durable                              -> attempts / last_error persistés
--   - identité d'événement                       -> id (UUID), jamais réutilisé
--   - append-only                                -> trigger interdisant DELETE
--                                                    (même doctrine que scan_events/incidents)
--
-- L'ordre causal PAR agrégat et le parallélisme ENTRE agrégats sont garantis
-- par la combinaison producer+worker via le même verrou advisory Postgres par
-- agrégat, transaction-scoped.
--
-- IMPORTANT : created_at N'EST PAS l'autorité d'ordre. Il est assigné à
-- l'INSERT, pas au COMMIT ; deux transactions concurrentes pourraient donc
-- devenir visibles dans l'ordre inverse de leurs timestamps. L'autorité
-- d'ordre est aggregate_sequence, attribué par le producer sous
-- pg_advisory_xact_lock(hashtext(aggregate_type||':'||aggregate_id)), verrou
-- bloquant tenu jusqu'au COMMIT/ROLLBACK de l'appelant. Le worker lit toujours
-- le plus petit aggregate_sequence pending et acquiert le MÊME verrou avant le
-- claim. FOR UPDATE SKIP LOCKED seul ne suffit pas : il protège une ligne, pas
-- toute la causalité d'un agrégat.

CREATE TABLE IF NOT EXISTS outbox_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type     TEXT        NOT NULL,
  aggregate_id       TEXT        NOT NULL,
  aggregate_sequence BIGINT      NOT NULL,
  event_type         TEXT        NOT NULL
                                 CHECK (event_type IN ('physical_outcome_reported')),
  payload            JSONB       NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at       TIMESTAMPTZ,
  attempts           INT         NOT NULL DEFAULT 0,
  last_error         TEXT,

  CONSTRAINT uq_outbox_events_aggregate_sequence
    UNIQUE (aggregate_type, aggregate_id, aggregate_sequence),

  CONSTRAINT chk_outbox_events_payload_shape CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload->>'outcome_type' IN ('LOST', 'STOLEN', 'DESTROYED', 'DAMAGED_UNUSABLE')
  )
);

COMMENT ON COLUMN outbox_events.created_at IS
  'Audit/observabilité uniquement — PAS l''autorité d''ordre. Voir aggregate_sequence pour l''ordre causal garanti par agrégat.';

COMMENT ON COLUMN outbox_events.aggregate_sequence IS
  'Autorité d''ordre par agrégat, attribuée par le producer sous pg_advisory_xact_lock (bloquant, tenu jusqu''au commit appelant). Jamais calculée hors de ce verrou.';

-- Claim efficace : file des événements pending.
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
  ON outbox_events (created_at)
  WHERE processed_at IS NULL;

-- Équité inter-agrégats ; l'ordre causal intra-agrégat reste porté par
-- uq_outbox_events_aggregate_sequence.
CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate
  ON outbox_events (aggregate_type, aggregate_id, created_at);

-- PROTECTION : append-only, même doctrine que scan_events / incidents
-- (migrations/022_parcel_first_refactor.sql) — jamais de suppression, le
-- statut se lit via processed_at.
CREATE OR REPLACE FUNCTION prevent_outbox_event_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'La suppression de outbox_events est interdite (append-only).';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_outbox_event_delete') THEN
    CREATE TRIGGER trg_prevent_outbox_event_delete
      BEFORE DELETE ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION prevent_outbox_event_delete();
  END IF;
END $$;

COMMENT ON TABLE outbox_events IS
  'Primitive outbox transactionnelle (HUB-000/F0). Un seul event_type '
  'aujourd''hui : physical_outcome_reported. Toute nouvelle famille '
  'nécessite une migration ajoutant sa valeur au CHECK — jamais un ajout '
  'silencieux côté code.';

-- ══════════════════════════════════════════════════════════════
-- CONSUMER MINIMAL RÉEL (F0 "real consumer proof") — reçu d'audit durable,
-- append-only, sans effet métier (pas de refund/reorder/mutation
-- Orders/Purchasing — hors scope F0). Idempotence garantie par la contrainte
-- UNIQUE(event_id, consumer_key), pas par convention applicative.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS physical_outcome_receipts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL REFERENCES outbox_events(id) ON DELETE RESTRICT,
  consumer_key    TEXT        NOT NULL,
  aggregate_type  TEXT        NOT NULL,
  aggregate_id    TEXT        NOT NULL,
  outcome_type    TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_physical_outcome_receipts_event_consumer UNIQUE (event_id, consumer_key)
);

COMMENT ON TABLE physical_outcome_receipts IS
  'Consumer minimal réel de physical_outcome_reported (F0). Preuve '
  'd''idempotence via UNIQUE(event_id, consumer_key), pas de conséquence '
  'métier — HUB-001 branchera les vrais consumers (Purchasing/Orders) '
  'plus tard, chacun avec son propre consumer_key.';
