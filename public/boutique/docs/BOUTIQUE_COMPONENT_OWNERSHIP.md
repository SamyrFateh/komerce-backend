# Boutique Komerce — Component Ownership Doctrine

## Objectif

Ce document verrouille la doctrine de propriété des composants de la boutique Komerce.

La boutique ne doit plus être modifiée comme une page monolithique. Chaque zone possède une source de vérité claire : données, rendu, orchestration, comportement mobile, comportement desktop, ou style.

Cette règle sert à éviter les patchs contradictoires, les refactorisations sauvages et les corrections faites au mauvais endroit par un agent IA ou un développeur.

## Documents liés

```txt
docs/BOUTIQUE_WOW_LAYER_ARCHITECTURE.md
```

Ce document lié précise le statut temporaire de `boutique-wow.css`, la stratégie anti-FOUC, et le chemin de migration vers les fichiers propriétaires après validation visuelle.

## Règle fondamentale

```txt
Un composant = une vérité.
Pas de doublon HTML.
Pas de logique parallèle.
Pas de CSS qui compense une erreur JS.
Pas de JS qui recrée ce qu'un renderer sait déjà faire.
```

## Table de propriété

| Zone / composant | Fichier propriétaire | Possède | Ne doit pas posséder |
|---|---|---|---|
| Schéma boutique | `public/boutique/js/shop-schema.js` | catégories, sous-catégories, images, ordre, `dbKeys`, normalisation | DOM, listeners, layout, scroll |
| Rail catégories markup | `public/boutique/js/render/render-categories.js` | HTML des chips catégories, fallback image/SVG/texte | clics, état actif, pager, scroll |
| Orchestration Accueil | `public/boutique/js/controllers/home-controller.js` | montage du rail, clics catégories, active state, subcats desktop, synchro sidebar | données catégories, cartes produit, internals pager |
| Catalogue | `public/boutique/js/b-catalog.js` | chargement produits, filtrage, pagination, appel des renderers, coordination post-render | schéma catégories, markup rail, HTML carte dupliqué |
| Pager catégories mobile | `public/boutique/js/b-pager.js` | cage mobile Temu, `--pager-top`, `--pager-h`, scroll sync, ghost loop, auto-advance | rendu rail, rendu cartes, layout desktop, patch CSS hero |
| Sous-catégories mobile | `public/boutique/js/b-subcat.js` | mode flat sous-catégorie mobile, pager sous-catégorie | pager catégories principales, données catégories |
| Sections home | `public/boutique/js/render/render-home-sections.js` | markup des sections catalogue | filtrage, pagination, rail catégories |
| Carte produit | `public/boutique/js/render/render-product-card.js` | HTML d'une carte produit | mutation panier/favoris, ouverture modale directe, pagination |
| Panier | `public/boutique/js/b-cart.js` et modules cart dédiés | état panier, rendu panier, actions panier | rendu produit global, schéma catégories |
| Modal produit | `public/boutique/js/b-modal.js` | cycle d'ouverture/fermeture modal, rendu détail produit | correction pager, correction hero, navigation globale |
| Styles catégories base/mobile | `public/boutique/css/categories.css` | visuel base/mobile des chips et subchips | mega-nav desktop complet, correction JS pager |
| Hero base/mobile | `public/boutique/css/hero.css` | hero mobile/base, sticky bar visuelle | neutralisation de la cage pager mobile |
| Grille produits + cartes (toutes tailles) | `public/boutique/css/products.css` | `.k-grid`, `.k-sec-grid`, `.k-card` base et overrides desktop — source de vérité unique | layout desktop global, panier, modal |
| Chips catégories desktop (mega-nav) | `public/boutique/css/boutique-desktop.css` | `.k-chip`, `.k-chip-photo`, `.k-chip-label`, `.k-chip.active` desktop — bloc P0 + patch P1V-2 | redéclarer le layout chip dans un fichier chargé après |
| Desktop premium | `public/boutique/css/boutique-desktop.css` | layout desktop, side-cart, hero desktop, mega-nav catégories, footer desktop | comportement mobile, cage `#k-page-scroll`, fix mobile hero/pager, redéclarer `.k-grid` |
| Overrides desktop `.k-card` | `public/boutique/css/desktop-commerce-skeleton.css` | `border-radius`, `border`, `box-shadow` desktop de `.k-card` ; side-cart sticky ; largeurs max ≥1200px | layout `.k-chip`, `.k-cats-shell`, `.k-cats` — propriété de `boutique-desktop.css` |
| Mini-cart / accès panier | `public/boutique/js/b-desktop-global-cart-access.js` et CSS dédié | accès global panier desktop, fallback drawer | bottom nav mobile, rendu complet panier |
| Couche wow temporaire | `public/boutique/css/boutique-wow.css` | expérimentation visuelle réversible | vérité définitive, structure, pager, métier |

