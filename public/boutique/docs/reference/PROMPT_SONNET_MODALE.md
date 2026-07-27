# Prompt d'exécution — modale produit canonique (Sonnet)

> Lire avant toute modification :
>
> 1. `public/boutique/docs/reference/PRODUCT_MODAL_REFERENCE_CANONICAL.md`
> 2. `public/boutique/docs/reference/reference-modale-4-etats.html`
> 3. `public/boutique/docs/reference/reference-modale-architecture.html`
> 4. `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`
> 5. `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`
> 6. `public/boutique/HANDOFF_MODALE_PROPRIETE_UNIQUE.md`

```text
RÔLE
Tu es l'agent d'exécution de la modale produit Komerce dans public/boutique.
Tu n'inventes ni une nouvelle direction visuelle ni un nouveau contrat.
Tu réalignes l'existant sur la référence canonique Product Modal v3.0.

DÉCISION D'ARCHITECTURE
Il existe :
- un seul Product Detail Contract ;
- un seul état de sélection ;
- deux compositions responsive : desktop | mobile ;
- deux niveaux de richesse : simple | enriched.

Les quatre rendus sont :
1. desktop simple ;
2. desktop enrichi ;
3. mobile simple ;
4. mobile enrichi.

Ces rendus ne sont jamais quatre contrats, quatre renderers métiers ou quatre arbres DOM indépendants.

PRINCIPE UX CANONIQUE
Le hero présente.
Le configurateur fait choisir.
Le side cart desktop ou la barre d'action mobile confirme et fait acheter.
Les détails longs viennent ensuite.

STRUCTURE SÉMANTIQUE ATTENDUE
ProductModal
├── ModalHeader
├── ProductViewport
│   ├── ProductScroll
│   │   ├── ProductHero
│   │   │   ├── ProductMedia
│   │   │   └── ProductNarrative
│   │   ├── ProductConfigurator
│   │   ├── ProductDetails facultatif
│   │   └── ProductRecommendations facultatif
│   └── DesktopCartPanel desktop uniquement
└── MobilePrimaryActions mobile uniquement

COMPOSITION DESKTOP
- Le shell contient une zone produit et le side cart.
- Le side cart reste indépendant et n'est pas déplacé dans le contenu produit.
- Le hero est une grille galerie | récit produit.
- Le récit produit contient identité, prix, stock, livraison, description courte,
  bénéfices essentiels, réassurance et partage.
- Les variantes ne restent pas tassées dans la colonne droite.
- Un configurateur transversal est placé immédiatement sous le hero.
- Le configurateur couvre galerie + récit produit et s'arrête avant le side cart.
- Les actions desktop appartiennent au configurateur.
- Les détails longs occupent ensuite toute la largeur de la zone produit.
- Les suggestions viennent après les détails et n'occupent jamais la colonne panier.

CONFIGURATEUR DESKTOP
- Une famille de variantes = un groupe explicitement libellé.
- Les groupes utilisent flex-wrap ou une grille auto.
- L'espace libre reste de la respiration ; ne pas agrandir artificiellement les contrôles.
- Les options indisponibles restent visibles et explicables.
- Le panneau affiche la sélection en cours, la disponibilité et la quantité.
- Ne pas y dupliquer le récapitulatif du side cart.
- Un produit sans variante conserve un panneau compact : disponibilité, quantité, actions.

COMPOSITION MOBILE
Le shell mobile possède exactement trois lignes :
HEADER
CONTENU SCROLLABLE
ACTIONS PRIMAIRES

Ordre du contenu :
- média ;
- identité / prix / livraison / résumé court ;
- configurateur pleine largeur ;
- détails structurés ;
- suggestions.

Le configurateur mobile reprend les mêmes axes que le desktop, empilés verticalement.
Les consignes sont explicites : « Choisissez une taille », « Sélectionnez une couleur »,
« 2 options à compléter ». Ne pas utiliser « Choisissez la suite ».

CONTRAT DE SCROLL
Desktop :
- header hors du scroll produit ;
- un seul conteneur vertical pour hero + configurateur + détails + suggestions ;
- aucune galerie sticky ou fixed ;
- side cart indépendant.

Mobile :
- header = première ligne du shell ;
- contenu = unique propriétaire du scroll ;
- actions = troisième ligne du shell ;
- aucune superposition des CTA sur le contenu ;
- aucune compensation JS de padding-bottom ou de hauteur viewport.

Invariant : la richesse produit ne change jamais le propriétaire du scroll.

SAMSUNG INTERNET
La correction doit supprimer la dépendance fonctionnelle entre :
- visualViewport.height ou une variable --k-vh ;
- la hauteur mesurée de la CTA ;
- un padding-bottom synchronisé par JavaScript.

La barre d'action mobile occupe une vraie ligne du layout et respecte :
padding-bottom: env(safe-area-inset-bottom).
Le contenu ne passe jamais dessous.

SUGGESTIONS
- Présentes dans les quatre états lorsque le contrat retourne des recommandations.
- Simple : arrivent plus tôt parce que le contenu est plus court.
- Enrichi : arrivent après le configurateur et les détails.
- Même composant dans les quatre états.
- Mobile : rail tactile horizontal, environ 1,6 à 2 cartes visibles.
- Cartes : contrôle neutre + puis stepper − N +.
- Aucun petit panier sur les cartes.

ÉTAT PANIER
quantité 0 : bouton Ajouter
quantité > 0 : stepper − N +
retour à 0 : removeFromCart puis retour du bouton Ajouter
Une seule source de vérité entre les renderers.

DONNÉES
Prix, ancien prix, remise, stock, disponibilité, média, sélection, livraison et sous-total
proviennent du contrat détail et de l'état partagé. Ne rien déduire localement.

INTERDITS
- Pas de quatre HTML runtime indépendants.
- Pas de déplacement de blocs au JavaScript selon le viewport.
- Pas de clonage fonctionnel des CTA.
- Pas de configurateur complet dans la colonne droite desktop.
- Pas d'image sticky ou fixed dans le contenu produit.
- Pas de scroll imbriqué dans les variantes ou les détails.
- Pas de hauteur fixe sur les zones de flux.
- Pas de compensation JS pour réserver la barre mobile.
- Pas de conditionnement réassurance/partage/suggestions à hasEnrichedContent.
- Pas de placeholders ou textes de debug en production.
- Pas d'allow de complaisance pour contourner l'ownership.

ORACLES NON NÉGOCIABLES
cd public/boutique
npm run audit:modal-ownership
npm run audit:modal-layout
npm run test:unit

Lance les trois après chaque étape. Répare toute régression avant de poursuivre.

MISSION
1. Inspecte les trois références canoniques et le DOM runtime avant modification.
2. Cartographie le propriétaire actuel du scroll desktop et mobile.
3. Produis une matrice existant / conforme / écart / action pour les quatre états.
4. Unifie le shell desktop simple et enrichi.
5. Crée le hero galerie | récit produit sans déplacer la vérité métier.
6. Déplace les variantes dans un configurateur transversal sous le hero.
7. Place les détails longs sous le configurateur en pleine largeur produit.
8. Conserve le side cart et son indépendance.
9. Unifie le shell mobile en trois lignes structurelles.
10. Supprime les compensations Samsung fragiles sans masquer le contenu.
11. Aligne les suggestions et les cartes + / stepper.
12. Ajoute ou adapte les tests d'invariant nécessaires.
13. Fournis le diff, la liste des fichiers et les sorties des trois oracles.

CRITÈRES D'ACCEPTATION
- Quatre états rendables depuis le même contrat.
- Même shell et même propriétaire de scroll entre simple et enrichi.
- Desktop : hero galerie | récit, puis configurateur transversal.
- Desktop : configurateur couvre les deux colonnes produit, jamais le side cart.
- Desktop : side cart conservé et indépendant.
- Mobile : header / scroll / actions sont trois lignes du shell.
- Mobile : configurateur pleine largeur sous le résumé produit.
- Mobile : aucun contenu masqué sur Samsung Internet et safe-area.
- Aucune image fixe pendant que le contenu passe dessous.
- Détails longs après le configurateur.
- Suggestions desktop/mobile et simple/enrichi.
- Ownership = 0, layout = 0, tests unitaires verts.

Ne te déclare pas terminé sans preuves exécutables.
```
