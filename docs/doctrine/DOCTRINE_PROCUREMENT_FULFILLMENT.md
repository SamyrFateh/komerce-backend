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

Cette jambe appartient au preflight fournisseur : disponibilité, coût fournisseur, quantité, possibilité d'expédier vers le hub et fret entrant au hub.

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
freight Supplier → Hub
  ↓
place-order payload exact
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

## 8. Gates canoniques avant achat fournisseur

```text
CUSTOMER COMMITMENT / order=ordered
        ↓
SUPPLIER ORDER IDENTITY RESOLVED
        ↓
PROCUREMENT ROUTE RESOLVED
        ↓
LIVE STOCK / PRICE REFRESH
        ↓
SUPPLIER → HUB FREIGHT VERIFIED
        ↓
PLACE-ORDER PAYLOAD READY
        ↓
HARD STOP
        ↓
SUPPLIER ORDER EXECUTION  ← gate séparé, fermé tant que non ouvert
```

`FULFILLMENT_READY` signifie que l'approvisionnement fournisseur est faisable pour la route résolue. Cela ne signifie jamais qu'une commande fournisseur a été passée.

## 9. Coût logistique : pas de double comptage

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

## 10. Règles AliExpress

Le nom « AliExpress Dropshipper » décrit la famille d'API du fournisseur, **pas** le modèle Komerce.

Pour Komerce :

- `ds.product.get` sert à la vérité produit/SKU ;
- Supplier Order Identity identifie l'unité exacte ;
- le freight fournisseur doit être calculé vers le Procurement Hub résolu ;
- le futur `placeOrder` doit utiliser l'unité exacte et l'adresse du hub ;
- le client final n'est pas la destination AliExpress tant que `DIRECT_TO_CUSTOMER` n'est pas explicitement ouvert.

Pour la route V1 actuelle, le proof AliExpress doit donc tester la destination hub `AE`, et non `KM` simplement parce que le Market initial est Comores.

## 11. Invariants non négociables

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
