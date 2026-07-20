# T-019 — Méthode de capture

Même méthode que T-017/T-018/T-023 : harnais HTML statique (`harness.html`,
réutilisé depuis T-023 — même fragment DOM `.k-modal-product-zone`) qui charge
les bundles CSS compilés réels (`css/dist/*.css`, régénérés via `deploy:css`
avant capture).

## Fichier requis

- `desktop-zone.png` — zone produit complète (image + panneau détails) à
  1024px, aplats appliqués.

## Vérification complémentaire (au-delà de la capture visuelle)

`background-image` et `background-color` calculés via `getComputedStyle` dans
la page réelle (pas seulement lus depuis le CSS source) :

| Élément | background-image | background-color |
|---|---|---|
| `.k-modal-product-zone` | `none` | `rgb(253, 250, 245)` (= `--page-bg` / `--sand` #FDFAF5) |
| `.k-modal-details` | `none` | `rgb(253, 250, 245)` (= `--page-bg`) |
| `.k-modal-img-wrap` (hors périmètre, inchangé) | conserve son radial-gradient décoratif (D6, déjà approuvé) | `--hero-bg` (#FDFAF3) |

Aucun gradient de fond résiduel sur les deux zones du périmètre (product-zone,
panneau détails). Le hero (`.k-modal-img-wrap`) est explicitement hors
périmètre de T-019 (« Hero et sticky footer » en zone interdite) et conserve
son traitement D6 (radial-gradient décoratif sur `--hero-bg`, déjà en
production).

## Séparation des zones

`--page-bg` (#FDFAF5) et `--hero-bg` (#FDFAF3) sont deux jetons distincts,
très proches en valeur (héritage direct de D6, qui avait déjà rapproché le
ton du hero du fond de page). La séparation visuelle entre la zone image et
le panneau détails reste portée principalement par la photo produit
elle-même et non par un contraste de fond marqué — c'est le comportement
délibéré de la spec (§327 : aplat unique `var(--page-bg)`, cohérent avec le
fond de page hors modale). Aucune règle de bordure/ombre séparatrice
n'existait déjà à cet endroit avant T-019 ; aucune n'est retirée.

`capture.js` reproduit la capture (nécessite d'être copié temporairement dans
`public/boutique/` pour la résolution de `playwright-core` via
`node_modules`, comme pour T-017/T-018/T-023).
