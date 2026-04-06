-- ============================================================
-- Migration 004 — Fix order_status enum (pipeline MVP 6 étapes)
-- Date : avril 2026
--
-- Bug corrigé : désynchronisation DB ↔ Code
--   L'enum PostgreSQL (9 valeurs) ne contenait pas les 4 statuts
--   utilisés dans orders.js → crash enum violation en production.
--
-- Pipeline avant (10 étapes) :
--   confirmed → paid → ordered → purchasing → preparation
--   → hub_preparation → shipped → transit_comores → available → collected
--
-- Pipeline après (6 étapes) :
--   confirmed → ordered → preparation → shipped → available → collected
--
-- Suppressions : draft, paid, purchasing, hub_preparation, transit_comores
-- Ajout        : ordered (manquait de l'enum DB)
-- ============================================================

BEGIN;

-- ─── Étape 1 : Migrer les données existantes ─────────────────────────────────
-- (par sécurité, même si certains statuts ne devraient pas exister en prod)

-- draft → confirmed (commande jamais créée en draft en prod)
UPDATE orders SET status = 'confirmed'
  WHERE status::text = 'draft';

-- paid → ordered (paiement validé = commande lancée)
UPDATE orders SET status = 'ordered'
  WHERE status::text = 'paid';

-- purchasing → ordered (regroupé dans ordered)
UPDATE orders SET status = 'ordered'
  WHERE status::text = 'purchasing';

-- hub_preparation → preparation (fusion étapes hub)
UPDATE orders SET status = 'preparation'
  WHERE status::text = 'hub_preparation';

-- transit_comores → shipped (toujours "en route")
UPDATE orders SET status = 'shipped'
  WHERE status::text = 'transit_comores';

-- Même migration sur l'historique
UPDATE order_status_history SET status = 'confirmed'   WHERE status::text = 'draft';
UPDATE order_status_history SET status = 'ordered'     WHERE status::text IN ('paid', 'purchasing');
UPDATE order_status_history SET status = 'preparation' WHERE status::text = 'hub_preparation';
UPDATE order_status_history SET status = 'shipped'     WHERE status::text = 'transit_comores';

-- ─── Étape 2 : Recréer l'enum avec les valeurs MVP ───────────────────────────

CREATE TYPE order_status_new AS ENUM (
  'confirmed',    -- commande créée, paiement en attente
  'ordered',      -- paiement validé → commande lancée
  'preparation',  -- [SCAN Hub] colis reçu, emballé
  'shipped',      -- départ maritime
  'available',    -- [SCAN Relais] colis reçu → SMS client
  'collected',    -- [SCAN QR] remis au client
  'cancelled',
  'refunded'
);

-- ─── Étape 3 : Migrer les colonnes vers le nouveau type ──────────────────────

ALTER TABLE orders
  ALTER COLUMN status TYPE order_status_new
  USING status::text::order_status_new;

ALTER TABLE orders
  ALTER COLUMN status SET DEFAULT 'confirmed'::order_status_new;

ALTER TABLE order_status_history
  ALTER COLUMN status TYPE order_status_new
  USING status::text::order_status_new;

-- ─── Étape 4 : Remplacer l'ancien type ───────────────────────────────────────

DROP TYPE order_status;
ALTER TYPE order_status_new RENAME TO order_status;

-- ─── Étape 5 : Ajouter colonne ordered_at si manquante ───────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ;

-- ─── Vérification post-migration ─────────────────────────────────────────────
-- SELECT enum_range(NULL::order_status);
-- Résultat attendu : {confirmed,ordered,preparation,shipped,available,collected,cancelled,refunded}

COMMIT;
