# Doctrine — Discovery locale unifiée Komerce

> **Statut** : doctrine active  
> **Date** : 2026-09-02
> **Portée** : Boutique, `catalog`, `local-stock`, `providers-services`, `recommendations`, activation progressive et futur parcours de prescription.  
> **Hiérarchie** : complète `AGENTS.md` et `docs/doctrine/FEATURE_DOCTRINE.md`. En cas de conflit, ces documents de niveau supérieur font foi.

---

## 1. Principe directeur

Komerce reste **une seule expérience e-commerce**.

La Discovery locale n'est pas une marketplace parallèle, un second catalogue ni une navigation séparée. Elle rend simplement visible ce qu'un client peut **obtenir ou faire réaliser localement**, quelle que soit la source métier réelle derrière la carte affichée.

> **Le client découvre une disponibilité locale. Komerce absorbe la complexité de provenance, d'ownership et d'exécution.**

Conséquence : aucune navigation client dédiée `Marketplace locale`, `Produits locaux`, `Services` ou `Artisans` n'est créée par cette doctrine.

---

## 2. Les trois expériences visibles, deux features sources principales

Côté client, le rail local peut faire cohabiter trois intentions :

```text
Product Komerce déjà disponible       → Acheter
Produit physique proposé par un tiers → Commander
Service proposé par un tiers          → Demander
```

Côté architecture, ces trois intentions ne créent pas trois domaines symétriques.

```text
catalog + local-stock ───────────────┐
                                     ├──> recommendations / Discovery
providers-services                   ┘
    ├── services
    └── physical_offers
```

`recommendations` compose en lecture. Il ne devient propriétaire d'aucune vérité métier.

---

## 3. Product Komerce + stock local

Un produit acheté, pricé et revendu par Komerce reste un **Product Komerce**, même s'il est déjà physiquement présent dans le marché.

Exemple : climatiseur importé puis stocké par Komerce aux Comores.

```text
Product Komerce
      ↓
local-stock
      ↓
availability calculée
      ↓
Discovery
```

Côté client :

```text
Climatiseur
Disponible maintenant
Déjà en stock aux Comores
[Acheter]
```

### Invariant

> **Komerce fixe le prix et porte le risque commercial → Product Komerce.**

Le fait d'être physiquement disponible aux Comores ne transforme jamais automatiquement le produit en « produit local ».

Il faut distinguer :

```text
origine
localisation physique
promesse de disponibilité
```

Exemple valide :

```text
origin = imported
location = KM
availability = AVAILABLE_NOW
```

---

## 4. Produit physique proposé par un tiers local

Le cas de référence est volontairement simple :

> Une personne prépare des samboussas pour des mariages et veut être visible sur Komerce.

Elle prépare elle-même le produit, porte l'exécution, peut proposer son prix et peut accepter ou refuser une demande.

Côté client :

```text
Samboussas mariage
Plateau de 50
Préparation sur commande
[Commander]
```

### Owner Feature First

Le produit physique tiers **n'est pas une nouvelle feature**.

Il est rattaché à la feature existante `providers-services`, dans une table sœur dédiée :

```text
providers-services
    providers
    services
    physical_offers
    inquiries
```

`physical_offers` reste distinct de `services` afin de ne pas appeler artificiellement un produit physique une « prestation ».

### Invariant

> **Le tiers fixe/propose le prix et porte le risque d'exécution → offre tierce (`physical_offers`).**

Ne pas créer :

- un `Product` artificiel dans `catalog` ;
- une nouvelle feature uniquement pour l'offre physique tierce ;
- une god-table `Listing` / `Offer` avec un discriminant `kind` qui encoderait tous les comportements.

---

## 5. Service proposé par un tiers

Un artisan ou prestataire local appartient également à `providers-services`.

Exemples :

- installation climatiseur ;
- plomberie ;
- électricité ;
- maçonnerie ;
- mécanique ;
- menuiserie.

Flux minimal :

