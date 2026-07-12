# Boutique Komerce - Architecture de reference

Ce document est le point d'entree obligatoire avant toute modification de la Boutique.

Il absorbe les anciens documents de travail sur la sequence de chargement et l'ownership des composants. Il doit rester le seul document canonique pour l'architecture Boutique.

Pour la frontière produit enrichi → fiche produit, lire également `../doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`. Cette doctrine définit les responsabilités entre raffinerie, moteurs métier, contrat détail et modal ; le présent document reste l'autorité Boutique sur l'ownership du rendu.

## Regle principale

Un composant = une verite.

Toute PR qui touche la Boutique doit identifier le fichier proprietaire du composant modifie et expliquer pourquoi ce fichier est le bon endroit.

Pour la modal produit : **une intelligence produit, deux compositions responsive**. Mobile et desktop consomment le meme contrat détail et le meme etat de selection ; ils peuvent composer l'interface differemment, jamais recalculer deux fois stock, prix ou livraison.

## Zones sensibles

- schema categories
- rendu rail categories
- orchestration accueil
- catalogue
- pager mobile
- modal produit
- panier
- styles categories
- hero mobile
- grille et cartes produit
- desktop premium

## Sequence de chargement

1. CSS statique charge dans l'ordre du head.
2. Script inline body execute immediatement au parse.
3. komerce-api.js charge avant les modules applicatifs.
4. main.js type module orchestre les imports ES.
5. DOMContentLoaded lance init dans boutique.js.
6. La suite desktop ne s'execute que sur ecran desktop.

## Ordre init boutique.js a preserver

1. initDom
2. installScrollOwner
3. updateCartBadge
4. setupCats
5. setupCatSwipeNav
6. setupSearch
7. setupModal
8. setupDrawer
9. setupBnav
10. setupInfiniteScroll
11. initFlatSubcat
12. setupFooterLinks
13. loadProducts
14. loadRelais

Regle critique : setupCats doit rester avant loadProducts.

## Ownership des composants

| Zone | Owner |
|---|---|
| Schema categories | public/boutique/js/shop-schema.js |
| Markup rail categories | public/boutique/js/render/render-categories.js |
| Orchestration accueil | public/boutique/js/controllers/home-controller.js |
| Catalogue | public/boutique/js/b-catalog.js |
| Pager mobile | public/boutique/js/b-pager.js |
| Sous-categories mobile | public/boutique/js/b-subcat.js |
| Sections home | public/boutique/js/render/render-home-sections.js |
| Carte produit | public/boutique/js/render/render-product-card.js |
| Panier | public/boutique/js/b-cart.js et modules cart |
| Facade modal publique | public/boutique/js/b-modal.js |
| Cycle modal / fetch / open-close | public/boutique/js/b-modal-core.js |
| Contrat d'affichage + etat de selection produit | public/boutique/js/view-models/modal-view-model.js ou son remplacement explicitement acté par la doctrine produit detail |
| Rendu contenu fiche produit | public/boutique/js/b-modal-product.js |
| Media / carousel / fullscreen | public/boutique/js/b-modal-image-ux.js |
| Composition et enrichissements desktop | public/boutique/js/b-modal-desktop-enhancers.js — layout/enrichissement seulement, jamais moteur stock/prix/livraison |
| Chips mobile et base | public/boutique/css/categories.css |
| Hero mobile et base | public/boutique/css/hero.css |
| Grille et cartes base | public/boutique/css/products.css |
| Desktop premium et mega-nav | public/boutique/css/boutique-desktop.css |
| Enrichissements cartes desktop | public/boutique/css/desktop-commerce-skeleton.css |
| Mini-cart et acces panier | module cart dedie |

## Interdictions

- creer une seconde source de verite
- dupliquer le rendu d'un composant
- compenser une erreur JS par du CSS au mauvais endroit
- compenser une erreur CSS par du JS au mauvais endroit
- casser le pager mobile
- appliquer un hack mobile au desktop
- ajouter des regles k-chip ou k-cats hors owner desktop
- dupliquer les regles k-grid ou k-card de base hors products.css
- faire lire les tables ou les champs de cuisine raffinerie directement par la modal
- recalculer la disponibilite couleur/taille dans un renderer mobile ou desktop
- coder une liste fixe Standard/Express ou un delai universel de livraison dans la Boutique
- laisser b-modal-desktop-enhancers.js devenir un second moteur de prix, stock ou livraison
- reutiliser la modal catalogue pour la fiche snapshot lecture seule du panier partage

