-- ============================================================
-- Migration 124 : order_status — retrait de pending_group_payment
-- (Boutique First, Lot 2/3, partie 1/2)
-- Date : août 2026
--
-- CONTEXTE :
--   "Paiement groupé depuis une commande existante" (pending_group_payment)
--   est un troisième mécanisme parallèle au même problème que
--   shared_cart_contributions et collective_workspaces. Une commande en
--   attente de financement groupé est exactement ce que l'invariant
--   produit n°1 interdit : « aucun paiement en attente ».
--
-- SÉPARATION EN DEUX FICHIERS (issue d'un test réel contre une copie du
-- schéma de production, pas d'une décision de conception a priori) :
--   Cette migration convertit order_status. La conversion de
--   shared_cart_status vit dans le fichier suivant (125). Empiriquement
--   reproduit à plusieurs reprises : exécuter les deux conversions
--   d'énumération dans LA MÊME transaction (donc le même fichier, le
--   runner enveloppant chaque fichier dans sa propre transaction) fait
--   échouer la seconde avec une erreur trompeuse ("operator does not
--   exist"), quelle que soit la structure du code (bloc DO unique ou
--   séparé, EXECUTE dynamique ou non, DISCARD ALL entre les deux).
--   Chaque conversion prise séparément réussit systématiquement. Split en
--   deux fichiers = deux transactions = la frontière qui fonctionne.
--
-- IDEMPOTENT.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

