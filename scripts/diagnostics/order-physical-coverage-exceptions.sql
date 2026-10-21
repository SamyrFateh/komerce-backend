-- C2 — Exceptions historiques : commandes réelles déjà avancées SANS couverture physique complète.
-- LECTURE SEULE (SELECT uniquement). À exécuter par un humain sur l'environnement autorisé.
-- Définition de « couvert » identique au gate (services/order-physical-coverage-service.js) :
-- v_purchase_line_progress.received_quantity = matière physique utilisable (placements actifs,
-- hors QUARANTINED/SUPERSEDED/outcome). Aucune réécriture de statut n'est déduite de ce résultat.
SELECT o.reference,
       o.status                                   AS etat,
       oi.id                                      AS order_item_id,
       oi.quantity                                AS quantite_attendue,
       COALESCE(v.rcv, 0)                         AS quantite_physique_utilisable,
       oi.quantity - COALESCE(v.rcv, 0)           AS quantite_manquante,
       COALESCE(v.declared, 0)                    AS preuve_declarative_received_qty,
       v.po_ids                                   AS purchase_orders,
       CASE WHEN COALESCE(v.declared, 0) > 0
            THEN 'Reçu déclaré sans preuve physique : rapprocher avec le hub, réceptionner via POST /api/scans/hub/receive si la matière existe, sinon ouvrir un incident'
            ELSE 'Aucune preuve : vérifier physiquement au hub puis réceptionner via le parcours canonique ou ouvrir un incident'
       END                                        AS prochaine_action
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id AND COALESCE(oi.fulfillment_source, '') <> 'LOCAL_STOCK'
  LEFT JOIN LATERAL (
         SELECT SUM(p.received_quantity) FILTER (WHERE NOT p.cancelled)          AS rcv,
                SUM(p.declared_received_quantity) FILTER (WHERE NOT p.cancelled) AS declared,
                ARRAY_AGG(DISTINCT p.purchase_order_id)                           AS po_ids
           FROM v_purchase_line_progress p
          WHERE p.order_item_id = oi.id
       ) v ON TRUE
 WHERE o.simulation_scope IS NULL
   AND o.status IN ('preparation', 'shipped', 'in_transit', 'available', 'collected')
   AND COALESCE(v.rcv, 0) < oi.quantity
 ORDER BY o.created_at, o.reference;
