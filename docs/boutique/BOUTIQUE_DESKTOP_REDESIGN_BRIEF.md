# Boutique Komerce — Desktop Redesign Brief

## Objectif

Ce document fixe la nouvelle direction desktop de la boutique Komerce.

Le mobile est considéré comme proche de la validation. Le desktop, lui, ne doit pas être simplement stabilisé dans son état actuel : il doit être repensé comme une vraie expérience d'achat desktop.

## Décision structurante

```txt
Mobile = stabiliser / préserver.
Desktop = réinventer.
```

Le desktop ne doit pas être un mobile agrandi.

Il doit devenir une surface d'achat plus dense, plus claire, plus crédible et plus utile.

## Diagnostic

Points faibles identifiés :

```txt
- aperçu accueil inspiré Temu mais peu convaincant ;
- zoom modal produit peu utile ;
- effets visuels parfois gadgets ;
- desktop pas encore assez structuré comme e-commerce sérieux ;
- hiérarchie commerciale insuffisante ;
- panier latéral utile mais à mieux intégrer ;
- grille produit à rendre plus premium et plus lisible ;
- modal produit à orienter achat/confiance, pas effet technique.
```

## Ce qu'on garde de l'inspiration Temu

```txt
- densité produit ;
- rapidité d'exploration ;
- catégories visibles ;
- sensation de catalogue vivant ;
- accès panier permanent ;
- prix très lisibles.
```

## Ce qu'on ne copie plus

```txt
- zoom modal gadget ;
- preview accueil trop animé mais faible valeur ;
- effets visuels qui parasitent l'achat ;
- desktop conçu comme une simple extrapolation mobile ;
- accumulation de rails sans hiérarchie.
```

## Direction UX desktop

Le desktop doit s'organiser autour de 5 zones :

```txt
1. Header premium + recherche forte
2. Hero compact et crédible
3. Univers / catégories / filtres lisibles
4. Grille produit dense et premium
5. Side-cart / confiance / résumé achat
```

## Layout cible

Structure recommandée :

```txt
┌──────────────────────────────────────────────────────────────┐
│ Header : logo | recherche large | suivi | favoris | panier   │
├──────────────────────────────────────────────────────────────┤
│ Hero compact : promesse + preuve + CTA catalogue             │
├──────────────┬───────────────────────────────┬───────────────┤
│ Catégories   │ Grille produits / sections    │ Panier / aide  │
│ Filtres      │ Trouvailles / soldes / pop.   │ Confiance      │
│ Univers      │                               │ Résumé achat   │
└──────────────┴───────────────────────────────┴───────────────┘
```

## Header desktop

Le header doit devenir un outil d'achat.

À renforcer :

```txt
- recherche centrale large ;
- accès suivi clair ;
- favoris discret ;
- panier visible ;
- pas de surcharge décorative ;
- sticky possible si fluide.
```

## Hero desktop

Le hero desktop doit être compact.

Objectif : installer la confiance, pas manger la page.

Il doit contenir :

```txt
- slogan Komerce ;
- promesse simple ;
- preuve de service : retrait relais, paiement cash, livraison Comores ;
- CTA catalogue ;
- éventuellement visuel de marque, mais pas dominant.
```

À éviter :

```txt
- hero trop haut ;
- slogan peu lisible ;
- overlay lourd ;
- effets décoratifs qui prennent la place des produits.
```

## Accueil desktop

L'accueil ne doit pas être un simple aperçu Temu.

Il doit devenir une page marchande hiérarchisée :

```txt
1. Trouvailles du moment
2. Soldes utiles
3. Nouveautés
4. Populaires
5. Univers : Mode, Maison, Tech, Auto, Bricolage, Perso
6. Réassurance Komerce
```

Chaque zone doit avoir une raison commerciale.

## Grille produit desktop

La grille doit être dense mais pas cheap.

Principes :

```txt
- cartes plus nettes ;
- prix fort ;
- ancien prix / promo sobres ;
- image stable ;
- bouton ajout discret mais évident ;
- hover premium léger ;
- utilisation des classes ProductCardViewModel.
```

Le renderer produit doit rester piloté par :

```txt
ProductCardViewModel → renderProductCard() → products.css
```

## Side-cart desktop

Le side-cart doit être utile, pas seulement présent.

Il doit pouvoir afficher :

```txt
- articles du panier ;
- sous-total ;
- bouton commander ;
- panier collectif ;
- message de confiance ;
- rappel retrait/livraison ;
- éventuellement recommandations très courtes.
```

À éviter :

```txt
- side-cart vide trop grand ;
- CTA trop nombreux ;
- redondance avec le drawer panier.
```

## Modal produit desktop

La modal doit vendre et rassurer.

Le zoom n'est pas prioritaire.

Structure cible :

```txt
Gauche : galerie simple / image produit propre
Droite : nom, prix, promo, variantes, disponibilité, délai, CTA
Bas : garanties Komerce + suggestions légères
```

À supprimer ou réduire :

```txt
- zoom gadget ;
- interactions image complexes ;
- preview inutile ;
- animations qui gênent la décision.
```

## Rôle du ProductCardViewModel

Le redesign desktop doit utiliser la fondation :

```txt
source product
→ catalog product
→ ProductCardViewModel
→ card classes
→ CSS desktop
```

Les CSS desktop ne doivent pas dépendre des fournisseurs.

Ils doivent dépendre de classes contractuelles :

```txt
k-card--promo
k-card--local-stock
k-card--dubai-sourcing
k-card--custom-made
k-card--has-variants
k-card--low-confidence
```

## Non-objectifs

Cette refonte desktop ne doit pas :

```txt
- casser le mobile ;
- toucher au b-pager.js ;
- changer la logique panier métier ;
- modifier les statuts backend ;
- créer un second renderer produit ;
- faire dépendre le CSS d'un fournisseur.
```

## Fichiers propriétaires probables

```txt
public/boutique/css/boutique-desktop.css
public/boutique/css/products.css
public/boutique/css/modal.css
public/boutique/js/render/render-product-card.js
public/boutique/js/view-models/product-card-view-model.js
```

À éviter :

```txt
- patcher le desktop dans boutique-wow.css ;
- corriger desktop depuis b-pager.js ;
- créer une nouvelle couche visuelle non documentée.
```

## Plan recommandé

### PR 1 — Desktop redesign skeleton

```txt
- nettoyer la doctrine desktop ;
- réduire les effets gadget ;
- préparer layout desktop 3 zones ;
- protéger mobile.
```

### PR 2 — Desktop product grid premium

```txt
- cartes desktop ;
- densité ;
- hover ;
- badges ProductCardViewModel ;
- prix / ancien prix / CTA.
```

### PR 3 — Desktop modal commerce

```txt
- supprimer ou neutraliser zoom inutile ;
- structure achat/confiance ;
- CTA propres ;
- suggestions discrètes.
```

### PR 4 — Desktop home commerce

```txt
- supprimer aperçu accueil bof ;
- créer sections marchandes utiles ;
- trouvailles, soldes, populaires, univers.
```

## Position finale

Le desktop Komerce doit être :

```txt
clair
premium
marchand
utile
dense mais respirant
orienté confiance et conversion
```

Pas une copie Temu.

Komerce doit garder l'énergie du e-commerce moderne, mais avec une expérience plus crédible et plus adaptée au marché Comores / diaspora.
