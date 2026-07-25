# Modale produit — référence canonique

> **Version** : 2.1 — 2026-07-25  
> **Statut** : référence normative de rendu  
> **Doctrine amont** : `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`  
> **Architecture** : `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`

## 1. Décision canonique

> **Un seul Product Detail Contract, un seul état de sélection, deux compositions responsive et quatre rendus de référence.**

Les quatre états résultent de deux axes indépendants :

| Richesse produit | Desktop | Mobile |
|---|---|---|
| Simple | Desktop simple | Mobile simple |
| Enrichi | Desktop enrichi | Mobile enrichi |

Ils ne constituent jamais quatre contrats ni quatre arbres DOM indépendants.

## 2. Structure sémantique unique

```text
ProductModal
├── ModalHeader
├── ProductMain
│   ├── ProductMedia
│   │   ├── GalleryRail                 facultatif
│   │   ├── MainMedia
│   │   ├── MediaPagination             facultatif
│   │   ├── PromotionBadge              facultatif
│   │   └── FavoriteAction              facultatif
│   ├── ProductInformation
│   │   ├── ProductIdentity
│   │   ├── StockStatus
│   │   ├── ProductPrice
│   │   ├── DeliveryPromise
│   │   ├── ProductVariants             facultatif
│   │   ├── ProductDescription
│   │   ├── DesktopPrimaryActions
│   │   ├── Reassurance
│   │   └── ShareActions
│   └── DesktopCartPanel                desktop uniquement
├── ProductRecommendations
└── MobileStickyActions                 mobile uniquement
```

Les capacités du produit activent ou retirent des sections. Elles ne sélectionnent pas un autre composant.

Attributs recommandés :

```html
<article
  class="k-product-modal"
  data-layout="mobile"
  data-richness="enriched"
  data-has-gallery="true"
  data-has-variants="true"
  data-has-promotion="true"
  data-has-recommendations="true">
```

## 3. Matrice des capacités

| Capacité | Simple | Enrichi |
|---|---:|---:|
| Image principale | Oui | Oui |
| Galerie | Non | Oui |
| Promotion | Facultative | Facultative |
| Variantes | Non | Oui |
| Description | Oui | Oui |
| Livraison | Oui | Oui |
| Réassurance | Oui | Oui |
| Partage | Oui | Oui |
| Suggestions | Oui | Oui |
| Panier latéral desktop | Oui | Oui |
| Actions sticky mobile | Oui | Oui |

Un produit simple se compacte naturellement. Une section absente ne laisse ni vide artificiel, ni séparateur inutile, ni message technique.

## 4. Composition desktop

La grille canonique est :

```text
médias | informations produit | panier
suggestions sur médias + informations | panier
```

Le panier appartient au shell de la modale. Il n'est jamais un élément `position: fixed` extérieur à celle-ci.

Ordre de lecture : média, identité, stock, prix, livraison, variantes éventuelles, description, actions, réassurance, partage, suggestions.

Le desktop simple conserve ce shell sans fabriquer une galerie ou des variantes inexistantes.

## 5. Composition mobile

Ordre canonique :

```text
Header
Média
Identité
Stock
Prix
Livraison
Variantes si disponibles
Description
Réassurance
Partage
Vous aimerez aussi
Barre d'actions sticky
```

Le mobile n'est pas un desktop rétréci. Le rail de miniatures devient une galerie tactile avec pagination. Le panier latéral disparaît ; son état reste visible dans le header.

> **Topbar mobile (REF-2026-07e)** — Sur mobile, la topbar occupe une zone de respiration distincte du média. Ses contrôles sont légers et ne forment pas de bandeau sombre. Le pager est une capsule unique. Le panier tressé est affiché sans pastille de fond.

La topbar est identique en mobile simple et mobile enrichi : la richesse produit ne change jamais le header. Le média ne se trouve pas sous la topbar au premier affichage — la topbar réserve sa propre place dans le flux (enfant flex du shell, avant le conteneur scrollable), jamais une compensation de padding ou une marge négative. L'état scrollé peut recevoir une surface translucide légère (jamais un fond gris, sombre, ou un overlay).

