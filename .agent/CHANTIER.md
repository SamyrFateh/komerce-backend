# CHANTIER — PDP Komerce conforme à la maquette premium

- Projet : Komerce
- Chantier : PDP mobile et desktop premium
- Statut : ouvert
- Mode d’exécution : agents séquentiels ou parallèles sur copies locales transférées par ZIP
- Référence longue archivée : `.agent/sources/CHANTIER_PDP_MAQUETTE_PREMIUM_ORIGINAL.md`

## Mission

Aligner la PDP mobile et desktop sur la maquette premium validée sans modifier
l’architecture, le Product Detail Contract, la state machine SKU, la logique panier
multi-variantes, les endpoints ou les sources de vérité transactionnelles.

## Features

- `catalog` — `features/catalog.feature.js`
- `modal-product` — `public/boutique/features/modal-product.feature.js`
- Domaine : `catalog`
- Slice : `frontend-slice`

## Références normatives

1. `AGENTS.md`
2. `docs/CARTE_FIRST_INDEX.md`
3. `features/catalog.feature.js`
4. `public/boutique/features/modal-product.feature.js`
5. `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`
6. `docs/boutique/BOUTIQUE_ARCHITECTURE.md`
7. `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`
8. `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md`
9. `docs/boutique/BOUTIQUE_CSS_PIPELINE.md`
10. `docs/BOUTIQUE_360.md`
11. `02_SPECS_SOURCE_DE_VERITE/pdp-mobile-spec.md`
12. `02_SPECS_SOURCE_DE_VERITE/pdp-desktop-spec.md`
13. `04_VALIDATION_ET_PREUVES/RAPPORT_VALIDATION_CORRECTIF_FINAL.md`

## Décisions définitives

### D-P1 — Desktop

- Désactiver sur la PDP : breadcrumb, trust badges, partage et récemment vus.
- Désactiver l’expérimentation Approche-C sur la PDP.
- Déplacer livraison et paiement sous les suggestions.
- Masquer le sous-total du sticky footer PDP.

### D-P2 — Favori

Retirer `.k-modal-fav-btn` du DOM initial de la PDP. Ne pas créer de flag de remplacement.

### D-P3 — Coral

Le coral est autorisé uniquement pour une promotion active
`.k-modal--has-promo` et pour le badge promotionnel dédié.

### D-P4 — Livraison du chantier

Trois vagues fonctionnelles : conformité stricte, responsive/états, finition premium.
Les tâches atomiques remplacent les trois commits monolithiques dans le travail
multi-agents ; l’intégrateur peut néanmoins produire trois commits de synthèse.

### D-P5 — Autonomie

Un agent n’escalade que pour : contradiction doctrinale, régression ambiguë,
ownership indéterminé ou décision produit absente.

## Invariants

- Un seul Product Detail Contract par ouverture.
- Un seul état de sélection partagé mobile/desktop.
- Aucun enhancer desktop ne calcule prix, stock, livraison ou sous-total.
- `b-modal-approche-c-hybrid` ne rend pas de donnée transactionnelle PDP.
- La product-zone desktop reste une grille avec `grid-template-columns`.
- L’image mobile conserve `min-height: 260px` et `flex: 0 0 auto`.
- « Voir en grand » reste ancré dans un wrapper `position: relative`.
- Les suggestions conservent l’événement `modal:suggestions-rendered`.
- Zéro `rgba(...)` littéral dans le scope modal-product.
- Sous-total et modes de paiement restent issus de `b-modal-buybox-shared.js`.
- Ne pas aggraver les cliquets bus 360, tokens, ownership ou feature audit.
- Ne pas régresser PDP-1 / PDP-2 du correctif final du 18 juillet.

## Hors périmètre

- Orchestration et cycle de vie de la modal.
- State machine SKU et contrat détail v1.
- Panier, `line_id`, endpoints et calculs transactionnels.
- Catalogue, hero d’accueil, catégories et panier partagé.
- Dette `b-modal-social-proof.js` / `modal:product-changed`.
- Refactor d’architecture.
- Édition directe de fichiers `dist/*.css`.

## Gates globaux

```text
npm --prefix public/boutique run deploy:css
npm --prefix public/boutique run check:cache
npm --prefix public/boutique run check:all
npm --prefix public/boutique run test:unit
npm run test:unit
npm run gate:feature-audit
npm run gate:boutique-ownership
npm run audit:features
npm run map:check
```

## Définition de terminé

- T-001 à T-030 sont `DONE`.
- Les 6 viewports et 6 états produit sont validés.
- Tous les gates sont verts.
- Les preuves avant/après sont déposées.
- `RAPPORT_CHANTIER_PDP_MAQUETTE_PREMIUM.md` est livré.
- Le ZIP final est vérifié par SHA-256.
