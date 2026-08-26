-- @migration 146_customs_shipments_market_id.sql
-- @domain    logistics-customs
-- @purpose   LOT 4B — donner aux expéditions douane une propriété marché
--            explicite afin que le Workspace Canonical puisse agir en contexte
--            mono-market sans inférer l'autorité depuis le navigateur.
--
-- Migration additive : market_id reste nullable pour les anciennes expéditions
-- sans colis, ou celles dont les liens historiques sont ambigus. Le runtime
-- Canonical refuse ces lignes non résolues ; Legacy reste disponible pendant
-- la preuve. Un NOT NULL éventuel viendra seulement après assainissement.

ALTER TABLE customs_shipments
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id);

-- Backfill uniquement quand tous les colis rattachés pointent vers un seul
-- marché autoritatif via orders.market_id. Aucune supposition par île/texte.
WITH resolved AS (
  SELECT csp.shipment_id,
         MIN(o.market_id::text)::uuid AS market_id
    FROM customs_shipment_parcels csp
    JOIN parcels p ON p.id = csp.parcel_id
    JOIN orders o ON o.id = p.order_id
   WHERE o.market_id IS NOT NULL
   GROUP BY csp.shipment_id
  HAVING COUNT(DISTINCT o.market_id) = 1
)
UPDATE customs_shipments cs
   SET market_id = resolved.market_id
  FROM resolved
 WHERE cs.id = resolved.shipment_id
   AND cs.market_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_customs_shipments_market_id
  ON customs_shipments (market_id, shipment_date DESC);

COMMENT ON COLUMN customs_shipments.market_id IS
  'Marché propriétaire de l expédition douane. Autorité serveur pour les Workspaces Canonical; NULL = legacy non résolu, non actionnable en Canonical.';
