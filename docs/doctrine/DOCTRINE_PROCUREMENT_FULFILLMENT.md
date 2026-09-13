# Doctrine canonique — Procurement & Fulfillment Komerce

**Statut : canonique**  
**Domaine propriétaire : Purchasing**  
**Portée : tous fournisseurs / tous Markets**

## 1. Principe fondamental

Komerce n'adopte jamais le modèle économique implicite d'un fournisseur, d'un SDK ou du nom commercial d'une API.

Un fournisseur peut appeler son programme « Dropshipper », « Marketplace », « Seller », « Fulfillment » ou autrement : cela ne change pas le modèle Komerce.

Le modèle Komerce par défaut est un **achat fournisseur déclenché par une vente client**, avec réception dans un **Procurement Hub** avant la logistique Market.

```text
CLIENT
  │ vente + paiement Komerce
  ▼
KOMERCE
  │ besoin d'approvisionnement
  ▼
PURCHASE ORDER
  │ achat fournisseur
  ▼
FOURNISSEUR
  │ Supplier Leg
  ▼
PROCUREMENT HUB
  │ réception / contrôle / consolidation
  ▼
MARKET LEG
  │ transport international / national
  ▼
MARKET / RELAIS / CLIENT
```

Ce modèle est de type **purchase-to-order / back-to-back procurement avec consolidation hub**. Il n'est pas, par défaut, du dropshipping direct fournisseur → client.

## 2. Deux transactions distinctes

### 2.1 Transaction commerciale client

Le client achète à **Komerce** selon les règles Komerce : catalogue, Market, prix, paiement, commande et service client.

Le fournisseur n'est pas partie au checkout client et ne détermine pas le prix client.

### 2.2 Transaction d'approvisionnement fournisseur

Après le gate commercial canonique (commande devenue `ordered` selon le cycle de vie existant), Purchasing crée ou résout une `purchase_order` et Komerce achète au fournisseur l'unité exacte nécessaire.

Aucun adapter fournisseur ne doit fusionner ces deux transactions.

## 3. Deux jambes logistiques distinctes

### Supplier Leg

```text
SUPPLIER → PROCUREMENT_HUB
```

Cette jambe appartient au procurement fournisseur. Selon les capacités réelles du fournisseur, son coût et son expédiabilité peuvent être vérifiés par API, vérifiés manuellement ou simulés dans staging à partir d'une hypothèse explicite.

### Market Leg

```text
PROCUREMENT_HUB → MARKET → RELAIS / CLIENT
```

Cette jambe appartient à la logistique Komerce. Elle ne doit pas être injectée silencieusement dans l'API fournisseur.

Le `country_code` du client ou du Market n'est donc **pas** la destination fournisseur par défaut.

## 4. Route d'approvisionnement canonique

Tout `Supplier Fulfillment Readiness` doit recevoir une route d'approvisionnement explicite.

### Mode par défaut : `PROCUREMENT_HUB`

```text
mode = PROCUREMENT_HUB
hub  = identité + destination du hub
```

Le moteur dérive la destination fournisseur depuis le hub résolu. Une destination brute fournie sans sémantique de route est refusée.

### Mode exceptionnel : `DIRECT_TO_CUSTOMER`

Le direct fournisseur → client est **fermé par défaut**. Il ne peut être activé que par une décision explicite et auditable couvrant au minimum :

- autorisation Market ;
- capacité fournisseur réellement prouvée ;
- partage d'adresse client explicitement autorisé ;
- fiscalité / douane ;
- SLA et tracking ;
- retours / remboursement ;
- politique qualité ;
- coût et délai complets.

Le fait qu'un fournisseur utilise le mot « dropshipping » n'ouvre jamais ce mode.

## 5. Hub actuel et extensibilité

Le modèle opérationnel historique Komerce utilise **Hub Dubai** pour réception, contrôle, emballage, scan et consolidation.

Pour la route V1 actuelle :

```text
Procurement Hub = Dubai, AE
```

Mais `Dubai` n'est pas une constante universelle du moteur Purchasing. À terme, un resolver de route peut sélectionner un hub selon fournisseur, origine, Market, coût, délai ou capacité.

L'invariant est le **rôle** `PROCUREMENT_HUB`, pas une ville codée en dur dans les adapters fournisseurs.

