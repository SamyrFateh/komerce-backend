# Doctrine — Accessibilité locale et ranking Discovery

> **Statut** : doctrine active  
> **Date** : 2026-09-03  
> **Portée** : Boutique mobile, pager catégories, `recommendations` / Discovery, projection des vérités `local-stock` et `providers-services`.  
> **Hiérarchie** : complète `DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md`, `FEATURE_DOCTRINE.md` et `AGENTS.md`. En cas de conflit, les documents de niveau supérieur font foi.  
> **Important** : cette doctrine fige l'expérience et les responsabilités. Elle **ne fige pas encore la formule mathématique ni les poids exacts du ranking V2.9**.

---

## 1. Signature produit

La Discovery locale doit rendre vraie cette promesse :

> **L'utilisateur choisit un univers. Komerce lui montre d'abord ce qui est disponible ici, puis le reste de l'offre.**

L'utilisateur ne doit pas construire lui-même un tri `catégorie × disponibilité × distance`.

La plateforme absorbe cette complexité.

La disponibilité locale est donc une **logique de composition dans chaque contexte catégorie**, pas une nouvelle navigation.

---

## 2. Une seule navigation primaire

La navigation mobile Temu reste l'axe primaire :

```text
Tout | Soldes | Mode | Maison | Tech | Bricolage | …
```

Elle répond à :

> **Qu'est-ce que je cherche ?**

Dans la page catégorie courante, `Disponible ici` répond à :

> **Qu'est-ce que Komerce peut déjà me proposer localement dans cet univers ?**

Ces deux questions ne deviennent jamais deux navigations concurrentes.

### Invariant UX

Ne pas ajouter :

```text
Tout | Maintenant | Bientôt | Sur commande
```

Ne pas ajouter non plus un sélecteur permanent :

```text
Disponibilité ▾
```

Le client choisit uniquement son univers ; Komerce compose le reste.

---

## 3. Chaque page catégorie est un contexte complet

Le pager horizontal est conservé parce qu'il porte désormais un contexte complet.

Composition mobile de référence :

```text
Header compact                  ← fixe
Hero / signature Komerce        ← fixe
Rail catégories Temu            ← fixe
────────────────────────────────────────
Disponible ici                  ← swipe avec la page
Rail horizontal Discovery       ← swipe avec la page
Catalogue de la catégorie       ← swipe avec la page
```

Quand l'utilisateur swipe :

```text
Tout → Maison → Mode → Tech
```

**tout le contenu sous le rail catégories glisse ensemble** : `Disponible ici` et le catalogue associé.

Le rail local n'est donc jamais un bloc fixe qui se recompose au-dessus du pager.

### Exemple

```text
MAISON
Disponible ici
[ciment local] [meuble local] [peintre]

Catalogue Maison
[canapé] [lampe] […]
```

Puis :

```text
TECH
Disponible ici
[clim en stock] [installation clim]

Catalogue Tech
[smartphone] [TV] […]
```

### Invariant

> **Une page = un univers complet : local pertinent d'abord, catalogue de cet univers ensuite.**

---

## 4. `Tout` reste la vitrine transversale

Dans `Tout`, `Disponible ici` agrège le meilleur pool local exposable sans imposer de catégorie.

```text
TOUT
Disponible ici
[samboussas] [clim en stock] [plombier] […]

Catalogue
[…]
```

Dans une catégorie réelle, le pool local est contextuel à cette catégorie.

Le local reste donc transversal dans sa nature, mais **contextuel dans sa présentation**.

Il ne devient ni un onglet `Local`, ni une marketplace séparée.

---

## 5. Si aucune offre locale n'existe, ne rien afficher

Une page catégorie sans offre locale pertinente commence directement par son catalogue.

```text
MODE
Catalogue Mode
[…]
```

Ne pas afficher :

- `Aucune offre locale` ;
- un rail vide ;
- un placeholder ;
- un compteur à zéro.

L'absence est silencieuse.

Le seuil futur à partir duquel un pool mérite son rail n'est pas figé ici. Une carte réellement utile ne doit pas être masquée uniquement pour satisfaire un quota visuel arbitraire.

---

## 6. La formulation client est `Disponible ici`

La formulation visible de référence est :

> **Disponible ici**

`Accessibilité locale`, `local-stock`, `provider`, `physical_offer` et autres notions internes restent des concepts d'architecture.

Le client voit ensuite la promesse précise sur chaque carte :

```text
Disponible maintenant
Préparation sur commande
Sur demande
Bientôt disponible
```

Le titre du rail dit **où** l'offre est accessible ; le badge dit **comment / quand** elle l'est.

---

## 7. Ranking par accessibilité réelle

Le rail n'est pas un ordre esthétique arbitraire.

Il doit tendre vers la réponse :

> **Qu'est-ce qui est le plus facile à obtenir ou à faire réaliser pour cet utilisateur, dans ce market et dans cet univers, maintenant ?**

Le ranking combine au minimum :

1. **proximité / pertinence géographique réelle** ;
2. **promesse de disponibilité / délai d'accès réel** ;
3. **pertinence dans la catégorie courante** ;
4. **diversité utile de la composition**.

### Ne pas figer trop tôt un ordre lexicographique

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

Le système doit optimiser **l'accessibilité réelle**, pas appliquer mécaniquement une règle absurde.

