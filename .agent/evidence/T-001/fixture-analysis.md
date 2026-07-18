# T-001 — Analyse de la fixture

## Fixture identifiée

`public/boutique/tests/fixtures/golden-elite-pro-detail.js` — Golden Product
« Chaussure de football Elite Pro » (`GOLDEN-ELITE-PRO`).

C'est la seule fixture de contrat Product Detail v1 présente dans le repo
(`public/boutique/tests/fixtures/`) et elle est explicitement documentée comme
la sortie réelle et validée (Ajv, schema v1) de
`services/catalog-product-detail.js::getProductDetail()`.

## Classement

```json
"contract_version": "1",
"inventory_model": "SKU",
```

→ **Classée `SKU`**, pas `LEGACY_VARIANTS`.

Référence doctrine (`docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`) :

- `inventory_model = 'SKU'` : `sellable_units` vient de `product_skus` — sélection
  transactionnelle par `sku_id`, ce qui correspond exactement au comportement
  attendu par `modal-selection-model.js` et aux renderers PDC (`b-modal-mobile-product.js`,
  `b-modal-desktop-product.js`).
- `inventory_model = LEGACY_VARIANTS` est un mode distinct où PDC-3 ne doit
  *jamais* prétendre disposer d'une sélection SKU autoritaire — non applicable
  ici.

## Conséquence pour M2/M3

Les sélecteurs Couleur (M2) et Taille (M3) mobiles s'appuient donc sur une
fixture en mode SKU réel : les groupes de variantes (`.k-vg`, `.k-vg-skus`,
`.k-vg-sizes`) rendus par `b-modal-mobile-product.js` peuvent être corrigés en
confiance sur cette base sans ambiguïté de contrat (pas de Cas legacy à gérer
en parallèle pour ce produit de référence).

## Utilisation

Consommée par `tests/unit/golden-product-selection-gpm3.test.js` (sélection
pure, sans DOM/fetch) et `tests/unit/golden-product-content-render.test.js`
(rendu du contenu enrichi mobile/desktop).

## Divergence notée

Les chemins normatifs référencés dans `.agent/CHANTIER.md` —
`02_SPECS_SOURCE_DE_VERITE/pdp-mobile-spec.md`,
`02_SPECS_SOURCE_DE_VERITE/pdp-desktop-spec.md`,
`04_VALIDATION_ET_PREUVES/RAPPORT_VALIDATION_CORRECTIF_FINAL.md` — n'existent
pas à la racine du repo. Ils existent uniquement dans l'archive
`.agent/sources/archives/KOMERCE_PDP_LIVRABLE_UNIQUE_2026-07-18.zip`
(sous `02_SPECS_SOURCE_DE_VERITE/` et `04_VALIDATION_ET_PREUVES/`). Consultés
depuis cette archive pour le préflight (extraction temporaire hors repo, non
committée). Signalé ici plutôt que corrigé silencieusement (AGENTS.md §8) ;
pas de décision prise sur une éventuelle extraction définitive de l'archive
dans le repo — hors périmètre T-001.
