# Harnais géométrie — mesure navigateur réelle

Ces scripts mesurent la géométrie rendue **dans un vrai Chromium**, contre les
bundles `css/dist/*.css` et le markup réel extrait d'`index.html`. Ils ne
dépendent ni du backend, ni de la base, ni d'un serveur applicatif : ils
servent les CSS depuis le disque et injectent le markup.

Ils existent parce que les gates statiques (`css-guard`, `audit-modal-layout`,
`boutique:360`) valident la **structure et l'ownership**, jamais le **rendu**.
Les quatre bugs de l'audit 2026-07 sont tous passés au travers des gates.

## Prérequis

```bash
npm i -D playwright && npx playwright install chromium
```

## Scripts

| Script | Mesure | Bug d'origine |
|---|---|---|
| `verify-sticky.js` | Le hero de la modale reste-t-il épinglé pendant le scroll des variantes ? (1440 / 1024 / 950 px + cas produit court) | Hero sticky neutralisé par un double centrage vertical |
| `measure-hero.js` | Hauteur du hero home avec et sans `k-home-premium-v1`, à 4 viewports | Flash du hero desktop « en gros » au rafraîchissement |
| `verify-backtop-zindex.js` | `elementFromPoint()` au centre du bouton « retour en haut », modale ouverte | Bouton recouvert par l'overlay + classe CSS désalignée du JS |
| `triage-conflicts.js` | Valeur calculée réelle des conflits de cascade invariants | Tri dead-code vs bug réel |
| `repro-search-grid.js` | `_balancedPick()` sur une liste étroite (aucun navigateur requis) | Grille vide après une recherche |

```bash
node public/boutique/harnais/geometry/verify-sticky.js
```

## Règle de robustesse

`extract.js` récupère le markup par **marqueurs de contenu**, jamais par numéro
de ligne — `index.html` bouge à chaque `deploy-css` (bump du `?v=`) et une
extraction par index se casse silencieusement en produisant des mesures fausses.
Toute extension de ce harnais doit passer par `extract.js`.

## Interprétation

`verify-sticky.js` affiche les `top` de `.k-modal-img-wrap` à plusieurs seuils
de scroll. Un sticky fonctionnel plafonne à `0` et y reste ; un sticky neutralisé
décroît linéairement avec le scroll (`[509, 409, 309, 209]` = défilement 1:1).

**Piège connu**, à ne pas réapprendre : un centrage vertical d'item de grille peut
venir de `align-self: center` **ou** de `margin: auto`, et les deux agissent
indépendamment. Neutraliser une seule des deux ne change **rien** de mesurable —
c'est ce qui a fait conclure à tort à un bug Chromium sur `position: sticky` +
grille. Le gate `scripts/check-sticky-integrity.js` verrouille les deux ensemble.
