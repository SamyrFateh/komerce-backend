# Doctrine — Accessibilité locale et ranking Discovery

> **Statut** : doctrine active  
> **Date** : 2026-09-03  
> **Portée** : Boutique mobile, `recommendations` / Discovery, projection des vérités `local-stock` et `providers-services`.  
> **Hiérarchie** : complète `DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md`, `FEATURE_DOCTRINE.md` et `AGENTS.md`. En cas de conflit, les documents de niveau supérieur font foi.  
> **Important** : cette doctrine fige l'expérience et les responsabilités. Elle **ne fige pas encore la formule mathématique ni les poids exacts du ranking V2.9**.

---

## 1. Signature produit

La Discovery locale doit rendre vraie cette promesse :

> **Komerce sait ce qui est réellement accessible près de toi et te le montre en premier, sans que tu aies à chercher.**

L'utilisateur ne doit pas avoir à construire lui-même un tri `catégorie × disponibilité × distance` pour comprendre ce qu'il peut obtenir.

La plateforme absorbe cette complexité.

Conséquence : la disponibilité locale est d'abord une **logique de composition et de ranking**, pas une nouvelle navigation.

---

## 2. Une seule navigation primaire

La navigation mobile Temu reste l'axe primaire :

```text
Tout | Soldes | Mode | Maison | Tech | Bricolage | …
```

Elle répond à :

> **Qu'est-ce que je cherche ?**

`Près de vous` répond à une autre question :

> **Qu'est-ce que je peux obtenir ou faire réaliser avec le moins de friction ici ?**

Ces deux questions ne doivent pas devenir deux rails de navigation concurrents.

### Invariant UX

Ne pas ajouter sous `Près de vous` :

```text
Tout | Maintenant | Bientôt | Sur commande
```

Ne pas ajouter non plus un sélecteur permanent :

```text
Disponibilité ▾
```

Le client découvre d'abord un rail déjà correctement ordonné.

---

## 3. `Près de vous` appartient à `Tout`

`Près de vous` reste visible directement dans l'univers `Tout`.

Composition mobile de référence :

```text
Header compact
Hero / signature Komerce
Rail catégories Temu
Près de vous · <market>
Rail horizontal Discovery
Catalogue Komerce
```

Le local est donc visible sans geste supplémentaire, mais il ne devient ni un onglet `Local`, ni une marketplace séparée.

### Swipe vers une catégorie

```text
Tout → Maison → Mode → Tech
```

Dans `Maison`, `Mode`, `Tech`, l'utilisateur entre dans l'univers catégorie correspondant. Le rail transversal `Près de vous` n'y est pas automatiquement projeté.

Si un jour une catégorie possède assez de profondeur locale pour justifier une expérience spécifique (`Mode locale`, par exemple), cette expérience sera un **enrichissement propriétaire de la catégorie**, pas une duplication automatique du rail transversal.

### Invariant

> **Pas de matrice implicite `catégorie × disponibilité locale`.**

---

## 4. Ranking par accessibilité réelle

Le rail n'est pas un ordre esthétique arbitraire.

Il doit tendre vers la réponse :

> **Qu'est-ce qui est le plus facile à obtenir ou à faire réaliser pour cet utilisateur, dans ce market, maintenant ?**

Le ranking combine au minimum trois familles de signaux :

1. **proximité / pertinence géographique réelle** ;
2. **promesse de disponibilité / délai d'accès réel** ;
3. **pertinence et diversité de la composition**.

### Important — ne pas figer trop tôt un ordre lexicographique

La doctrine ne dit pas encore :

```text
proximité ABSOLUMENT avant disponibilité
```

ni :

```text
disponibilité ABSOLUMENT avant proximité
```

Exemple à arbitrer en V2.9 :

```text
A — disponible maintenant à 8 km
B — sur commande à 1 km
```

Le système doit optimiser **l'accessibilité réelle**, pas appliquer mécaniquement une règle qui produirait une expérience absurde.

Les poids, seuils, rayons et fonctions de score seront donc validés sur des cas concrets avant d'être figés.

---

## 5. Les promesses visibles restent explicites sur les cartes

Le ranking est invisible ; la promesse de chaque carte ne l'est pas.

Les cartes doivent expliquer pourquoi l'objet est accessible avec des libellés simples, issus d'une vérité métier réelle.

Promesses de référence :

```text
Disponible maintenant
Préparation sur commande
Sur demande
Bientôt disponible
```

Exemples :

```text
Product Komerce + stock local réel
→ Disponible maintenant

Physical Offer tierce
→ Préparation sur commande

Service actif
→ Sur demande

Stock / offre réellement annoncé en arrivée
→ Bientôt disponible
```

Ces libellés sont des **projections de vérités sources**. Discovery ne doit jamais inventer une disponibilité qu'un domaine propriétaire ne peut pas garantir.

Un produit catalogue standard sans promesse locale vérifiable reste dans le catalogue Komerce classique ; il n'entre pas artificiellement dans `Près de vous` pour remplir le rail.

---

## 6. Ownership du ranking

La doctrine Feature First existante reste inchangée :

- `local-stock` possède la vérité de stock Komerce et sa disponibilité calculée ;
- `providers-services` possède les services, offres physiques et leur capacité réelle d'exécution ;
- `catalog` possède le Product Komerce ;
- `recommendations` / Discovery **compose et ordonne en lecture**.

