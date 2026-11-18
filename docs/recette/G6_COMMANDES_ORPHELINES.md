# Commandes G6 du 18 novembre 2026

## Inventaire pour le propriétaire

À exécuter sur le staging après vérification de la cible. Chaque ligne donne l’étape de la commande et, le cas échéant, le statut du PO. Les commandes sans ligne ou sans PO restent visibles. La colonne « campagne_18_11 » identifie le périmètre demandé. Les autres commandes servent au rapprochement.

~~~sql
BEGIN READ ONLY;
WITH membership AS (
  SELECT DISTINCT oi.order_id, pl.purchase_order_id AS po_id
  FROM order_items oi
  JOIN purchase_lines pl ON pl.order_item_id = oi.id
  WHERE pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL
), peers AS (
  SELECT m.po_id, array_agg(o.reference ORDER BY o.reference) AS commandes_du_po
  FROM membership m JOIN orders o ON o.id = m.order_id
  GROUP BY m.po_id
)
SELECT market.code AS marche, o.reference, o.status AS etape_commande,
       o.payment_mode, o.payment_status, po.id AS po, po.status AS etape_po,
       peers.commandes_du_po,
       (market.code, o.reference) IN (
         ('KM','KG6BRN8'), ('KM','KEUV1BR'), ('KM','KFV1J2A'), ('KM','KG2R3C4'),
         ('CM','KHE0W13'), ('CM','KNCGJ00'), ('CM','KU61CW8'), ('CM','K3IZCBU'),
         ('CM','KCWKF7Q'), ('CM','KH2OIGF'), ('CG','KLG239M'), ('CG','KCP76WT')
       ) AS campagne_18_11
FROM orders o
LEFT JOIN markets market ON market.id = o.market_id
LEFT JOIN membership m ON m.order_id = o.id
LEFT JOIN purchase_orders po ON po.id = m.po_id
LEFT JOIN peers ON peers.po_id = po.id
WHERE o.simulation_scope = 'G6-BUYER'
  AND o.status NOT IN ('collected','cancelled')
ORDER BY market.code, o.reference, po.id;
COMMIT;
~~~

## Gestes du propriétaire

1. Avant tout geste, obtenir le GO et vérifier pour chaque référence la commande, le marché, le paiement et toutes les commandes du PO. Laisser en attente un PO partagé avec une commande hors sélection, un dossier remboursé ou un dossier qui impliquerait un PSP ou fournisseur externe.
2. Pour un PO exclusivement composé des cibles approuvées et toujours en brouillon, ouvrir **Opérations → Achats fournisseurs** (`/admin/workspaces/purchasing`), sélectionner **À préparer**, retrouver le PO et contrôler ses lignes. Choisir **Écarter le brouillon** et confirmer. Le service marque le PO annulé et détache ses lignes. Contrôler le PO dans l’historique des achats.
3. Dans les lignes ouvertes, identifier uniquement celles des commandes approuvées, y compris la ligne hors PO. Choisir **Annuler** pour la ligne concernée et renseigner le motif « Recette G6 interrompue le 18/11 — référence de commande ». Contrôler le retour à l’écran après chaque geste.
4. **Limite du parcours admin actuel.** L’annulation d’une ligne ou du PO laisse la commande client à son étape. L’écran privé **Mon Komerce → Commandes → Annuler la commande** propose l’annulation au client connecté. La consultation rapide par référence masque cette action. Le serveur autorise l’admin, mais aucun bouton correspondant n’a été identifié dans sa fiche Order 360. Laisser la commande en attente de cette action admin. Un workflow Chromium aurait la même limite.
5. Rejouer l’inventaire en lecture seule. Reporter par référence l’étape encore visible et le résultat des gestes. Une commande absente de cet inventaire peut être retirée ou annulée : vérifier son état final dans sa fiche avant de la compter comme annulée.
