# Plan de migration Debt Zero — REPLACE TEMU

> À exécuter UNIQUEMENT si le verdict final est REPLACE TEMU (après test humain
> device). Aucune période durable où Temu et Vertical coexistent en prod : le
> flag sert à la preuve, pas à créer deux architectures permanentes.
>
> Chaque lot passe TOUS les gates avant le suivant. Debt Zero maintenu à chaque
> étape. Ordre strict — ne pas paralléliser les lots qui se dépendent.

## Principe directeur

On ne « bascule » pas d'un coup. On rend le vertical DÉFAUT en retirant le pager,
lot par lot, chaque lot laissant la Boutique fonctionnelle. Le flag `?shell=vertical`
disparaît à la fin : le vertical n'est plus une option, c'est l'architecture.

---

## LOT 1 — Tests d'invariants (AVANT tout changement de code)

**Objectif** : remplacer les tests qui protègent l'implémentation Temu par des
tests qui protègent l'invariant utilisateur. Ces tests doivent passer sur le
vertical AVANT qu'on retire le pager.

- Réécrire `b-pager.test.js` → `mobile-navigation.test.js` :
  - ne teste plus la cage, `k-pager-active`, ghost loop, bounce
  - teste : changement catégorie (chip → section), catégorie active au scroll,
    pas de scroll horizontal du catalogue
- Réécrire `b-scroll-owner.test.js` → `scroll-position.test.js` :
  - ne teste plus `getMobileScrollContainer`/cage
  - teste : retour PDP à la position exacte, back navigateur exact
- Garder les tests d'invariants déjà bons (cart, checkout, modal-core actions)

**Gate** : les nouveaux tests passent sur le vertical (flag actif). Les anciens
tests Temu restent verts aussi (pager encore là). Zéro test supprimé à ce stade.

---

## LOT 2 — Ownership / gouvernance

**Objectif** : faire évoluer les feature cards pour refléter la cible sans pager.

- `catalog.feature.js` : marquer `b-pager.js` et la partie cage de `b-scroll-owner.js`
  comme `deprecated: 'REPLACE-TEMU lot 4-5'` (pas encore retirés)
- Déclarer le futur module de navigation vertical comme owner canonique
  (si `spike-vertical-shell.js` est promu en module de prod, le renommer sans
  le préfixe spike et lui donner un header full)
- Régénérer business-graph + feature-360, vérifier ratchet à 0

**Gate** : `feature:registry`, `business-graph:ratchet-check`, `feature:360:check`.

---

## LOT 3 — Retrait des appelants pager

**Objectif** : retirer les SITES D'APPEL du pager (c'est ce que la Phase 2 a
identifié : les DELETE ont des appelants, il faut les retirer d'abord).

- `b-catalog.js` : supprimer la branche `_isMobile && !isVerticalShell()` qui
  monte le pager ; le vertical devient le seul chemin mobile. Retirer les appels
  `_setupMobilePager`, `_setupInfiniteLoop`, `_setupSectionAutoAdvance`,
  `_recalcPagerVars`, `_scrollPagerToCat`.
- `b-nav.js` : retirer les `classList.remove('k-pager-active')` devenus inutiles.
- `b-cart.js` : retirer le guard `k-pager-active`.
- `hero-bootstrap.js` : retirer le recalc `--pager-top`.

**Gate** : suite de tests complète verte, dont les nouveaux invariants du LOT 1.

---

## LOT 4 — Composants pager supprimables

**Objectif** : supprimer le code devenu réellement mort (plus aucun appelant).

- Supprimer `b-pager.js` entièrement (ghost loop, bounce, recalc cage,
  mobile pager, section auto-advance).
- Supprimer de `b-scroll-owner.js` : `getMobileScrollContainer`,
  `ensureDesktopScrollOwner`, `clearInlinePagerStyles`, le guard rAF anti-race.
- **KEEP** dans `b-scroll-owner.js` : `installScrollOwner` (wheel redirect
  desktop, indépendant du pager) — ou le déplacer dans un `b-desktop-wheel.js`.
- Retirer les fichiers des feature cards.

**Gate** : `arch:gate` (headers), `feature:registry`, tests.

---

## LOT 5 — CSS supprimable

