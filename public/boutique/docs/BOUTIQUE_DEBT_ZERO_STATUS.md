# Boutique Debt Zero — Status

## Baseline de départ

État observé avant reprise complète :

- `boutique:audit` : 0 violation ;
- breakpoints : 0 ;
- Boutique 360 : orphan emit/listen = 0, undeclared = 0 ;
- `!important` : 9 ;
- assets manquants suivis : 2 ;
- conflits de cascade suivis par baseline : 211 ;
- conflits de spécificité suivis par baseline : 87 ;
- Architecture LIVE : faux diagnostic historique de 30 CSS orphelins, dû au parsing du wrapper `bundle-css.js` au lieu de la source canonique `css-bundles.js`.

## B0 — Vérité instrumentée

- [x] Branche dédiée `refactor/boutique-debt-zero`.
- [x] `gen-boutique-arch-live.js` dépend directement de `css-bundles.js`.
- [x] Le générateur est importable sans écrire implicitement le document LIVE.
- [x] Test de non-régression : chaque source CSS sur disque doit être déclarée dans `BUNDLES` et aucune source déclarée ne doit manquer.
- [x] Preuve CI draft #987 : Boutique source gates verts, tests ciblés verts, arbre non muté, Required verdict vert.
- [ ] Required verdict de la PR mergeable #988.
- [ ] Régénération puis commit du document LIVE fiable.
- [ ] Alignement de `BOUTIQUE_ARCHITECTURE.md` sur l'état réel 2026-08.
- [ ] Recalcul de la dette CSS réelle avant B1/B2/B3.

Ce fichier est un ledger de chantier, pas une nouvelle baseline. Les cliquets existants restent les guards exécutables jusqu'à leur remboursement explicite.
