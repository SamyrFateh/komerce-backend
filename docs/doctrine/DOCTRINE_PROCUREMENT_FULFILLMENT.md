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

## 9bis. Vocabulaire canonique — capability, readiness, execution mode (GAP-3)

Trois vocabulaires de statut coexistent dans le code Purchasing. Ils ne sont **pas** trois façons redondantes de dire la même chose : ce sont trois axes distincts qui ont été historiquement mélangés. Cette section fixe le vocabulaire canonique de chaque axe et la table de correspondance exacte entre le code existant et ces axes — **sans réécrire le code** (convergence par mapping documenté, pas par migration).

### 9bis.1 Les trois axes

```
CAPABILITY     = ce que l'intégration provider SAIT faire, niveau maturité de l'intégration
                 (statique par provider, indépendant du SKU/quantité en cours)
                 → déjà doctriné §8 : MODEL_SIMULATION_READY, MANUAL_PROCUREMENT_READY,
                   SUPPLIER_API_PREFLIGHT_READY, AUTO_ORDER_READY

READINESS      = est-ce que CETTE unité × CETTE quantité × CETTE route est exécutable
                 MAINTENANT (runtime, calculé à chaque preflight)
                 → vocabulaire canonique : VERDICT.* (services/suppliers/supplier-fulfillment-readiness.js)

EXECUTION_MODE = comment l'achat sera exécuté pour CET essai : auto | manual | whatsapp
                 → dérivé de CAPABILITY ∩ contexte fournisseur, jamais une source de vérité
                   indépendante
```

Une capability absente ne réfute jamais une readiness différente niveau (doctrine §8.3, déjà en vigueur) : un provider sans API d'achat peut être `FULFILLMENT_READY` en readiness tout en restant plafonné à `MANUAL_PROCUREMENT_READY` en capability. Ce sont deux questions différentes — « peut-on acheter cette unité maintenant » et « avec quel degré d'automatisation » — et le code ne doit jamais faire dépendre l'une de l'autre implicitement.

### 9bis.2 READINESS — vocabulaire canonique retenu

`VERDICT` (`services/suppliers/supplier-fulfillment-readiness.js`) est le vocabulaire canonique : c'est le seul des trois avec un contrat de validation (`supplier-fulfillment-adapter-contract.js:validateVerdict`), et l'adapter Allegro l'utilise déjà nativement (`const { VERDICT, result } = require('./supplier-fulfillment-readiness')`).

```
FULFILLMENT_READY | BLOCKED_SUPPLIER_IDENTITY | PROCUREMENT_ROUTE_UNRESOLVED
| SKU_INACTIVE | OUT_OF_STOCK | SUPPLIER_UNAVAILABLE | PRICE_DRIFT_BLOCKED
| NOT_SHIPPABLE | FREIGHT_UNAVAILABLE | PREFLIGHT_FAILED
```

### 9bis.3 Table de correspondance — `canonical-unit-purchasing-gate.js` → `VERDICT.*`

Le gate (`prepareCanonicalUnitPurchase`) ne retourne que **trois formes** de champ `.status` — pas une par cause d'échec. C'est un point de lecture important : le détail de la cause vit dans `.reason`, pas dans `.status`.

**Forme 1 — `status: 'BLOCKED_SUPPLIER_IDENTITY'`** (constante `BLOCKED`, fixe). Tous les échecs internes au gate, *avant* que l'adapter fournisseur soit sollicité pour un verdict, passent par le helper `blocked(reason, evidence)` qui fixe `.status` à cette constante unique et place la cause précise dans `.reason` :

| `.reason` observé | Origine | Équivalent `VERDICT.*` le plus proche | Nature |
|---|---|---|---|
| `INVALID_QUANTITY` | garde d'entrée (quantité ≤ 0 ou non finie) | — (aucun équivalent) | gate-only, avant toute résolution |
| `CANONICAL_RESOLUTION_UNAVAILABLE` | exception levée par `resolveFn` | `PREFLIGHT_FAILED` | équivalent sémantique |
| `NO_UNIT`, `AMBIGUOUS_PRODUCT`, `AMBIGUOUS_UNIT`, `NO_SUPPLIER_IDENTITY`, `INACTIVE_UNIT` *(resolver)* | `resolution.status` ≠ `RESOLVED` (résolveur Canonical Unit) | — (aucun équivalent) | gate-only, échec catalogue en amont de toute readiness fournisseur |
| `"BLOCKED_SUPPLIER_IDENTITY: <détail>"` *(chaîne préfixée, pas un token court)* | `normalizeIdentity()` lève une erreur | `BLOCKED_SUPPLIER_IDENTITY` | même code sémantique ; forme de chaîne différente des autres `.reason` (préfixée, pas un simple token) |
| `<texte libre>` (ex. "Adapter fulfillment absent pour X") | `validateAdapter()` — adapter absent/mal formé | `SUPPLIER_UNAVAILABLE` | équivalent sémantique, texte libre non normalisé |
| `INACTIVE_UNIT` *(gate)* | `canonical_unit.current_state.is_active === false` | `SKU_INACTIVE` | **même nom que le `INACTIVE_UNIT` du resolver ci-dessus, cause différente** — homonymie à surveiller |
| `STOCK_UNAVAILABLE` | stock absent, vide ou non numérique | `OUT_OF_STOCK` | équivalent large — le gate distingue "stock inconnu" de "stock insuffisant" (ligne suivante), `VERDICT` ne le fait pas |
| `OUT_OF_STOCK` | stock numérique mais insuffisant | `OUT_OF_STOCK` | **token identique** |
| `PRICE_UNAVAILABLE`, `CURRENCY_UNAVAILABLE` | prix/devise absents sur la Canonical Unit | `PRICE_DRIFT_BLOCKED` | équivalent le plus proche ; pas de distinction fine dans `VERDICT` |
| `PREFLIGHT_ERROR` | exception non gérée pendant `adapter.evaluate()` | `PREFLIGHT_FAILED` | équivalent sémantique |
| `BUILD_ORDER_PAYLOAD_CAPABILITY_UNAVAILABLE`, `BUILD_ORDER_PAYLOAD_ERROR`, `BUILD_ORDER_PAYLOAD_EMPTY` | échec **après** un verdict `ready:true` de l'adapter, pendant la construction du payload d'achat | — (aucun équivalent) | gate-only : la readiness fournisseur était positive, l'échec est postérieur (bug adapter ou payload vide) |

