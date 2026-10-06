# Doctrine canonique — Logistics Control Chain Komerce

**Statut : canonique**  
**Date : 2026-10-06**  
**Autorité physique : `logistics`**  
**Consommateurs principaux : `orders`, `purchasing`, `customs`, `market`, `dashboard`, `decision-signals`**

## 1. Principe fondamental

Komerce suit un **engagement client unique** depuis la commande jusqu'au relais, même lorsque cet engagement traverse plusieurs objets économiques, fournisseurs et physiques.

La chaîne de contrôle canonique est :

```text
CLIENT
  ↓
ORDER / ORDER ITEMS
  ↓
PURCHASE REQUIREMENT
  ↓
PURCHASE LINE / PURCHASE ORDER
  ↓
SUPPLIER EXECUTION
  ↓
PROCUREMENT HUB
  ↓
HUB RECEIVE / IDENTIFY / CONTROL
  ↓
SPLIT / MERGE / REPACK / CONSOLIDATE
  ↓
OUTBOUND MARKET PARCEL
  ↓
TRANSPORT RAIL / FORWARDER
  ↓
CUSTOMS
  ↓
RELAY
  ↓
CUSTOMER HANDOVER
```

Les enveloppes changent ; la filiation avec la commande client ne se perd jamais.

## 2. Le HUB est une primitive Logistics Komerce

Un HUB est un **point physique de concentration et de custody** décidé et opéré par Komerce dans le domaine `logistics`.

Il n'appartient ni à un Market, ni à une source de sourcing, ni à un fournisseur.

Le HUB peut servir plusieurs fournisseurs et plusieurs Markets. Son rôle est de mutualiser les flux avant leur redistribution.

Le HUB possède notamment les gestes physiques suivants :

```text
receive
identify
reconcile
count
inspect
quarantine
accept / reject
split
merge
repack
consolidate
pack
dispatch
```

Ces gestes modifient la réalité physique et la custody, jamais l'allocation commerciale ou économique amont.

## 3. Deux jambes logistiques distinctes

### 3.1 Supplier Leg

```text
SUPPLIER → PROCUREMENT HUB
```

La route d'approvisionnement est résolue par `purchasing` à partir du modèle Komerce et des capacités réellement disponibles du fournisseur.

La source ou marketplace peut rendre une destination HUB **possible** ; elle ne choisit pas le HUB stratégique de Komerce.

L'adapter fournisseur traduit la route déjà résolue en adresse, warehouse, ship-to, consignee ou autre contrat provider natif.

### 3.2 Market Leg

```text
PROCUREMENT HUB → RAIL → FORWARDER → MARKET → RELAY
```

Cette jambe appartient à la logistique Komerce.

L'identité du Market peut être connue dès la commande et les allocations HUB la préservent. En revanche, la **spécialisation logistique de sortie** devient opérante au HUB : constitution d'un outbound homogène, choix du rail, du transitaire et de la suite de la route vers le Market.

Un Market ne possède donc pas « son HUB ». Il consomme des sorties HUB compatibles avec ses routes logistiques.

## 4. Filiation continue

La commande client est la racine de lecture de la chaîne.

Une `order_item` peut être :

- regroupée dans une Purchase Order ;
- répartie sur plusieurs Purchase Orders ;
- reçue dans plusieurs colis fournisseur ;
- placée dans une ou plusieurs unités physiques HUB ;
- splittée, mergée ou repackée ;
- réencapsulée dans un ou plusieurs colis Market ;
- transportée sur un rail puis remise au relais.

Aucune transformation ne doit casser la capacité à remonter :

```text
physical unit / parcel
  → hub allocation
  → purchase line
  → purchase order
  → order item
  → order
  → customer commitment
```

Et inversement, depuis une commande, Komerce doit pouvoir retrouver ses encapsulations actuelles.

## 5. La Control Tower est une projection, jamais une nouvelle vérité métier

La Logistics Control Tower ne possède aucun lifecycle métier.

Elle projette les vérités des features propriétaires :

```text
orders
+ purchasing
+ supplier execution
+ hub identity / custody
+ parcels / shipments
+ customs
+ relay
+ decision signals
        ↓
CONTROL TOWER PROJECTION
```

La V1 est **read-only** et calculée par le backend. Elle ne crée pas de table de statut parallèle et ne persiste pas un « état dashboard » concurrent.

Une matérialisation ou un cache pourra être introduit ultérieurement uniquement pour des raisons de performance mesurées, sans changer le contrat sémantique.

## 6. Étape courante projetée

`current_stage` est une information de projection, pas un lifecycle supplémentaire.

Vocabulaire initial :

```text
ORDER
PURCHASING
SUPPLIER
HUB_RECEIVING
HUB_CONTROL
FORWARDER
TRANSPORT
CUSTOMS
RELAY
DELIVERED
```

Ce vocabulaire peut être raffiné sans réécrire les domaines propriétaires, tant que chaque étape reste dérivable de faits canoniques.

## 7. Health distinct du lifecycle

La couleur d'une commande dans la Control Tower exprime sa **santé opérationnelle courante**, pas son statut métier.

Vocabulaire visuel V1 :

```text
GREEN   = NORMAL
ORANGE  = DELAYED / AT_RISK
RED     = BLOCKED / ACTION_REQUIRED
```

