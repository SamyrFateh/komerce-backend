-- ============================================================
-- Migration 051 : Reventilation reelle terrain par order_item
-- Date : avril 2026
-- Version ASCII pure
--
-- DOCTRINE :
--   Quand le terrain produit une donnee reelle (facture transitaire,
--   facture douane, scan parcel livre, commission relais payee), on
--   reventile cette realite vers les order_items concernes.
--
--   Resultat : pour chaque order_item, on a une trace complete des
--   coûts reellement engagés, alloues par cost_type et par methode.
--
-- COST_TYPE align sur cost_components migration 043 (13 categories doctrine).
--
-- ALLOCATION_METHOD :
--   - direct           : coût directement attache (achat AED)
--   - by_value         : ventilation proportionnelle a la valeur achat (douane MVP)
--   - by_weight        : ventilation par poids (fret simple)
--   - by_volume        : ventilation par volume m3
--   - by_taxable_weight: max(poids reel, poids volumetrique) (fret aerien/maritime)
--   - per_item         : montant fixe par article (commission relais standard)
--   - per_order        : montant fixe par commande (frais Stripe fixe)
--   - manual           : saisi a la main par admin
--   - estimated_fallback: estime utilise faute de reel (transitionnel)
--
-- IDEMPOTENT.
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- Table principale
-- ============================================================
CREATE TABLE IF NOT EXISTS order_item_real_cost_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Liens
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id   UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  parcel_id       UUID REFERENCES parcels(id) ON DELETE SET NULL,
  shipment_id     UUID REFERENCES customs_shipments(id) ON DELETE SET NULL,

  -- Categorisation doctrine (alignée sur cost_components.category)
  cost_type       TEXT NOT NULL,
                  -- product_purchase | sourcing | hub | packaging
                  -- freight | customs | port_transitaire | local_distribution | relay
                  -- payment | risk_provision | fixed_overhead
                  -- incident | marketing

  -- Montant
  amount_kmf      NUMERIC(12,2) NOT NULL,

  -- Methode d'allocation
  allocation_method TEXT NOT NULL,
                  -- direct | by_value | by_weight | by_volume | by_taxable_weight
                  -- per_item | per_order | manual | estimated_fallback

  -- Provenance
  source          TEXT,
                  -- 'customs_shipments' | 'admin_manual' | 'finance_config'
                  -- 'stripe_charge' | 'parcel_delivery' | 'monthly_recalc'
  is_actual       BOOLEAN NOT NULL DEFAULT TRUE,
                  -- TRUE si coût reel constate, FALSE si fallback estime
  confidence      TEXT,
                  -- 'high' | 'medium' | 'low'

  -- Audit
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- Index
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_oirca_order_item ON order_item_real_cost_allocations(order_item_id);
CREATE INDEX IF NOT EXISTS idx_oirca_order      ON order_item_real_cost_allocations(order_id);
CREATE INDEX IF NOT EXISTS idx_oirca_cost_type  ON order_item_real_cost_allocations(cost_type);
CREATE INDEX IF NOT EXISTS idx_oirca_parcel     ON order_item_real_cost_allocations(parcel_id) WHERE parcel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oirca_shipment   ON order_item_real_cost_allocations(shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oirca_created_at ON order_item_real_cost_allocations(created_at);

-- ============================================================
-- Contrainte d'unicite (un meme cost_type peut avoir plusieurs entrees
-- pour le meme order_item si les ventilations viennent de sources differentes,
-- ex : douane reelle de 2 shipments. On NE met PAS de unique sur (order_item_id, cost_type)).
--
-- Idempotence : c'est l'application qui doit gerer (verifier source + shipment_id
-- avant insert pour eviter les doublons sur recalcul).
-- ============================================================

-- ============================================================
-- FIN MIGRATION 051
-- ============================================================
