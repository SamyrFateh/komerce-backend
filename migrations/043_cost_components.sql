-- ============================================================
-- Migration 043 : Phase 1 — Structure modulable des couts (cost_components)
-- Date : avril 2026
-- Version ASCII pure
--
-- OBJECTIF :
--   Remplacer pricing_components par une table propre, doctrine-aligned.
--
-- DOCTRINE :
--   famille = landed_relay (9 categories : ce qui amene l'objet au relais)
--   famille = business     (3 categories : payment, risk_provision, fixed_overhead)
--   famille = exceptional  (1+ categories : incidents, campagnes marketing)
--
-- STRATEGIE :
--   1. On cree cost_components (nouvelle table propre)
--   2. On cree cost_component_events (audit log)
--   3. On reseed avec les 13 categories doctrine et des composants par defaut
--   4. pricing_components reste intacte (rollback safe). Sera droppee
--      dans une migration ulterieure quand le code aura migre.
--
-- IDEMPOTENT.
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- 1. Table cost_components
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_components (
  -- Identification
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT UNIQUE NOT NULL,
  label           TEXT NOT NULL,
  emoji           TEXT,
  description     TEXT,

  -- Hierarchie doctrine : famille -> categorie
  family          TEXT NOT NULL,
  category        TEXT NOT NULL,

  -- Valorisation (affinee Phase 2)
  default_value   NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit            TEXT NOT NULL,
  currency        TEXT,

  -- Portee d'application (Phase 3)
  scope           TEXT NOT NULL DEFAULT 'global',
  scope_value     TEXT,

  -- Allocation (Phase 3)
  allocation_method TEXT NOT NULL DEFAULT 'none',

  -- Qualite des donnees (Phase 2)
  source          TEXT NOT NULL DEFAULT 'default',
  confidence      TEXT NOT NULL DEFAULT 'medium',

  -- Contexte d'application
  channel         TEXT,
  island          TEXT,

  -- Activation
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_exceptional  BOOLEAN NOT NULL DEFAULT FALSE,
  active_from     DATE,
  active_until    DATE,

  -- Edition / UI
  is_editable     BOOLEAN NOT NULL DEFAULT TRUE,
  is_deletable    BOOLEAN NOT NULL DEFAULT TRUE,
  display_order   INTEGER NOT NULL DEFAULT 100,
  notes           TEXT,

  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 2. CHECK constraints (contraintes doctrine)
-- ============================================================

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_family_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_family_check
  CHECK (family IN ('landed_relay', 'business', 'exceptional'));

-- 13 categories doctrine + extensibilite exceptionnelle
ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_category_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_category_check
  CHECK (category IN (
    -- famille = landed_relay (9 categories)
    'product_purchase', 'sourcing', 'hub', 'packaging',
    'freight', 'customs', 'port_transitary',
    'local_distribution', 'relay',
    -- famille = business (3 categories)
    'payment', 'risk_provision', 'fixed_overhead',
    -- famille = exceptional (extensible)
    'incident', 'marketing_campaign'
  ));

-- Coherence famille <-> categorie
ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_family_category_consistency;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_family_category_consistency
  CHECK (
    (family = 'landed_relay' AND category IN (
      'product_purchase', 'sourcing', 'hub', 'packaging',
      'freight', 'customs', 'port_transitary',
      'local_distribution', 'relay'
    ))
    OR
    (family = 'business' AND category IN (
      'payment', 'risk_provision', 'fixed_overhead'
    ))
    OR
    (family = 'exceptional' AND category IN (
      'incident', 'marketing_campaign'
    ))
  );

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_unit_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_unit_check
  CHECK (unit IN (
    'kmf', 'pct',
    'kmf_per_kg', 'kmf_per_m3',
    'kmf_per_order', 'kmf_per_parcel', 'kmf_per_shipment',
    'aed', 'eur', 'usd'
  ));

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_scope_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_scope_check
  CHECK (scope IN (
    'global', 'category', 'product', 'order', 'parcel',
    'shipment', 'supplier', 'relay'
  ));

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_allocation_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_allocation_check
  CHECK (allocation_method IN (
    'none', 'per_order', 'per_item', 'by_value',
    'by_weight', 'by_volume', 'by_taxable_weight',
    'by_quantity', 'by_category_risk', 'manual'
  ));

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_source_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_source_check
  CHECK (source IN (
    'default', 'category', 'manual', 'supplier', 'real', 'missing'
  ));

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_confidence_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_confidence_check
  CHECK (confidence IN ('low', 'medium', 'high'));

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_channel_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_channel_check
  CHECK (channel IS NULL OR channel IN ('cash_relais', 'diaspora', 'mobile_money'));

ALTER TABLE cost_components
  DROP CONSTRAINT IF EXISTS cost_components_island_check;
ALTER TABLE cost_components
  ADD CONSTRAINT cost_components_island_check
  CHECK (island IS NULL OR island IN ('grande_comore', 'moheli', 'anjouan', 'mayotte'));

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_cost_components_active
  ON cost_components(is_active, family, category, display_order);
CREATE INDEX IF NOT EXISTS idx_cost_components_scope
  ON cost_components(scope, scope_value) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cost_components_channel
  ON cost_components(channel) WHERE is_active;

-- ============================================================
-- 4. Trigger updated_at
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cost_components_updated'
  ) THEN
    CREATE TRIGGER trg_cost_components_updated
      BEFORE UPDATE ON cost_components
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 5. Audit log : cost_component_events
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_component_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id    UUID REFERENCES cost_components(id) ON DELETE SET NULL,
  component_key   TEXT,
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'created', 'updated', 'activated', 'deactivated', 'deleted',
    'value_changed', 'scope_changed'
  )),
  old_value       JSONB,
  new_value       JSONB,
  notes           TEXT,
  triggered_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_component_events_component
  ON cost_component_events(component_id, created_at DESC);

