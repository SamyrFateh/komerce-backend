-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 010 — Refonte Parcel-Centric · Phase 1 : Fondations
--
-- OBJECTIF : Créer les tables parcels/parcel_items, ajouter les colonnes de
--            liaison (scans.parcel_id, orders.computed_status) et poser la
--            séquence de référencement — le tout SANS TOUCHER au code existant.
--
-- IMPACT : ZÉRO. Le trigger trg_scan_sync_status, orders.status, sub_orders
--          et tous les endpoints continuent à fonctionner normalement.
--
-- Tables créées    : parcels, parcel_items
-- Colonnes ajoutées: scans.parcel_id (nullable), orders.computed_status (nullable)
-- Séquence         : parcel_ref_seq
-- Règles métier    : PARCEL_* dans business_rules
-- Data migration   : sub_orders → parcels, sub_order_items → parcel_items
--
-- Fait partie de la refonte en 5 phases décrite dans ANALYSE_REFONTE_PARCELS.md
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Type ENUM parcel_status ─────────────────────────────────────────────
-- Pipeline logistique colis — inclut "arrived" (étape douane) qui n'existait
-- pas dans le modèle précédent (le passage in_transit → available était direct).

DO $$ BEGIN
  CREATE TYPE parcel_status AS ENUM (
    'draft',          -- colis en création (articles pas encore tous assignés)
    'preparation',    -- emballé au hub Dubai
    'shipped',        -- remis au transitaire
    'in_transit',     -- embarqué sur bateau 🚢
    'arrived',        -- arrivé au port (customs pending) — NOUVEAU
    'available',      -- dédouané, disponible au relais
    'collected',      -- récupéré par le destinataire
    'cancelled'       -- annulé
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── 2. Table parcels ──────────────────────────────────────────────────────
-- Unité logistique principale. Remplace sub_orders à terme.
-- Un order → N parcels. Chaque parcel a son propre statut logistique.

CREATE TABLE IF NOT EXISTS parcels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shipment_id       UUID REFERENCES shipments(id),

  -- Identité du colis
  reference         TEXT UNIQUE NOT NULL,       -- KOM-P-2026-000001
  label             TEXT,                        -- "Colis 1/2", "Backorder"

  -- Type de colis :
  --   standard       = expédition complète (tout disponible)
  --   partial        = ce qui est disponible maintenant
  --   backorder      = reliquat en attente
  --   awaiting_stock = tout est en attente de sourcing
  type              TEXT NOT NULL DEFAULT 'standard'
                    CHECK (type IN ('standard', 'partial', 'backorder', 'awaiting_stock')),

  -- Statut logistique (SOURCE DE VÉRITÉ pour ce colis)
  status            parcel_status NOT NULL DEFAULT 'draft',

  -- Dates clés — chaque étape est horodatée
  prepared_at       TIMESTAMPTZ,
  shipped_at        TIMESTAMPTZ,
  in_transit_at     TIMESTAMPTZ,
  arrived_at        TIMESTAMPTZ,
  available_at      TIMESTAMPTZ,
  collected_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,

  -- Relais de destination (hérité de la commande par défaut)
  relais_id         UUID REFERENCES relais(id),
  pickup_code       TEXT,                        -- code retrait 6 chiffres

  -- Métadonnées
  weight_kg         NUMERIC(6,2),
  notes             TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);


-- ── 3. Table parcel_items ─────────────────────────────────────────────────
-- Mapping articles → colis. Permet de savoir exactement quels order_items
-- sont dans quel colis, en quelle quantité.
-- Chaîne complète : orders → order_items → parcel_items → parcels

CREATE TABLE IF NOT EXISTS parcel_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  order_item_id   UUID NOT NULL REFERENCES order_items(id),
  product_id      UUID NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);


-- ── 4. Colonnes ajoutées (nullable — zéro impact) ────────────────────────

-- scans.parcel_id : permet de rattacher un scan à un colis (Phase 2+)
ALTER TABLE scans ADD COLUMN IF NOT EXISTS parcel_id UUID REFERENCES parcels(id);

-- orders.computed_status : statut calculé par computeOrderStatus() (Phase 2+)
-- Coexiste avec orders.status pendant la transition
ALTER TABLE orders ADD COLUMN IF NOT EXISTS computed_status TEXT;


-- ── 5. Séquence pour références colis ─────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS parcel_ref_seq START WITH 1 INCREMENT BY 1;


