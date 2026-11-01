-- PostgreSQL 16: ownership, idempotency, and cascade on disposable data only.
DO $$
DECLARE
  o uuid := '22222222-2222-2222-2222-222222222222';
  p uuid := '33333333-3333-3333-3333-333333333333';
  s uuid := '44444444-4444-4444-4444-444444444444';
  i uuid := '55555555-5555-5555-5555-555555555555';
  a uuid;
  first_id uuid;
  failed boolean;
BEGIN
  INSERT INTO public.order_items(id,order_id) VALUES(i,o);
  INSERT INTO public.order_item_real_cost_allocations DEFAULT VALUES RETURNING id INTO a;
  INSERT INTO public.international_n1_allocation_links
    (allocation_id,shipment_id,component,fee_type,parcel_id,order_item_id)
    VALUES(a,s,'freight','',p,i);
  first_id:=a;
  failed:=false;
  BEGIN
    INSERT INTO public.order_item_real_cost_allocations DEFAULT VALUES RETURNING id INTO a;
    INSERT INTO public.international_n1_allocation_links
      (allocation_id,shipment_id,component,fee_type,parcel_id,order_item_id)
      VALUES(a,s,'freight','',p,i);
  EXCEPTION WHEN unique_violation THEN failed:=true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'same source share can be double-counted'; END IF;
  INSERT INTO public.international_n1_reconciliations
    (shipment_id,snapshot_hash,total_freight_kmf,allocation_rows,actor_id)
    VALUES(s,repeat('0',64),200,1,'test-admin');
  failed:=false;
  BEGIN
    INSERT INTO public.international_n1_reconciliations(shipment_id,snapshot_hash,actor_id)
      VALUES(s,repeat('1',64),'test-admin');
  EXCEPTION WHEN unique_violation THEN failed:=true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'more than one current reconciliation per shipment'; END IF;
  DELETE FROM public.order_item_real_cost_allocations WHERE id=first_id;
  IF (SELECT COUNT(*) FROM public.international_n1_allocation_links WHERE shipment_id=s)<>0 THEN
    RAISE EXCEPTION 'link not removed when owned allocation is removed'; END IF;
END $$;

-- The old customs writer must not rebook a reconciled international source.
DO $$
DECLARE
 m uuid := '11111111-1111-1111-1111-111111111111';
 s uuid := '44444444-4444-4444-4444-444444444444';
 c uuid := '66666666-6666-6666-6666-666666666666';
 blocked boolean;
BEGIN
 INSERT INTO public.customs_shipments(id,market_id,reference) VALUES(c,m,'CSTM-001');
 UPDATE public.international_shipments SET customs_shipment_id=c,
   freight_invoice_kmf=100,freight_invoice_ref='FREIGHT-PROOF-1' WHERE id=s;
 blocked:=false;
 BEGIN
   UPDATE public.customs_shipments SET freight_kmf=100 WHERE id=c;
 EXCEPTION WHEN check_violation THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'duplicate legacy freight permitted'; END IF;
 blocked:=false;
 BEGIN
   INSERT INTO public.customs_shipment_fees(shipment_id,fee_type,proof_ref)
   VALUES(c,'handling','ANOTHER-PROOF');
 EXCEPTION WHEN check_violation THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'duplicate legacy fee permitted'; END IF;
END $$;
