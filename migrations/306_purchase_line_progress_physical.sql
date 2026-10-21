-- 306 — v_purchase_line_progress : le « reçu » devient la matière physique utilisable (C2, audit P1–P7).
--
-- Avant : PO regroupée = somme des placements RECEIVE (quarantaine non exclue, removed_at ignoré) ;
-- PO historique = purchase_orders.received_qty (déclaratif, sans preuve physique).
-- Après (une seule définition, formes regroupée et historique) : quantité des placements ACTIFS
-- (removed_at IS NULL) des allocations de la ligne, dans des unités ni QUARANTINED ni SUPERSEDED et sans
-- outcome_type (LOST/STOLEN/DESTROYED/DAMAGED_UNUSABLE). Une matière déplacée par SPLIT/MERGE/REPACK
-- n'est comptée qu'une fois : l'ancien placement reçoit removed_at, le nouveau le remplace.
-- received_qty reste lisible (declared_received_quantity, colonne ajoutée en fin de vue) mais n'est plus
-- une preuve de réception. Aucune donnée réécrite. Rollback : rejouer la définition de la migration 265.

CREATE OR REPLACE VIEW public.v_purchase_line_progress AS
SELECT
  pl.id                                AS line_id,
  pl.order_item_id                     AS order_item_id,
  oi.order_id                          AS order_id,
  pl.purchase_order_id                 AS purchase_order_id,
  po.status                            AS po_status,
  CASE
    WHEN po.id IS NULL        THEN NULL
    WHEN po.order_id IS NULL  THEN 'grouped'
    ELSE 'historical'
  END                                  AS po_shape,
  public.purchase_line_effective_quantity(pl.cancelled_at, pl.settled_quantity, pl.confirmed_quantity, pl.quantity)
                                       AS effective_quantity,
  COALESCE((
    SELECT SUM(p.quantity)::integer
      FROM public.hub_purchase_allocations a
      JOIN public.hub_physical_unit_placements p ON p.allocation_id = a.id AND p.removed_at IS NULL
      JOIN public.hub_physical_units u ON u.id = p.physical_unit_id
       AND u.state NOT IN ('QUARANTINED', 'SUPERSEDED') AND u.outcome_type IS NULL
     WHERE a.purchase_line_id = pl.id
        OR (a.purchase_line_id IS NULL AND a.purchase_order_id = pl.purchase_order_id AND a.order_item_id = pl.order_item_id)
  ), 0)                                AS received_quantity,
  (pl.cancelled_at IS NOT NULL)        AS cancelled,
  pl.product_supplier_id               AS product_supplier_id,
  po.hub_received_at                   AS hub_received_at,
  pl.quantity                          AS quantity,
  COALESCE(po.received_qty, 0)         AS declared_received_quantity
FROM public.purchase_lines pl
JOIN public.order_items oi ON oi.id = pl.order_item_id
LEFT JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
UNION ALL
SELECT
  NULL::uuid,
  po.order_item_id,
  po.order_id,
  po.id,
  po.status,
  'historical_no_line',
  CASE WHEN po.status = 'cancelled' THEN 0 ELSE po.qty END,
  COALESCE((
    SELECT SUM(p.quantity)::integer
      FROM public.hub_purchase_allocations a
      JOIN public.hub_physical_unit_placements p ON p.allocation_id = a.id AND p.removed_at IS NULL
      JOIN public.hub_physical_units u ON u.id = p.physical_unit_id
       AND u.state NOT IN ('QUARANTINED', 'SUPERSEDED') AND u.outcome_type IS NULL
     WHERE a.purchase_order_id = po.id AND a.purchase_line_id IS NULL
  ), 0),
  (po.status = 'cancelled'),
  po.product_supplier_id,
  po.hub_received_at,
  po.qty,
  COALESCE(po.received_qty, 0)
FROM public.purchase_orders po
WHERE po.order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.purchase_lines pl WHERE pl.purchase_order_id = po.id);

COMMENT ON VIEW public.v_purchase_line_progress IS
  'Progression d''achat par ligne. received_quantity = matière physique utilisable (placements actifs, hors quarantaine/superseded/outcome) pour toutes les formes de PO ; declared_received_quantity = ancien compteur déclaratif, informatif uniquement.';
