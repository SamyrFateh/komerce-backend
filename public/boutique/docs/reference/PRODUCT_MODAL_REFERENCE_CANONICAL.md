# Modale produit — référence canonique

> **Version** : 3.1 — 2026-08-13
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

> **Le hero présente et permet de configurer. Le panier ou la barre d'action confirme et fait acheter.**

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
│   │   │   └── ProductBuyBox
│   │   │       ├── ProductIdentity
│   │   │       ├── ProductPrice
│   │   │       ├── ProductSummary
│   │   │       ├── ProductVariants              facultatif
│   │   │       ├── StockStatus
│   │   │       ├── DeliveryPromise
│   │   │       ├── QuantitySelector
│   │   │       ├── DesktopPrimaryActions        desktop uniquement
│   │   │       ├── Reassurance
│   │   │       └── ShareActions
│   │   ├── ProductDetails                       facultatif
│   │   └── ProductRecommendations               facultatif
│   └── DesktopCartPanel                         desktop uniquement
└── MobilePrimaryActions                         mobile uniquement
```

Le contrat métier et l'état de sélection restent uniques.

Le responsive change uniquement la composition :

- desktop : `ProductMedia | ProductBuyBox` dans le hero ;
- mobile : les mêmes capacités sont recomposées en flux vertical ;
- aucun axe de variante n'appartient exclusivement à une surface ;
- aucun renderer ne recrée localement prix, stock, média ou disponibilité.

Le `ProductBuyBox` constitue la zone transactionnelle de décision rapide. Il contient les informations nécessaires pour comprendre, configurer et acheter le produit sans navigation intermédiaire.

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
│ ProductMedia | ProductBuyBox                  │ Articles         │
│                                               │ Quantités        │
│ ProductDetails                                │ Sous-total       │
│                                               │ Commander        │
│ Suggestions                                   │                  │
└───────────────────────────────────────────────┴──────────────────┘
```

Le side cart appartient au shell de la modale, reste indépendant de la zone produit et conserve son propre flux interne si nécessaire.

La zone produit possède un seul scroll vertical. Le hero, les détails et les suggestions appartiennent à ce même flux.

### 5.2 Hero desktop : média + buybox

Le hero desktop utilise deux régions :

```text
PRODUCT MEDIA | PRODUCT BUYBOX
```

La colonne gauche est consacrée au produit visuel : image principale, galerie et miniatures lorsqu'elles existent.

La colonne droite constitue le cockpit d'achat.

Son ordre nominal est :

```text
Nom
Prix
Description courte

Axe 1
[options]

Axe 2
[options]

Axe N
[options]

Stock / disponibilité
Livraison
Quantité
Actions
Réassurance
Partage
```

La description courte provient de `content.short_description`.

Le renderer desktop ne fabrique jamais localement un résumé à partir des premiers caractères de la description longue.

La description longue, les caractéristiques, la composition, l'entretien, les avertissements et les guides appartiennent à `ProductDetails` sous le hero.

### 5.3 Variantes desktop : tous les axes visibles

Sur desktop, la sélection de variantes reste inline dans la buybox.

Il n'existe pas de stepper de navigation du type `étape 1/4`, ni de modale de sélection pour les axes produit ordinaires.

Chaque axe possède :

- un libellé explicite ;
- la valeur actuellement sélectionnée ;
- ses options visibles dans un flux naturel ;
- un état disponible, indisponible ou incompatible ;
- une géométrie indépendante du nombre total d'axes.

Les axes sont rendus dans l'ordre fourni par `option_axes[]`.

```text
Couleur · Vert
[●] [●] [●] [●]

Taille · M
[XS] [S] [M] [L] [XL]

Modèle · Premium
[Standard] [Premium]

Capacité · 256 Go
[128 Go] [256 Go] [512 Go]
```

Les valeurs courtes utilisent des contrôles à largeur naturelle avec retour à la ligne.

Les variantes visuelles utilisent des swatches ou miniatures lorsque le contrat fournit une représentation exploitable.

Un produit peut exposer 0, 1 ou N axes sans changer de shell.

Un axe contenant beaucoup de valeurs peut être compacté avec une action locale telle que `Voir toutes` ou `+ N options`.

Cette expansion reste dans le même bloc. Elle ne remplace jamais le configurateur par une navigation séquentielle.

Une option incompatible ou en rupture reste visible lorsque cela aide à comprendre l'offre. Son état est explicite et elle ne devient jamais une combinaison achetable.

La sélection utilisateur doit converger vers au plus un SKU achetable.

Lorsqu'un SKU unique est résolu, média, prix, stock, disponibilité et actions sont recalculés depuis le même état de sélection.

### 5.4 Résilience aux produits complexes

La composition desktop doit rester lisible avec un nombre élevé d'axes et de valeurs.

Le test de référence doit inclure un produit volontairement complexe comportant plusieurs axes, de nombreuses valeurs et un grand nombre de combinaisons SKU.

La croissance du configurateur se fait verticalement dans le flux naturel de la buybox.

Aucun axe n'impose une hauteur fixe au hero et aucun contenu ne peut être tronqué par une boîte à hauteur constante.

Le média conserve une présence forte, mais sa hauteur ne doit pas être obtenue en imposant artificiellement la hauteur d'un produit complexe à tous les produits.

### 5.5 Produit sans variante

Pour un produit sans variante :

- aucun sélecteur vide n'est rendu ;
- la buybox se compacte naturellement ;
- disponibilité, livraison, quantité et actions restent accessibles ;
- le média peut exploiter davantage d'espace sans créer de grand vide transactionnel.

Le shell reste identique.

### 5.6 Contenu détaillé desktop

`ProductDetails` commence immédiatement sous le hero.

La navigation de contenu peut exposer des entrées telles que :

```text
Description | Caractéristiques | Guide | Livraison
```

mais uniquement lorsque la donnée correspondante existe réellement.

Aucun onglet vide, placeholder ou hauteur réservée n'est autorisé.

La description longue constitue la section `Description`.

Les caractéristiques, matériaux, entretien, avertissements, guides et sections éditoriales sont dérivés du contenu canonique.

Le contenu actif commence immédiatement sous sa navigation, sans espace vertical artificiel.

Les suggestions arrivent ensuite et restent dans la zone produit, jamais dans le side cart.
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
- Variantes en flux naturel, contrôles à largeur naturelle, `flex-wrap` ou grille auto, jamais dans une hauteur fixe tronquante.
- Un seul conteneur scrollable par composition produit.
- Aucune image sticky dans la fiche produit.
- Aucune hauteur copiée d'une maquette pour contraindre le contenu.
- Le desktop simple et enrichi partagent le même shell.
- Le mobile simple et enrichi partagent le même shell.
- Le configurateur est une capacité sémantique unique : intégré à la buybox desktop et recomposé dans le flux mobile.

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
- Le hero desktop contient ProductMedia et ProductBuyBox.
- Le configurateur desktop est intégré à ProductBuyBox ; tous les axes sont visibles sans navigation séquentielle.
- Le configurateur mobile est une section pleine largeur sous le résumé produit.
- Les détails longs commencent immédiatement sous le hero.
- Le side cart desktop reste indépendant.
- La barre d'action mobile ne masque aucun contenu sur Samsung Internet ou ailleurs.
- Aucune image produit ne reste fixe pendant que le contenu passe dessous.
- Les suggestions existent dans les quatre états lorsque fournies.
- Les cartes de suggestion utilisent `+` / stepper, jamais un panier miniature.
- Aucun texte de debug n'est visible.