Les poids, seuils, rayons et fonctions de score seront validés sur des cas concrets.

---

## 8. Ownership : vérité source, placement recommendations

La doctrine Feature First reste inchangée :

- `local-stock` possède la vérité de stock Komerce et sa disponibilité calculée ;
- `providers-services` possède les services, offres physiques et leur capacité réelle d'exécution ;
- `catalog` possède le Product Komerce et sa taxonomie ;
- `recommendations` / Discovery **compose, contextualise et ordonne en lecture**.

### Invariant

> **Les features sources possèdent la vérité ; `recommendations` possède la politique de sélection, d'appartenance aux contextes de Discovery et d'ordre ; le frontend conserve l'ordre reçu.**

Le frontend peut sélectionner la projection correspondant à la page active à partir des `category_keys` fournis par le backend, mais il ne doit jamais :

- calculer une distance métier ;
- reclasser par disponibilité ;
- inventer une appartenance catégorie ;
- posséder un flag d'exposition métier ;
- corriger le ranking par une liste codée en dur.

---

## 9. Le ghost est une mécanique de navigation, pas une page métier

Le pager peut conserver un ghost de `Tout` à la fin du rail afin de rendre la boucle `dernière catégorie → Tout` fluide.

### Conditions obligatoires

Le ghost :

- est un **snapshot DOM visuel** du vrai `Tout` ;
- ne fetch jamais ;
- ne ranke jamais ;
- ne monte aucun module Discovery ;
- ne possède aucun ID DOM dupliqué ;
- ne déclenche aucune mutation ;
- n'est pas interactif ;
- se recale silencieusement sur le vrai `Tout` après la transition.

`Disponible ici` présent dans le ghost est donc uniquement le snapshot du rail déjà rendu dans le vrai `Tout`.

### Invariant

> **Le ghost simule une continuité de geste ; il ne crée aucune seconde vérité.**

---

## 10. Pas de filtre tant que le produit peut décider correctement

La règle reste :

> **Ne pas demander au client de classer ce que Komerce peut déjà classer correctement pour lui.**

Donc :

- pas de deuxième rail de chips ;
- pas de dropdown `Disponibilité` ;
- pas d'onglet `Local` ;
- pas de page `/local`, `/artisans` ou `/services` comme second univers Boutique ;
- pas de tri visible `distance / prix / popularité` ;
- pas de persistance de filtre entre catégories.

Le swipe de catégorie est le seul choix de contexte nécessaire.

---

## 11. Quand le pool local devient profond

Si la profondeur d'un pool local devient trop importante pour le rail horizontal, une action secondaire `Voir tout →` pourra être ajoutée.

Elle ne doit pas créer une marketplace parallèle.

Une vue développée peut regrouper naturellement :

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

Il s'agit d'un **groupement de lecture**, pas d'un filtre préalable.

Le seuil exact reste volontairement non figé.

---

## 12. V2.9 : données et cas à éprouver

V2.9 doit éprouver :

- la projection explicite `category_keys` pour Product, Physical Offer et Service ;
- une offre pertinente dans plusieurs univers ;
- une catégorie sans local ;
- disponible maintenant proche vs plus loin ;
- disponible maintenant plus loin vs sur commande très proche ;
- service sur demande vs offre physique sur commande ;
- utilisateur sans géolocalisation fine ;
- plusieurs îles / villes dans un même market ;
- forte concentration d'un même `kind` ;
- objets `Bientôt disponible` avec délais différents.

À partir de ces cas seront figés :

- la formule de score ;
- les poids ;
- les seuils géographiques ;
- les fallbacks ;
- les règles de diversité ;
- la télémétrie.

---

## 13. Anti-patterns spécifiques

Ne pas construire :

1. un `Disponible ici` fixe au-dessus du pager qui se recompose à chaque swipe ;
2. un second rail `Maintenant / Bientôt / Sur commande` ;
3. un dropdown permanent `Disponibilité` ;
4. un onglet Temu `Local` ;
5. une page locale parallèle ;
6. un ranking frontend distinct du ranking backend ;
7. un mapping catégorie inventé dans le renderer ;
8. un ghost actif ou fetchant ses propres données ;
9. un faux `Disponible maintenant` sans garantie backend ;
10. une formule de ranking figée avant les cas métier réels.

---

## 14. Invariants finaux

> **L'utilisateur choisit un univers ; Komerce montre d'abord ce qui est disponible ici, puis le reste de l'offre.**

> **Chaque page catégorie est un contexte complet qui swipe ensemble : `Disponible ici` + catalogue.**

> **`Tout` agrège le meilleur du local ; les autres pages ne montrent que le local pertinent pour leur univers.**

> **S'il n'existe rien de pertinent localement, le rail est absent sans message.**

> **`Disponible ici` est la formulation client ; les badges expliquent la promesse précise.**

> **Les domaines sources possèdent la vérité ; `recommendations` possède la composition, le contexte et l'ordre ; le frontend ne re-ranke jamais.**

> **Le ghost est un snapshot visuel inerte de `Tout`, jamais une seconde page métier.**

> **Aucun sélecteur de disponibilité n'est nécessaire tant que Komerce peut résoudre correctement le besoin.**

> **La doctrine de ranking est fixée dans son intention ; sa formule mathématique reste ouverte jusqu'aux cas V2.9.**