## 6. Supplier Order Identity reste indépendante de la route

Deux questions différentes doivent toujours rester séparées :

```text
Quelle unité acheter ?
→ Supplier Order Identity

Où le fournisseur doit-il l'expédier ?
→ Procurement Route
```

Une API de fret peut être product-level alors que l'achat exige une variante exacte. Cela ne diminue jamais l'exigence d'identité fournisseur déterministe.

```text
product_sku.id
  ↓
Supplier Order Identity exacte
  ↓
refresh exact stock / prix
  ↓
Procurement Route résolue
  ↓
Supplier Leg vérifié selon capacité réelle
  ↓
achat manuel ou payload place-order exact
```

## 7. Contrat des adapters fournisseurs

Le cœur Komerce fournit à l'adapter :

- l'identité fournisseur opaque ;
- la quantité ;
- la route d'approvisionnement déjà résolue ;
- la destination fournisseur dérivée de cette route.

L'adapter peut connaître `sku_id`, `sku_attr`, `variant_id`, `seller_sku`, noms d'API et DTO propres au fournisseur.

L'adapter ne peut pas :

- transformer le pays client en destination fournisseur par défaut ;
- choisir lui-même un modèle direct-to-customer ;
- inventer une route logistique ;
- exposer l'adresse client au fournisseur sans mode direct explicite ;
- modifier le prix Market ;
- créer une commande fournisseur pendant un preflight.

## 8. Capacité Komerce et capacité fournisseur sont deux axes différents

Une API fournisseur absente, limitée ou inaccessible ne change pas le modèle Komerce. Elle change seulement **le niveau d'automatisation disponible**.

### 8.1 `MODEL_SIMULATION_READY`

Komerce peut démontrer en staging que :

```text
vente client simulée
→ commande / paiement de test
→ order = ordered
→ Purchase Order
→ Supplier Order Identity exacte
→ Procurement Route Hub
→ coût fournisseur + hypothèses logistiques explicites
→ réception Hub simulée
→ Market Leg simulée
→ livraison / relais simulé
```

Aucune API d'achat fournisseur réelle n'est requise à ce niveau.

Une valeur simulée doit être marquée comme telle ; elle ne peut jamais être présentée comme un fait fournisseur live.

### 8.2 `MANUAL_PROCUREMENT_READY`

Un opérateur peut acheter réellement sans ambiguïté :

- produit fournisseur exact ;
- unité/variante exacte ;
- quantité ;
- coût source et devise ;
- fournisseur / URL ou canal d'achat ;
- destination Procurement Hub ;
- toute information nécessaire au passage manuel de commande.

Le fournisseur n'a pas besoin d'exposer une API `placeOrder` ou une API de fret live.

Si le fret n'est disponible que dans l'interface fournisseur au moment de l'achat, il est vérifié manuellement et enregistré comme tel.

### 8.3 `SUPPLIER_API_PREFLIGHT_READY`

Les capacités API réellement disponibles ont été prouvées : stock/prix live, quote de fret si l'API le permet, shippability, etc.

L'absence d'une capacité API produit un verdict de capacité (`FREIGHT_UNAVAILABLE`, `SUPPLIER_UNAVAILABLE`, etc.) mais **ne réfute pas** `MODEL_SIMULATION_READY` ou `MANUAL_PROCUREMENT_READY`.

### 8.4 `AUTO_ORDER_READY`

Komerce sait réellement créer la commande fournisseur via une API autorisée, stocker l'identifiant fournisseur, reprendre un timeout sans double achat, suivre statut et tracking, avec kill switch et idempotence.

Ce niveau est séparé du business model et reste fermé tant qu'il n'est pas explicitement prouvé.

## 9. Gates canoniques

### 9.1 Gate de simulation business

```text
CUSTOMER FLOW SIMULABLE
        ↓
SUPPLIER ORDER IDENTITY RESOLVED
        ↓
PROCUREMENT ROUTE RESOLVED
        ↓
PURCHASE ORDER EXPLOITABLE
        ↓
SUPPLIER LEG SIMULÉ / MANUEL EXPLICITE
        ↓
HUB RECEIPT SIMULABLE
        ↓
MARKET LEG SIMULABLE
        ↓
MODEL_SIMULATION_READY
```

