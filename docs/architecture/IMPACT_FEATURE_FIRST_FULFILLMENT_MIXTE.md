# Impact Feature First — Fulfillment mixte local / import

> **Statut** : proposition à challenger avant code  
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
3. comprendre dès le checkout que la commande a deux temporalités ;
4. récupérer les articles disponibles sans attendre ceux qui arrivent plus tard ;
5. ne pas payer de transport import sur une ligne déjà présente localement.

Le système doit rester simple : **1 panier → 1 commande → 1 paiement → plusieurs états de disponibilité par ligne**.

---

## 2. Feature First — owners déjà présents

### `catalog`

Rôle existant : Product Komerce et contrat de carte / fiche produit.

Impact :

- un Product `AVAILABLE_NOW` reste un Product ;
- Discovery ne doit pas remplacer sa capacité panier canonique ;
- produit simple : quick-add `+` ;
- produit à variantes : ouverture détail avant ajout.

Aucune nouvelle vérité métier dans `catalog`.

### `local-stock`

Rôle existant : vérité physique locale, projection `AVAILABLE_NOW | UNAVAILABLE`, cycle transactionnel `allocate → consume | release`.

Impact :

- reste seul owner de la disponibilité locale ;
- décide si une ligne peut être engagée sur stock local ;
- ne devient pas owner du checkout, du prix transport ni du retrait.

### `orders`

Rôle existant : owner de `orders`, `order_items`, checkout transactionnel et projection checkout Boutique.

Capacités déjà présentes à réutiliser :

- `order_items.availability_status` ;
- `order_items.estimated_available_at` ;
- service owner `order-item-availability-service.js` ;
- création d'une seule commande et d'un seul paiement ;
- rattachement à `local-stock` lors de l'insertion des lignes.

Impact proposé :

- snapshot immuable de provenance d'exécution par ligne : `LOCAL_STOCK | IMPORT` ;
- initialisation `availability_status='available'` pour une ligne effectivement engagée sur stock local, sinon état import existant ;
- projection checkout regroupée par disponibilité, sans créer une nouvelle commande.

### `logistics`

Rôle existant : `parcels`, expédition partielle, backorder, statuts `available` / `collected`.

Important : le repo possède déjà un mécanisme canonique de séparation après commande via `parcels`. La route historique `GET /orders/:id/sub-orders` est aujourd'hui un redirect vers les parcels : **ne pas ressusciter `sub_orders` et ne pas créer une nouvelle table `fulfillment_groups` sans nécessité réelle**.

Impact :

- les parcels restent l'unité d'exécution physique lorsque des lots doivent évoluer séparément ;
- la distinction local/import au checkout n'a pas besoin d'un nouveau domaine.

### `payments`

Aucun nouveau comportement métier : un seul paiement couvre la commande entière.

### `recommendations` / Discovery

Rôle existant : projection de lecture.

Impact :

- continue à exposer `AVAILABLE_NOW` fourni par `local-stock` ;
- ne possède ni panier, ni commande, ni fulfillment.

---

## 3. Règles de gestion minimales proposées

### R1 — Product reste Product

`AVAILABLE_NOW` change la promesse logistique, jamais la nature du produit.

### R2 — Le panier reste unique

Un produit local et un produit import peuvent cohabiter dans `state.cart` et dans la même `CheckoutSelection`.

### R3 — Le serveur classe, jamais le client

Chaque ligne de commande reçoit une provenance d'exécution résolue côté serveur :

- `LOCAL_STOCK` si le stock local est réellement engageable pour le marché / lieu ;
- `IMPORT` sinon.

Le frontend n'envoie jamais cette décision comme autorité.

### R4 — Une commande, un paiement

Une commande mixte ne doit pas être artificiellement scindée en deux orders.

### R5 — Disponibilité par ligne

La commande globale peut rester en cours tandis que certaines lignes sont déjà `available`.

Le client voit deux groupes de projection :

```text
Disponible maintenant
- Veste
- Savon

À venir
- Téléphone — estimation 2–3 semaines
```

