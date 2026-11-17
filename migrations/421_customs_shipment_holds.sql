-- G6-E : état « retenu en douane » (décision propriétaire, #4327 du 16/11/2026).
-- Additif : aucune colonne ni enum existant modifié. Un dossier est retenu tant qu'une ligne 'held' existe.
-- Déclaration : transitaire ou responsable marché de son marché (motif obligatoire).
-- Libération (mainlevée) : responsable marché de son marché ou admin ; contrôlé par le service/la route.
CREATE TABLE IF NOT EXISTS customs_shipment_holds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id       UUID NOT NULL REFERENCES customs_shipments(id),
  market_id         UUID NOT NULL REFERENCES markets(id),
  status            TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','released')),
  reason            TEXT NOT NULL CHECK (length(btrim(reason)) >= 3),
  held_by           UUID NOT NULL REFERENCES users(id),
  held_by_role      TEXT NOT NULL,
  held_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_by       UUID REFERENCES users(id),
  released_by_role  TEXT,
  released_at       TIMESTAMPTZ,
  release_note      TEXT,
  CONSTRAINT customs_shipment_holds_release_coherent CHECK (
    (status = 'held' AND released_at IS NULL AND released_by IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL AND released_by IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customs_shipment_holds_one_active
  ON customs_shipment_holds (shipment_id) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS idx_customs_shipment_holds_market
  ON customs_shipment_holds (market_id, status);
