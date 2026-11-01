-- PG16: one cost snapshot per international shipment; never per-order/item allocation.
DO $$
DECLARE s uuid:='44444444-4444-4444-4444-444444444444';
        m uuid:='11111111-1111-1111-1111-111111111111';
        c uuid:='66666666-6666-6666-6666-666666666666';
        blocked boolean;
BEGIN
  IF to_regclass('public.international_n1_allocation_links') IS NOT NULL THEN
    RAISE EXCEPTION 'historic cost allocation bridge not retired'; END IF;
  INSERT INTO public.international_n1_reconciliations
    (shipment_id,snapshot_hash,total_freight_kmf,total_customs_kmf,documented_total_kmf,allocation_rows,actor_id)
    VALUES(s,repeat('0',64),100,20,120,0,'test-admin');
  blocked:=false;
  BEGIN
    INSERT INTO public.international_n1_reconciliations
      (shipment_id,snapshot_hash,actor_id) VALUES(s,repeat('1',64),'test-admin');
  EXCEPTION WHEN unique_violation THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'more than one financial snapshot per shipment'; END IF;
  blocked:=false;
  BEGIN UPDATE public.international_n1_reconciliations
      SET financial_closed_at=now() WHERE shipment_id=s;
  EXCEPTION WHEN check_violation THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'unproven financial closure accepted'; END IF;
  INSERT INTO public.customs_shipments(id,market_id,reference) VALUES(c,m,'CSTM-001');
  UPDATE public.international_shipments SET customs_shipment_id=c,
    freight_invoice_kmf=100,freight_invoice_ref='FREIGHT-PROOF-1' WHERE id=s;
  blocked:=false;
  BEGIN UPDATE public.customs_shipments SET freight_kmf=100 WHERE id=c;
  EXCEPTION WHEN check_violation THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'double freight entry accepted'; END IF;
END $$;