## Regles CSS

Les chips categories mobile appartiennent a categories.css.
Les chips categories desktop et le mega-nav appartiennent a boutique-desktop.css.
La grille produit et les cartes de base appartiennent a products.css.
Les enrichissements desktop de carte appartiennent a desktop-commerce-skeleton.css.

La modal produit utilise ses owners `modal-shell.css`, `modal-media.css`, `modal-product.css` et l'extension desktop declaree. Un comportement metier ne doit jamais etre corrige par une classe CSS conditionnelle inventant une disponibilite ou une livraison.

Un fichier charge tard ne doit pas voler l'ownership d'un composant possede par un fichier charge plus tot.

## Regles JS

shop-schema.js porte les donnees de categories.
render-categories.js produit le markup des chips.
home-controller.js orchestre le rail, les clics et l'etat actif.
b-pager.js possede le pager mobile.
b-catalog.js charge les produits et coordonne les renderers.
render-product-card.js rend la carte produit.

Pour la modal produit :

```text
contrat detail produit
        ↓
etat de selection unique
        ↓
renderers modal
        ↓
composition mobile / desktop
```

`b-modal-core.js` orchestre le cycle et le chargement. Il ne doit pas rester durablement un renderer parallele des champs metier.

`b-modal-product.js` rend l'etat produit. Il ne possede pas la verite de stock ni la decision de rail.

`b-modal-desktop-enhancers.js` adapte la composition desktop. Une information deja resolue dans le contrat ou l'etat de selection ne doit pas y etre recalculee.

## Mobile pager

Le mobile repose sur le contrat suivant : hero fixe, sticky bar categories, page scroll dedie, b-pager.js pour les variables de pager et la synchronisation.

Il est interdit de reparer une superposition mobile en remettant brutalement le hero ou le catalogue dans le flux normal.

## Modal produit mobile

Le mobile est une fiche produit transactionnelle plein ecran : parcours vertical, galerie swipe, selection tactile, indisponibilite expliquee et actions visibles/sticky.

Les vignettes couleur utilisent les medias fournis par le contrat quand ils existent. La disponibilite d'une taille depend des unites vendables reelles restantes pour la selection courante, jamais d'un stock autonome de l'axe Taille.

## Desktop

Le desktop peut ameliorer le hero, la grille, le mega-nav, le rail contextuel, le side-cart et les sous-categories sticky.

Il ne doit pas modifier le moteur mobile pager ni les variables gerees par b-pager.js.

Pour la modal, le desktop compose une galerie + Buy Box premium depuis le meme contrat detail et le meme etat de selection que le mobile. Le desktop n'est pas un mobile elargi ; il ne gagne pas pour autant le droit de recalculer les verites produit.

## Corrections deja actees

Les conflits d'ownership identifies dans les audits initiaux ont ete traites par les corrections recentes de la Boutique : rail contextuel desktop restaure, side-cart mieux aligne, rails categories desktop polis.

La frontiere produit detail du 2026-07-12 corrige une autre derive : le ViewModel modal existait mais le rendu continuait a lire le produit brut dans plusieurs modules. La doctrine `DOCTRINE_PRODUCT_DETAIL_CONTRACT.md` fixe la cible de convergence sans ajouter un second moteur produit.

Ce document ne maintient donc pas une liste d'anomalies ouvertes. Il fixe la regle d'architecture a respecter apres correction.

## Checklist avant PR Boutique

- Le fichier modifie est bien proprietaire du probleme traite.
- Aucune seconde source de verite n'a ete creee.
- Le mobile pager n'est pas casse.
- Le desktop n'a pas recu de hack mobile.
- Le rail categories reste pilote par shop-schema, render-categories et home-controller.
- Les cartes produit restent pilotees par render-product-card.
- La modal catalogue reste distincte de la fiche snapshot shared-cart.
- La selection SKU est possedee par un owner unique partage mobile/desktop.
- Aucun renderer n'invente un stock par axe.
- Aucun delai ou rail de livraison n'est code comme verite universelle dans le frontend.
- Aucune regle k-chip ou k-cats n'a ete ajoutee hors owner.
- Aucune regle k-grid ou k-card de base n'a ete dupliquee hors products.css.
