# T-001 — Rapport de préflight

Chantier : PDP mobile et desktop premium (`.agent/CHANTIER.md`)
Feature : `modal-product` (canonicalFeature `catalog`, `frontend-slice`)

## 1. Chargement des modules mobiles — Cas A/B

**Question posée par la tâche** : `b-mobile-modal-v1.js` et
`b-mobile-premium-v1.js` sont-ils chargés pour la PDP mobile ?

**Réponse : Cas B — aucun des deux n'est chargé pour la modal produit.**

Preuves (`grep-results.txt`) :

- Aucune occurrence de `b-mobile-modal-v1` ni `b-mobile-premium-v1` dans
  `public/boutique/index.html` ni dans les imports de
  `public/boutique/js/main.js`.
- Les seules références hors `coverage/` et `tests/` sont : le fichier lui-même,
  `public/boutique/features/boutique.feature.js` (déclaration de fichiers de la
  feature `boutique`, pas un import exécuté), et un commentaire JSDoc
  `@used-by` dans `b-bus.js` (documentation générée, pas du code exécuté).
- `main.js` charge la PDP via
  `import { setupProductDetailModal } from './b-modal-product-detail-bootstrap.js'`,
  qui déclare `@depends b-bus.js, b-store.js, b-modal-mobile-product.js,
  b-modal-desktop-product.js, view-models/modal-selection-model.js` et importe
  effectivement `b-modal-mobile-product.js` / `b-modal-desktop-product.js`.

**Conclusion** : `b-mobile-modal-v1.js` et `b-mobile-premium-v1.js` sont du
code mort pour la PDP (feature `modal-product`) — ils appartiennent à une
autre feature (`boutique`, probablement accueil/catalogue) et ne doivent pas
être touchés par les tâches M1–M11 de ce chantier. Toute correction visuelle
mobile de la PDP doit cibler `b-modal-mobile-product.js` et les CSS déjà
alloués (`modal-mobile-canonical.css`, `modal-enriched-content.css`,
`modal-product.css`).

## 2. Owners confirmés

| Zone | Owner réel |
|---|---|
| Sélecteur Couleur mobile (M2) | `b-modal-mobile-product.js` (`.k-vg`, `.k-vg-skus`) |
| Sélecteur Taille mobile (M3) | `b-modal-mobile-product.js` (`.k-vg`, `.k-vg-sizes`) |
| Pill stock mobile (M1) | `b-modal-mobile-product.js` (`.k-mdm-info-strip`, `.k-mdm-chip--ok`) + styles dans `modal-mobile-canonical.css` |
| Contenu enrichi mobile/desktop | `modal-enriched-content.css` (owner déclaré `modal-product`, chargé après `modal-mobile-canonical.css` et `modal-product.css` dans le bundle `components.css`) |

`modal-mobile-canonical.css` et `modal-enriched-content.css` déclarent tous
deux `@owner modal-product` dans leur en-tête `@komerce-arch-lite` — cohérent
avec la carte `modal-product.feature.js`.

## 3. Fixture

Voir `fixture-analysis.md`. Classée **SKU** (`golden-elite-pro-detail.js`,
`inventory_model: "SKU"`), pas `LEGACY_VARIANTS`.

## 4. `.agent/GENERATED_OUTPUTS.json` — sorties réelles confirmées

Sortie réelle de `npm --prefix public/boutique run check:cache`
(`node scripts/deploy-css.js --dry`) : 3 bundles compilés dans `css/dist/`
(`base.css`, `components.css`, `desktop.css`) + hash comparé à
`.cache-buster-state.json` à la racine de `public/boutique/`. Aucun `.map`
généré. `event.css` existe aussi dans `css/dist/` bien que non mentionné par
`check:cache --dry` dans ce run (4ᵉ bundle, cf. `check:cache-buster.js`).

Écarts constatés avec les patterns déclarés avant correction :

- `public/boutique/dist/**` — chemin inexistant (le vrai dossier est
  `public/boutique/css/dist/`).
- `public/boutique/css/components.css` et `.css.map` — chemin inexistant (le
  fichier réel est `public/boutique/css/dist/components.css`, sans `.map`).
- `public/boutique/sw.js` et `public/boutique/service-worker.js` — n'existent
  nulle part dans le repo.
- `public/boutique/js/dist/**` (bundle JS + `.bundle-state.json` + `chunks/`)
  existe réellement mais n'était couvert par aucun pattern. Non ajouté ici :
  aucun script `deploy-css`/`check:cache` ne le régénère, et la tâche T-001 ne
  demande de confirmer que les sorties CSS/cache-buster. **Flag pour revue** :
  ownership de la régénération de `js/dist/` non déterminé à ce stade — à
  traiter par une tâche dédiée ou une décision ADR si un correctif futur doit
  toucher au bundle JS.

`.agent/GENERATED_OUTPUTS.json` mis à jour en conséquence dans ce commit
(patterns corrigés vers `public/boutique/css/dist/**`, retrait des patterns
inexistants ; `js/dist/**` volontairement laissé hors périmètre, voir flag
ci-dessus).

## 5. Gates exécutés

```text
npm --prefix public/boutique run check:imports   → PASS (0 import fantôme, 0 cycle, 0 module manquant)
npm --prefix public/boutique run audit:ownership → PASS (docs/BOUTIQUE_OWNERSHIP_LIVE.md régénéré, aucun diff vs. committé)
npm --prefix public/boutique run check:cache     → PASS (dry-run, 3 bundles identiques, aucun changement)
```

## 6. Critères d'acceptation

- [x] Conclusion explicite sur le chargement des deux modules (Cas B — non chargés).
- [x] Owners des sélecteurs Couleur, Taille, stock et contenu enrichi identifiés.
- [x] Fixture classée (SKU).
- [x] Fichiers générés réellement commités listés / corrigés dans `GENERATED_OUTPUTS.json`.
- [x] Aucune correction visuelle introduite pendant ce préflight (aucun fichier
      CSS/JS applicatif modifié — seuls `.agent/GENERATED_OUTPUTS.json` et les
      preuves `.agent/evidence/T-001/` ont été produits).

## 7. Divergences signalées (non corrigées silencieusement, AGENTS.md §8)

- `02_SPECS_SOURCE_DE_VERITE/**` et `04_VALIDATION_ET_PREUVES/**` référencés
  par `.agent/CHANTIER.md` n'existent pas à la racine du repo ; disponibles
  uniquement dans l'archive `.agent/sources/archives/KOMERCE_PDP_LIVRABLE_UNIQUE_2026-07-18.zip`.
  Aucune décision prise ici sur une extraction définitive — hors périmètre T-001.
- Ownership de régénération de `public/boutique/js/dist/**` non déterminé
  (voir §4).

## 8. Prochaine action

T-001 → passage en `REVIEW` (jamais `DONE` directement, cf. règle de sortie de
la tâche et CHARTER §11). Une fois approuvée, elle débloque M2 et M3
(`T-003`, `T-004`) ainsi que toute tâche s'appuyant sur un ownership CSS
confirmé.