**Objectif** : retirer le CSS de cage.

- `layout.css` : supprimer `.k-pager-active`, la cage `position:fixed`, le
  masquage footer, les vars `--pager-top/-h/-w`, `overflow:hidden` body lié pager.
- Retirer les classes `.k-grid-cat-pager`, `.k-grid-flat-subcat` si liées au pager.
- Promouvoir les règles du spike CSS (`spike-vertical-shell.css`) dans le CSS
  de prod (layout.css / products.css), sans le préfixe spike.

**Gate** : `css:guard`, `css:specificity-guard`, build CSS, tests visuels.

---

## LOT 6 — Simplifications modal / nav / catalog

**Objectif** : SIMPLIFY l'indirection scroll → appels natifs directs.

- Remplacer dans les 11 modules `getScrollY()` → `window.scrollY`,
  `scrollToPosition(y)` → `window.scrollTo({top:y})`,
  `scrollPageToElement` → `el.scrollIntoView` + offset.
- `b-modal-core.js` : supprimer `_savedPagerInlineStyles`, `_savedGridScrollLeft`,
  le flag `_closingFromPopstate` lié au double scroll-restore pager. La
  restauration devient `window.scrollTo(state._savedCatalogScrollY)` — déjà le
  cas via `scrollToPosition` qui pointe nativement vers window.
- Garder `scrollPageToTop` (utile) mais le simplifier en `window.scrollTo(0,0)`.

**Gate** : suite complète, dérive PDP = 0px (scénario Playwright réexécuté).

---

## LOT 7 — Suppression du flag spike

**Objectif** : le vertical n'est plus une option, c'est l'architecture.

- Retirer `isVerticalShell()` et toutes ses gardes dans `b-catalog.js`, `boutique.js`.
- Promouvoir `spike-vertical-shell.js` → `mobile-vertical-navigation.js` (module
  de prod, header full, plus de mention spike). Garder l'IntersectionObserver +
  navigation catégorie, retirer l'instrumentation HUD.
- Retirer l'injection dynamique du CSS spike (le CSS est maintenant dans le bundle).

**Gate** : `arch:gate`, `feature:registry`, business-graph.

---

## LOT 8 — Suppression du harness

**Objectif** : retirer les artefacts de spike qui ne sont plus nécessaires.

- Supprimer `spike/mobile-vertical-native/` en entier (harness, measure,
  dead-code-analysis, preview-server, scenario-run, docs de spike).
- Supprimer `spike-vertical-shell.spec.js` (remplacé par des specs e2e de prod).
- Garder une trace décisionnelle : archiver METRICS.md + SCENARIO_RESULTS.json +
  le verdict dans `docs/decisions/REPLACE_TEMU.md` (ADR).

**Gate** : `gate:touched-files` (plus aucun fichier spike orphelin).

---

## LOT 9 — Gates finaux

Avant le merge atomique, TOUS ces gates verts sur la branche de migration :

- `npm run backend:audit`
- `npm run arch:gate`
- `npm run gate:touched-files`
- `npm run feature:registry`
- `npm run business-graph:check`
- `npm run business-graph:ratchet-check`
- `npm run business-graph:disposition-check`
- `npm run feature:360:check`
- suite unitaire Boutique complète
- suite Playwright (dérive PDP 0px, back exact, 1 scroll owner, desktop inchangé)
- build CSS + css:guard + css:specificity-guard

Debt Zero absolu : aucune baseline relevée, aucune nouvelle ACTIONABLE_DRIFT,
aucune nouvelle KNOWN_DEBT.

---

## LOT 10 — Merge atomique

**Objectif** : basculer en une seule PR, pas de coexistence durable.

- Une PR unique `refactor(mobile): replace Temu pager with vertical native shell`
  qui contient les lots 1→9 en commits ordonnés.
- Le merge fait passer la prod de Temu à Vertical d'un coup : à aucun moment
  après le merge il n'existe deux architectures mobiles.
- Post-merge : déclencher les e2e sur staging pour confirmer en conditions réelles.

---

## Invariant absolu de la migration

À AUCUN moment après le LOT 10, Temu et Vertical ne coexistent en prod. Le flag
`?shell=vertical` n'existe plus. Il n'y a qu'une architecture mobile : le vertical.
