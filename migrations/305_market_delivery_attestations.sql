-- 305_market_delivery_attestations.sql
-- Lot B (audit P1–P7) — Preuve de livrabilité d'un marché : liaison de transport + tarification applicable.
--
-- Constat audité : aucun référentiel ne dit, par marché, qu'une liaison de transport existe et à quel
-- tarif ; le checkout n'avait aucune garde (routage insulaire KM seulement, tarifs globaux business_rules).
-- Cette table n'est PAS un booléen : chaque attestation porte un transporteur référencé (carriers),
-- un mode, une origine, un tarif strictement positif, un délai, une référence de preuve documentaire,
-- une validité bornée, un attestant central. Aucun backfill : aucune donnée inventée. Additif, rollback :
-- DROP TABLE market_delivery_attestations.

CREATE TABLE IF NOT EXISTS market_delivery_attestations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id          UUID NOT NULL REFERENCES markets(id),
  carrier_id         UUID NOT NULL REFERENCES carriers(id),
  mode               TEXT NOT NULL CHECK (mode IN ('SEA', 'AIR', 'ROAD', 'MIXED')),
  origin_ref         TEXT NOT NULL CHECK (length(btrim(origin_ref)) >= 2),
  freight_rate       NUMERIC(14,2) NOT NULL CHECK (freight_rate > 0),
  rate_currency      TEXT NOT NULL CHECK (rate_currency ~ '^[A-Z]{3}$'),
  rate_unit          TEXT NOT NULL CHECK (rate_unit IN ('PER_KG', 'PER_PARCEL')),
  transit_days       INTEGER NOT NULL CHECK (transit_days > 0 AND transit_days <= 365),
  evidence_ref       TEXT NOT NULL CHECK (length(btrim(evidence_ref)) >= 3),
  attested_by        UUID NOT NULL REFERENCES users(id),
  attested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until        TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  revoked_by         UUID REFERENCES users(id),
  revoke_reason      TEXT,
  CONSTRAINT market_delivery_attestation_validity CHECK (valid_until > attested_at),
  CONSTRAINT market_delivery_attestation_revocation CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) >= 3)
  )
);

CREATE INDEX IF NOT EXISTS idx_market_delivery_attestations_active
  ON market_delivery_attestations (market_id, valid_until)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE market_delivery_attestations IS
  'Preuve centrale, vérifiable et révocable, qu''une liaison de transport et un tarif applicable existent pour un marché. Jamais un booléen ; jamais déduite des tarifs globaux.';