## Contrats par composant

### `shop-schema.js`

Responsabilité : être la source unique des catégories, sous-catégories, images, labels, `dbKeys`, ordre et normalisation.

Interdictions :

```txt
Do not render DOM here.
Do not attach UI listeners here.
Do not decide scroll, pager, or layout behavior here.
Do not duplicate category markup here.
```

Consommateurs officiels :

```txt
render-categories.js
home-controller.js
b-catalog.js
render-home-sections.js
```

### `render-categories.js`

Responsabilité : produire uniquement le markup HTML des chips catégories à partir de `shop-schema.js`.

Interdictions :

```txt
Do not bind click handlers here.
Do not mutate state.activeCat here.
Do not scroll the rail here.
Do not recalculate mobile pager variables here.
```

### `home-controller.js`

Responsabilité : monter le rail catégories, gérer la sélection, synchroniser l'état actif, piloter les sous-catégories desktop et coordonner les appels vers le catalogue.

Interdictions :

```txt
Do not define category data here.
Do not duplicate category chip markup here.
Do not render product cards here.
Do not own b-pager internals here.
```

### `b-pager.js`

Responsabilité : posséder le pager horizontal mobile façon Temu : cage fixed, variables CSS, scroll sync, ghost loop, auto-advance.

Contrat :

```txt
Expected DOM:
- #k-page-scroll
- #k-grid
- #k-grid > .k-cat-section

Expected lifecycle:
- active only on mobile
- destroyed on desktop
- recalculated after hero/category rail height changes
```

Interdictions :

```txt
Do not render category chips here.
Do not render product cards here.
Do not patch desktop layout here.
Do not fix hero overlap with CSS from here.
```

### `b-catalog.js`

Responsabilité : charger les produits, gérer le filtrage et la pagination, appeler les renderers, coordonner la remise en place du pager après rendu.

Interdictions :

```txt
Do not hardcode category schema here.
Do not render category rail markup here.
Do not duplicate product card HTML here.
Do not own desktop sidebar markup here.
```

### `render-product-card.js`

Responsabilité : rendre une carte produit unique et cohérente dans tous les contextes.

Interdictions :

```txt
Do not bind global click listeners here.
Do not open product modal directly here.
Do not mutate cart or favorite state here.
Do not decide pagination here.
```

### `products.css`

Responsabilité : être la source de vérité unique pour `.k-grid`, `.k-sec-grid` et `.k-card` — mobile-first, toutes tailles d'écran.

Interdictions :

```txt
Do not declare .k-chip or .k-cats layout here.
Do not own desktop-only layout (side-cart, mega-nav, hero desktop).
Do not duplicate .k-grid or .k-card rules in other files.
```

Note : les overrides desktop de `.k-card` (border-radius, box-shadow, border hover) sont dans `desktop-commerce-skeleton.css` — c'est légitime car ils enrichissent sans contredire `products.css`.

### `boutique-desktop.css`

Responsabilité : porter uniquement l'expérience desktop premium, dont le mega-nav catégories (`.k-chip`, `.k-cats-shell`, `.k-cats`).

Interdictions :

```txt
Do not override mobile pager mechanics.
Do not change #k-page-scroll mobile fixed cage behavior.
Do not use !important to fight mobile/base CSS.
Do not fix mobile hero overlap from desktop CSS.
Do not redeclare .k-grid columns or gap — source of truth is products.css.
```

Propriété du mega-nav chip :

```txt
Source de vérité unique pour .k-chip desktop : bloc P0 (≥900px) + patch P1V-2 (.k-chip.active fond coral).
Tout fichier CSS chargé après boutique-desktop.css (ex: desktop-commerce-skeleton.css)
ne doit pas redéclarer .k-chip, .k-chip-photo, .k-chip-label, .k-chip.active, .k-cats-shell, .k-cats.
Un tel redéclaration écraserait silencieusement le mega-nav et rendrait le rail catégories invisible.
```

### `desktop-commerce-skeleton.css`

Responsabilité : overrides desktop de `.k-card` (aspect visuel enrichi) et contraintes de largeur max du workspace.

Interdictions :

```txt
Do not redeclare .k-chip or any chip/cats variant here — boutique-desktop.css owns it.
Do not redeclare .k-grid gap or columns here — products.css owns it.
Do not redeclare .k-card:hover transform here — products.css owns it.
```

### `boutique-wow.css`

Responsabilité : porter une couche de test visuel réversible pendant la phase d'itération.

Interdictions :

```txt
Do not make boutique-wow.css the permanent owner of stable component styles.
Do not change pager mechanics from CSS.
Do not hide structural bugs with visual patches.
Do not keep it indefinitely without migrating validated rules.
```

