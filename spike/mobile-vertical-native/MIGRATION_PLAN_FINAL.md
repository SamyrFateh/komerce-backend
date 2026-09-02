# PLAN FINAL ATOMIQUE — REPLACE TEMU

> **Décision architecturale proposée** : REPLACE TEMU (le vertical a gagné le
> rechallenge). Deux verrous avant migration : (1) smoke test sur déploiement
> réel avec backend, (2) absence de régression UX matérielle sur device (veto UX
> conditionnel — une préférence subjective pour le swipe ne suffit pas à bloquer).
>
> **Ce document est un PLAN. Rien n'est exécuté.** Le spike est frozen.
>
> **Règle impérative** : après migration, aucune branche Temu dormante. Pas de
> legacy « au cas où », pas de double shell, pas de flag permanent, pas d'ancien
> pager désactivé. Le rollback est Git, pas du dead code.

---

## Vue d'ensemble — ordre atomique

Les 18 étapes forment UNE PR unique (`refactor(mobile): replace Temu pager with
vertical native shell`) avec commits ordonnés. Chaque commit laisse la Boutique
fonctionnelle. Le merge bascule la prod d'un coup — aucune coexistence durable.

L'ordre respecte une règle : **on fige les invariants AVANT de retirer quoi que
ce soit** (étapes 1-2), **on retire les appelants AVANT les définitions**
(étapes 4-9), **on supprime le flag EN DERNIER** (étape 13) une fois que le
vertical est le seul chemin.

---

## ÉTAPE 1 — Figer les invariants fonctionnels par tests

**Fichiers** : nouveaux `tests/unit/mobile-navigation-invariants.test.js`,
`tests/unit/scroll-position-invariants.test.js`

**Dépendances** : aucune (première étape)

**Risque** : faible — on ajoute des tests, on n'en retire aucun

**Invariant protégé** : les 6 invariants Komerce mobiles —
1. changement catégorie (chip → section visible)
2. catégorie active synchronisée au scroll manuel
3. retour à une catégorie précédente possible
4. retour PDP à la position exacte (0px)
5. back navigateur exact (0px)
6. pas de scroll horizontal du catalogue

**Test de sortie** : les nouveaux tests passent sur le vertical (flag actif) ET
les anciens tests Temu restent verts (pager encore présent). Double couverture
temporaire volontaire.

**Code** : KEEP (ajout pur)

---

## ÉTAPE 2 — Convertir les tests Temu en tests d'invariants

**Fichiers** :
- `tests/unit/b-pager.test.js` (32 tests) → contenu réécrit vers invariants,
  renommé `mobile-navigation.test.js`
- `tests/unit/b-scroll-owner.test.js` (45 tests) → réécrit, renommé
  `scroll-position.test.js`

**Dépendances** : ÉTAPE 1 (les invariants doivent être définis)

**Risque** : moyen — ces tests protègent aujourd'hui la mécanique ; il faut
s'assurer qu'aucun invariant réel ne passe à la trappe pendant la conversion

**Invariant protégé** : tout ce que les anciens tests protégeaient de LÉGITIME
(position, navigation) est reporté ; ce qu'ils protégeaient d'ACCIDENTEL (cage,
`k-pager-active`, ghost loop, scrollLeft grid) est abandonné

**Test de sortie** : les tests convertis passent sur le vertical. Aucune
assertion sur `k-pager-active`, cage, `getMobileScrollContainer`.

**Code** :
- DELETE : assertions sur cage / `k-pager-active` / ghost / bounce / scrollLeft grid
- KEEP (converti) : assertions sur position, navigation catégorie, retour PDP

---

## ÉTAPE 3 — Ownership / gouvernance

**Fichiers** :
- `public/boutique/features/catalog.feature.js`
- `docs/BUSINESS_FEATURE_GRAPH.*`, `docs/FEATURE_360.*`, `docs/O6_INVENTORY.md`

**Dépendances** : ÉTAPE 2

**Risque** : faible — déclaratif

**Invariant protégé** : unicité d'autorité ; le graphe reste reconstructible