La barre sticky contient :

- `Ajouter` ;
- `Acheter maintenant`.

Elle respecte `env(safe-area-inset-bottom)` et ne masque jamais le contenu scrollable.

## 6. Mobile enrichi — état de référence

Le quatrième état ajoute au mobile simple :

- galerie tactile et pagination ;
- badge promotionnel et favori lorsqu'ils existent ;
- ancien prix et remise lorsqu'ils existent ;
- variantes avant la description ;
- mêmes engagements, partage et suggestions que le desktop enrichi.

Les options indisponibles sont désactivées, mais restent stables dans le layout. Aucune sélection, disponibilité, image, livraison ou tarification n'est inventée par le renderer.

## 7. Suggestions — règle commune

La section `Vous aimerez aussi` est présente dans les quatre états lorsque le contrat de recommandations retourne des éléments.

```html
<section class="k-product-recommendations"
         aria-labelledby="k-product-recommendations-title">
  <h2 id="k-product-recommendations-title">Vous aimerez aussi</h2>
  <div role="region" aria-label="Suggestions de produits">
    <!-- rail -->
  </div>
</section>
```

### Simple versus enrichi

La différence ne porte pas sur l'existence du bloc, mais sur son contexte :

| Règle | Produit simple | Produit enrichi |
|---|---|---|
| Présence | Oui | Oui |
| Position perçue | Plus tôt | Plus bas |
| Cause | contenu produit court | galerie, variantes et contenu plus dense |
| Rôle dominant | découverte | complément d'un achat déjà engagé |
| UI | rail compact | même rail compact et cohérent |

Les cartes de suggestion utilisent un contrôle neutre `+`, puis un stepper `− N +` après ajout. Elles n'affichent pas de petit panier.

Sur mobile, le rail est horizontal et tactile, avec environ 1,6 à 2 cartes visibles. Il demeure entièrement accessible au-dessus de la barre sticky.

## 8. Actions et état panier

Une seule logique métier pilote desktop et mobile :

```text
quantité = 0  → bouton Ajouter
quantité > 0  → stepper − N +
retour à 0    → suppression panier puis retour du bouton Ajouter
```

Les renderers ne maintiennent aucun état concurrent.

## 9. Invariants d'implémentation

- Un seul contrat Product Detail par ouverture.
- Un seul état de sélection partagé.
- Une zone DOM possède un owner explicite.
- Aucun déplacement de blocs par JavaScript selon le viewport.
- Aucun clonage fonctionnel des CTA.
- Aucun calcul local de prix, stock, livraison ou sous-total.
- Aucun conditionnement de la réassurance, du partage ou des suggestions à `hasEnrichedContent`.
- Variantes en flux naturel et `flex-wrap`, jamais dans une hauteur fixe tronquante.
- Un seul conteneur scrollable par composition.
- Pas de hauteurs fixes copiées depuis une maquette.

## 10. Gouvernance

> **Un nouvel état visuel ne doit jamais créer un nouveau contrat Product Detail sans justification fonctionnelle explicite.**

Toute évolution doit vérifier :

1. qu'elle exprime une capacité produit ou une composition responsive ;
2. qu'elle ne duplique pas le markup ou l'état métier ;
3. qu'elle reste compatible avec les quatre états ;
4. qu'elle conserve les audits ownership/layout et les tests unitaires au vert.

## 11. Critères d'acceptation

- Les quatre états sont rendables depuis le même contrat.
- Le mobile enrichi existe et suit l'ordre canonique.
- Les suggestions sont présentes sur desktop et mobile, simple et enrichi.
- Le panier desktop appartient au shell.
- La barre sticky mobile ne masque aucun contenu.
- Les variantes précèdent la description.
- Le produit simple se compacte sans placeholders.
- Les cartes de suggestion utilisent `+` / stepper, jamais un panier miniature.
- Aucun texte de debug n'est visible.
