-- Ensure a canonical KOM-BOX cannot be assigned to two separate shipments.
DO $$
DECLARE
  m uuid := '11111111-1111-1111-1111-111111111111';
  box uuid := '55555555-5555-5555-5555-555555555555';
  other uuid := '66666666-6666-6666-6666-666666666666';
  rejected boolean := false;
BEGIN
  INSERT INTO public.hub_physical_units(id,market_id,reference,unit_type,state)
    VALUES(box,m,'KOM-BOX-PG16','MARKET_PARCEL','DISPATCHED');
  INSERT INTO public.international_shipment_hub_boxes(shipment_id,physical_unit_id)
    VALUES('44444444-4444-4444-4444-444444444444',box);
  INSERT INTO public.international_shipments(id,market_id,reference,forwarder_name,transport_mode,created_by)
    VALUES(other,m,'INT-KM-BOX-2','Transitaire test','sea','fixture-owner');
  BEGIN
    INSERT INTO public.international_shipment_hub_boxes(shipment_id,physical_unit_id) VALUES(other,box);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'same KOM-BOX assigned twice'; END IF;
  IF (SELECT COUNT(*) FROM public.international_shipment_hub_boxes WHERE physical_unit_id=box)<>1
    THEN RAISE EXCEPTION 'KOM-BOX assignment not conserved'; END IF;
END $$;