**Test de sortie** : `feature:registry` (0 orphelin, 0 multi-owner),
`business-graph:ratchet-check` (baseline inchangée), `feature:360:check`

**Code** :
- Promouvoir `spike-vertical-shell.js` → `mobile-vertical-navigation.js`
  (header full, plus de mention spike) déclaré owner canonique de la nav mobile
- Retirer `b-pager.js`, parties cage de `b-scroll-owner.js`, `spike-vertical-shell.css`
  des feature cards (au fur et à mesure des suppressions étapes 8-10)

---

## ÉTAPE 4 — Retrait des appelants pager

**Fichiers** : `b-nav.js` (5 refs), `b-cart.js` (3 refs), `hero-bootstrap.js` (7 refs)

**Dépendances** : ÉTAPE 1-2 (invariants figés)

**Risque** : moyen — ces modules touchent nav, panier, hero

**Invariant protégé** : panier ouvre/ferme, nav fonctionne, hero s'affiche

**Test de sortie** : tests cart, nav, invariants navigation verts

**Code** :
- DELETE dans `b-nav.js` : `classList.remove('k-pager-active')` (3 sites) devenus
  inutiles ; le guard pager de la nav
- DELETE dans `b-cart.js` : guard `k-pager-active` (le panier n'a plus à savoir
  si une cage existe)
- DELETE dans `hero-bootstrap.js` : recalc `--pager-top`, hooks stabilisation
  hero liés à la cage

---

## ÉTAPE 5 — Simplification b-catalog

**Fichiers** : `public/boutique/js/b-catalog.js` (31 refs pager)

**Dépendances** : ÉTAPE 4

**Risque** : ÉLEVÉ — c'est le cœur du montage catalogue ; le plus gros blast radius

**Invariant protégé** : le catalogue se rend, les catégories s'affichent en
sections verticales, le clic produit ouvre la PDP

**Test de sortie** : `b-catalog.test.js` (16 tests, adaptés), invariants
navigation + position, scénario Playwright dérive 0px

**Code** :
- DELETE : la branche `_isMobile && !isVerticalShell()` qui monte le pager
- DELETE : appels `_setupMobilePager`, `_setupInfiniteLoop`,
  `_setupSectionAutoAdvance`, `_recalcPagerVars`, `_scrollPagerToCat`,
  `destroyMobilePager`, pose de `k-pager-active` / `k-grid-cat-pager`
- KEEP : `renderHomeSections` (rend déjà les `.k-cat-section[data-cat]`),
  `_renderCard`, le chemin desktop
- Le mobile devient : rendre les sections + installer la nav verticale
  (IntersectionObserver + rail sticky). Un seul chemin.

---

## ÉTAPE 6 — Simplification b-nav

**Fichiers** : `public/boutique/js/b-nav.js`

**Dépendances** : ÉTAPE 5

**Risque** : moyen

**Invariant protégé** : navigation entre vues (Boutique / Suivi / Favoris /
Groupe) ; changement de catégorie

**Test de sortie** : tests nav, invariants navigation

**Code** :
- SIMPLIFY : les appels `getScrollY()`/`scrollToPosition()` deviennent
  `window.scrollY`/`window.scrollTo` (3 sites)
- DELETE : toute logique de reset cage au switch de vue

---

## ÉTAPE 7 — Simplification modal / scroll restore

**Fichiers** : `public/boutique/js/b-modal-core.js` (19 refs pager restore)

**Dépendances** : ÉTAPE 5

**Risque** : ÉLEVÉ — le retour PDP est l'invariant le plus visible

**Invariant protégé** : retour PDP à la position exacte (0px), back navigateur

**Test de sortie** : scénario Playwright (dérive PDP 0px, back 0px) + tests
modal-core-active-flows

