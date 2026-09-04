# Impact Feature First — Fulfillment mixte local / import

> **Statut** : challenge repo effectué, proposition amendée avant code  
> **Date** : 2026-09-04  
> **Question** : comment permettre dans un seul panier / checkout des produits déjà disponibles localement et des produits à venir par import, sans créer une seconde commande ni une nouvelle feature inutile ?

---

## 1. Problème concret

Un même panier peut contenir :

- un Product Komerce `AVAILABLE_NOW` via `local-stock` ;
- un autre Product Komerce non présent localement et livré plus tard via le flux import.

Le client doit pouvoir :

1. ajouter normalement le produit local au panier ;
2. payer une seule fois ;
3. comprendre dès le checkout que la commande a plusieurs temporalités ;
4. récupérer un lot disponible sans attendre les lignes import ;
5. ne pas payer de transport international sur une ligne déjà présente localement.

Le système doit rester simple :

> **1 panier → 1 checkout → 1 paiement → 1 commande → état par ligne → lots physiques via parcels si nécessaire.**

---

## 2. Ce que le repo sait déjà faire

### `local-stock`

Déjà présent :

- vérité physique `local_stock.qty_physical` ;
- `commercial_exposure` ;
- disponibilité calculée après déduction des allocations actives ;
- allocation transactionnelle `allocateForOrderItem` ;
- `consumeAllocationsForOrder` au paiement confirmé ;
- `releaseAllocationsForOrder` à l'annulation ;
- verrou `FOR UPDATE` anti-survente.

### `orders`

Déjà présent :

- une transaction de checkout unique ;
- `orders` / `order_items` ;
- `order_items.availability_status` ;
- `order_items.estimated_available_at` ;
- `order-item-availability-service.js` comme boundary owner ;
- création d'une commande unique ;
- pricing transport avant l'insertion finale ;
- allocation local-stock pendant la persistance des lignes.

### `logistics`

Déjà présent :

- `parcels` / `parcel_items` ;
- partial shipping / backorder ;
- `computeOrderStatus()` avec règle explicite : au moins un parcel `collected` mais pas tous → parent `available` ;
- synchronisation parcel → order par la machine canonique.

### Limite réelle trouvée

Le pickup canonique n'est **pas** encore parcel-scoped : `recordCanonicalCollection()` reçoit une commande, lance un scan `collected` sans `order_item_id`, synchronise donc tous les parcels actifs, exige un parent final `collected`, puis invalide le secret order-level.

Conclusion : le modèle parcels est réutilisable, mais la remise partielle nécessite une petite extension explicite du pickup.

---

## 3. Feature First — owners et responsabilités

### `catalog`

Possède :

- Product Komerce ;
- variantes ;
- contrat de carte / fiche ;
- capacité panier du Product.

Impact :

- `AVAILABLE_NOW` ne crée pas un nouveau kind ;
- un Product simple local retrouve le quick-add `+` canonique ;
- un Product à variantes ouvre le détail avant ajout.

### `local-stock`

Possède :

- disponibilité physique locale ;
- exposition commerciale ;
- décision "cette quantité est engageable localement" ;
- lock / allocate / consume / release.

N'est pas owner de :

- checkout ;
- transport pricing ;
- ordre de paiement ;
- pickup.

### `orders`

Possède :

- orchestration transactionnelle ;
- `order_items` ;
- snapshot historique de provenance ;
- filtrage des lignes envoyées au pricing transport ;
- projection checkout ;
- disponibilité opérationnelle des lignes.

### `logistics`

Possède :

- lots physiques `parcels` ;
- transitions parcel ;
- collecte ciblée d'un parcel ;
- recompute du statut parent.

### `payments`

Aucun nouveau modèle : une seule commande, un seul paiement.

### `recommendations`

Projection de lecture uniquement. Aucun ownership panier/commande/fulfillment.

---

## 4. Règles de gestion V1 proposées

### R1 — Product reste Product

`AVAILABLE_NOW` change la promesse logistique, jamais la nature du Product.

### R2 — Panier / checkout / paiement / commande restent uniques

Aucun split transactionnel induit par le mélange local/import.

### R3 — Le serveur classe sous transaction

Chaque ligne est résolue comme :

```text
LOCAL_STOCK
IMPORT
```

Règle simple :

```text
local_stock exposé + quantité suffisante → LOCAL_STOCK
pas de lane locale exposée               → IMPORT
lane locale exposée mais insuffisante    → 409
```

Le frontend n'envoie jamais cette classification comme autorité.

### R4 — Pas de race entre promesse et allocation

Le resolver local doit recevoir le client transactionnel `orders`, verrouiller la ligne `local_stock` et conserver ce verrou jusqu'au `COMMIT/ROLLBACK` qui englobe ensuite pricing, insertion de la commande et allocation.

### R5 — Snapshot distinct du workflow

Ajouter :

```text
order_items.fulfillment_source
  LOCAL_STOCK | IMPORT
```

Ce snapshot est immuable.

Ne pas détourner `availability_status`, qui reste mutable et opérationnel.

### R6 — Une ligne locale n'est pas automatiquement prête au retrait

Ne pas écrire `availability_status='available'` juste parce que `fulfillment_source='LOCAL_STOCK'`.

`Disponible maintenant` signifie disponibilité physique locale ; `available` dans le lifecycle order item / parcel signifie prêt opérationnellement.

### R7 — Transport international uniquement sur IMPORT

`orders` filtre les lignes avant d'appeler `quoteTransportPriceForOrder()`.

`transport-pricing` ne reçoit aucune connaissance du domaine `local-stock`.

### R8 — Aucun fallback local → import silencieux

