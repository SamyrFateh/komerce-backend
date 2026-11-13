-- G6-PRE-STRESS-2 / O-HUB — Fable #3998, contrôles indépendants H1..H9.
-- Lecture seule, exécuter sur PostgreSQL staging APRÈS qu'un geste métier est stabilisé
-- (et AVANT/APRÈS l'E2E). Même SHA, mêmes requêtes pour ChatGPT et Opus,
-- mais références d'objets distinctes. Zéro changement de statut par SQL.
--
-- Provenance : https://github.com/SamyrFateh/komerce-backend/issues/3998
-- IMPORTANT : les anomalies d'ancienneté (H8/H9) et une rupture partielle (H2)
-- s'interprètent selon la doctrine, cf. G6_PRE_STRESS_BUSINESS_SCENARIOS.md.
-- NE PAS attribuer un PASS global sans geste Chromium, HTTP, SQL et audit.

-- H1 — commande entièrement reçue, toujours bloquée au statut ordered (HB-01).
SELECT o.id, o.reference FROM orders o
 WHERE o.status = 'ordered'
   AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.fulfillment_source = 'IMPORT')
   AND NOT EXISTS (
     SELECT 1 FROM order_items oi WHERE oi.order_id = o.id
       AND COALESCE(oi.fulfillment_source, '') <> 'LOCAL_STOCK'
       AND oi.quantity > COALESCE((SELECT SUM(v.received_quantity)
                 FROM v_purchase_line_progress v
                WHERE v.order_item_id = oi.id AND NOT v.cancelled), 0)
   );

-- H2 — sous-couverture potentiellement terminale, à rapprocher d'une rupture + incident/alerte admin (HB-02).
-- ATTENTION : une sous-couverture avec incident source et remboursement en attente
-- peut être un état légitime ; toute ligne renvoyée exige rapprochement, pas "FAIL" automatique.
SELECT oi.id, oi.order_id, oi.quantity, SUM(v.effective_quantity) AS couvert
  FROM order_items oi
  JOIN v_purchase_line_progress v ON v.order_item_id = oi.id
  JOIN orders o ON o.id = oi.order_id AND o.status IN ('ordered', 'preparation')
 GROUP BY oi.id
HAVING SUM(v.effective_quantity) < oi.quantity
   AND bool_and(v.cancelled OR v.received_quantity >= v.effective_quantity);

-- H3 — en préparation mais sans ligne de colis (HB-03). Vérifier seulement après
-- complétude et répartition automatique ou balayage, pas dans la transaction en cours.
SELECT o.id, o.reference FROM orders o
 WHERE o.status = 'preparation'
   AND NOT EXISTS (
     SELECT 1 FROM parcel_items pi
       JOIN order_items oi ON oi.id = pi.order_item_id
       JOIN parcels p ON p.id = pi.parcel_id AND p.cancelled_at IS NULL
      WHERE oi.order_id = o.id
   );

-- H4 — excès physique dans les colis actifs, double répartition (HB-04).
SELECT pi.order_item_id, oi.quantity, SUM(pi.quantity) AS en_colis, COUNT(*) AS lignes
  FROM parcel_items pi
  JOIN parcels p ON p.id = pi.parcel_id AND p.cancelled_at IS NULL
  JOIN order_items oi ON oi.id = pi.order_item_id
 GROUP BY pi.order_item_id, oi.quantity HAVING SUM(pi.quantity) > oi.quantity;

-- H5 — vérité de quantité reçue : deux diagnostics distincts (HB-05, HB-06).
-- H5a — quantité reçue au-delà de la quantité effective de ligne (HB-05).
SELECT line_id, effective_quantity, received_quantity
  FROM v_purchase_line_progress
 WHERE NOT cancelled AND received_quantity > effective_quantity;

-- H5b — décalage allocation / quantité confirmée, diagnostic complémentaire.
-- IMPORTANT : l'allocation fige la demande et peut différer légitimement après
-- clôture ou rupture ; investiguer les placements et la vérité physique avant FAIL.
SELECT a.id, a.quantity AS allocation,
       COALESCE(pl.settled_quantity, pl.confirmed_quantity, pl.quantity) AS ligne
  FROM hub_purchase_allocations a
  JOIN purchase_lines pl ON pl.id = a.purchase_line_id
 WHERE pl.cancelled_at IS NULL
   AND a.quantity <> COALESCE(pl.settled_quantity, pl.confirmed_quantity, pl.quantity);

-- H6 — sur-engagement au-delà de la quantité commandée (garde SQL).
SELECT oi.id, oi.quantity, SUM(v.effective_quantity) AS engage
  FROM order_items oi
  JOIN v_purchase_line_progress v ON v.order_item_id = oi.id AND NOT v.cancelled
 GROUP BY oi.id HAVING SUM(v.effective_quantity) > oi.quantity;

-- H7 — unité, allocation et commande de marchés différents (garde SQL).
SELECT p.id FROM hub_physical_unit_placements p
  JOIN hub_purchase_allocations a ON a.id = p.allocation_id
  JOIN hub_physical_units u ON u.id = p.physical_unit_id
  JOIN orders o ON o.id = a.order_id
 WHERE p.removed_at IS NULL
   AND (a.market_id <> o.market_id
     OR (u.market_id IS NOT NULL AND u.market_id <> a.market_id));

-- H8 — colis fournisseur reçu sans rapprochement au-delà de 24 h (HB-08).
-- Toute ligne doit être visible comme tâche RECONCILE_PARCEL, âgée, dans l'interface directrice.
SELECT u.id, u.reference, u.created_at FROM hub_physical_units u
 WHERE u.unit_type = 'SUPPLIER_PACKAGE'
   AND u.state = 'RECEIVED' AND u.outcome_type IS NULL
   AND u.created_at < NOW() - INTERVAL '24 hours'
   AND NOT EXISTS (
     SELECT 1 FROM hub_physical_unit_placements p
      WHERE p.physical_unit_id = u.id
   );

-- H9 — sac fermé ou carton emballé en attente depuis plus de 48 h.
-- Toute ligne exige supervision datée/alerte 48h ; ne pas masquer l'attente.
SELECT u.id, u.reference, u.unit_type, u.updated_at FROM hub_physical_units u
 WHERE u.state = 'PACKED' AND u.outcome_type IS NULL
   AND u.updated_at < NOW() - INTERVAL '48 hours'
   AND ((u.unit_type = 'HANDLING_UNIT'
         AND NOT EXISTS (SELECT 1 FROM hub_box_bags b WHERE b.bag_unit_id = u.id))
     OR (u.unit_type = 'MARKET_PARCEL'
         AND NOT EXISTS (SELECT 1 FROM international_shipment_hub_units h WHERE h.physical_unit_id = u.id)));