```text
Provider
   ↓
Service
   ↓
Inquiry
   ↓
Discovery
```

Côté client :

```text
Installation climatiseur
Sur demande
[Demander]
```

Le service peut être expérimenté sans paiement intégré, commission, provider wallet, settlement ni booking engine.

---

## 6. Une seule table `inquiries`, intégrité DB stricte

`inquiries` porte le même cycle de demande vers un Provider, mais une demande cible **exactement une** proposition.

Modèle cible :

```text
inquiries
  service_id         NULL FK → services
  physical_offer_id  NULL FK → physical_offers

CHECK (num_nonnulls(service_id, physical_offer_id) = 1)
```

### Invariant

Une inquiry cible exactement :

- un `service`, ou
- une `physical_offer`,

jamais les deux et jamais aucune.

L'association polymorphe :

```text
offer_type + offer_id
```

est interdite, car elle sacrifie l'intégrité référentielle Postgres.

L’action finale `Commander`, déclenchée depuis le détail Komerce d’une offre physique V0, crée une `inquiry`, **pas** une ligne dans `orders`. Le rail lui-même ne déclenche aucune mutation métier.

---

## 7. Un rail, un contrat de carte, un détail Komerce, trois actions

Le rail local reste unique.

La différence métier n’est pas portée par une taxonomie ou une composition différente, mais par la promesse affichée et l’action finale.

```text
Product Komerce
Disponible maintenant
[Acheter]

Physical offer
Préparation sur commande
[Commander]

Service
Sur demande
[Demander]
```

### Invariant UX — One Card Contract

Sur une même surface Discovery, `Product`, `Physical Offer` et `Service` partagent **la même géométrie de carte**.

Le kind métier peut modifier le contenu d’un slot ; il ne peut jamais modifier le squelette de la carte.

```text
DiscoveryCard
├── media slot
├── title slot
├── primary meta slot
├── context slot
└── action slot
```

Les slots structurels restent présents même lorsque leur donnée est absente. Une donnée optionnelle ne doit donc jamais :

- déplacer le CTA ;
- changer la hauteur du squelette ;
- créer une mini-carte dédiée ;
- créer une colonne ou une pile réservée à un kind ;
- modifier l’ordre structurel entre mobile et desktop.

Le `subtitle` reste obligatoire. Il porte la nuance de promesse dans le badge et évite d’ajouter une nouvelle taxonomie visuelle.

> **Même expérience ne veut pas dire même métier. Même expérience veut dire même contrat de présentation.**

### Invariant UX — One Open Contract

Une carte Discovery possède un seul contrat d’ouverture :

```text
clic carte ─┐
            ├──> openDiscoveryDetail(kind, ref)
CTA rail ───┘
                    ↓
                 #k-modal
```

Le CTA visible dans le rail exprime l’intention de l’utilisateur ; il ne déclenche pas directement une mutation métier.

Donc :

- le rail ne crée jamais une `Inquiry` ;
- le rail ne crée jamais une `Order` ;
- aucun kind ne possède un opener parallèle ;
- aucun second overlay ou second système de modale n’est autorisé.

> **Discover ≠ Act : la carte et son CTA ouvrent le détail ; l’action métier finale appartient au détail Komerce.**

### Une seule surface de détail Komerce

La carte Discovery n’ouvre jamais une marketplace, une page artisan ni un second système de modale.

`Product`, `Physical Offer` et `Service` restent des vérités métier distinctes, mais utilisent le **même shell de détail Komerce**. La nature métier détermine les capacités affichées et l’interaction finale, pas une nouvelle expérience.

```text
Carte Komerce
      ↓
openDiscoveryDetail(kind, ref)
      ↓
#k-modal
      ↓
Product        → Acheter
Physical Offer → Commander
Service        → Demander / Contacter
```

Les blocs de détail (média, fournisseur, variantes, livraison, références, contact autorisé) sont optionnels et apparaissent uniquement lorsque leur domaine source possède réellement la donnée. Discovery ne les invente jamais.

