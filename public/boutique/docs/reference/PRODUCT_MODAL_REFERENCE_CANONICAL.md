# Modale produit — référence canonique

> **Version** : 3.0 — 2026-07-27  
> **Statut** : référence normative de rendu  
> **Doctrine amont** : `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`  
> **Architecture active** : `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`

## 1. Décision canonique

> **Un seul Product Detail Contract, un seul état de sélection, deux compositions responsive et quatre rendus de référence.**

Les quatre états résultent de deux axes indépendants :

| Richesse produit | Desktop | Mobile |
|---|---|---|
| Simple | Desktop simple | Mobile simple |
| Enrichi | Desktop enrichi | Mobile enrichi |

Ils ne constituent jamais quatre contrats, quatre renderers métiers ou quatre arbres DOM indépendants.

La richesse produit ajoute ou retire des capacités. Le responsive change la composition, jamais la vérité produit.

## 2. Principe UX commun

> **Le hero présente. Le configurateur fait choisir. Le panier ou la barre d'action confirme et fait acheter.**

L'ordre fonctionnel est commun à tous les écrans :

```text
DÉCOUVRIR → COMPRENDRE → CONFIGURER → ACHETER → APPROFONDIR
```

Conséquences :

- l'image et la description courte appartiennent au hero ;
- les variantes appartiennent à un configurateur identifiable ;
- les détails longs viennent après le configurateur ;
- le side cart desktop reste la confirmation transactionnelle ;
- la barre d'action mobile reste la porte d'achat ;
- la variante enrichie est plus longue, mais n'utilise pas une autre mécanique de scroll.

## 3. Structure sémantique unique

```text
ProductModal
├── ModalHeader
├── ProductViewport
│   ├── ProductScroll
│   │   ├── ProductHero
│   │   │   ├── ProductMedia
│   │   │   │   ├── GalleryRail                 facultatif
│   │   │   │   ├── MainMedia
│   │   │   │   ├── MediaPagination             facultatif
│   │   │   │   ├── PromotionBadge              facultatif
│   │   │   │   └── FavoriteAction              facultatif
│   │   │   └── ProductNarrative
│   │   │       ├── ProductIdentity
│   │   │       ├── StockStatus
│   │   │       ├── ProductPrice
│   │   │       ├── DeliveryPromise
│   │   │       ├── ProductSummary
│   │   │       ├── ProductHighlights           facultatif
│   │   │       ├── Reassurance
│   │   │       └── ShareActions
│   │   ├── ProductConfigurator
│   │   │   ├── SelectionStatus
│   │   │   ├── ProductVariants                 facultatif
│   │   │   ├── QuantitySelector
│   │   │   └── DesktopPrimaryActions           desktop uniquement
│   │   ├── ProductDetails                      facultatif
│   │   └── ProductRecommendations              facultatif
│   └── DesktopCartPanel                        desktop uniquement
└── MobilePrimaryActions                        mobile uniquement
```

Les capacités du produit activent ou retirent des sections. Elles ne sélectionnent jamais un autre contrat.

Attributs recommandés :

```html
<article
  class="k-product-modal"
  data-layout="mobile"
  data-richness="enriched"
  data-has-gallery="true"
  data-has-variants="true"
  data-has-details="true"
  data-has-recommendations="true">
```

## 4. Matrice des capacités

| Capacité | Simple | Enrichi |
|---|---:|---:|
| Image principale | Oui | Oui |
| Galerie | Facultative | Oui si fournie |
| Promotion | Facultative | Facultative |
| Variantes | Facultatives | Facultatives |
| Résumé produit | Oui | Oui |
| Détails structurés | Non ou très courts | Oui si fournis |
| Livraison | Oui si fournie | Oui si fournie |
| Réassurance | Oui | Oui |
| Partage | Oui | Oui |
| Suggestions | Oui si fournies | Oui si fournies |
| Panier latéral desktop | Oui | Oui |
| Actions persistantes mobile | Oui | Oui |

Un produit simple se compacte naturellement. Une section absente ne laisse ni trou artificiel, ni séparateur orphelin, ni placeholder technique.

## 5. Composition desktop canonique

### 5.1 Shell

```text
┌───────────────────────────────────────────────┬──────────────────┐
│ Zone produit                                  │ Side cart        │
│                                               │                  │
│ Hero                                          │ Articles         │
│ Galerie | récit produit                       │ Quantités        │
│                                               │ Sous-total       │
│ Configurateur pleine largeur                  │ Commander        │
│                                               │                  │
│ Détails                                       │                  │
│ Suggestions                                   │                  │
└───────────────────────────────────────────────┴──────────────────┘
```

