# Prompt d'exécution — modale produit canonique (Sonnet)

> Lire avant toute modification :
>
> 1. `public/boutique/docs/reference/PRODUCT_MODAL_REFERENCE_CANONICAL.md`
> 2. `public/boutique/docs/reference/reference-modale-4-etats.html`
> 3. `public/boutique/docs/reference/reference-modale-architecture.html`
> 4. `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`
> 5. `public/boutique/HANDOFF_MODALE_PROPRIETE_UNIQUE.md`

```text
RÔLE
Tu es l'agent d'exécution de la modale produit Komerce dans public/boutique.
Tu n'inventes pas une nouvelle direction visuelle ou un nouveau contrat. Tu mets à jour
l'existant afin qu'il respecte la référence canonique Product Modal v2.1.

DÉCISION D'ARCHITECTURE
Il existe un seul Product Detail Contract, un seul état de sélection et deux axes :
- layout : desktop | mobile
- richesse : simple | enriched

La combinaison produit quatre rendus :
1. desktop simple
2. desktop enrichi
3. mobile simple
4. mobile enrichi

Ces quatre rendus ne sont jamais quatre composants ou quatre arbres DOM indépendants.
Les capacités activent des sections facultatives ; le responsive change la composition.

STRUCTURE SÉMANTIQUE ATTENDUE
ProductModal
├── ModalHeader
├── ProductMain
│   ├── ProductMedia
│   │   ├── GalleryRail / pagination facultatifs
│   │   └── MainMedia
│   ├── ProductInformation
│   │   ├── Identity / stock / price / delivery
│   │   ├── Variants facultatifs
│   │   ├── Description
│   │   ├── Actions
│   │   ├── Reassurance
│   │   └── Share
│   └── DesktopCartPanel — desktop uniquement
├── ProductRecommendations
└── MobileStickyActions — mobile uniquement

RÈGLES VISUELLES
- Desktop : grille médias | informations | panier.
- Le panier appartient au shell ; il n'est pas fixed hors de la modale.
- Les suggestions desktop occupent médias + informations, jamais la colonne panier.
- Mobile : composition verticale native, galerie tactile, panier dans le header.
- Ordre mobile : média → identité → stock → prix → livraison → variantes → description
  → réassurance → partage → suggestions → actions sticky.
- Le mobile enrichi est obligatoire.
- Une seule croix de fermeture.
- Une section absente disparaît sans vide, séparateur ou message technique.

SUGGESTIONS
- « Vous aimerez aussi » existe dans les quatre états quand des recommandations existent.
- Simple : le rail arrive plus tôt car le contenu produit est plus court ; rôle découverte.
- Enrichi : le même rail arrive après davantage d'informations ; rôle complément d'achat.
- La différence porte sur le contexte, pas sur l'existence ou sur un autre composant.
- Mobile : rail horizontal tactile, environ 1,6 à 2 cartes visibles.
- Cartes : image, nom, prix, promotion éventuelle, contrôle neutre + puis stepper − N +.
- Aucun petit panier sur les cartes.
- Le rail reste au-dessus de la barre sticky et possède un libellé accessible.

ÉTAT PANIER
quantité 0 : bouton Ajouter
quantité > 0 : stepper − N +
retour à 0 : removeFromCart puis retour du bouton Ajouter
Une seule source de vérité et aucun état concurrent entre renderers.

DONNÉES
Prix, ancien prix, remise, stock, disponibilité, média, sélection, livraison et sous-total
proviennent du contrat détail et de l'état partagé. Ne rien déduire localement.

INTERDITS
- Pas de quatre HTML indépendants.
- Pas de déplacement de blocs au JavaScript selon le viewport.
- Pas de clonage fonctionnel des CTA.
- Pas de conditionnement réassurance/partage/suggestions à hasEnrichedContent.
- Pas de hauteur fixe sur les zones de flux.
- Pas de placeholders ou textes de debug en production.
- Pas d'allow de complaisance pour contourner l'ownership.

ORACLES NON NÉGOCIABLES
cd public/boutique
npm run audit:modal-ownership
npm run audit:modal-layout
npm run test:unit

Lance les trois après chaque étape. Répare toute régression avant de poursuivre.

MISSION
1. Inspecte le référentiel et le DOM actuel avant modification.
2. Produis une matrice précise : existant / conforme / écart / action.
3. Conserve ce qui respecte déjà la référence.
4. Ajoute proprement le mobile enrichi sans créer un quatrième renderer autonome.
5. Aligne les suggestions des quatre états sur la règle canonique.
6. Aligne les cartes sur le contrôle + / stepper neutre.
7. Vérifie le panier desktop dans le shell et les actions sticky mobile.
8. Ajoute ou adapte les tests d'invariant nécessaires.
9. Fournis le diff, la liste des fichiers et les sorties des trois oracles.

CRITÈRES D'ACCEPTATION
- Quatre états rendables depuis le même contrat.
- Mobile enrichi présent.
- Suggestions desktop/mobile et simple/enrichi.
- Variantes avant description.
- Produit simple compact sans trous.
- Panier desktop structurel.
- Sticky mobile sans contenu masqué, y compris Samsung Internet et safe-area.
- Ownership = 0, layout = 0, tests unitaires verts.

Ne te déclare pas terminé sans preuves exécutables.
```
