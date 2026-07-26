# Référentiel canonique — modale produit Komerce

> **Version active** : Product Modal v3.0 — 2026-07-27

Ce dossier fixe la référence visuelle et compositionnelle de la modale produit Boutique.

## Ordre de lecture

1. `PRODUCT_MODAL_REFERENCE_CANONICAL.md` — règles normatives ;
2. `reference-modale-4-etats.html` — quatre rendus de référence ;
3. `reference-modale-architecture.html` — coque, scroll et responsabilités ;
4. `PROMPT_SONNET_MODALE.md` — prompt d'exécution contrôlé.

## Décision v3.0

```text
Desktop
Hero galerie | récit produit
        ↓
Configurateur transversal pleine largeur
        ↓
Détails
        ↓
Suggestions
        │
        └── side cart indépendant

Mobile
Header
  ↓
Contenu produit scrollable
  ↓
Actions primaires dans une ligne dédiée
```

Règles cardinales :

- le hero présente le produit ;
- le configurateur fait choisir ;
- le side cart desktop ou la barre mobile fait acheter ;
- simple et enrichi partagent le même shell ;
- la richesse produit ne change jamais le propriétaire du scroll ;
- aucune image sticky dans la fiche produit ;
- aucune compensation JavaScript de la barre d'action mobile ;
- le side cart desktop est conservé.

## Autorité

En cas de contradiction entre une ancienne capture, un commentaire de code ou une maquette antérieure et ce dossier, la version v3.0 de ce dossier prévaut pour la composition de la modale.

La vérité métier reste définie par :

- `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md` ;
- `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md` ;
- `public/boutique/js/view-models/modal-selection-model.js`.