Le side cart appartient au shell de la modale, reste indépendant de la zone produit et conserve son propre flux interne si nécessaire.

Le configurateur couvre toute la largeur disponible de la zone produit, c'est-à-dire la largeur de la galerie et du récit produit réunies. Il s'arrête avant le side cart.

### 5.2 Hero desktop

Le hero utilise deux colonnes :

```text
GALERIE / MÉDIAS | IDENTITÉ / PRIX / DESCRIPTION COURTE / BÉNÉFICES
```

La colonne droite présente le produit. Elle ne porte plus le configurateur complet.

Elle peut contenir :

- nom, référence, prix, promotion et stock ;
- promesse de livraison ;
- description courte ;
- bénéfices ou caractéristiques essentielles ;
- réassurance et partage.

Les tableaux, consignes d'entretien, avertissements, guides détaillés et descriptions longues ne doivent pas allonger artificiellement cette colonne. Ils appartiennent à `ProductDetails` sous le configurateur.

### 5.3 Configurateur desktop transversal

Le configurateur est un panneau distinct placé immédiatement sous le hero.

```text
┌────────────────────────────────────────────────────────────┐
│ Configurez votre produit                                   │
│                                                            │
│ Taille                 Couleur                              │
│ [42] [43] [44]         [Bleu] [Noir]                       │
│                                                            │
│ Modèle                 Finition                             │
│ [Standard] [Premium]   [Mate] [Brillante]                   │
│                                                            │
│ Sélection actuelle · disponibilité · quantité · actions    │
└────────────────────────────────────────────────────────────┘
```

Règles :

- chaque axe garde un libellé explicite ;
- les options utilisent le `flex-wrap` ou une grille naturelle ;
- l'espace libre reste de la respiration, il n'est pas rempli artificiellement ;
- une option indisponible reste visible et explicable ;
- les choix aval sont réévalués par l'état partagé ;
- les actions desktop restent dans le configurateur ;
- le side cart affiche la confirmation après ajout et ne doit pas être dupliqué dans le panneau.

Pour un produit sans variante, le panneau reste présent sous une forme compacte avec disponibilité, quantité et actions. Le shell ne change pas.

### 5.4 Contenu enrichi desktop

Après le configurateur, les informations longues occupent la largeur de la zone produit :

- description détaillée ;
- caractéristiques techniques ;
- composition ;
- entretien ;
- avertissements ;
- guide des tailles ;
- contenu éditorial additionnel.

Les suggestions arrivent ensuite. Elles occupent la zone produit, jamais la colonne du side cart.

## 6. Composition mobile canonique

### 6.1 Shell mobile robuste

Le mobile utilise trois lignes structurelles :

```text
HEADER
CONTENU SCROLLABLE
ACTIONS PRIMAIRES
```

La barre d'action n'est pas superposée au contenu. Elle occupe une vraie ligne du shell.

```css
.k-product-modal {
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.k-product-modal__scroll {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.k-product-modal__actions {
  position: relative;
  padding-bottom: env(safe-area-inset-bottom);
}
```

Cette structure remplace les compensations de hauteur calculées en JavaScript.

Sont interdits pour réserver la place des actions :

- un `padding-bottom` mesuré depuis la hauteur du CTA ;
- une variable viewport recalculée pour compenser la barre basse ;
- une action `position: fixed` superposée au contenu ;
- un second scroll dans le configurateur.

### 6.2 Ordre mobile

```text
Header
Média
Identité / prix / livraison / résumé court
Configurateur pleine largeur
Détails structurés
Suggestions
Actions primaires
```

Le média reste généreux, mais ne doit pas monopoliser tout le premier écran. Le nom, le prix et l'amorce du configurateur doivent apparaître rapidement.

Le configurateur mobile reprend les mêmes axes que le desktop, empilés sur toute la largeur :

```text
Configurez votre produit
Sélection actuelle

Couleur
[ Bleu ] [ Noir ]

Taille
[42] [43] [44]

Quantité
[ − 1 + ]
```

Les instructions doivent être explicites : `Choisissez une taille`, `Sélectionnez une couleur`, `2 options à compléter`. Les libellés ambigus tels que `Choisissez la suite` sont interdits.

### 6.3 Actions mobiles

La barre contient :

- `Ajouter` ;
- `Acheter maintenant`.

Avant sélection complète, l'action concernée est désactivée ou affiche l'étape manquante. Après sélection complète, elle devient transactionnelle.

