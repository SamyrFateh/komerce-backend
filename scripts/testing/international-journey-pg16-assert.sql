-- Verify the migration's conservation and append-only constraints. No production data.
DO $$
DECLARE
  m uuid := '11111111-1111-1111-1111-111111111111';
  o uuid := '22222222-2222-2222-2222-222222222222';
  p uuid := '33333333-3333-3333-3333-333333333333';
  s uuid := '44444444-4444-4444-4444-444444444444';
  fee uuid;
  rejected boolean;
BEGIN
  INSERT INTO public.markets(id) VALUES(m);
  INSERT INTO public.orders(id,market_id) VALUES(o,m);
  INSERT INTO public.parcels(id,order_id) VALUES(p,o);
  INSERT INTO public.international_shipments(id,market_id,reference,forwarder_name,transport_mode,created_by)
    VALUES(s,m,'INT-KM-001','Transitaire de test','sea','fixture-owner');
  INSERT INTO public.international_shipment_parcels(shipment_id,parcel_id,volume_cm3)
    VALUES(s,p,5000);
  INSERT INTO public.international_shipment_events(shipment_id,event_type,proof_ref,actor_id)
    VALUES(s,'created','HANDOVER-PROOF','fixture-owner');
  INSERT INTO public.international_shipment_charges(shipment_id,fee_type,amount_kmf,proof_ref,idempotency_key,actor_id)
    VALUES(s,'handling',1000,'INVOICE-ARRIVAL-1','IDEM-ARRIVAL-1','fixture-owner') RETURNING id INTO fee;
  rejected := false;
  BEGIN
    INSERT INTO public.international_shipment_charges(shipment_id,fee_type,amount_kmf,proof_ref,idempotency_key,actor_id)
      VALUES(s,'handling',1000,'INVOICE-ARRIVAL-1','IDEM-ARRIVAL-1','fixture-owner');
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'idempotency uniqueness missing'; END IF;
  rejected := false;
  BEGIN
    UPDATE public.international_shipment_charges SET amount_kmf=999 WHERE id=fee;
  EXCEPTION WHEN integrity_constraint_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'immutability guard missing'; END IF;
  rejected := false;
  BEGIN
    INSERT INTO public.international_shipment_parcels(shipment_id,parcel_id)
      VALUES(s,p);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate parcel assignment was allowed'; END IF;
  IF (SELECT COUNT(*) FROM public.international_shipment_charges WHERE shipment_id=s)<>1
     THEN RAISE EXCEPTION 'financial facts not conserved'; END IF;
  IF to_regclass('public.order_item_real_cost_allocations') IS NOT NULL
     THEN RAISE EXCEPTION 'isolated fixture unexpectedly created N1 real allocations'; END IF;
END $$;
