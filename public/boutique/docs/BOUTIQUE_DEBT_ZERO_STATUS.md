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

- [x] `gen-boutique-arch-live.js` dépend directement de `css-bundles.js`.
- [x] Le générateur est importable sans écrire implicitement le document LIVE.
- [x] Test de non-régression : chaque source CSS sur disque doit être déclarée dans `BUNDLES` et aucune source déclarée ne doit manquer.
- [x] PR #988 : Boutique source gates verts, tests ciblés verts, arbre non muté, Required verdict vert.
- [x] PR #988 mergée sur `main` — commit `182788870b744af9dfe050d21f0021f6c492c5b9`.
- [ ] Régénération puis commit du document LIVE fiable.
- [ ] Alignement de `BOUTIQUE_ARCHITECTURE.md` sur l'état réel 2026-08.

## B1 — Dette simple

### Assets

- `hero_banner.png` : aucune référence vivante retrouvée ; entrée de baseline devenue périmée, à retirer lors du refigeage.
- `og-cover.jpg` : référence vivante dans `index.html` (`meta[property=og:image]`) mais fichier absent de `public/images` ; vraie dette fonctionnelle de partage social.
- Ne pas fabriquer `og-cover.jpg` en copiant un PNG/WebP sous une fausse extension. Corriger avec un asset réel ou une référence canonique dont le format/Content-Type restent cohérents.

### À poursuivre

- [ ] classifier les 9 `!important` par nécessité réelle ;
- [ ] vérifier la baseline assets sur le gate réel puis la ramener à l'étiage ;
- [ ] examiner l'audit dépendances du workspace Boutique ;
- [ ] recalculer ensuite les 211 conflits cascade et 87 conflits spécificité sur la vérité B0 corrigée.

Ce fichier est un ledger de chantier, pas une nouvelle baseline. Les cliquets existants restent les guards exécutables jusqu'à leur remboursement explicite.
