# Boutique Komerce — Category & Subcategory Navigation Redesign

## Objectif

Repenser le système de navigation catégories / sous-catégories de la boutique Komerce.

Le mobile est proche de la validation avec un rail court, compact et rapide. Le desktop, lui, doit passer d'une logique de rail agrandi à une vraie architecture d'exploration e-commerce.

## Décision structurante

```txt
Mobile = rail rapide et stable.
Desktop = architecture d'exploration : univers → rayons → filtres → produits.
```

La navigation desktop ne doit pas être une copie du mobile.

## Problème actuel

La navigation actuelle mélange plusieurs intentions :

```txt
- catégories principales ;
- sous-catégories ;
- filtres transverses comme Soldes ;
- rails visuels ;
- sidebar ;
- mega-dropdown ;
- logique mobile pager.
```

Résultat :

```txt
- la hiérarchie n'est pas assez claire ;
- les sous-catégories ressemblent à des accessoires ;
- le desktop manque de profondeur ;
- le client ne comprend pas toujours où il est ;
- le système risque de devenir difficile à maintenir avec le sourcing réel.
```

## Nouvelle hiérarchie recommandée

On ne parle plus seulement de catégories / sous-catégories.

On parle de :

```txt
Univers
→ Rayons
→ Filtres rapides
→ Produits
```

### Univers

Les grands piliers Komerce :

```txt
Tout
Soldes
Mode & Beauté
Maison
Tech
Bricolage
Créations personnelles
Auto
```

### Rayons

Les sous-catégories propres à un univers.

Exemples :

```txt
Mode & Beauté
→ Femme
→ Homme
→ Enfant
→ Beauté
→ Accessoires

Maison
→ Cuisine
→ Rangement
→ Déco
→ Salle de bain

Tech
→ Téléphones
→ Accessoires
→ Audio
→ Objets utiles
```

### Filtres rapides

Filtres transverses indépendants des univers :

```txt
Promos
Nouveautés
Populaires
Disponible rapidement
Sur commande
Petit prix
Premium
```

### Produits

La grille ne doit recevoir que le résultat d'un état de navigation clair.

## Mobile

Le mobile garde une logique compacte :

```txt
rail catégories principal
+ éventuellement sous-catégories contextuelles courtes
+ pager mobile
```

Le mobile ne doit pas afficher une architecture trop profonde.

Règle :

```txt
Mobile = décider vite.
Desktop = explorer confortablement.
```

## Desktop

Le desktop doit avoir une navigation plus claire :

```txt
1. Header : recherche centrale forte.
2. Barre univers : catégories principales, compacte.
3. Sidebar gauche : rayons de l'univers actif.
4. Zone centrale : produits.
5. Side-cart droite : panier / confiance.
```

Structure cible :

```txt
Header
Hero compact
Univers bar
┌──────────────┬──────────────────────────────┬───────────────┐
│ Rayons       │ Produits                      │ Panier        │
│ Filtres      │ Sections / grille             │ Confiance     │
│ Navigation   │                               │ Résumé achat  │
└──────────────┴──────────────────────────────┴───────────────┘
```

## Règle importante : Soldes n'est pas un univers métier

`Soldes` peut être affiché dans le rail principal parce que c'est utile commercialement.

Mais architecturalement, `Soldes` est plutôt un filtre transversal :

```txt
filter: promo = true
```

Pas une vraie famille métier comme Mode, Maison ou Tech.

Donc le système doit pouvoir distinguer :

```txt
- category_type = universe
- category_type = commercial_filter
```

## Modèle de navigation recommandé

À terme, `shop-schema.js` devrait porter une structure plus explicite :

```js
{
  key: 'mode-beaute',
  label: 'Mode & Beauté',
  type: 'universe',
  showInMobileRail: true,
  showInDesktopUniverses: true,
  dbKeys: ['Mode & Beauté'],
  subcategories: [
    { key: 'femme', label: 'Femme', dbKeys: ['Femme'] },
    { key: 'homme', label: 'Homme', dbKeys: ['Homme'] },
    { key: 'beaute', label: 'Beauté', dbKeys: ['Beauté'] }
  ]
}
```

Et pour Soldes :

```js
{
  key: 'soldes',
  label: 'Soldes',
  type: 'commercial_filter',
  filter: { promo: true },
  showInMobileRail: true,
  showInDesktopUniverses: true
}
```

## État de navigation cible

L'UI doit pouvoir exprimer un état clair :

```js
{
  activeUniverse: 'mode-beaute',
  activeSubcategory: 'femme',
  activeCommercialFilter: 'promo',
  searchQuery: '',
  sort: 'recommended'
}
```

À éviter :

```txt
un seul activeCat qui porte tout : catégorie, filtre, sous-catégorie, promo.
```

Cela devient vite ambigu.

## Responsabilités par fichier

### `shop-schema.js`

Possède :

```txt
- univers ;
- rayons ;
- filtres commerciaux ;
- mapping vers dbKeys ;
- labels/images/icônes.
```

Ne possède pas :

```txt
- DOM ;
- listeners ;
- layout ;
- scroll ;
- pager.
```

### `render-categories.js`

Possède :

```txt
- markup du rail mobile ;
- markup de la barre univers desktop si nécessaire ;
- markup des éléments de navigation depuis le schema.
```

Ne possède pas :

```txt
- état actif ;
- filtrage produit ;
- logique pager.
```

### `home-controller.js`

Possède :

```txt
- état actif de navigation ;
- choix univers/rayon/filtre ;
- coordination avec le catalogue ;
- mise à jour active states.
```

### `b-catalog.js`

Possède :

```txt
- chargement / filtrage produit ;
- application de l'état de navigation ;
- rendu final des sections/grilles.
```

### `b-pager.js`

Possède uniquement :

```txt
- mécanique mobile de pager catégories ;
- scroll sync ;
- cage mobile.
```

Ne doit pas porter la stratégie de navigation desktop.

## Anti-patterns à éviter

```txt
- ajouter des sous-catégories directement en dur dans le HTML ;
- créer une deuxième vérité desktop séparée du schema ;
- traiter Soldes comme une vraie catégorie métier en base ;
- faire dépendre le CSS des noms fournisseurs ;
- mélanger filtre commercial et catégorie dans le même champ ;
- corriger le desktop depuis b-pager.js ;
- casser le mobile validé pour enrichir le desktop.
```

## Plan d'implémentation recommandé

### PR 1 — Navigation doctrine

Cette PR.

Objectif : documenter le modèle cible.

### PR 2 — Schema navigation v2

Créer une structure plus claire dans `shop-schema.js` :

```txt
universes
commercialFilters
subcategories/rayons
```

Sans changer visuellement toute la boutique.

### PR 3 — Desktop navigation shell

Créer une vraie navigation desktop :

```txt
barre univers
sidebar rayons
filtres rapides
active state clair
```

### PR 4 — Mobile compatibility

S'assurer que le rail mobile continue de consommer le schema sans profondeur excessive.

### PR 5 — Catalog filtering cleanup

Remplacer progressivement les ambiguïtés `activeCat` par un état plus expressif.

## Position finale

Le bon modèle Komerce est :

```txt
Mobile : simple, rapide, tactile.
Desktop : structuré, profond, marchand.
```

Et la règle d'or :

```txt
Les catégories ne sont pas seulement du design.
Elles sont l'architecture d'achat de la boutique.
```