-- ============================================================
-- 6. Seeds doctrinaux 13 categories
-- ============================================================
-- Insertion conditionnelle : si le composant existe deja par sa key,
-- on ne le re-cree pas (idempotent).
--
-- Strategie :
--   - 1 a 2 composants par defaut par categorie pour amorcer
--   - valeurs realistes Komerce a calibrer en Phase 2
--   - is_editable = TRUE pour que l'admin puisse les ajuster
--   - confidence = 'medium' (defaut, a affiner avec la realite terrain)
-- ============================================================

INSERT INTO cost_components
  (key, label, emoji, description, family, category, default_value, unit,
   scope, allocation_method, source, confidence, display_order)
VALUES

-- ===== famille = landed_relay =====

-- 1. product_purchase (achat fournisseur) — geree directement par products.cost_kmf
--    On cree quand meme un composant placeholder pour les surcoûts d'achat
('frais_bancaires_achat_pct', 'Frais bancaires transfert', 'BANK',
 'Frais Wise/SWIFT pour payer le fournisseur. Pourcentage du montant achete.',
 'landed_relay', 'product_purchase', 1.5, 'pct',
 'global', 'by_value', 'default', 'medium', 10),

-- 2. sourcing
('sourcing_temps_acheteur_kmf', 'Temps acheteur', 'CLOCK',
 'Temps moyen passe par un acheteur sur une commande sourcing.',
 'landed_relay', 'sourcing', 200, 'kmf_per_order',
 'global', 'per_order', 'default', 'low', 20),

-- 3. hub (Dubai)
('hub_controle_qualite_kmf', 'Controle qualite hub', 'CHECK',
 'Verification visuelle et fonctionnelle a l''arrivee au hub Dubai.',
 'landed_relay', 'hub', 150, 'kmf_per_parcel',
 'global', 'per_item', 'default', 'medium', 30),

('hub_etiquetage_kmf', 'Etiquetage SKU', 'TAG',
 'Application de l''etiquette Komerce + code-barres.',
 'landed_relay', 'hub', 50, 'kmf_per_parcel',
 'global', 'per_item', 'default', 'medium', 31),

-- 4. packaging
('packaging_carton_standard_kmf', 'Carton standard', 'BOX',
 'Carton + ruban + protections. Valeur moyenne par colis.',
 'landed_relay', 'packaging', 300, 'kmf_per_parcel',
 'global', 'per_item', 'default', 'medium', 40),

-- 5. freight (Dubai -> Comores)
('fret_maritime_eur_m3', 'Fret maritime', 'SHIP',
 'Tarif fret maritime au m3 (FCL ou LCL).',
 'landed_relay', 'freight', 180, 'eur',
 'global', 'by_volume', 'default', 'medium', 50),

('assurance_transport_pct', 'Assurance transport', 'SHIELD',
 'Assurance sur valeur CIF declaree.',
 'landed_relay', 'freight', 0.5, 'pct',
 'global', 'by_value', 'default', 'medium', 51),

-- 6. customs (douane Comores) — les taux specifiques sont dans customs_categories
('frais_inspection_douane_kmf', 'Inspection douane', 'GLASS',
 'Frais d''expertise ponctuelle. Provision moyenne.',
 'landed_relay', 'customs', 5000, 'kmf_per_shipment',
 'shipment', 'per_order', 'default', 'low', 60),