Voir aussi :

```txt
docs/BOUTIQUE_WOW_LAYER_ARCHITECTURE.md
```

## Règle spécifique au rail catégories

La chaîne de vérité cible est :

```txt
shop-schema.js
→ render-categories.js
→ home-controller.js
→ b-pager.js uniquement pour le déplacement mobile
```

`index.html` ne doit pas devenir une seconde source de vérité pour les catégories. Il doit idéalement ne contenir que le point d'ancrage :

```html
<nav class="k-cats" id="k-cats" aria-label="Catégories"></nav>
```

Si des chips statiques sont conservées temporairement pour éviter le FOUC, elles doivent être strictement synchrones avec `shop-schema.js` et considérées comme une optimisation de boot, pas comme la vérité.

### Ordre de chargement CSS et propriété du mega-nav

L'ordre de chargement est : `categories.css` → `boutique-desktop.css` → `desktop-commerce-skeleton.css`.

`desktop-commerce-skeleton.css` est chargé en dernier et gagne toujours la cascade. Toute règle `.k-chip*`, `.k-cats-shell` ou `.k-cats` dans ce fichier écrase silencieusement le mega-nav de `boutique-desktop.css`. Ce type de conflit a causé l'invisibilité du rail catégories en production (corrigé Lot J).

Règle : **seul `boutique-desktop.css` déclare le layout des chips desktop.**

## Règle spécifique au mobile

Le mobile repose sur l'architecture suivante :

```txt
hero fixe
+ sticky bar catégories
+ #k-page-scroll en cage fixed
+ b-pager.js qui calcule --pager-top / --pager-h
+ #k-grid en pager horizontal catégories
```

Il est interdit de réparer un problème de superposition mobile en remettant brutalement le hero ou le catalogue dans le flux normal. Ce type de patch casse le moteur Temu mobile.

Avant toute correction mobile, vérifier :

```txt
- Accueil initial
- retour Accueil depuis Suivi/Favoris
- ouverture/fermeture modal
- swipe horizontal catégorie
- scroll vertical dans une catégorie
- bottom nav
- absence de pilule panier flottante parasite
```

## Règle spécifique au desktop

Le desktop doit être optimisé dans `boutique-desktop.css` et les modules desktop dédiés, sans toucher aux hypothèses du mobile.

Le desktop peut améliorer :

```txt
- hero premium
- grille dense
- mega-nav catégories
- side-cart droit
- sous-catégories sticky
- footer riche
```

Mais il ne doit pas modifier :

```txt
- #k-page-scroll.k-pager-active
- #k-grid.k-grid-cat-pager
- --pager-top / --pager-h mobile
- cycle b-pager.js
```

## Checklist avant PR UI boutique

Avant de merger une PR UI boutique :

```txt
[ ] Le fichier modifié est bien propriétaire du problème traité.
[ ] Aucune seconde source de vérité n'a été créée.
[ ] Le mobile pager n'est pas cassé.
[ ] Le desktop n'a pas reçu de hack mobile.
[ ] Le rail catégories reste piloté par shop-schema/render-categories/home-controller.
[ ] Les cartes produit restent pilotées par render-product-card.js.
[ ] Les changements CSS sont dans le bon fichier et le bon media query.
[ ] Aucun !important n'a été ajouté pour masquer un conflit d'architecture.
[ ] Aucune règle .k-chip / .k-cats n'a été ajoutée dans desktop-commerce-skeleton.css.
[ ] Aucune règle .k-grid / .k-card de base n'a été dupliquée hors products.css.
[ ] Si boutique-wow.css est modifié, le changement est expérimental, réversible et documenté.
```

## Prompts de garde pour agents IA

À donner à un agent avant modification :

```txt
Tu dois respecter la doctrine docs/BOUTIQUE_COMPONENT_OWNERSHIP.md.
Lis aussi docs/BOUTIQUE_WOW_LAYER_ARCHITECTURE.md si tu touches au polish visuel.
Ne modifie que le fichier propriétaire du problème.
Ne crée pas de doublon de markup ou de logique.
Ne casse pas le moteur mobile hero fixe + #k-page-scroll + b-pager.js.
Si tu dois corriger le rail catégories, passe par shop-schema.js, render-categories.js ou home-controller.js selon la nature du problème.
Si tu dois corriger le desktop, isole le changement dans boutique-desktop.css ou un module desktop dédié.
Si tu modifies boutique-wow.css, considère-le comme temporaire et prépare la migration future vers les fichiers propriétaires.
N'ajoute jamais de règle .k-chip, .k-cats-shell ou .k-cats dans desktop-commerce-skeleton.css — boutique-desktop.css en est le seul propriétaire.
N'ajoute jamais de règle .k-grid ou .k-card de base hors de products.css.
```