-- ── 6. Index ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_parcels_order      ON parcels(order_id);
CREATE INDEX IF NOT EXISTS idx_parcels_status     ON parcels(status);
CREATE INDEX IF NOT EXISTS idx_parcels_shipment   ON parcels(shipment_id);
CREATE INDEX IF NOT EXISTS idx_parcels_type       ON parcels(type);
CREATE INDEX IF NOT EXISTS idx_parcels_reference  ON parcels(reference);
CREATE INDEX IF NOT EXISTS idx_parcels_relais     ON parcels(relais_id);

CREATE INDEX IF NOT EXISTS idx_parcel_items_parcel     ON parcel_items(parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_items_order_item ON parcel_items(order_item_id);

CREATE INDEX IF NOT EXISTS idx_scans_parcel ON scans(parcel_id);


-- ── 7. Trigger updated_at ─────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parcels_updated') THEN
    CREATE TRIGGER trg_parcels_updated
      BEFORE UPDATE ON parcels
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;


-- ── 8. Règles métier — split strategy defaults ───────────────────────────
-- Utilise value_type et label_fr (schéma de la table business_rules v007)

INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES
  ('parcel', 'PARCEL_DEFAULT_SPLIT_STRATEGY', '{"value": "default"}', 'string',
   'Stratégie de split par défaut',
   'Nom de la stratégie appliquée pour découper une commande en colis. "default" = tout dispo → 1 standard, sinon partial + backorder. Extensible sans migration.',
   NULL, NULL),

  ('parcel', 'PARCEL_SPLIT_MIN_ITEMS_FOR_PARTIAL', '{"value": 1}', 'number',
   'Nb min articles pour colis partial',
   'Nombre minimum d''articles disponibles pour créer un colis partial plutôt qu''attendre tout le stock',
   1, 100),

  ('parcel', 'PARCEL_AWAITING_STOCK_MAX_DAYS', '{"value": 30}', 'number',
   'Durée max attente stock (jours)',
   'Nombre de jours maximum avant qu''un colis awaiting_stock soit escaladé ou annulé',
   1, 90),

  ('parcel', 'PARCEL_AUTO_CREATE_ON_ORDER', '{"value": false}', 'boolean',
   'Création auto colis à la commande',
   'Si true, un colis est automatiquement créé dès qu''une commande est payée. Si false, l''admin crée manuellement.',
   NULL, NULL)
ON CONFLICT (key) DO NOTHING;


-- ── 9. Migration données : sub_orders → parcels ──────────────────────────
-- Migre les données existantes de sub_orders vers parcels pour continuité.
-- Utilise les mêmes UUID pour permettre un rollback facile.
-- Ne migre que si sub_orders contient des données.
-- Le JOIN sur order_items garantit la récupération de product_id même si
-- sub_order_items ne l'a pas (schéma 007 vs 009).

INSERT INTO parcels (id, order_id, reference, type, status, shipped_at, notes, created_by, created_at, updated_at)
SELECT
  so.id,
  so.parent_order_id,
  COALESCE(so.tracking_ref, 'KOM-P-LEGACY-' || LEFT(so.id::text, 8)),
  CASE so.type
    WHEN 'partial_ship' THEN 'partial'
    WHEN 'backorder'    THEN 'backorder'
    ELSE 'standard'
  END,
  -- Cast TEXT → parcel_status (les valeurs sub_orders sont compatibles)
  so.status::parcel_status,
  so.shipped_at,
  so.notes,
  so.created_by,
  so.created_at,
  so.updated_at
FROM sub_orders so
WHERE NOT EXISTS (SELECT 1 FROM parcels p WHERE p.id = so.id);

INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity, created_at)
SELECT
  soi.id,
  soi.sub_order_id,
  soi.order_item_id,
  oi.product_id,
  soi.quantity,
  soi.created_at
FROM sub_order_items soi
JOIN order_items oi ON oi.id = soi.order_item_id
WHERE NOT EXISTS (SELECT 1 FROM parcel_items pi WHERE pi.id = soi.id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN Migration 010 — Phase 1 Fondations
--
-- Prochaine étape : Phase 2 (double écriture) — les scans écriront dans
-- parcels EN PLUS de orders.status. Le trigger legacy reste actif.
-- ═══════════════════════════════════════════════════════════════════════════════
