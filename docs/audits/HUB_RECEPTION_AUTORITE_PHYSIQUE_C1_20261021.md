# C1 — Inventaire de l'autorité de réception physique Hub (lecture seule)

Base : `main` après #2800. Aucun code métier, aucune migration, aucun flag modifié. Livrable : consommateurs, chemins vers `preparation`, faisabilité du raccordement, requête de preuve. **Décision attendue avant C2.**

## 1. Chemins de réception

| Chemin | Preuve physique ? | Consommateurs |
|---|---|---|
| `POST /api/scans/hub/receive` → `hub-operations.receiveSupplierPackageCommand` → `hub-physical-identity.receiveSupplierPackage` | Oui : unité physique, allocation, placement `RECEIVE`, quarantaine, idempotence par `reference` | UI Opérations (`operations-workspace.js:340`), `scans.test.js` |
| `POST /api/purchasing/:id/receive` → `purchasing-receive-service.processReceive` | **Non** : incrémente `purchase_orders.received_qty` (déclaratif) | Aucun consommateur UI ; tests `purchasing-route.test.js` ; refuse déjà les PO regroupées (409) |
| `services/receive-purchase-order.js` | Non | Aucun appelant de production (tests seulement) |

Le chemin canonique accepte les deux formes de PO (`resolvePurchaseSnapshot` joint `purchase_orders.order_id` ; PO regroupée par ligne d'achat, `KOMERCE_GROUPED_PURCHASING`).

## 2. Définition du « reçu » (vue `v_purchase_line_progress`, migration 265)
- PO regroupée : somme des placements `RECEIVE` des allocations de la ligne (physique).
- PO historique (avec ou sans ligne d'achat) : `purchase_orders.received_qty` (déclaratif). **Aucun code hors `purchasing-receive-service` / `receive-purchase-order` n'écrit `received_qty`** : une PO historique reçue par le chemin canonique reste à 0 dans la vue, donc la commande ne se complète jamais ; seul le chemin déclaratif la fait avancer. C'est la raison de la coexistence.
- Le reçu physique ne soustrait ni unités `QUARANTINED`/`SUPERSEDED` ni `outcome_type` (LOST, STOLEN, DESTROYED, DAMAGED_UNUSABLE) : un placement `RECEIVE` reste compté après mise en quarantaine.

## 3. Transitions vers `preparation` (toutes passent par `transitionOrderStatus`)
1. `purchasing-completion-service.evaluateOrderProcurementCompletion` — lit la vue (canonique si PO regroupée ; déclaratif si historique).
2. `purchasing-receive-service.processReceive` — déclaratif pur.
3. `routes/hub-dashboard.js:201` (`hub_start_prep`) et `:316` (`hub_auto_prepare`) — depuis `confirmed`/`ordered`, **aucun contrôle de réception**.
4. `parcel-auto-create-service.js:197` — création d'un colis force `preparation`.
5. `scan-engine.js:787` — agrégat colis `pending` → `preparation`.
6. `receive-purchase-order.js:106` — code mort.

Le point d'étranglement unique est `order-status-machine.transitionOrderStatus` (SSOT). Un gate placé dans le seul chemin 2 laisserait 3–5 contourner la custody.

## 4. Faisabilité du raccordement de l'historique à la custody canonique
- Faisable sans nouveau moteur : la vue passerait, pour la forme historique, de `received_qty` à la somme des placements `RECEIVE` joints à `hub_purchase_allocations.purchase_order_id` (allocation unique par PO), avec exclusion des unités `QUARANTINED`/`SUPERSEDED` et des `outcome_type` non nuls. Aucune écriture dupliquée de `received_qty`.
- Ensuite, `POST /api/purchasing/:id/receive` devient inutile (410, sans consommateur UI) et `receive-purchase-order.js` peut rester inerte.
- Réserve à prouver en C2 : sémantique de `hub_physical_unit_placements.removed_at` après SPLIT/MERGE/REPACK (ne pas compter deux fois), et PO historiques déjà passées `hub_received` par déclaratif (historique à préserver, jamais réécrit).

## 5. Exigence C2 (arbitrée) : couverture quantitative
Complétude d'une commande = pour chaque ligne attendue non `LOCAL_STOCK`, `SUM(quantité physique utilisable) >= quantité effective`, quarantaine et unités inutilisables exclues ; gate dans `transitionOrderStatus` vers `preparation` (hors transitions historiques déjà effectuées).

## 6. Requête de preuve (à exécuter par un humain, lecture seule)
```sql
WITH need AS (
  SELECT oi.order_id, oi.id AS order_item_id, oi.quantity
    FROM order_items oi WHERE COALESCE(oi.fulfillment_source,'') <> 'LOCAL_STOCK'
), cover AS (
  SELECT a.order_item_id, COALESCE(SUM(p.quantity),0) AS usable_qty
    FROM hub_purchase_allocations a
    JOIN hub_physical_unit_placements p ON p.allocation_id = a.id AND p.operation_type = 'RECEIVE'
    JOIN hub_physical_units u ON u.id = p.physical_unit_id
   WHERE u.state NOT IN ('QUARANTINED','SUPERSEDED') AND u.outcome_type IS NULL
   GROUP BY a.order_item_id
)
SELECT o.reference, o.status, n.order_item_id, n.quantity AS needed, COALESCE(c.usable_qty,0) AS physical_usable
  FROM orders o
  JOIN need n ON n.order_id = o.id
  LEFT JOIN cover c ON c.order_item_id = n.order_item_id
 WHERE o.simulation_scope IS NULL
   AND o.status IN ('preparation','shipped','in_transit','available','collected')
   AND COALESCE(c.usable_qty,0) < n.quantity
 ORDER BY o.created_at;
```
Résultat attendu : liste des commandes réelles passées en préparation sans couverture physique complète (historique déclaratif inclus). Une liste non vide est l'ampleur de la dette à traiter avant ou avec C2.

## 7. Options chiffrées
- **(a) Raccorder l'historique** (préféré) : vue + gate dans `transitionOrderStatus` + 410 sur la route déclarative. 1 migration de vue, 1 garde, tests de couverture quantitative/quarantaine/idempotence. Contre-revue Opus.
- **(b) Fermer le chemin historique** : 410 immédiat ; les PO historiques ouvertes devraient être réceptionnées via le chemin canonique, ce qui exige quand même la correction de la vue (§2), sinon elles ne se complètent jamais.
- Dans les deux cas : arbitrer le sort des chemins 3–5 (gate central) et le traitement des commandes déjà en `preparation` sans couverture (résultat de §6).