### Capability-driven, geometry-stable

La richesse future d’une fiche ne doit pas remettre en cause le contrat d’expérience.

Une capacité supplémentaire peut alimenter un slot ou un bloc optionnel :

```text
provider
variants
quantity / format
fulfillment
livraison
références
contact autorisé
```

mais elle ne crée ni nouveau kind d’interface, ni nouvelle navigation, ni nouveau shell.

Le système peut donc devenir plus riche sans devenir plus fragmenté.

Le client n’a pas besoin de connaître les mots internes :

- Provider ;
- Service table ;
- Physical offer ;
- Inquiry ;
- local-stock ;
- commercial exposure ;
- fulfillment ;
- settlement.

> **Le système sait. Le client agit.**

> **Une seule expérience de découverte et de détail Komerce ; seule la nature de l’interaction finale change.**

---

## 8. Discovery est une projection de lecture

`recommendations` peut devenir le moteur de composition du rail local, mais il reste une feature de sélection / ranking en lecture.

Il répond à :

> **Qu'est-ce qui est pertinent à montrer ici et maintenant pour ce market ?**

Il ne répond jamais à :

> **Quelle est la vérité métier de cet objet ?**

### Contrat de lecture autorisé

Un DTO de projection commun est acceptable :

```text
DiscoveryCard
  kind            product | physical_offer | service
  title
  subtitle
  cta_label
  cta_action_ref
  image_ref
```

`kind` sert uniquement à router l'interaction client vers le bon domaine source.

Il ne porte aucune règle métier et ne devient jamais un modèle persistant.

### Interdits

Ne pas créer :

- `discoverable_items` ;
- une table de clone Discovery ;
- un `UNION` métier persistant ;
- une classe mère Product/Service ;
- un god-object `Offer`.

> **Les domaines restent séparés. Discovery les rend voisins.**

---

## 9. Capability != Exposure

Les capacités backend et le rendu frontend peuvent être construits avant d'être visibles.

L'exposition reste pilotée par le backend.

### Source de vérité objet

Réutiliser le patron `commercial_exposure`.

Un objet peut être valide et actif tout en restant invisible :

```text
commercial_exposure = DISABLED
→ aucun affichage client
```

Puis :

```text
commercial_exposure = ENABLED
→ affichage autorisé sous réserve des autres invariants du domaine
```

### Market scope

Le market scope est résolu côté serveur selon la doctrine market existante. Le client ne choisit jamais lui-même le scope d'autorisation.

### Phase globale

Une politique globale peut décider qu'une famille entière n'est pas encore activable, par exemple :

```text
stock_komerce_local   ON
physical_offers       OFF
services              OFF
prescription          OFF
```

Cette politique ne doit pas devenir une série de `if FEATURE_X` dispersés dans le frontend.

### Ne pas créer de fausses sources de vérité

`capability_ready` et `data_ready` ne sont pas des colonnes DB supplémentaires par défaut.

- capability ready = la feature existe, ses contrats et tests sont verts ;
- data ready = validation applicative de la donnée nécessaire ;
- commercial exposure = autorisation commerciale explicite de l'objet.

---

## 10. Frontend final construit en avance

Le frontend final peut être développé avant l'ouverture commerciale.

Contrat obligatoire :

```text
aucune donnée exposable
→ composant absent

exposure = DISABLED
→ composant absent

contrat alimenté + exposure autorisée
→ composant visible
```

Surfaces possibles :

### PDP Product Komerce

```text
Disponible maintenant
Déjà en stock aux Comores
```

### PDP complémentaire

```text
Besoin d'installation ?
[Demander]
```

### Rail local

```text
Product Komerce
Physical offer
Service
```

### Prescription future

```text
Votre artisan vous a préparé une liste
[Voir la liste]
```

Le frontend n'est jamais propriétaire de l'autorisation métier d'exposer une carte.

---

## 11. Stock local : promesse fiable avant exposition

`local_stock.qty_physical` reste la vérité physique opérateur.

