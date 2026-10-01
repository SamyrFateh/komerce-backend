-- 264 — v_purchase_line_progress : vue unique de progression d'achat par ligne (PR 2/8, MISSION_PURCHASE_LINES).
--
-- Source de vérité unique de « combien est engagé et combien est reçu » pour les lecteurs (signaux, routes
-- purchasing, scans Hub, complétude de réception, stock-sync). Aucun lecteur ne doit recalculer ce résultat
-- depuis purchase_orders.qty / received_qty : une PO regroupée (PR 4) n'a ni order_id ni qty.
--
-- Deux origines de lignes de la vue :
--   1. purchase_lines (toute ligne, rattachée ou ouverte) ;
--   2. PO historiques SANS ligne (antérieures à la migration 225, terminales) : exposées avec line_id NULL
--      pour que les lecteurs gardent exactement leur résultat actuel ;
-- Le reçu d'une PO historique vient de purchase_orders.received_qty (la seule ligne porte tout le reçu).
--   Le reçu d'une PO regroupée vaudra la somme des placements RECEIVE (PR 3) : 0 tant que ce lien n'existe pas.
--
-- `quantity` = quantité brute engagée à l'origine (inchangée par annulation), `effective_quantity` = ce qui reste dû.
--
-- Additif et idempotent : CREATE OR REPLACE, aucune colonne ni donnée supprimée.

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
  CASE WHEN po.order_id IS NOT NULL THEN COALESCE(po.received_qty, 0) ELSE 0 END
                                       AS received_quantity,
  (pl.cancelled_at IS NOT NULL)        AS cancelled,
  pl.product_supplier_id               AS product_supplier_id,
  po.hub_received_at                   AS hub_received_at,
  pl.quantity                          AS quantity
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
  COALESCE(po.received_qty, 0),
  (po.status = 'cancelled'),
  po.product_supplier_id,
  po.hub_received_at,
  po.qty
FROM public.purchase_orders po
WHERE po.order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.purchase_lines pl WHERE pl.purchase_order_id = po.id);

COMMENT ON VIEW public.v_purchase_line_progress IS
  'Progression d''achat par ligne (engagé effectif, reçu, annulé). Seule définition du reçu par ligne pour les lecteurs. Les PO historiques sans ligne (avant 225) sont exposées avec line_id NULL.';

-- is_order_complete : même contrat (TRUE si rien de non annulé n'est en retard de réception), mais calculé
-- sur la vue. L'ancienne définition lisait purchase_orders.order_id/qty et aurait répondu TRUE à tort pour
-- une commande dont les lignes sont dans une PO regroupée.
CREATE OR REPLACE FUNCTION public.is_order_complete(p_order_id uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public.v_purchase_line_progress v
     WHERE v.order_id = p_order_id
       AND v.purchase_order_id IS NOT NULL
       AND NOT v.cancelled
       AND v.received_quantity < v.effective_quantity
  );
$$;
