# Boutique Komerce - Architecture de reference

Ce document est le point d'entree obligatoire avant toute modification de la Boutique.

Il absorbe les anciens documents de travail sur la sequence de chargement et l'ownership des composants. Il doit rester le seul document canonique pour l'architecture Boutique.

## Regle principale

Un composant = une verite.

Toute PR qui touche la Boutique doit identifier le fichier proprietaire du composant modifie et expliquer pourquoi ce fichier est le bon endroit.

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
| Modal produit | public/boutique/js/b-modal.js |
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

## Regles CSS

Les chips categories mobile appartiennent a categories.css.
Les chips categories desktop et le mega-nav appartiennent a boutique-desktop.css.
La grille produit et les cartes de base appartiennent a products.css.
Les enrichissements desktop de carte appartiennent a desktop-commerce-skeleton.css.

Un fichier charge tard ne doit pas voler l'ownership d'un composant possede par un fichier charge plus tot.

## Regles JS

shop-schema.js porte les donnees de categories.
render-categories.js produit le markup des chips.
home-controller.js orchestre le rail, les clics et l'etat actif.
b-pager.js possede le pager mobile.
b-catalog.js charge les produits et coordonne les renderers.
render-product-card.js rend la carte produit.

## Mobile pager

Le mobile repose sur le contrat suivant : hero fixe, sticky bar categories, page scroll dedie, b-pager.js pour les variables de pager et la synchronisation.

Il est interdit de reparer une superposition mobile en remettant brutalement le hero ou le catalogue dans le flux normal.

## Desktop

Le desktop peut ameliorer le hero, la grille, le mega-nav, le rail contextuel, le side-cart et les sous-categories sticky.

Il ne doit pas modifier le moteur mobile pager ni les variables gerees par b-pager.js.

## Corrections deja actees

Les conflits d'ownership identifies dans les audits initiaux ont ete traites par les corrections recentes de la Boutique : rail contextuel desktop restaure, side-cart mieux aligne, rails categories desktop polis.

Ce document ne maintient donc pas une liste d'anomalies ouvertes. Il fixe la regle d'architecture a respecter apres correction.

## Checklist avant PR Boutique

- Le fichier modifie est bien proprietaire du probleme traite.
- Aucune seconde source de verite n'a ete creee.
- Le mobile pager n'est pas casse.
- Le desktop n'a pas recu de hack mobile.
- Le rail categories reste pilote par shop-schema, render-categories et home-controller.
- Les cartes produit restent pilotees par render-product-card.
- Aucune regle k-chip ou k-cats n'a ete ajoutee hors owner.
- Aucune regle k-grid ou k-card de base n'a ete dupliquee hors products.css.