Une commande peut donc suivre :

```text
GREEN → ORANGE → RED → ORANGE → GREEN
```

sans rollback de lifecycle.

La cause reste séparée de la couleur. Exemples :

```text
PAYMENT_BLOCKED
SUPPLIER_DELAY
SUPPLIER_UNAVAILABLE
PARTIAL
HUB_NON_COMPLIANT
HUB_BACKLOG
FORWARDER_DELAY
RAIL_UNAVAILABLE
CUSTOMS_HOLD
RELAY_EXCEPTION
```

Un retard n'est jamais assimilé à une indisponibilité ; une non-conformité n'est jamais assimilée à un retard.

## 8. Règle canonique des commandes splittées

Une commande peut avoir plusieurs branches simultanément à des étapes différentes.

La Control Tower n'affiche pas plusieurs fois le même numéro de commande au niveau principal.

Elle affiche la commande à **l'étape qui gouverne actuellement la complétude de l'engagement client**, c'est-à-dire la branche nécessaire la moins avancée qui empêche encore la complétude attendue.

Exemple :

```text
3 lignes → CUSTOMS
1 ligne  → HUB_CONTROL
```

Projection niveau 1 :

```text
HUB_CONTROL
ORANGE K-104829
```

Le drill-down expose ensuite toutes les branches et leurs encapsulations.

Cette règle n'interdit pas une livraison partielle autorisée par une feature propriétaire ; elle définit seulement la représentation de contrôle de l'engagement restant.

## 9. Vue Market

Un responsable Market doit pouvoir suivre **uniquement les commandes de son Market**, de bout en bout, depuis l'engagement client jusqu'au relais.

Le scope Market est toujours résolu côté serveur. Un `market_id` fourni par le navigateur n'est jamais une autorité.

Le niveau 1 montre uniquement :

- les étapes de la chaîne ;
- sous chaque étape, les numéros de commande ;
- un signal GREEN / ORANGE / RED.

Aucune date, PO, référence colis ou explication détaillée n'est nécessaire au niveau 1.

Le clic sur le numéro révèle :

- étape courante ;
- health ;
- cause ;
- branches éventuelles ;
- encapsulation courante : PO, colis fournisseur, unité HUB, colis Market, shipment ;
- responsable/action suivante ;
- lien vers les workspaces métiers propriétaires.

## 10. Causes structurelles

Une exception unitaire reste attachée à la commande.

Lorsque plusieurs commandes partagent une cause commune suffisamment forte, la Control Tower doit pouvoir projeter un **signal structurel** au-dessus de l'étape concernée.

Exemples :

```text
37 commandes
→ même étape PURCHASING
→ PAYMENT_BLOCKED
→ cause commune paiement fournisseur
```

ou :

```text
18 commandes
→ HUB_RECEIVING
→ HUB_BACKLOG
```

Le dashboard ne crée pas cette cause par intuition. Il agrège des faits et signaux canoniques identifiables.

Principe :

```text
exception isolée
→ agir sur la commande

concentration d'exceptions corrélées
→ agir sur la cause structurelle
```

## 11. Principe UI

La sophistication appartient au modèle et à la traçabilité, pas à l'écran.

La vue principale doit rester volontairement simple :

```text
ORDER     PURCHASING     SUPPLIER     HUB     FORWARDER     CUSTOMS     RELAY
  ● K-1      ● K-4          ● K-8     ● K-9      ● K-11       ● K-13    ● K-15
  ● K-2      ● K-5                    ● K-10
  ● K-3
```

Le vert doit rester discret. L'orange attire l'attention. Le rouge appelle une action.

Une masse orange/rouge doit privilégier une cause commune plutôt qu'une répétition visuelle de dizaines d'alertes identiques.

## 12. Critère End-to-End de référence

Le premier E2E business de la Control Chain doit prouver :

```text
client order
→ order item
→ purchase line
→ purchase order
→ supplier execution
→ hub receipt
→ hub control
→ repack / outbound
→ rail / forwarder
→ customs
→ relay
```

La preuve minimale doit couvrir :

1. un happy path complet ;
2. une anomalie HUB qui passe GREEN → RED → GREEN après résolution ;
3. une commande splittée dont le niveau 1 reste unique et dont le drill-down montre plusieurs branches ;
4. une cause structurelle commune à plusieurs commandes.

## 13. Invariants non négociables

1. Le HUB appartient à `logistics`, jamais à un Market ou à un fournisseur.
2. `purchasing` résout la Procurement Route ; un adapter fournisseur ne choisit jamais le HUB stratégique.
3. Supplier Leg et Market Leg restent deux jambes distinctes.
4. La filiation client survit à tous les split/merge/repack et changements d'enveloppe.
5. Le dashboard ne possède aucun état métier et ne réécrit aucun lifecycle.
6. `current_stage` et `health` sont des projections dérivées.
7. Une commande splittée reste une seule commande au niveau 1.
8. La couleur et la cause sont deux dimensions séparées.
9. Une cause structurelle doit être fondée sur des faits/signaux canoniques, jamais inventée par l'UI.
10. Le scope Market est résolu serveur.
11. Le drill-down peut traverser les features, mais toute action reste exécutée par la feature propriétaire.
12. Le client reste la racine et le relais la borne opérationnelle de la Control Chain Market.