Le panier reste visible dans le header. Il n'existe pas de side cart mobile.

## 7. Contrat de scroll

### Desktop

- le header de modale reste hors du scroll produit ;
- la zone produit possède un seul conteneur vertical scrollable ;
- le hero, le configurateur, les détails et les suggestions défilent ensemble ;
- la galerie n'est ni `sticky` ni `fixed` ;
- le side cart est indépendant et ne défile pas avec la zone produit.

### Mobile

- le header est une ligne du shell ;
- le contenu produit possède un seul scroll ;
- la barre d'action est une ligne du shell ;
- aucun contenu ne passe derrière la barre basse ;
- aucun calcul JavaScript de compensation n'est nécessaire.

### Invariant commun

> **La richesse du produit ne change jamais le propriétaire du scroll.**

Le produit enrichi est plus long. Il n'est pas une autre interface.

## 8. Suggestions — règle commune

La section de recommandations est présente dans les quatre états lorsque le contrat retourne des éléments.

La différence simple/enrichi porte uniquement sur sa position naturelle dans le flux :

| Règle | Produit simple | Produit enrichi |
|---|---|---|
| Présence | Si fournie | Si fournie |
| Position perçue | Plus tôt | Plus bas |
| Cause | contenu court | configurateur et détails plus denses |
| Composant | identique | identique |

Les cartes utilisent un contrôle neutre `+`, puis un stepper `− N +` après ajout. Elles n'affichent jamais de panier miniature.

Sur mobile, le rail est horizontal et tactile, avec environ 1,6 à 2 cartes visibles. Il reste entièrement accessible dans le scroll avant la barre d'action.

## 9. Actions et état panier

Une seule logique métier pilote desktop et mobile :

```text
quantité = 0  → bouton Ajouter
quantité > 0  → stepper − N +
retour à 0    → suppression panier puis retour du bouton Ajouter
```

Les renderers ne maintiennent aucun état concurrent.

Le side cart desktop reste la confirmation de ce qui a été ajouté. Le configurateur affiche seulement la sélection en cours avant ajout.

## 10. Invariants d'implémentation

- Un seul contrat Product Detail par ouverture.
- Un seul état de sélection partagé.
- Une zone DOM possède un owner explicite.
- Aucun déplacement de blocs par JavaScript selon le viewport.
- Aucun clonage fonctionnel des CTA.
- Aucun calcul local de prix, stock, livraison ou sous-total.
- Aucun conditionnement de la réassurance, du partage ou des suggestions à `hasEnrichedContent`.
- Variantes en flux naturel, `flex-wrap` ou grille auto, jamais dans une hauteur fixe tronquante.
- Un seul conteneur scrollable par composition produit.
- Aucune image sticky dans la fiche produit.
- Aucune hauteur copiée d'une maquette pour contraindre le contenu.
- Le desktop simple et enrichi partagent le même shell.
- Le mobile simple et enrichi partagent le même shell.
- Le configurateur est présent comme section sémantique distincte, même lorsqu'il se compacte.

## 11. Gouvernance

> **Un nouvel état visuel ne doit jamais créer un nouveau contrat Product Detail sans justification fonctionnelle explicite.**

Toute évolution doit vérifier :

1. qu'elle exprime une capacité produit ou une composition responsive ;
2. qu'elle ne duplique pas le markup ou l'état métier ;
3. qu'elle reste compatible avec les quatre états ;
4. qu'elle conserve les audits ownership/layout et les tests unitaires au vert ;
5. qu'elle ne réintroduit ni scroll imbriqué, ni compensation viewport fragile.

## 12. Critères d'acceptation

- Les quatre états sont rendables depuis le même contrat.
- Desktop simple et enrichi utilisent le même scroll et le même shell.
- Mobile simple et enrichi utilisent le même scroll et le même shell.
- Le hero desktop contient galerie et récit produit.
- Le configurateur desktop couvre galerie + récit, sans empiéter sur le side cart.
- Le configurateur mobile est une section pleine largeur sous le résumé produit.
- Les détails longs viennent après le configurateur.
- Le side cart desktop reste indépendant.
- La barre d'action mobile ne masque aucun contenu sur Samsung Internet ou ailleurs.
- Aucune image produit ne reste fixe pendant que le contenu passe dessous.
- Les suggestions existent dans les quatre états lorsque fournies.
- Les cartes de suggestion utilisent `+` / stepper, jamais un panier miniature.
- Aucun texte de debug n'est visible.
