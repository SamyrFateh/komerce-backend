-- PostgreSQL 16 disposable fixture: append-only shipment facts without legacy parcel identity.
DO $$
DECLARE m uuid:='11111111-1111-1111-1111-111111111111';
        s uuid:='44444444-4444-4444-4444-444444444444';
        fee uuid;
        rejected boolean;
BEGIN
  INSERT INTO public.markets(id) VALUES(m);
  INSERT INTO public.international_shipments(id,market_id,reference,created_by,hub_draft)
    VALUES(s,m,'INT-KM-001','fixture-owner',true);
  INSERT INTO public.international_shipment_events(shipment_id,event_type,proof_ref,actor_id)
    VALUES(s,'opened',NULL,'fixture-owner');
  INSERT INTO public.international_shipment_charges
    (shipment_id,fee_type,amount_kmf,proof_ref,idempotency_key,actor_id)
    VALUES(s,'handling',1000,'INVOICE-ARRIVAL-1','IDEM-ARRIVAL-1','fixture-owner') RETURNING id INTO fee;
  rejected:=false;
  BEGIN
    INSERT INTO public.international_shipment_charges
      (shipment_id,fee_type,amount_kmf,proof_ref,idempotency_key,actor_id)
      VALUES(s,'handling',1000,'INVOICE-ARRIVAL-1','IDEM-ARRIVAL-1','fixture-owner');
  EXCEPTION WHEN unique_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'source idempotency not enforced'; END IF;
  rejected:=false;
  BEGIN UPDATE public.international_shipment_charges SET amount_kmf=999 WHERE id=fee;
  EXCEPTION WHEN integrity_constraint_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'source immutability missing'; END IF;
  IF to_regclass('public.international_shipment_parcels') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy international parcel composition still present'; END IF;
  IF (SELECT COUNT(*) FROM public.international_shipment_charges WHERE shipment_id=s)<>1
    THEN RAISE EXCEPTION 'source facts not conserved'; END IF;
END $$;
