# METRICS — Spike Mobile Vertical vs Pager Temu

> Généré par `spike/mobile-vertical-native/measure.js`. Mesure objective, aucun fichier de prod modifié.

## 1. Comparatif shell A (Pager) vs B (Vertical) — même composition

| Métrique | A — Pager Temu | B — Vertical natif |
|---|---:|---:|
| Scroll owners | 2 (cage horizontale + N pages verticales) | 1 (document) |
| Mécanismes de synchronisation | 4 (snap-x, sync chip, N scroll pages, restore) | 1 (IntersectionObserver) |
| Traitements spéciaux modale/catalogue | 1 (mémoriser page + scrollTop local) | 0 (window.scrollY standard) |
| Classes structurelles de shell | 4 (cage, track, page, page-scroll) | 2 (rail-sticky, section) |
| Montage d'un bloc transversal (Discovery/merch) | contraint (page précise) | naturel (section dans le flux) |

Les deux shells rendent **le même contenu** (mêmes cartes, même Discovery, même
2ᵉ bloc merch), via des fonctions de rendu **communes**. Seuls le conteneur de
scroll, la navigation catégorie et la synchronisation active diffèrent.

## 2. Dette réelle du pager dans le code de PRODUCTION

| Élément | Mesure |
|---|---:|
| `b-scroll-owner.js` (indirection scroll) | 225 lignes |
| `b-pager.js` (cage + ghost + bounce) | 565 lignes |
| Marqueurs CSS cage pager dans `layout.css` | 6 occurrences |
| Restauration pager au cycle modale (`b-modal-core.js`) | 19 occurrences |
| Modules dépendants de l'indirection scroll | 11 |
| Sites d'appel à l'indirection | 54 |

### Modules couplés au shell (blast radius)

- `b-cart.js`
- `b-catalog-desktop-enhancers.js`
- `b-catalog.js`
- `b-checkout.js`
- `b-desktop-sidebar.js`
- `b-desktop-upgrade.js`
- `b-modal-core.js`
- `b-nav.js`
- `b-pager.js`
- `boutique.js`
- `hero-bootstrap.js`

### Code réellement supprimable si B gagne

Environ **790 lignes** de complexité accidentelle
(`b-scroll-owner.js` entier + `b-pager.js` entier), plus les 6
règles CSS de cage et les 19 traitements spéciaux au
cycle modale. L'indirection scroll disparaît : les 11 modules
dépendants reviennent à `window.scrollY` / `window.scrollTo` natifs.

### Complexité — classification

**Métier nécessaire** (existe dans A comme B) :
- charger les produits par catégorie
- ouvrir la PDP en modale
- restaurer la position au retour

**UX utile** (le swipe apporte quelque chose) :
- swipe horizontal catégorie (A : pleine page ; B : sur le rail catégories)

**Accidentelle** (n'existe QUE à cause du pager) :
- b-scroll-owner: indirection getScrollY/getMobileScrollContainer/scrollToPosition/scrollPageToElement
- b-pager: recalc --pager-top en double rAF + hooks stabilisation image hero
- b-pager: ghost-loop + téléportation silencieuse vers Tout
- b-pager: bounce vertical (bas de page → page suivante)
- b-modal-core: sauvegarde/restauration 10 styles inline du pager au cycle modale
- b-modal-core: restauration scrollLeft du grid + flag _closingFromPopstate
- layout.css: cage fixed + masquage footer + overflow:hidden body
- b-scroll-owner: guard rAF anti-race dans ensureDesktopScrollOwner

## 3. Gouvernance — tests qui protègent l'implémentation, pas l'invariant

Ces tests assertent la MÉCANIQUE Temu (cage, `k-pager-active`, scrollLeft du grid).
Ils protègent une implémentation, pas un invariant utilisateur. **À réécrire** vers
l'invariant (position restaurée, catégorie changée) AVANT toute migration — pas à
supprimer maintenant :

- `b-pager.test.js`
- `b-scroll-owner.test.js`

Tests qui protègent déjà un invariant utilisateur (survivent à la migration) :

- `b-cart-active-flows.test.js`
- `b-cart-mobile-drawer.test.js`
- `b-cart-pill.test.js`
- `b-cart-stepper-guard.test.js`
- `b-cart.test.js`
- `b-catalog-desktop-enhancers-coverage.test.js`
- `b-catalog-desktop-enhancers.test.js`
- `b-catalog.test.js`
- `b-checkout-relay-status.test.js`
- `b-checkout.test.js`

## 4. Invariants utilisateur — à valider sur device réel

Le harness (`harness.html`) permet de tester manuellement sur iPhone / Android :

- [ ] scroll vertical continu haut→bas sans rupture
- [ ] retour PDP à la position exacte (0px dérive)
- [ ] ouverture/fermeture panier
- [ ] ouverture/fermeture modale
- [ ] changement de catégorie (tap chip)
- [ ] catégorie active synchronisée au scroll manuel
- [ ] pas de scroll horizontal parasite
- [ ] resize / rotation
- [ ] desktop strictement inchangé (le spike ne touche pas la prod)

## 5. Sensation UX — swipe (à trancher sur device)

Le point non mesurable en statique : **le swipe pleine page (A) contre le swipe
sur rail + scroll vertical fluide (B)**. Le harness monte les deux réellement.
C'est le seul critère qui nécessite un test humain sur device — tout le reste est
objectivement en faveur de B.
