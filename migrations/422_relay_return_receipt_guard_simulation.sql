-- @migration 422_relay_return_receipt_guard_simulation.sql
-- @domain logistics
-- Additif : le garde de 401 refusait les commandes de recette (simulation_scope).
-- Aucune décision d'environnement en base : en production, une commande de recette
-- est impossible en amont (garde acheteur). Le trigger redevient donc neutre vis-à-vis
-- de simulation_scope. La 401 reste immuable ; seule la fonction est remplacée.
CREATE OR REPLACE FUNCTION public.guard_relay_product_return_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  request_row record;
BEGIN
  SELECT d.id,d.type,d.status,d.return_quantity,oi.qty_collected,o.relais_id
    INTO request_row
    FROM public.disputes d
    JOIN public.orders o ON o.id=d.order_id
    JOIN public.order_items oi
      ON oi.id=d.return_order_item_id AND oi.order_id=o.id
   WHERE d.id=NEW.request_id
   FOR SHARE OF d,o,oi;
  IF NOT FOUND
     OR request_row.type IS DISTINCT FROM 'product_return'
     OR request_row.status NOT IN ('open','processing')
     OR request_row.relais_id IS DISTINCT FROM NEW.relay_id
     OR request_row.return_quantity IS DISTINCT FROM NEW.quantity
     OR request_row.qty_collected < NEW.quantity
  THEN
    RAISE EXCEPTION 'RELAY_RETURN_RECEIPT_NOT_ELIGIBLE'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
