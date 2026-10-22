-- @migration 313_market_transport_sale_rates.sql
-- @domain    logistics
-- @purpose   Tarifs de VENTE du transport définis par Market (même moteur transport-pricing, paramètres de marché).
--            Les clés sont celles de business_rules (SEA_KMF_PER_KG_COMMERCIAL, AIR_KMF_PER_KG_TAXABLE) : aucun moteur
--            parallèle. Le tarif est saisi dans la DEVISE DU MARCHÉ (KMF reste la monnaie des Comores) ; il est converti
--            vers la base KMF par la seule voie gouvernée (parités fixes, chaîne FX DJF), jamais implicitement.
--            Absence de ligne = refus fail-closed hors marché KMF.
--            Le coût de fret attesté n'est jamais un prix. Chaque tarif porte sa pièce (evidence_ref) et son auteur.
--            Rollback : DROP TABLE market_transport_sale_rates (aucune donnée métier ne la référence).

CREATE TABLE IF NOT EXISTS market_transport_sale_rates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id        UUID NOT NULL REFERENCES markets(id),
  rate_key         TEXT NOT NULL CHECK (rate_key IN ('SEA_KMF_PER_KG_COMMERCIAL', 'AIR_KMF_PER_KG_TAXABLE')),
  rate_per_kg      NUMERIC(14, 4) NOT NULL CHECK (rate_per_kg > 0), -- dans `currency`
  currency         TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  evidence_ref     TEXT NOT NULL CHECK (length(btrim(evidence_ref)) > 0),
  set_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  valid_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_market_transport_sale_rates_active
  ON market_transport_sale_rates (market_id, rate_key) WHERE revoked_at IS NULL;

COMMENT ON TABLE market_transport_sale_rates IS
  'Tarif de vente transport par Market (devise du marché, par kg ; converti en KMF de base par voie gouvernée). Absent = refus hors KMF. Distinct du coût de fret attesté.';