Ne pas matérialiser `qty_allocated` dans `local_stock` tant qu'un besoin de performance réel ne le justifie pas.

Les allocations actives sont dérivées depuis une table propriétaire `local-stock` :

```text
local_stock_allocations
  local_stock_id
  order_id
  quantity
  allocated_at
  consumed_at NULL
  released_at NULL
```

Disponibilité calculée :

```text
available = qty_physical - SUM(allocations actives)
```

Une allocation est active lorsque :

```text
consumed_at IS NULL
AND released_at IS NULL
```

### Cycle minimal

```text
CRÉATION DE COMMANDE
→ ALLOCATE

PAIEMENT / EXÉCUTION RÉELLEMENT CONFIRMÉE
→ CONSUME
→ qty_physical -= quantity
→ consumed_at = now()

ANNULATION / ÉCHEC AVANT CONSOMMATION
→ RELEASE
→ released_at = now()
```

`consume` et `release` doivent être idempotents et mutuellement exclusifs.

### Invariant

> Une allocation a une seule issue terminale : `consumed` ou `released`.

Une vraie réservation panier avec TTL, expiration et fenêtre de 15 minutes n'est pas imposée par cette doctrine tant que le volume ne la justifie pas.

---

## 12. Frontière avec `unsold-resolution`

`unsold-resolution` ne gère pas la libération normale d'une allocation local-stock.

Il traite une valeur déjà immobilisée devenue invendue / non retirée selon son propre cycle métier.

Donc :

```text
échec paiement
annulation commande
abandon avant consommation
→ RELEASE local-stock
```

alors que :

```text
stock consommé
commande ensuite non retirée / devenue invendue
→ éventuel unsold-resolution
```

Ne pas coupler `local-stock` à l'horloge ou au cycle d'abandon de `unsold-resolution` pour les releases ordinaires.

---

## 13. Activation séquentielle

L'expérience doit pouvoir être activée progressivement et réversiblement.

### Phase 0 — Shadow

Backend câblé, frontend éventuellement construit, rien de visible.

### Phase 1 — Product Komerce disponible localement

```text
Disponible maintenant
Déjà en stock aux Comores
```

À activer uniquement lorsque le cycle `allocate / consume / release` garantit la promesse.

### Phase 2 — Rail local Product Komerce

### Phase 3 — Service contextuel sur PDP

### Phase 4 — Service dans le rail local

### Phase 5 — Produit physique tiers

Cas de vérité :

```text
Samboussas mariage
Plateau de 50
Préparation sur commande
[Commander]
```

### Phase 6 — Rail mixte complet

```text
Product Komerce
Physical offer
Service
```

### Phase 7 — Prescription artisan

Chaque phase peut être testée sur un petit nombre d'objets avant élargissement.

---

## 14. Prescription artisan

L'artisan peut devenir plus qu'un prestataire : il peut prescrire le besoin produit Komerce.

```text
Artisan
   ↓
prescription matériaux
   ↓
Shared List
   ↓
Client
   ↓
Checkout Komerce
```

La valeur d'un service gratuit peut alors être mesurée par :

> **GMV produit généré par prescription artisan.**

Les évolutions de gouvernance `shared-cart` restent un chantier distinct et ne sont pas anticipées par cette doctrine.

---

## 15. Paiement tiers explicitement différé

La Discovery locale ne doit pas être bloquée par la finance tiers.

Tant que Komerce n'encaisse pas pour le compte du tiers et ne doit pas lui reverser de fonds, ne pas construire :

- payout ;
- settlement ;
- split payment ;
- provider wallet ;
- commission obligatoire ;
- remboursement tiers complexe.

Le jour où de l'argent doit sortir de Komerce vers un principal tiers ouvre un chantier séparé `orders / payments / wallet / conformité`.

---

## 16. Substitution et complémentarité

Une offre locale peut être :

### Substitutive

Exemple : ciment déjà disponible localement.

### Complémentaire

Exemple :

