# LOT 4H — Decision Signals Truth / absorption de ProblemsView

## Mission

Fermer la dette de vérité laissée par `ProblemsView` après la naissance de l'Action Center Canonical.

`ProblemsView` n'est pas migré. Ses règles sont auditées une par une. Une anomalie n'entre dans `decision-signals` que si sa condition est formulable depuis une source backend autoritaire, sans recomputation métier navigateur, et si sa disparition peut auto-résoudre le signal.

Doctrine :

> Un signal décrit un fait dérivé vérifiable. Un libellé métier ne peut jamais être plus fort que la vérité qui le produit.

## Verdict sur les 10 règles Legacy

| Règle Legacy | Verdict 4H | Source canonique / raison |
|---|---|---|
| `no_po` | **RÉÉCRIRE** | Le statut pertinent est `ordered`, pas `confirmed`. `triggerPurchasing()` crée les PO après `ordered` et le réparateur `repairOrderedWithoutPurchaseOrders` définit déjà l'invariant réel. |
| `double_payment` | **REJETER pour 4H** | `payments.length > 1` dans un payload `/api/orders` n'est pas une preuve canonique d'une double capture. Une future règle doit partir des autorités Stripe/PayPal/cash et distinguer replay idempotent d'un vrai double encaissement. |
| `cash_unsettled` | **DÉJÀ COUVERT** | `cash_expiring` lit `cash_collections.status='pending'` et porte la durée côté serveur. |
| `po_overflow` | **RÉÉCRIRE** | La vraie colonne est `purchase_orders.qty`; `received_qty > qty` est une anomalie d'intégrité forte puisque le service de réception borne normalement la quantité reçue. |
| `po_received_stuck` | **RÉÉCRIRE** | `purchasing` est un statut Legacy. L'invariant canonique est : toutes les PO actives sont reçues mais la commande reste `ordered` au-delà d'une courte fenêtre de cohérence. |
| `available_long` | **RÉÉCRIRE** | Utiliser `orders.available_at`, jamais `updated_at`, afin qu'une mise à jour sans rapport ne remette pas le compteur à zéro. |
| `prep_stuck` | **RÉÉCRIRE** | Utiliser `orders.preparation_at`, jamais `updated_at`. |
| `transit_long` | **DÉJÀ COUVERT** | `parcel_blocked` surveille les colis non terminaux bloqués côté serveur. Pas de second moteur parallèle dans 4H. |
| `no_sms` | **NE PAS CRÉER DE SIGNAL** | Le canal client canonique est `client_notifications`; `reconcileOrderMilestonesForUser()` répare idempotemment une émission de milestone manquée. L'ancien booléen `sms_sent` n'est plus l'autorité. |
| `no_hub_scan` | **REJETER pour 4H** | La règle Legacy dépend de `hub_id/hub_scan` sur le payload commande et de l'ancien statut `purchasing`. Aucun prédicat canonique équivalent n'est inventé. |

## Nettoyage de règles existantes `signal-service`

Trois générateurs historiques ne respectent plus la vérité actuelle et sont retirés du set généré :

- `stock_rupture` : son SQL détecte en réalité **0 vente en 30 jours**, pas une rupture de stock ;
- `margin_drift` : son SQL appelle « marge » un simple `total_kmf / nombre d'articles < 5000`, sans consommer le moteur économique ;
- `dispute_sensitive` : il cherche des valeurs `orders.status` (`disputed`, `problem`, `refund_requested`) absentes de la machine d'état canonique des commandes.

Les signaux actifs de ces types historiques sont résolus lors de la génération 4H afin qu'ils ne restent pas visibles comme faits encore vrais.

## Nouveaux signaux 4H

### `ordered_without_purchase_order`

**Vérité :** commande `ordered` sans aucune PO active, après une fenêtre de 15 minutes pour ne pas observer la courte phase asynchrone de déclenchement sourcing.

- entity : `order`
- owner : `sourcing`
- sévérité : `critical`
- drill : Order 360 via la résolution serveur existante
- auto-résolution : dès qu'une PO active existe ou que la commande quitte `ordered`

### `purchase_order_overreceived`

**Vérité :** au moins une PO active porte `received_qty > qty`.

- entity : `order`
- owner : `hub`
- sévérité : `critical`
- le signal agrège le nombre de PO incohérentes par commande
- auto-résolution : dès que l'incohérence disparaît

### `purchase_order_receipt_stuck`

**Vérité :** une commande reste `ordered` alors que toutes ses PO actives sont complètement reçues (`received_qty >= qty`), avec dernière réception complète vieille de plus de 15 minutes.

- entity : `order`
- owner : `hub`
- sévérité : `warning`
- auto-résolution : dès que la commande passe à `preparation` ou que la condition de complétude disparaît

### `pickup_overdue`

**Vérité :** commande encore `available` plus de 7 jours après `available_at`.

- entity : `order`
- owner : `relais`
- sévérité : `warning`
- auto-résolution : collecte, annulation ou changement de statut

### `preparation_stuck`

**Vérité :** commande encore `preparation` plus de 4 jours après `preparation_at`.

- entity : `order`
- owner : `hub`
- sévérité : `info`
- auto-résolution : changement de statut

## Action Center

Ces types rejoignent la famille `ops`. L'Action Center reste la seule nouvelle surface : aucun écran Problems Canonical n'est créé.

Les drill-down restent exclusivement résolus côté serveur depuis l'entité interne vers une référence métier publique. Aucun UUID supplémentaire n'est exposé au navigateur.

## Frontière 4H

4H ne :

- crée aucune nouvelle table ;
- modifie aucune commande, PO, notification ou donnée de paiement ;
- n'ajoute aucune mutation métier à l'Action Center ;
- ne fabrique pas de scope marché sur `signals` ;
- ne supprime pas encore la route Legacy `/admin/problems` avant preuve de couverture.

## Preuve attendue

- tests unitaires de chaque nouveau prédicat ;
- preuve d'auto-résolution ;
- preuve que les trois anciens générateurs trompeurs ne sont plus générés ;
- famille Action Center mise à jour ;
- tests Action Center / signal-service existants verts ;
- Feature First, Business Graph, Feature 360, Contract et Security 360 sans dérive ;
- aucune dépendance Canonical → Legacy.
