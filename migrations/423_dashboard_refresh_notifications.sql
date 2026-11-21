-- @migration 423_dashboard_refresh_notifications.sql
-- @domain dashboard
-- #4948 : déclencheur d'invalidation de LECTURE, sans nouvelle table ni mutation métier.
-- PostgreSQL ne livre un NOTIFY qu'après un COMMIT réussi ; jamais après ROLLBACK.
-- FOR EACH STATEMENT limite les notifications des batchs ; payload opaque unique,
-- coalescé par transaction (aucun ID marché / client / montant transmis).
-- La lecture canonique reste le seul arbitre des chiffres et des permissions.
CREATE OR REPLACE FUNCTION public.notify_dashboard_refresh()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('komerce_dashboard_refresh', 'changed');
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'orders', 'order_items', 'purchase_orders', 'purchase_lines',
    'purchase_order_authorizations', 'purchase_variance_decisions',
    'supplier_execution_payments', 'manual_purchase_executions',
    'parcels', 'parcel_items', 'hub_physical_units',
    'hub_physical_unit_placements', 'hub_purchase_allocations',
    'hub_box_bags', 'hub_box_effective_placements', 'hub_custody_events',
    'international_shipments', 'international_shipment_hub_units',
    'handling_units', 'handling_unit_allocations', 'scan_events',
    'customs_shipments', 'customs_shipment_holds', 'shipments',
    'payments', 'wallet_transactions', 'refund_intents', 'disputes',
    'refunds', 'refund_execution_intents', 'cash_collections',
    'cash_custody_movements', 'cash_deposits', 'invoices',
    'financial_movements', 'market_settlements', 'supplier_payment_settlements',
    'order_item_cost_imputations', 'order_item_real_cost_allocations',
    'order_cost_status', 'order_status_history', 'order_comments',
    'order_incidents', 'incidents', 'relais', 'recipients',
    'products', 'product_variants', 'product_skus',
    'market_product_prices', 'product_market_price_drafts',
    'product_market_exposure', 'product_content_profile',
    'catalog_media', 'catalog_media_visual_fr_reviews',
    'sourcing_candidates', 'supplier_catalog_imports',
    'partners', 'suppliers', 'markets', 'signals'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = table_name
        AND c.relkind IN ('r', 'p')
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name
        AND t.tgname = 'dashboard_refresh_after_write'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER dashboard_refresh_after_write AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.notify_dashboard_refresh()',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;