**Code** :
- DELETE : `_savedPagerInlineStyles` + restauration des 10 styles inline (la cage
  n'existe plus)
- DELETE : `_savedGridScrollLeft` + restauration scrollLeft grid (pas de scroll
  horizontal en vertical)
- DELETE : flag `_closingFromPopstate` lié au double scroll-restore pager
- SIMPLIFY : `state._savedCatalogScrollY = getScrollY()` →
  `state._savedCatalogScrollY = window.scrollY` ; restauration →
  `window.scrollTo({top: state._savedCatalogScrollY})`
- KEEP : la logique d'ouverture/fermeture modale, le lock body scroll
  (`--modal-scroll-y`), les events `modal:opened/closed`

---

## ÉTAPE 8 — Suppression parties pager de b-scroll-owner

**Fichiers** : `public/boutique/js/b-scroll-owner.js` (225L)

**Dépendances** : ÉTAPES 5-7 (plus aucun appelant des fonctions cage)

**Risque** : moyen

**Invariant protégé** : scroll position (via window natif), wheel desktop

**Test de sortie** : scroll-position invariants, tests desktop enhancers

**Code** :
- DELETE : `getMobileScrollContainer()` (retournait la cage — plus de cage)
- DELETE : `ensureDesktopScrollOwner()` + guard rAF anti-race (nettoyait la cage)
- DELETE : `clearInlinePagerStyles()` (nettoyait les styles cage)
- SIMPLIFY : `getScrollY()` → supprimée, remplacée par `window.scrollY` chez les
  8 appelants ; idem `scrollToPosition`, `scrollPageToElement`, `scrollPageToTop`
  → `window.scrollTo`/`scrollIntoView` natifs
- **KEEP** : `isDesktop()` (utilisé par 22 modules — invariant transversal)
- **KEEP** : `installScrollOwner()` (wheel redirect desktop, indépendant du
  pager mobile) — à conserver, éventuellement déplacé dans `b-desktop-wheel.js`

Résultat : `b-scroll-owner.js` se réduit à `isDesktop()` + `installScrollOwner()`
(ou est scindé). ~150L supprimées, ~75L conservées.

---

## ÉTAPE 9 — Suppression b-pager

**Fichiers** : `public/boutique/js/b-pager.js` (565L)

**Dépendances** : ÉTAPE 5 (b-catalog n'appelle plus rien de b-pager)

**Risque** : faible (plus aucun appelant après étape 5)

**Invariant protégé** : aucun (le module devient réellement mort)

**Test de sortie** : `grep` confirme 0 import de `b-pager.js` ; suite complète verte

**Code** :
- DELETE : le fichier entier — ghost loop, bounce, recalc cage, mobile pager,
  section auto-advance, hooks stabilisation hero, double rAF `--pager-top`

---

## ÉTAPE 10 — Suppression CSS cage / --pager-* / ghost / bounce

**Fichiers** : `public/boutique/css/layout.css` (6 marqueurs cage),
`products.css`, `categories.css`

**Dépendances** : ÉTAPES 5, 9 (plus rien ne pose les classes)

**Risque** : moyen — CSS structurel, risque de casser un layout adjacent

**Invariant protégé** : rendu visuel du catalogue, footer visible, pas de fuite
horizontale

**Test de sortie** : `css:guard`, `css:specificity-guard`, build CSS, tests
visuels Playwright

**Code** :
- DELETE : `.k-pager-active` + cage `position:fixed`, masquage footer
  (`FIX-FOOTER-PAGER`), `overflow:hidden` body lié pager, vars
  `--pager-top/-h/-w`, `.k-grid-cat-pager`, parties `.k-grid-flat-subcat` liées
  au pager
- Promouvoir les règles de `spike-vertical-shell.css` (rail sticky, sections
  verticales) dans `layout.css`/`products.css`, sans préfixe spike

---

## ÉTAPE 11 — Installation définitive rail sticky + IntersectionObserver

**Fichiers** : `mobile-vertical-navigation.js` (ex-`spike-vertical-shell.js`
promu), `layout.css`

**Dépendances** : ÉTAPES 5, 10

**Risque** : faible (déjà prouvé par le spike)

**Invariant protégé** : navigation catégorie, catégorie active au scroll

**Test de sortie** : invariants navigation, scénario Playwright

**Code** :
- KEEP (promu de spike) : `isVerticalShell` retiré (voir étape 13),
  IntersectionObserver de catégorie active, navigation chip → scrollIntoView,
  rail sticky
- DELETE : l'instrumentation HUD, `spikeSnapshot`, `spikeMarkBeforeModal`,
  `spikeMeasureAfterModal` (outils de spike, pas de prod)

---

## ÉTAPE 12 — Intégration native Discovery

**Fichiers** : `public/boutique/js/discovery-rail.js`

**Dépendances** : ÉTAPE 5 (le flux vertical existe)

**Risque** : faible

**Invariant protégé** : « Près de vous » s'affiche dans le flux, les 3 kinds
fonctionnent, clic → modale

**Test de sortie** : `discovery-rail.test.js`, scénario Playwright (étape
discovery)

**Code** :
- SIMPLIFY : `ensureMount()` insère déjà avant le catalogue — en vertical c'est
  une simple section dans le flux, aucun montage spécial. Retirer toute
  éventuelle logique liée à la cage.
- KEEP : le composer, le renderer, l'inquiry flow (inchangés)

---

## ÉTAPE 13 — Suppression du flag ?shell=vertical

**Fichiers** : `b-catalog.js`, `boutique.js`, `mobile-vertical-navigation.js`

**Dépendances** : ÉTAPES 5-12 (le vertical est le seul chemin)

**Risque** : faible

**Invariant protégé** : aucun comportement conditionnel ne subsiste

**Test de sortie** : `grep` confirme 0 occurrence de `isVerticalShell`,
`?shell=vertical`, `spike-shell-vertical` dans le code de prod

**Code** :
- DELETE : `isVerticalShell()` et toutes ses gardes
- DELETE : l'injection dynamique du CSS spike (le CSS est dans le bundle)
- DELETE : la classe `spike-shell-vertical` (le CSS s'applique inconditionnellement)

---

## ÉTAPE 14 — Suppression instrumentation et harness spike

**Fichiers** : `spike/mobile-vertical-native/` (entier),
`tests/e2e/spike-vertical-shell.spec.js`, `tests/unit/spike-vertical-shell.test.js`

**Dépendances** : ÉTAPES 11, 13

**Risque** : faible

**Invariant protégé** : aucun (nettoyage)

**Test de sortie** : `gate:touched-files` (0 fichier spike orphelin)

**Code** :
- DELETE : harness.html, shell.js, shell.css, data.js, measure.js,
  dead-code-analysis.js, preview-server.js, scenario-run.js, tous les .md de spike
- KEEP (archivé) : METRICS.md + SCENARIO_RESULTS.json + verdict → déplacés dans
  `docs/decisions/ADR-REPLACE-TEMU.md` (trace décisionnelle, pas du code)

---

## ÉTAPE 15 — Convertir Playwright A→B en tests B permanents

**Fichiers** : nouveau `tests/e2e/mobile-vertical-navigation.spec.js`

**Dépendances** : ÉTAPES 11, 13, 14

**Risque** : faible

**Invariant protégé** : les invariants de navigation en e2e permanents

**Test de sortie** : le spec tourne en CI (mode LOCAL) et en smoke (mode DISTANT)

**Code** :
- KEEP (converti) : les assertions B du scénario (1 scroll owner, 0px dérive,
  navigation catégorie, pas de fuite horizontale) deviennent des tests e2e de prod
- DELETE : les comparaisons A/B (plus de A à comparer)

---

## ÉTAPE 16 — Gates Debt Zero

**Dépendances** : ÉTAPES 1-15

**Test de sortie** : TOUS verts avant merge —
`backend:audit`, `arch:gate`, `gate:touched-files`, `feature:registry`,
`business-graph:check`, `business-graph:ratchet-check`,
`business-graph:disposition-check`, `feature:360:check`, suite unitaire Boutique,
build CSS + `css:guard` + `css:specificity-guard`

**Invariant protégé** : Debt Zero absolu — aucune baseline relevée, aucune
nouvelle ACTIONABLE_DRIFT, aucune nouvelle KNOWN_DEBT

---

## ÉTAPE 17 — Smoke preview avec backend réel

**Dépendances** : ÉTAPE 16

**Test de sortie** : la branche de migration déployée sur un environnement de
preview avec le backend RÉEL ; le spec Playwright DISTANT
(`mobile-vertical-navigation.spec.js` avec `BASE_URL`) passe :
- vrais produits, vraie PDP, vrai Discovery
- dérive PDP 0px, back 0px, 1 scroll owner
- bottom nav correcte, panier réel, checkout réel

**Invariant protégé** : le vertical fonctionne en conditions réelles, pas
seulement avec données mockées

**+ VETO UX** : test humain device (HUMAN_TEST_PROTOCOL.md) — bloque uniquement
sur dégradation matérielle observée, pas sur préférence subjective du swipe.

---

## ÉTAPE 18 — Merge atomique

**Dépendances** : ÉTAPES 16, 17 (gates + smoke + veto UX levés)

**Test de sortie** : PR unique mergée ; post-merge, e2e sur staging confirment

**Invariant protégé** : à aucun moment après le merge, deux architectures
mobiles ne coexistent

**Code** : le merge fait passer la prod de Temu à Vertical d'un coup.

---

# BUDGET DE DETTE FINAL

## AVANT (état actuel avec pager Temu)

| Mécanisme | Mesure |
|---|---|
| `b-pager.js` (cage, ghost, bounce, recalc) | 565 L — **DELETE** |
| `b-scroll-owner.js` parties cage | ~150 L / 225 L — **DELETE** |
| `b-scroll-owner.js` `isDesktop` + `installScrollOwner` | ~75 L — **KEEP** |
| CSS cage / `--pager-*` / footer-hide (layout.css) | 6 blocs — **DELETE** |
| `b-modal-core` restore pager (styles inline + scrollLeft + flag) | 19 refs — **DELETE** |
| Appelants pager `b-catalog` | 31 refs — **DELETE** |
| Appelants pager `b-nav` | 5 refs — **DELETE** |
| Appelants pager `b-cart` | 3 refs — **DELETE** |
| Appelants pager `hero-bootstrap` | 7 refs — **DELETE** |
| Indirection scroll (`getScrollY` etc.) | 8 modules, ~30 sites — **SIMPLIFY** |
| Scroll owners mobiles | **2** (cage horizontale + N pages verticales) |
| Mécanismes de synchronisation | **4** (snap-x, sync chip, N page scroll, restore) |

## APRÈS (vertical natif)

| Mécanisme restant | Nécessaire ? |
|---|---|
| `isDesktop()` | KEEP — invariant transversal (22 modules) |
| `installScrollOwner()` (wheel desktop) | KEEP — indépendant du pager |
| `mobile-vertical-navigation.js` (IntersectionObserver + rail sticky) | KEEP — la navigation elle-même |
| `window.scrollY` / `window.scrollTo` natifs | KEEP — remplacent l'indirection |
| `render-home-sections` (sections `.k-cat-section`) | KEEP — inchangé, déjà là |
| CSS rail sticky + sections verticales | KEEP — promu du spike |
| Scroll owners mobiles | **1** (le document) |
| Mécanismes de synchronisation | **1** (IntersectionObserver) |

## Bilan chiffré

- **~740 lignes DELETE** (b-pager 565 + parties b-scroll-owner ~150 + CSS + restore modal)
- **~46 refs SIMPLIFY** (appelants → window natif, 8 modules)
- **~75 lignes + isDesktop KEEP** (wheel desktop, isDesktop)
- **Scroll owners : 2 → 1**
- **Mécanismes sync : 4 → 1**
- **Traitements spéciaux modale : 1 → 0**

---

# RÈGLE IMPÉRATIVE POST-MIGRATION

Après le merge (étape 18) :

- ❌ Aucune branche Temu dormante dans le code
- ❌ Aucun legacy « au cas où »
- ❌ Aucun double shell
- ❌ Aucun flag permanent (`?shell=vertical` supprimé)
- ❌ Aucun ancien pager désactivé
- ✅ Le rollback est **Git** (revert de la PR), pas du dead code conservé

Le vertical n'est pas une option activée par défaut : c'est la seule
architecture mobile. `b-pager.js` n'existe plus. Il n'y a rien à réactiver.