Ces groupes sont des **projections**, pas une nouvelle table obligatoire.

### R6 — Retrait partiel autorisé

Une ligne locale prête peut être remise sans attendre les lignes import.

La remise physique séparée s'appuie sur le lifecycle `parcels` existant lorsqu'une unité autonome est requise.

### R7 — Transport facturé seulement quand il existe

Une ligne `LOCAL_STOCK` ne contribue pas au transport international.

Les lignes `IMPORT` continuent à utiliser le moteur de transport existant.

### R8 — Pas de fallback silencieux

Si une ligne affichée `Disponible maintenant` n'est plus engageable au moment atomique de la commande, le checkout renvoie un conflit clair et demande une nouvelle validation. Il ne transforme pas silencieusement la promesse en import 3 semaines.

---

## 4. Modèle minimal pressenti

Éviter un nouveau `fulfillment_groups` V1.

Ajouter seulement si le challenge confirme le besoin un snapshot owner `orders` sur `order_items`, par exemple :

```text
fulfillment_source = LOCAL_STOCK | IMPORT
```

Pourquoi un snapshot dédié plutôt que réutiliser `availability_status` :

- `availability_status` est mutable (`pending`, `available`, `delayed`, `backorder`...) ;
- la provenance d'exécution est une information historique différente ;
- une ligne import devient un jour `available` sans devenir historiquement `LOCAL_STOCK`.

Le lieu local peut rester dérivable de l'allocation tant qu'il n'existe qu'un lieu réel (`KM_MAIN`). Ne pas ajouter une FK / taxonomie de lieux avant le besoin.

---

## 5. Impact code probable

### Frontend Discovery

- `public/boutique/js/render/render-discovery-rail.js`
- owner de l'action panier canonique à réutiliser depuis `b-cart.js`
- tests Discovery rail.

### Checkout frontend (owner métier `orders`)

- `public/boutique/js/b-checkout.js`
- `public/boutique/js/b-checkout-render.js`
- afficher deux blocs calculés depuis la projection serveur / sélection enrichie.

### Checkout backend

- `services/order-checkout-service.js`
- `services/order-checkout-persistence.js`
- éventuellement un petit resolver dédié de fulfillment par ligne ;
- pricing transport doit ignorer les lignes réellement locales ;
- allocation locale reste déléguée à `local-stock-service.js`.

### Orders / tracking

- `services/order-item-availability-service.js`
- routes de détail / liste de commande afin de projeter les disponibilités par ligne.

### Logistics

- réutiliser `parcels` / `parcel_items` pour les lots autonomes ;
- ne pas modifier la state machine globale avant preuve que le retrait partiel ne peut pas être représenté par les parcels existants.

---

## 6. Non-objectifs V1

- pas de deuxième commande ;
- pas de deuxième paiement ;
- pas de table `fulfillment_groups` ;
- pas de résurrection de `sub_orders` ;
- pas de réservation panier TTL ;
- pas de multi-entrepôt ;
- pas de calcul ETA dans `local-stock` ;
- pas de fallback local → import silencieux ;
- pas de nouveau kind Discovery.

---

## 7. Questions à challenger avant code

1. Le snapshot `order_items.fulfillment_source` est-il le plus petit ajout durable, ou peut-on prouver qu'une donnée existante suffit sans ambiguïté historique ?
2. Peut-on faire participer `LOCAL_STOCK` au calcul de transport à coût zéro sans introduire de branche métier dans `transport-pricing` qui appartiendrait au mauvais owner ?
3. Quel est le plus petit raccord entre une ligne locale `available` et le lifecycle `parcels` pour permettre le retrait partiel sans marquer toute l'order `collected` ?
4. Le QR/retrait actuel est-il trop order-level pour une remise partielle et, si oui, quel owner doit porter l'extension ?
5. Quels invariants / tests Feature First doivent être ajoutés pour empêcher le frontend de décider lui-même `LOCAL_STOCK` ?