### 9.2 Gate d'achat fournisseur réel manuel

```text
CUSTOMER COMMITMENT / order=ordered
        ↓
SUPPLIER ORDER IDENTITY RESOLVED
        ↓
PROCUREMENT ROUTE RESOLVED
        ↓
LIVE STOCK / PRICE quand disponible
        ↓
ACHAT MANUEL NON AMBIGU
        ↓
MANUAL_PROCUREMENT_READY
```

### 9.3 Gate d'auto-order

```text
MANUAL_PROCUREMENT_READY
        ↓
CAPACITÉS API FOURNISSEUR PROUVÉES
        ↓
FREIGHT API si réellement disponible
        ↓
PLACE-ORDER API PROUVÉE
        ↓
IDEMPOTENCE / TRACKING / KILL SWITCH
        ↓
AUTO_ORDER_READY
```

Un fournisseur n'est jamais déclaré `AUTO_ORDER_READY` sur la base d'une API supposée.

## 10. Coût logistique : pas de double comptage

Le coût réel doit rester décomposable :

```text
achat fournisseur
+ freight fournisseur → hub
+ réception / contrôle / handling hub
+ consolidation
+ freight hub → Market
+ douane / taxes applicables
+ dernier kilomètre / relais
```

Le moteur économique peut agréger ces composantes, mais une même charge ne doit jamais être imputée dans deux jambes différentes.

En simulation, chaque composante doit porter une provenance explicite : `live`, `manual`, `estimated`, `simulated` ou équivalent canonique. Un coût simulé ne devient jamais silencieusement un coût fournisseur réel.

## 11. Règles AliExpress

Le nom « AliExpress Dropshipper » décrit la famille d'API du fournisseur, **pas** le modèle Komerce.

Pour Komerce :

- `ds.product.get` sert à la vérité produit/SKU lorsqu'il est disponible ;
- Supplier Order Identity identifie l'unité exacte ;
- le Procurement Hub reste la destination métier Komerce ;
- une API AliExpress de fret n'est utilisée que si elle permet réellement de vérifier la Supplier Leg souhaitée ;
- si AliExpress ne propose pas cette capacité par API, la Supplier Leg reste manuelle/simulée sans falsifier un succès API ;
- le futur `placeOrder` n'est ouvert que si l'API et le compte le permettent réellement ;
- le client final n'est pas la destination AliExpress tant que `DIRECT_TO_CUSTOMER` n'est pas explicitement ouvert.

Le proof AliExpress ne doit donc plus chercher à démontrer « tout AliExpress par API ». Il doit démontrer séparément :

```text
Komerce sait vendre correctement          ← modèle Komerce
Komerce sait produire la PO exacte        ← modèle Komerce
Komerce sait router vers le Hub           ← modèle Komerce
AliExpress expose stock/prix live          ← capacité fournisseur observée
AliExpress expose freight API exploitable  ← capacité fournisseur à prouver
AliExpress expose placeOrder exploitable   ← capacité fournisseur à prouver
```

## 12. Invariants non négociables

1. **Vente client et achat fournisseur sont deux transactions distinctes.**
2. **Aucune intention d'achat fournisseur par inférence.**
3. **Aucune destination fournisseur brute sans route d'approvisionnement explicite.**
4. **`PROCUREMENT_HUB` est le mode par défaut Komerce.**
5. **`DIRECT_TO_CUSTOMER` est fermé par défaut et exige une décision explicite.**
6. **Le vocabulaire/API d'un fournisseur ne redéfinit jamais le modèle Komerce.**
7. **Supplier Leg et Market Leg restent séparés techniquement et économiquement.**
8. **Un preflight ne passe jamais de commande et ne déclenche jamais de paiement fournisseur.**
9. **Toute future auto-order conserve une Purchase Order Komerce idempotente comme autorité d'orchestration.**
10. **Le Hub est une capacité/rôle résolu ; Dubai est la route V1 actuelle, pas une hypothèse universelle du moteur.**
11. **Une capacité API fournisseur absente ne peut jamais être simulée comme disponible.**
12. **Une incapacité API fournisseur n'empêche pas de prouver séparément la cohérence du modèle Komerce en staging.**