### Invariant

> **Les features sources possèdent la vérité ; `recommendations` possède la politique de sélection et d'ordre ; le frontend affiche l'ordre reçu.**

Le frontend ne doit donc pas :

- recalculer la distance métier ;
- reclasser les cartes par disponibilité ;
- inventer un score local ;
- posséder un flag d'exposition métier ;
- corriger un ranking backend par une liste codée en dur.

---

## 7. Diversité sans mensonge

Un ranking purement numérique peut produire un rail inutilement monotone : six produits presque identiques peuvent masquer une offre physique ou un service pertinent.

`recommendations` peut donc appliquer une politique de diversité **après éligibilité métier**, afin de montrer la richesse réelle de l'écosystème local.

Cette diversité :

- ne rend jamais visible un objet non exposable ;
- ne falsifie jamais sa disponibilité ;
- ne crée pas une géométrie différente par `kind` ;
- ne doit pas faire remonter une offre manifestement moins accessible uniquement pour remplir un quota visuel.

La diversité est un signal de composition, pas une nouvelle vérité métier.

---

## 8. Pas de filtre tant que le produit peut décider correctement

La règle par défaut est :

> **Ne pas demander au client de classer ce que Komerce peut déjà classer correctement pour lui.**

Donc, dans la surface principale :

- pas de deuxième rail de chips ;
- pas de dropdown `Disponibilité` ;
- pas de tri `distance / prix / popularité` ;
- pas de compteur transformant le rail en inventaire à administrer ;
- pas de persistance de filtre entre catégories, puisqu'aucun filtre primaire n'existe.

Cette simplicité n'interdit pas une profondeur future. Elle interdit seulement de l'exposer avant que le besoin soit prouvé.

---

## 9. Quand le pool local devient profond

Si la quantité d'offres locales devient trop importante pour qu'un rail horizontal suffise, la première extension autorisée est une action secondaire de type :

```text
Près de vous · Comores                Voir tout →
```

Cette action ne doit pas créer une marketplace parallèle.

La vue développée doit conserver la même expérience Komerce et peut regrouper naturellement les cartes par promesse :

```text
Disponible maintenant
[cartes]

Préparation sur commande
[cartes]

Sur demande
[cartes]

Bientôt disponible
[cartes]
```

Il s'agit d'un **groupement de lecture**, pas d'une obligation de filtrer avant de voir les résultats.

### Non figé à ce stade

Le seuil exact déclenchant `Voir tout` n'est pas défini par cette doctrine. Il sera choisi à partir de la profondeur réelle du pool, de la télémétrie et des tests UX.

---

## 10. Ce que V2.9 devra décider avec des cas concrets

La prochaine étape ne consiste pas à inventer immédiatement un score définitif.

V2.9 devra tester au minimum :

- disponible maintenant proche vs disponible maintenant plus loin ;
- disponible maintenant plus loin vs sur commande très proche ;
- service sur demande vs offre physique sur commande ;
- absence de coordonnées fines mais market connu ;
- utilisateur sans permission de géolocalisation ;
- plusieurs îles / villes dans un même market ;
- quantité limitée de résultats disponibles maintenant ;
- forte concentration d'un même `kind` ;
- objets `Bientôt disponible` avec délais différents.

À partir de ces cas seront figés :

- la formule de score ;
- les poids ;
- les seuils de distance ;
- les fallbacks géographiques ;
- la règle de diversité ;
- la télémétrie nécessaire.

---

## 11. Anti-patterns spécifiques

Ne pas construire :

1. un second rail `Maintenant / Bientôt / Sur commande` ;
2. un dropdown permanent `Disponibilité` ;
3. un onglet Temu `Local` servant de marketplace parallèle ;
4. une page `/local`, `/artisans` ou `/services` comme second univers de Boutique ;
5. un filtre croisé automatique `catégorie × local × disponibilité` ;
6. un ranking frontend distinct du ranking backend ;
7. un champ persistant Discovery qui clone la vérité de disponibilité des domaines sources ;
8. un faux `Disponible maintenant` sans garantie backend ;
9. un remplissage artificiel du rail avec du sourcing distant sans promesse locale ;
10. une formule de ranking figée avant d'avoir confronté les cas métier réels.

---

## 12. Invariants finaux

> **Komerce montre le local avant de demander au client de le chercher.**

> **Le local est un axe transversal de disponibilité, pas une catégorie.**

> **`Près de vous` reste immédiatement visible dans `Tout` et ne crée aucune seconde navigation primaire.**

> **Le rail est ordonné automatiquement par accessibilité réelle ; les cartes rendent leur promesse explicite par des badges issus des vérités métier.**

> **Les domaines sources possèdent la vérité ; `recommendations` possède la composition et le ranking ; le frontend conserve l'ordre reçu.**

> **Aucun sélecteur de disponibilité n'est nécessaire tant que le ranking peut résoudre correctement le besoin.**

> **Quand la profondeur locale le justifiera, `Voir tout` pourra développer la même expérience par groupements de disponibilité, sans créer une marketplace parallèle.**

> **La doctrine de ranking est fixée dans son intention ; sa formule mathématique reste volontairement ouverte jusqu'au challenge V2.9.**