**Forme 2 — `status` = la valeur `VERDICT.*` exacte retournée par l'adapter.** Quand `adapter.evaluate()` répond `ready:false`, le gate **ne passe pas** par `blocked()` : il retourne le verdict de l'adapter tel quel (`{ ...verdict, place_order_invoked: false }`, ligne 91). C'est le seul chemin où `.status` porte directement un littéral `VERDICT.*` — parce que l'adapter Allegro construit lui-même son verdict via `result(VERDICT.XXX, evidence, reason)`. Aucune traduction n'est nécessaire ici ; c'est déjà le vocabulaire canonique.

**Forme 3 — `status: 'HARD_STOP'`** *(succès terminal, `ready:false`)*. Payload d'achat construit avec succès, en attente d'exécution manuelle ou automatique en aval. Équivalent conceptuel : `FULFILLMENT_READY` **+** capability `MANUAL_PROCUREMENT_READY` (doctrine §8.2).

**⚠️ Piège de lecture** : `'HARD_STOP'` ne signifie *pas* un échec. `ready:false` ici signifie seulement que `place_order_invoked` est faux — le gate ne déclenche jamais l'achat lui-même, c'est son rôle par construction (cf. §7, contrat des adapters). Un lecteur qui infère « `HARD_STOP` = readiness négative » se trompe : c'est le chemin de succès du gate, celui qui produit un payload exploitable.

### 9bis.4 Capability — le contrat d'evidence déjà en usage

L'adapter Allegro (`allegro-fulfillment-adapter.js`) enrichit son `evidence` de champs qui **sont déjà**, en pratique, le signal de capability par tentative :

```
evidence.manual_procurement_ready : boolean   → capability §8.2, prouvée à ce preflight
evidence.auto_order_ready          : boolean   → capability §8.4, prouvée à ce preflight
evidence.execution_mode            : 'manual' | 'auto'   → dérivé, informatif
```

Ce n'est pas un vocabulaire concurrent de `VERDICT.*` : ce sont des champs additionnels *dans* l'evidence d'un verdict `VERDICT.*`, qui répondent à l'axe CAPABILITY, pas à l'axe READINESS. C'est la forme à retenir comme convention pour tout futur adapter (GAP-2) : le verdict porte la readiness, l'evidence porte la capability observée à ce preflight.

### 9bis.5 Execution mode — deux calculs indépendants, non unifiés (dette pour GAP-4)

`purchasing-trigger-service.js` calcule son propre `triggerMode` :

```js
const triggerMode = ps.auto_order ? 'auto' : (ps.platform === 'whatsapp' ? 'whatsapp' : 'manual');
```

Ce calcul **ne lit jamais** `evidence.execution_mode` produit par l'adapter. Les deux concordent aujourd'hui par coïncidence : Allegro fixe `execution_mode:'manual'` en dur, et son `auto_order` en base est `false`. Rien dans le code ne garantit que ces deux sources restent synchronisées pour un futur provider — un adapter qui déclarerait `auto_order_ready:true` alors que `ps.auto_order=false` en base (ou l'inverse) ne serait détecté par aucun contrôle.

**Décision GAP-3 : ne pas unifier maintenant.** Documenté comme dette explicite pour GAP-4, qui branche le gate (porteur de l'evidence adapter) sur le chemin réel de `purchasing-trigger-service.js` — c'est à ce moment que `triggerMode` doit être dérivé de `evidence.execution_mode`/`auto_order_ready` plutôt que recalculé indépendamment depuis la ligne `suppliers.auto_order`.

### 9bis.6 Ce que cette section NE fait PAS

- Ne renomme aucun statut existant.
- Ne supprime aucun des trois vocabulaires.
- Ne modifie `triggerMode`, ni la table de correspondance ci-dessus n'est appliquée en code — c'est un mapping de lecture, pas une réécriture.
- Ne fige pas de nouvelle capability au-delà de `manual_procurement_ready`/`auto_order_ready`, déjà prouvées par Allegro.

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