-- v_group_orders : vue orpheline (vérifié : aucun code applicatif ne
-- l'interroge), bâtie sur des concepts déjà retirés. Dépend de
-- shared_carts.status et de colonnes/tables supprimées en migration 125 —
-- retirée ici en prérequis commun, sans effet sur order_status.
DROP VIEW IF EXISTS v_group_orders;

DO $$
DECLARE
  stuck_count INTEGER;
  def_suppliers_stats text;
  def_v_ceremony_orders text;
  def_v_hub_transit text;
  def_v_order_fulfillment text;
  def_v_order_margins text;
  def_v_parcel_reconciliation text;
  def_v_sourcing_pipeline text;
  def_idx_orders_active text;
  def_idx_orders_status_ordered text;
  def_uq_orders_pickup_active text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'order_status' AND e.enumlabel = 'pending_group_payment'
  ) THEN
    RAISE NOTICE 'Migration 124 — pending_group_payment déjà absent de order_status, rien à faire.';
    RETURN;
  END IF;

  -- Compensation avant migration de type : toute commande encore dans cet
  -- état bascule vers 'pending' — transition déjà valide dans l'ancienne
  -- machine (pending_group_payment → pending, "retour si groupe abandonné"),
  -- donc sémantiquement neutre, pas une invention de ce lot.
  SELECT COUNT(*) INTO stuck_count FROM orders WHERE status = 'pending_group_payment';
  IF stuck_count > 0 THEN
    UPDATE orders SET status = 'pending' WHERE status = 'pending_group_payment';
    RAISE NOTICE 'Migration 124 — % commande(s) pending_group_payment basculée(s) vers pending.', stuck_count;
  END IF;

  -- 7 vues dépendent de orders.status (vérifié par requête exhaustive sur
  -- pg_depend, pas une supposition) : suppliers_stats, v_ceremony_orders,
  -- v_hub_transit, v_order_fulfillment, v_order_margins,
  -- v_parcel_reconciliation, v_sourcing_pipeline. Aucune ne dépend d'une
  -- autre de la liste (vérifié). Toutes légitimes et actives — on capture
  -- leur définition exacte via pg_get_viewdef (fidélité garantie, pas de
  -- retranscription manuelle), on les supprime, on change le type, on les
  -- recrée à l'identique.
  def_suppliers_stats         := pg_get_viewdef('suppliers_stats'::regclass, true);
  def_v_ceremony_orders       := pg_get_viewdef('v_ceremony_orders'::regclass, true);
  def_v_hub_transit           := pg_get_viewdef('v_hub_transit'::regclass, true);
  def_v_order_fulfillment     := pg_get_viewdef('v_order_fulfillment'::regclass, true);
  def_v_order_margins         := pg_get_viewdef('v_order_margins'::regclass, true);
  def_v_parcel_reconciliation := pg_get_viewdef('v_parcel_reconciliation'::regclass, true);
  def_v_sourcing_pipeline     := pg_get_viewdef('v_sourcing_pipeline'::regclass, true);

  DROP VIEW suppliers_stats;
  DROP VIEW v_ceremony_orders;
  DROP VIEW v_hub_transit;
  DROP VIEW v_order_fulfillment;
  DROP VIEW v_order_margins;
  DROP VIEW v_parcel_reconciliation;
  DROP VIEW v_sourcing_pipeline;

  -- 3 index partiels comparent status à des littéraux castés explicitement
  -- ::order_status (l'ancien nom de type). Pendant l'ALTER COLUMN TYPE, la
  -- colonne devient order_status_new mais ces littéraux restent typés
  -- order_status — comparer les deux distinctement n'a pas d'opérateur
  -- ("operator does not exist"), même si les valeurs se recouvrent.
  -- Vérifié exhaustivement (pg_indexes), pas une supposition. Capturés
  -- avant suppression, recréés après le renommage — à ce moment-là, les
  -- littéraux se recastent naturellement vers le type final order_status.
  def_idx_orders_active         := (SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_orders_active');
  def_idx_orders_status_ordered := (SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_orders_status_ordered');
  def_uq_orders_pickup_active   := (SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_orders_pickup_active');

  DROP INDEX idx_orders_active;
  DROP INDEX idx_orders_status_ordered;

  -- uq_orders_pickup_active : déjà supprimé par la migration 119
  -- (drop_orders_pickup_code) sur toute base où 119 est passée avant 124.
  -- def_uq_orders_pickup_active est alors NULL — pas d'IF EXISTS ici pour
  -- éviter un DROP silencieux sur les bases où il existe encore, mais on
  -- ne tente le DROP que s'il a effectivement été trouvé ci-dessus.
  IF def_uq_orders_pickup_active IS NOT NULL THEN
    DROP INDEX uq_orders_pickup_active;
  END IF;

  CREATE TYPE order_status_new AS ENUM (
    'pending', 'confirmed', 'ordered', 'preparation', 'shipped',
    'in_transit', 'available', 'collected', 'cancelled', 'refunded'
  );

  -- La clause DEFAULT de orders.status référence le type order_status ;
  -- Postgres ne peut pas la recaster automatiquement vers le nouveau type
  -- pendant l'ALTER COLUMN TYPE ("default for column status cannot be
  -- cast automatically to type order_status_new"). On la retire avant, on
  -- la restaure après le renommage, avec la même valeur qu'en production
  -- (schema_railway.sql : DEFAULT 'confirmed'::order_status).
  ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;

  ALTER TABLE orders
    ALTER COLUMN status TYPE order_status_new
    USING status::text::order_status_new;

  -- order_status_history.status utilise le même type (découvert par
  -- l'échec du DROP TYPE ci-dessous lors des tests réels, pas anticipé)
  -- — aucun DEFAULT, aucun index partiel dessus (vérifié), conversion
  -- directe suffisante.
  ALTER TABLE order_status_history
    ALTER COLUMN status TYPE order_status_new
    USING status::text::order_status_new;

  DROP TYPE order_status;
  ALTER TYPE order_status_new RENAME TO order_status;

  ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'confirmed'::order_status;

  EXECUTE 'CREATE VIEW suppliers_stats AS ' || def_suppliers_stats;
  EXECUTE 'CREATE VIEW v_ceremony_orders AS ' || def_v_ceremony_orders;
  EXECUTE 'CREATE VIEW v_hub_transit AS ' || def_v_hub_transit;
  EXECUTE 'CREATE VIEW v_order_fulfillment AS ' || def_v_order_fulfillment;
  EXECUTE 'CREATE VIEW v_order_margins AS ' || def_v_order_margins;
  EXECUTE 'CREATE VIEW v_parcel_reconciliation AS ' || def_v_parcel_reconciliation;
  EXECUTE 'CREATE VIEW v_sourcing_pipeline AS ' || def_v_sourcing_pipeline;

  -- Les littéraux ::order_status dans ces définitions capturées se
  -- recastent naturellement vers le type final maintenant renommé.
  EXECUTE def_idx_orders_active;
  EXECUTE def_idx_orders_status_ordered;
  IF def_uq_orders_pickup_active IS NOT NULL THEN
    EXECUTE def_uq_orders_pickup_active;
  END IF;

  RAISE NOTICE 'Migration 124 OK — order_status recréé sans pending_group_payment, 7 vues et 3 index restaurés à l''identique.';
END $$;