-- 7. port_transitary
('transitaire_pct', 'Honoraires transitaire', 'CLIPBOARD',
 'Pourcentage sur valeur du shipment.',
 'landed_relay', 'port_transitary', 3, 'pct',
 'global', 'by_value', 'default', 'medium', 70),

('frais_portuaires_kmf', 'Frais portuaires', 'PORT',
 'Manutention port + stationnement.',
 'landed_relay', 'port_transitary', 25000, 'kmf_per_shipment',
 'shipment', 'per_order', 'default', 'medium', 71),

-- 8. local_distribution (Comores)
('transport_port_relais_kmf', 'Transport port -> relais', 'TRUCK',
 'Acheminement local vers le hub puis vers le relais (Grande Comore).',
 'landed_relay', 'local_distribution', 500, 'kmf_per_parcel',
 'global', 'per_item', 'default', 'medium', 80),

('transport_inter_iles_moheli_kmf', 'Transport inter-iles Moheli', 'BOAT',
 'Surcout transport vers Moheli (bateau).',
 'landed_relay', 'local_distribution', 800, 'kmf_per_parcel',
 'category', 'per_item', 'default', 'medium', 81),

('transport_inter_iles_anjouan_kmf', 'Transport inter-iles Anjouan', 'BOAT',
 'Surcout transport vers Anjouan (bateau).',
 'landed_relay', 'local_distribution', 800, 'kmf_per_parcel',
 'category', 'per_item', 'default', 'medium', 82),

-- 9. relay (commission relais)
('commission_relais_kmf', 'Commission relais', 'COIN',
 'Commission par commande remise au client.',
 'landed_relay', 'relay', 500, 'kmf_per_order',
 'global', 'per_order', 'default', 'medium', 90),

-- ===== famille = business =====

-- 10. payment (varie selon canal)
('stripe_pct', 'Frais Stripe', 'CARD',
 'Frais Stripe pour le canal diaspora.',
 'business', 'payment', 1.5, 'pct',
 'global', 'by_value', 'default', 'high', 100),

('stripe_fixed_kmf', 'Frais Stripe fixes', 'CARD',
 'Frais fixes Stripe par transaction.',
 'business', 'payment', 130, 'kmf_per_order',
 'global', 'per_order', 'default', 'high', 101),

('cash_collecte_kmf', 'Frais collecte cash', 'MONEY',
 'Cout de remise du cash relais a la banque.',
 'business', 'payment', 200, 'kmf_per_order',
 'global', 'per_order', 'default', 'medium', 102),

-- 11. risk_provision
('provision_non_collecte_pct', 'Provision non-collecte cash', 'WARNING',
 'Provision sur commandes cash non recuperees par le client.',
 'business', 'risk_provision', 2, 'pct',
 'global', 'by_value', 'default', 'medium', 110),

('provision_casse_transport_pct', 'Provision casse transport', 'BREAK',
 'Provision sur casse / perte pendant le transport.',
 'business', 'risk_provision', 1, 'pct',
 'global', 'by_value', 'default', 'medium', 111),

-- 12. fixed_overhead
('charges_fixes_mensuelles_kmf', 'Charges fixes mensuelles', 'BUILDING',
 'Loyers, salaires, logiciels, comptable. Allouees par commande selon volume cible.',
 'business', 'fixed_overhead', 0, 'kmf_per_order',
 'global', 'per_order', 'real', 'high', 120),

-- ===== famille = exceptional =====

-- 13. incident (provision pour aleas isoles)
('incident_force_majeure_kmf', 'Provision force majeure', 'STORM',
 'Cyclone, blocage port, greve. NON inclus dans le calcul prix par defaut.',
 'exceptional', 'incident', 0, 'kmf_per_shipment',
 'global', 'manual', 'default', 'low', 200)

ON CONFLICT (key) DO NOTHING;

-- Marquer les composants exceptionnels
UPDATE cost_components
   SET is_exceptional = TRUE
 WHERE family = 'exceptional';

-- ============================================================
-- 7. Verifications
-- ============================================================
DO $$
DECLARE
  total INTEGER;
  by_family RECORD;
  family_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total FROM cost_components;
  RAISE NOTICE 'Migration 043 OK : cost_components creee.';
  RAISE NOTICE '  Total composants seedees : %', total;

  FOR by_family IN
    SELECT family, COUNT(*) AS nb
      FROM cost_components
     GROUP BY family
     ORDER BY family
  LOOP
    RAISE NOTICE '    - famille %: % composants', by_family.family, by_family.nb;
  END LOOP;
END $$;