```text
climatiseur Komerce
+
installation locale
```

### Autonome

Exemples :

- samboussas ;
- gâteau ;
- mécanicien ;
- meuble artisanal.

La politique de Discovery peut rester éditoriale et simple tant qu'un moteur de ranking sophistiqué n'est pas justifié par les données.

---

## 17. Mesures

### Discovery

- impressions ;
- CTR ;
- interaction par `kind` ;
- conversion.

### Local-stock Komerce

- usage de `Disponible maintenant` ;
- conversion ;
- rupture ;
- erreur d'allocation ;
- stock dormant ;
- temps de retrait.

### Physical offers

- offres activées ;
- inquiries ;
- réponses ;
- acceptations ;
- exécutions ;
- annulations ;
- répétition.

### Services

- inquiries ;
- taux de réponse ;
- délai de réponse ;
- acceptation ;
- exécution.

### Prescription

- prescriptions ;
- conversion en Shared List ;
- conversion en commande ;
- GMV produit généré ;
- récurrence artisan.

---

## 18. Cas de vérité : samboussas

Toute évolution de Discovery locale doit continuer à répondre simplement aux questions suivantes :

```text
Qui crée l'offre ?
Qui la valide ?
Qui peut l'activer ?
Qui fixe le prix ?
Qui répond à la demande ?
Qui peut la suspendre ?
Que voit le client ?
Que crée le CTA Commander ?
Comment l'offre disparaît-elle si le provider n'est plus disponible ?
Comment le market scope est-il appliqué ?
```

Si la réponse exige une marketplace complète, le modèle est trop lourd.

Si elle exige de mentir en appelant tout `Product` ou tout `Service`, le modèle est faux.

---

## 19. Anti-patterns

Ne pas :

1. créer une marketplace locale séparée ;
2. créer une navigation `Local / Artisans / Services` ;
3. confondre origine et disponibilité locale ;
4. transformer tout en `Product` ;
5. transformer tout en `Service` ;
6. créer une feature séparée pour `physical_offers` sans nouveau service métier autonome ;
7. créer un god-object `Listing` / `Offer` universel ;
8. créer `discoverable_items` ;
9. créer une FK polymorphe `offer_type + offer_id` ;
10. matérialiser plusieurs vérités de stock sans nécessité ;
11. exposer `Disponible maintenant` sans garantie backend ;
12. utiliser `unsold-resolution` comme mécanisme générique de release ;
13. disperser les flags métier dans le frontend ;
14. construire payout / settlement avant preuve de valeur ;
15. activer toutes les familles d'offre en même temps.
16. varier la géométrie de carte selon le kind ou isoler les services dans une composition dédiée ;
17. déclencher une Inquiry ou une autre mutation métier directement depuis le rail ;
18. créer un opener, un overlay ou un shell de détail parallèle pour un kind Discovery.

---

## 20. Invariants finaux

> **Komerce reste une expérience unique.**

> **Le rail local est une fenêtre de visibilité complémentaire, pas une marketplace parallèle.**

> **Il sait faire cohabiter un Product Komerce déjà disponible, une offre physique réellement proposée par un tiers et un Service local sans fusionner leurs vérités métier.**

> **`providers-services` porte `services`, `physical_offers` et leur mécanique de demande ; `local-stock` porte la vérité de stock vendable Komerce ; `recommendations` compose uniquement en lecture.**

> **Le backend et le frontend peuvent être construits en avance. L'exposition est activée séquentiellement lorsque les données, l'exploitation et la promesse client sont suffisamment fiables.**

> **Une même surface Discovery impose une géométrie de carte commune : le kind change les données disponibles et l’action finale, jamais le squelette de présentation.**

> **Carte et CTA de rail partagent une seule entrée de détail ; aucune mutation métier ne part directement du rail.**

> **Product, Physical Offer et Service utilisent un seul shell de détail Komerce. La richesse future s’ajoute par capacités optionnelles, pas par multiplication des expériences.**