Une quantité locale devenue insuffisante pendant le checkout provoque un conflit explicite.

### R9 — Retrait partiel via parcels

Un lot local prêt peut être collecté indépendamment d'un lot import encore en transit.

Le parent reste `available` tant que tous les parcels actifs ne sont pas `collected`.

### R10 — Pickup one-shot conservé

Un retrait partiel cible un seul parcel et consomme le secret courant.

S'il reste un parcel à retirer : nouveau secret canonique order-level généré après la remise partielle.

Si tout est retiré : aucun nouveau secret.

Ne pas réactiver `parcels.pickup_code` en clair comme autorité.

---

## 5. Pourquoi `fulfillment_source` est justifié

`local_stock_allocations` contient aujourd'hui :

```text
local_stock_id
order_id
quantity
```

mais pas `order_item_id`.

Une commande peut porter plusieurs lignes du même Product avec variantes ou rails différents. Après coup, une allocation ne permet donc pas d'identifier sans ambiguïté quelle `order_item` a été exécutée localement.

Le snapshot sur `order_items` est plus petit et plus stable qu'un nouveau groupe de fulfillment.

Il ne remplace pas les allocations ; il documente la provenance de la ligne.

---

## 6. Impact code probable — mesuré par owner

### Lot A — Discovery quick-add Product local

Owner principal : `catalog` / frontend Boutique.

Fichiers probables :

- `public/boutique/js/render/render-discovery-rail.js`
- réutilisation de `addToCart` / `quickAdd` depuis `b-cart.js`
- tests `discovery-rail`.

Impact backend : aucun.

### Lot B — Resolver transactionnel local/import

Owner principal : `local-stock`, consommé par `orders`.

Fichiers probables :

- `services/local-stock-service.js`
- `services/order-checkout-service.js`
- tests `local-stock-service` + `orders checkout`.

But : résoudre / verrouiller / retourner `LOCAL_STOCK | IMPORT` sans mutation frontend.

### Lot C — Snapshot order item

Owner principal : `orders`.

Impact :

- migration nouvelle après vérification du prochain numéro libre ;
- `order_items.fulfillment_source` ;
- `services/order-checkout-persistence.js` ;
- projections detail/list ;
- tests migration/schema/orders.

### Lot D — Transport mixte

Owner principal : `orders` comme orchestrateur ; moteur `transport-pricing` inchangé.

Impact :

- construire le devis à partir des seules lignes `IMPORT` ;
- local = zéro contribution au transport international ;
- tests commande mixte local + import.

### Lot E — Projection checkout

Owner métier : `orders`, rendu Boutique.

Fichiers probables :

- `public/boutique/js/b-checkout.js`
- `public/boutique/js/b-checkout-render.js`
- tests checkout.

UX :

```text
Disponible maintenant
À venir
```

Aucun modèle persistant de groupe.

### Lot F — Pickup parcel-scoped

Owner principal : `logistics`, avec mutations order via boundaries existantes.

Fichiers à challenger / probablement toucher :

- `services/pickup-collection-recorder.js`
- `utils/parcelSync.js` ou un boundary parcel-scoped équivalent ;
- `services/pickup-secret-service.js`
- pickup services/routes appelants ;
- tests pickup + parcel sync + order status.

Invariants :

- un seul parcel collecté par événement ;
- parent `available` si reliquat ;
- parent `collected` seulement au dernier lot ;
- secret consommé à chaque retrait ;
- rotation si reliquat.

---

## 7. Fichiers / domaines à ne pas créer ou élargir sans preuve

Ne pas créer en V1 :

- feature `fulfillment` ;
- table `fulfillment_groups` ;
- deuxième order ;
- deuxième paiement ;
- résurrection `sub_orders` ;
- nouvelle state machine globale ;
- parcel pickup code plaintext comme nouvelle vérité ;
- TTL panier local-stock ;
- multi-entrepôt.

Ne pas faire porter à `transport-pricing` la décision local/import.

Ne pas faire porter à `recommendations` ou au frontend une décision engageante de stock.

---

## 8. Invariants Feature First à ajouter

1. `local-stock` est le seul owner de la décision engageable locale.
2. Le client ne peut pas imposer `fulfillment_source` dans le payload order.
3. `fulfillment_source` est immuable après insertion de `order_items`.
4. `availability_status` et `fulfillment_source` ne sont jamais utilisés comme synonymes.
5. Une ligne `LOCAL_STOCK` n'entre pas dans le pricing transport import.
6. Une lane locale exposée mais insuffisante produit 409, jamais un fallback import.
7. Une commande mixte produit une seule `orders` row.
8. Un retrait partiel ne transitionne pas le parent à `collected` tant qu'un parcel actif reste non collecté.
9. Le secret de retrait reste one-shot, y compris lors de retraits partiels.
10. Discovery n'écrit ni order, ni allocation, ni source de fulfillment.

---

## 9. Non-objectifs V1

- fallback explicite manuel "Commander quand même en import" ;
- multi-entrepôt ;
- livraison locale tarifée ;
- split payment ;
- réservation panier TTL ;
- ETA produit par `local-stock` ;
- optimisation fournisseur / regroupement avancé des parcels.

---

## 10. Verdict du challenge repo

**AMENDER puis implémenter par petits lots.**

Architecture retenue :

```text
catalog Product
  ↓
local-stock resolve + lock
  ↓
orders snapshot par ligne
  ↓
pricing IMPORT seulement
  ↓
1 order
  ↓
parcels pour l'exécution séparée
  ↓
pickup parcel-scoped + rotation secret si reliquat
```

Le principal trou n'est pas un manque de table de groupement ; c'est le pickup canonique encore order-level.
