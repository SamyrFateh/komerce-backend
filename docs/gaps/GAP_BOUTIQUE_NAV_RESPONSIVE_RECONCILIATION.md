# GAP — Réconciliation navigation & responsive Boutique (mobile + desktop)

> **Destinataire : agent d'exécution (Sonnet).** Ce document est autosuffisant.
> Chaque GAP donne : preuve mesurée, cause (fichier + ligne), correctif **exact
> et déjà validé par injection dans un vrai navigateur**, tests à écrire,
> critère d'acceptation vérifiable. **N'invente rien, ne redemande rien :**
> applique dans l'ordre, prouve chaque critère, puis passe au suivant.

- Base auditée : `main` @ `763c372` (après #1770, hero v3).
- Audit : Playwright, 9 formats (320×568, 360×780, 390×844, 412×915, 768×1024,
  paysage 844×390, 900×800, 1024×768, 1440×900) × 7 vues (Boutique, 4 onglets,
  recherche ouverte, fiche produit) + parcours de navigation en tactile réel.
- Données locales : 40 produits exposés marché KM (script § Annexe A).

---

## 0. Règles non négociables (valent pour tous les GAP)

1. **Une PR par lot** (§ Plan d'exécution). Branche depuis `origin/main` à jour.
2. **Ne jamais committer** `public/boutique/check-sourcing.js` (fichier non suivi
   d'une autre session ; il fait échouer `boutique-ownership-full-check --strict`
   en local seulement — la CI ne le voit pas).
3. **CSS compilé** : après toute modif CSS, `cd public/boutique && npm run bundle:css`.
   Committer `css/dist/*`, `index.html` et `.cache-buster-state.json`, **mais**
   annuler tout bump de version d'un bundle dont le fichier `dist` n'a pas changé
   (cas récurrent : `critical-home.css`). Vérifier :
   `git diff public/boutique/index.html` → seuls les bundles réellement modifiés
   changent de `?v=`.
   Si `css/dist/components.css` ou `discovery-desktop-v2.css` changent alors que
   tu n'as touché à aucune de leurs sources : c'est une dérive préexistante,
   `git checkout --` ces fichiers et leurs `?v=`.
4. **Ownership CSS** : modifier un sélecteur **dans son fichier propriétaire**
   (indiqué dans chaque GAP). Vérifier `npm run audit:arch` → « Aucune violation ».
5. **Gates boutique obligatoires avant chaque commit** (depuis `public/boutique`) :
   `npm run audit:arch`, `npm run audit:registry`, `node scripts/check-html-balance.js`,
   et la suite `npx jest tests/unit --ci`.
6. **Référence des échecs préexistants** (identiques sur `main`, hors périmètre,
   ne pas corriger) — la suite est acceptée si les suites en échec sont
   **exactement** celles-ci et aucune autre :
   ```
   tests/unit/category-subcategory-continuity.test.js
   tests/unit/discovery-detail.test.js
   tests/unit/hero-desktop-panorama.test.js
   tests/unit/market-hydration-market-scope.test.js
   tests/unit/modal-mobile-suggestion-actions.test.js
   tests/unit/modal-topbar-mobile.test.js
   tests/unit/runtime-css-var-ownership.test.js
   tests/unit/shared-list-responsive-layout.test.js
   tests/unit/visual-geometry-css-invariants.test.js
   ```
   Commande de comparaison : `npx jest tests/unit --ci 2>&1 | grep '^FAIL' | sort -u`.
7. **Merge** : une PR est mergée (squash) uniquement si (a) tous les checks CI
   sont verts, `Required verdict` compris, (b) tous ses critères d'acceptation
   ci-dessous sont prouvés et collés dans la description de PR. Si la PR est
   `behind`, faire « Update branch », attendre la CI, puis merger.

---

## Tableau de synthèse

| ID | Sévérité | Sujet | Statut au moment de l'audit | Lot |
|---|---|---|---|---|
| G-01 | 🔴 P0 | `components.css` bloqué en preload (boutique sans styles) | **Corrigé**, PR #1774 verte, `behind`, **non mergée** | PR-1 |
| G-02 | 🟠 P1 | Pager : bascule de rayon involontaire + pas de retour | **Codé et validé en tactile réel**, branche poussée `fix/boutique-pager-deliberate-reversible` (`c3ee394`), **pas de PR** | PR-2 |
| G-03 | 🟠 P1 | Bouton retour Android quitte le site depuis les onglets | À faire | PR-3 |
| G-04 | 🟡 P2 | Rechargement sur un onglet → retombe sur Boutique | À faire (inclus dans G-03) | PR-3 |
| G-05 | 🟠 P1 | Débordement horizontal 900–1 279 px (en-tête desktop) | À faire, correctif validé | PR-4 |
| G-06 | 🟠 P1 | Mobile paysage : chrome fixe = 76 % de l'écran | À faire, correctif validé | PR-4 |
| G-07 | 🟡 P2 | Cibles tactiles < 40 px (bouton « + », flèches fiche) | À faire, correctif validé | PR-4 |
| G-08 | ⚪ — | Bouton WhatsApp flottant chevauche les cartes | **Accepté, aucune action** (preuve § G-08) | — |
| G-09 | ⚪ — | 320×568 : chrome fixe = 50 % | **Hors lot, aucune action** (§ G-09) | — |
| G-10 | ✅ | Champ référence « K » en double cadre (Commandes) | **Corrigé** dans la branche G-02 | PR-2 |

Ce qui a été vérifié **conforme** (ne rien toucher) : retour depuis une fiche
produit (ferme la fiche, reste sur le site, conserve le scroll du rayon) ; liens
`?tab=track|shares|fav|komerce|wallet|group` ; mémoire de scroll par rayon après
aller-retour d'onglet ; puces de rayon (activation + recentrage) ; onglets
Commandes / Partages / Favoris / Komerce sans débordement ni contenu masqué sous
l'en-tête, du 320 au 768 ; les états « Chargement… » se résolvent en ~3 s
(invitation à s'identifier en anonyme).

---

## G-01 — 🔴 `components.css` reste bloqué en preload (PR #1774)

**Preuve.** Rechargements successifs dans le même navigateur (cache chaud) :
17/20 laissaient `#k-components-preload` en `rel="preload"` ⇒ `components.css`
jamais appliqué (grille, fiche, panier quasi sans styles). Production, à froid :
1/8. Introduit par #1713.

**Cause.** `public/boutique/js/preload-css-swap.js` testait `link.sheet` pour
détecter un fichier déjà chargé ; un `<link rel="preload">` n'a **jamais** de
`.sheet`. Si le fichier finit de charger avant l'attachement de l'écouteur
`load` (cache chaud, très fréquent avec le cache long immuable), la bascule
n'a jamais lieu.

**Correctif (déjà écrit, PR #1774).** Détection via Resource Timing
(`performance.getEntriesByName(link.href)` avec `responseEnd > 0`) + filets
`DOMContentLoaded` puis `window 'load'`, exceptions absorbées. 4 tests ajoutés
dans `tests/unit/critical-css-loading.test.js`.

**À faire.** PR #1774 : « Update branch » (elle est `behind` suite à #1772, sans
rapport), attendre la CI verte, **merger en squash**. Puis vérifier en production
(§ critère).

**Critère d'acceptation.**
- Script § Annexe C (`swap-warm.js`) contre la prod après déploiement :
  `{"stylesheet":20}` sur 20 rechargements. Avant correctif : ~`{"preload":17,"stylesheet":3}`.
- `curl -s https://komerce-backend-production.up.railway.app/boutique.html | grep -c preload-css-swap` = 1.

---

## G-02 — 🟠 Pager : bascule involontaire et pas de retour (branche prête)

**Preuve (tactile réel, CDP `Input.dispatchTouchEvent`, 390×844).**
- Un scroll qui s'arrête à **21 px** du bas de « Mode » bascule sur « Maison »
  sans geste volontaire ; un rayon trop court bascule au premier glissement.
- Une fois sur « Maison », remonter en haut puis tirer vers le bas **ne ramène
  jamais** à « Mode » (le module n'implémentait que `onAdvance`).

**Cause.** `public/boutique/js/b-pager-end-bounce.js` (version `main`) : `onScroll`
programmait l'avance dès `isAtBottom(page)` (tolérance 32 px) + 160 ms ; aucun
chemin de recul.

**Correctif (déjà écrit, branche `fix/boutique-pager-deliberate-reversible`,
commits `778a901` + `c3ee394`).**
- **Avancer** : uniquement un geste qui **commence déjà en bas** (tolérance 4 px)
  et tire vers le haut ≥ `PULL_PX` = 56 px, verticalement dominant (×1,25).
  Arriver en bas ne fait plus rien.
- **Reculer** : geste qui **commence tout en haut** (`scrollTop ≤ 4`) et tire vers
  le bas ≥ 56 px ⇒ `onRetreat(page, prevPage)`. `b-pager.js` : `onRetreat` pose le
  rayon précédent **sur sa fin** (`_placePageAtBottom`), synchronise la puce,
  `_scrollToIndex(index-1)`. Le premier rayon (« Tout ») ne recule pas.
- Aucun risque de pull-to-refresh : les pages ont déjà
  `overscroll-behavior-y: none` (`css/products.css`, règle
  `#k-grid.k-grid-cat-pager … > .k-cat-section`).
- Atterrissage du recul (`c3ee394`) : `_setupScrollSync` remettait le rayon en
  haut à l'arrivée (le scroll smooth dépasse la fenêtre `_isProgrammaticScroll`
  de 100 ms). `onRetreat` annonce `_pendingLanding = { cat }`, que la synchro
  honore (`_placePageAtBottom`) au lieu du reset. Swipe horizontal inchangé
  (rayon présenté en haut) — vérifié.
- Tests : `tests/unit/b-pager-end-bounce.test.js` réécrit (16 cas A/B),
  `tests/unit/pager-bump-entry-context.test.js` adapté au tirage volontaire.
- Inclut G-10 (champ « K »).

**À faire.**
1. `git fetch && git checkout fix/boutique-pager-deliberate-reversible && git rebase origin/main`.
   En cas de conflit sur `css/dist/*`, `index.html`, `.cache-buster-state.json` :
   prendre la version `origin/main`, puis `npm run bundle:css` et appliquer la
   règle 0.3.
2. Lancer la validation tactile § Annexe B (`pager-touch.js`). Déjà exécutée
   sur la branche au moment de la rédaction : A1/A2/A3/B1/B2 conformes, B1 à
   `st == max`. La relancer après rebase pour prouver l'absence de régression.
3. Lancer l'audit § Annexe D ; aucune nouvelle ligne `OVERFLOW-X` / `SOUS-HEADER`
   sur les formats mobiles par rapport au § Référence d'audit.
4. Gates (règle 0.5), ouvrir la PR (titre : `fix(boutique): pager mobile
   volontaire et réversible + champ référence K`), coller les sorties, merger
   selon la règle 0.7.

**Critère d'acceptation (sortie attendue de `pager-touch.js`).**
```
A1 scroll qui s'arrête 21px avant le bas      -> même rayon (Mode & Beauté)
A2 tirage 60px vers le haut, déjà en bas      -> rayon suivant (Maison)
A3 tirage 40px vers le haut, déjà en bas      -> même rayon
B1 tirage 60px vers le bas, tout en haut      -> rayon précédent (Mode & Beauté), posé en bas (scrollTop == max)
B2 tirage 60px vers le bas en haut de « Tout » -> reste sur Tout
```
Plus : `npx jest tests/unit/b-pager-end-bounce.test.js tests/unit/pager-bump-entry-context.test.js tests/unit/discovery-bump-entry.test.js tests/unit/discovery-home-only-surface.test.js --ci` ⇒ 22/22.

---

## G-03 — 🟠 Le bouton retour Android fait quitter le site depuis un onglet

**Preuve.** Page précédente = autre site, ouvrir la Boutique, taper Commandes,
Partages, Favoris ou Komerce, puis `history.back()` ⇒ **4/4 quittent le site**.
Seule la fiche produit crée une entrée d'historique (`{ kModal: true }`).

**Cause.** `public/boutique/js/b-nav.js`, `setupBnav()` (≈ l. 279–299) : les
clics d'onglet appellent `switchView()` sans aucune entrée d'historique ; aucun
`popstate` ne pilote les onglets. Le seul `popstate` existant est celui de la
fiche (`js/b-modal-core.js` ≈ l. 175), qui ignore les états `kModal` et ne
ferme que la fiche ouverte.

**Correctif exact — `public/boutique/js/b-nav.js` uniquement.**

1. Au-dessus de `setupBnav`, ajouter :
```js
// G-03 — Onglets dans l'historique : retour Android = onglet précédent,
// jamais sortie du site. Une seule entrée d'historique pour tout le séjour
// hors Boutique (push depuis Boutique, replace entre onglets).
const HISTORY_TABS = new Set(['track', 'shares', 'fav', 'komerce']);
let _currentTab = 'shop';

function showTab(tab) {
  _currentTab = tab;
  if (tab === 'komerce') {
    activateNavTab(null);
    switchView('shop');
    openMonKomerce();
    return;
  }
  activateNavTab(tab);
  if (tab === 'fav')    { renderFavView(); switchView('fav'); return; }
  if (tab === 'track')  { renderTrackView(); switchView('track'); return; }
  if (tab === 'shares') { renderListsView(); switchView('track'); return; }
  switchView('shop');
}
```
2. Remplacer le corps du `click` dans `setupBnav()` par :
```js
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      if (tab === 'cart') { activateNavTab(tab); openCart(); return; }
      const inTabEntry = !!(history.state && history.state.kTab);
      if (HISTORY_TABS.has(tab)) {
        if (inTabEntry) history.replaceState({ kTab: tab }, '');
        else history.pushState({ kTab: tab }, '');
        showTab(tab);
        return;
      }
      // Retour à la Boutique depuis un onglet : consommer l'entrée d'onglet
      // pour qu'un retour ultérieur ne revienne pas sur un onglet quitté.
      showTab('shop');
      if (inTabEntry) history.back();
    });
```
3. À la fin de `setupBnav()`, ajouter l'écouteur :
```js
  window.addEventListener('popstate', (event) => {
    if (event.state && event.state.kModal) return;             // géré par b-modal-core.js
    if (dom.modalOverlay && dom.modalOverlay.classList.contains('open')) return; // idem
    const target = (event.state && event.state.kTab) || 'shop';
    if (target === _currentTab) return;                        // idempotent
    showTab(target);
  });
```
   (`dom` est déjà importé dans `b-nav.js` — vérifier l'import en tête ; sinon
   `import { dom } from './b-store.js';` comme les autres modules.)
4. **G-04 inclus** — restauration après rechargement : dans `handleTabDeepLink()`,
   juste après `if (!tab || tab === 'shop') return;` **remplacer** ce `return` par :
```js
    if (!tab || tab === 'shop') {
      const kept = history.state && history.state.kTab;
      if (kept && HISTORY_TABS.has(kept)) showTab(kept);
      return;
    }
```
   et, dans la branche deep-link valide, remplacer
   `window.history.replaceState({}, '', clean);` par
   `window.history.replaceState({ kTab: resolvedTab }, '', clean);`
   puis appeler `showTab(resolvedTab)` à la place du bloc d'activation manuel
   qui suit (mêmes effets, un seul chemin).

**Ne pas toucher** `js/b-modal-core.js`. Les deux écouteurs `popstate` coexistent :
celui de la fiche ferme la fiche ; celui des onglets s'arrête dès qu'une fiche
est ouverte ou que l'état est `kModal`, et il est idempotent.

**Tests à écrire.** `tests/unit/b-nav-history.test.js` (jsdom) : mocker
`switchView`, `renderFavView`, `renderTrackView`, `renderListsView`,
`openMonKomerce`, `openCart` (même technique que les tests existants qui
importent `b-nav.js` — chercher `jest.mock('../../js/b-nav` ou
`b-nav.js` dans `tests/unit/` et reproduire le montage). Cas :
1. Boutique → clic Favoris ⇒ `history.pushState` appelé avec `{kTab:'fav'}`.
2. Favoris → clic Commandes ⇒ `replaceState({kTab:'track'})`, pas de push.
3. `popstate` avec `state=null` depuis Favoris ⇒ `switchView('shop')`.
4. `popstate` avec `{kModal:true}` ⇒ aucun `switchView`.
5. `popstate` pendant qu'une fiche est ouverte (`dom.modalOverlay.classList` contient `open`) ⇒ aucun `switchView`.
6. Clic Boutique depuis un onglet (`history.state.kTab` présent) ⇒ `history.back` appelé.
7. Clic Panier ⇒ ni push ni replace.

**Critère d'acceptation (script § Annexe E `nav-history.js`).**
```
RETOUR Android depuis track   -> ✅ reste : tab=shop
RETOUR Android depuis shares  -> ✅ reste : tab=shop
RETOUR Android depuis fav     -> ✅ reste : tab=shop
RETOUR Android depuis komerce -> ✅ reste : tab=shop
Fav -> Commandes -> retour    -> ✅ reste : tab=shop (une seule entrée d'onglet)
RETOUR depuis fiche produit   -> fiche fermée, site conservé, scroll rayon ~600
RECHARGER sur Favoris         -> tab=fav
LIEN ?tab=track puis retour   -> quitte le site (point d'entrée : attendu)
```

---

## G-05 — 🟠 Débordement horizontal 900–1 279 px (en-tête desktop)

**Preuve.** `document.scrollWidth` : 900 → **1 116**, 1 024 → **1 167**,
1 100 → **1 198**, 1 180 → **1 231** (barre de défilement horizontale).
Les 4 boutons texte (Mon Komerce, Mes Favoris, Mes Commandes, Mes Partages)
débordent de `.k-header-actions` (`flex: 1 1 auto; min-width: 0`) ; ils sont en
`white-space: nowrap` et ne rétrécissent pas. Conforme à partir de 1 280 px.

**Correctif exact — `public/boutique/css/layout.css`** (propriétaire des
`.k-header-nav-btn` desktop, bloc « Nav buttons (ex boutique-desktop.css) » ≈ l. 1037).
Ajouter **à la fin du fichier** :
```css
/* G-05 — 900–1279 px : les 4 boutons de navigation passent en icône seule
   (aria-label déjà présent) pour supprimer le débordement horizontal.
   Scopé .k-header-actions : ne touche pas le CTA « Suivre ma commande »
   qui porte aussi .k-header-nav-btn. */
@media (min-width: 900px) and (max-width: 1279px) {
  .k-header-actions .k-header-nav-btn {
    flex: 0 0 40px;
    width: 40px;
    height: 40px;
    padding: 0;
    justify-content: center;
    gap: 0;
  }
  .k-header-actions .k-header-nav-btn > span:not(.k-komerce-nav-icon):not(.k-header-group-badge),
  .k-header-actions .k-header-nav-btn .k-komerce-nav-label {
    display: none;
  }
}
```
Validé par injection : `scrollWidth == innerWidth` à 900 / 1 024 / 1 100 / 1 180 /
1 279 ; boutons 40×40 ; CTA hero inchangé (186 px) ; 1 280 et 1 440 inchangés
(boutons texte).

**Tests à écrire.** `tests/unit/header-compact-desktop.test.js` : lire
`css/layout.css`, vérifier la présence de
`@media (min-width: 900px) and (max-width: 1279px)`, du sélecteur scopé
`.k-header-actions .k-header-nav-btn`, de `flex: 0 0 40px` et du masquage des
libellés ; vérifier que le sélecteur non scopé `.k-header-nav-btn > span` **n'est
pas** masqué hors de ce media.

**Critère d'acceptation.** Audit § Annexe D aux formats `900,1024` : **zéro**
ligne `OVERFLOW-X` sur les 7 vues. Capture 1 024 : logo, recherche, 4 icônes
rondes, avatar, sans débordement.

---

## G-06 — 🟠 Mobile paysage : le chrome fixe occupe 76 % de la hauteur

**Preuve.** 844×390 : en-tête 44 + hero 134 + rail 64 + barre du bas 50 ⇒ la
section produits fait **94 px** de haut (≈ ¾ d'une carte).

**Correctif exact — `public/boutique/css/hero-ultra-mobile.css`** (extension
mobile du hero, `@owner css/hero.css`). Ajouter **à la fin du fichier**, hors du
bloc `@media (max-width: 899px)` existant :
```css
/* G-06 — Mobile en paysage à faible hauteur : la scène et le slogan cèdent
   la place au catalogue ; le rail de rayons reste. Le JS du pager mesure
   #k-hero-fixed-wrap dynamiquement : aucun ajustement JS requis. */
@media (max-width: 899px) and (orientation: landscape) and (max-height: 500px) {
  .k-hero { display: none; }
}
```
Validé par injection : paysage section **94 → 228 px** (×2,4), rail collé sous
l'en-tête (48→112) ; portrait **strictement identique** (section 553 px) ;
rotation live portrait → paysage → portrait sans trou (écart bloc fixe /
section = 0 à chaque étape).

**Attention test existant.** `tests/unit/hero-ultra-mobile.test.js` contient
`expect(css).not.toContain('@media (min-width: 900px)')` : la nouvelle règle
utilise `max-width`, le test reste vert. Ajouter dans ce même fichier de test :
```js
  test('G-06 : en paysage bas, la scène cède la place au catalogue', () => {
    expect(css).toContain('@media (max-width: 899px) and (orientation: landscape) and (max-height: 500px)');
    expect(css).toMatch(/orientation: landscape\) and \(max-height: 500px\) \{\s*\.k-hero \{ display: none; \}/);
  });
```

**Critère d'acceptation.** Script § Annexe F (`landscape.js`) :
```
paysage         sectionH >= 220, hero "none", gap 0
portrait        sectionH == 553 (390x844), hero visible
rotation ×2     gap 0 à chaque étape
```

---

## G-07 — 🟡 Cibles tactiles inférieures à 40 px

**Preuve.** 390×844 : bouton « + » des cartes `.k-card-add-trigger` **30×30** ;
flèches de la fiche `#k-modal-nav .k-modal-nav-btn` **28×28**
(`#k-modal-prev`, `#k-modal-next`). Un tap à 4 px du bord visible est perdu.

**Correctif exact (zone tactile élargie, visuel inchangé).**
- `public/boutique/css/products.css`, juste après la règle `.k-card-add-trigger { … }` (≈ l. 185) :
```css
/* G-07 — zone tactile 40×40 sans changer le visuel 30×30 */
.k-card-add-trigger { position: relative; }
.k-card-add-trigger::after { content: ''; position: absolute; inset: -5px; }
```
- `public/boutique/css/modal-shell.css`, juste après la règle
  `#k-modal-nav .k-modal-nav-btn { … }` (≈ l. 430, dans le même bloc media) :
```css
  /* G-07 — zone tactile 40×40 sans changer le visuel 28×28 */
  #k-modal-nav .k-modal-nav-btn { position: relative; }
  #k-modal-nav .k-modal-nav-btn::after { content: ''; position: absolute; inset: -6px; }
```
Validé par injection (`elementFromPoint` à 4 px hors du bord visible) : avant
`false`, après `true` ; visuel toujours 30×30 et 28×28.

**Vérifier avant d'appliquer** : `grep -n "k-card-add-trigger::after\|k-modal-nav-btn::after" public/boutique/css/*.css`
doit être vide (sinon fusionner dans le pseudo-élément existant au lieu d'en créer un second).

**Critère d'acceptation.** Script § Annexe G (`tap-targets.js`) : pour les deux
cibles, `bord_gauche_moins4: true` et `visuel` inchangé.

---

## G-08 — ⚪ Bouton WhatsApp flottant : accepté, aucune action

Le FAB `#k-wa-fab` (40×40, fixe) chevauche parfois le cœur ou le « + » d'une
carte **pendant** le scroll — inhérent à tout bouton flottant. Mesuré en fin de
rayon (scroll max) à 360, 390 et 768 : **aucune** action de carte recouverte
(`coveredAtEnd: []`), grâce aux 80 px de `padding-bottom` des sections. Toute
action reste atteignable. **Ne rien modifier.**

## G-09 — ⚪ 320×568 : chrome fixe = 50 % — hors lot

Mesuré, jugé utilisable (une rangée pleine visible). Masquer le hero en portrait
bas retirerait la promesse de marque sur iPhone SE : **ne rien modifier dans ce
lot.**

## G-10 — ✅ Champ référence « K » (Commandes) — corrigé dans la branche G-02

Double cadre : `.k-track-input` (`css/cart.css` ≈ l. 1051, déclaré après) battait
`.k-track-input--ref` (même spécificité) ⇒ le champ redessinait sa bordure dans
le cadre `.k-track-ref-wrap`. Correctif : sélecteur
`.k-track-ref-wrap .k-track-input--ref` (2 classes), `border-radius: 0`, focus sans
cadre ; préfixe « K » aligné sur la typographie du champ (18 px, 700,
`letter-spacing: 4px`). Rien à faire de plus que livrer G-02.

---

## Plan d'exécution (ordre imposé)

| Lot | Contenu | Branche | Action |
|---|---|---|---|
| PR-1 | G-01 | `fix/boutique-preload-css-swap-race` (PR #1774) | Update branch → CI verte → merge → critère prod |
| PR-2 | G-02 + G-10 | `fix/boutique-pager-deliberate-reversible` | Rebase → Annexes B + D → PR → merge |
| PR-3 | G-03 + G-04 | nouvelle `fix/boutique-tab-history` | Code § G-03 → tests → Annexe E → PR → merge |
| PR-4 | G-05 + G-06 + G-07 | nouvelle `fix/boutique-responsive-header-landscape-targets` | CSS § G-05/06/07 → tests → Annexes D, F, G → PR → merge |

Après PR-4 : relancer l'audit complet (Annexe D, tous formats) et coller dans la
PR-4 le tableau avant/après des colonnes `OVERFLOW-X` et `fixe=`.

---

## Référence d'audit (état `main` @ `763c372`, avant corrections)

| Format | Vue | Constat |
|---|---|---|
| 900, 1024 | toutes | `OVERFLOW-X` document (1 116 / 1 167) → G-05 |
| 844×390 | Boutique | chrome fixe 76 %, section 94 px → G-06 |
| 320×568 | Boutique | chrome fixe 50 % → G-09 (hors lot) |
| 360–768 | Boutique, fiche | cibles 28–30 px → G-07 |
| tous | `#k-hero-h1` « tronqué » | **faux positif** : `h1.sr-only` voulu, ignorer |
| 1024–1440 | onglets | cibles < 32 px = boutons desktop à la souris : **hors périmètre** |

---

## Annexe A — Environnement local reproductible

Depuis la racine du dépôt :
```bash
service postgresql start
su postgres -c "dropdb komerce_test"; su postgres -c "createdb komerce_test"
su postgres -c "psql -c \"ALTER DATABASE komerce_test OWNER TO komerce;\""
PGPASSWORD=komerce psql -h localhost -U komerce -d komerce_test -f docs/db/railway-live-schema.sql > /tmp/schema.log 2>&1
export NODE_ENV=development DATABASE_URL="postgresql://komerce:komerce@localhost:5432/komerce_test" \
  JWT_SECRET=x ADMIN_PASSWORD=x STRIPE_SECRET_KEY=sk_test_x STRIPE_WEBHOOK_SECRET=whsec_x QR_SECRET=x \
  AUTHKEY_API_KEY=x PAYPAL_CLIENT_ID=x PAYPAL_CLIENT_SECRET=x PAYPAL_WEBHOOK_ID=x META_WA_APP_SECRET=x \
  KOMERCE_DISABLE_CRONS=true PORT=3000
node scripts/ci-db-bootstrap.js
PGPASSWORD=komerce psql -h localhost -U komerce -d komerce_test -q -c "
INSERT INTO products (id,name,price_kmf,category,is_active,is_available,image_url,product_ref)
SELECT gen_random_uuid(),'Produit test '||g,1000*g,(ARRAY['Mode','Maison','Tech','Bricolage','Auto'])[1+g%5],true,true,'https://example.com/i'||g||'.jpg','PRD-SCR-'||lpad(g::text,3,'0') FROM generate_series(1,40) g;
INSERT INTO product_market_exposure (product_id,market_id,commercial_exposure) SELECT p.id,m.id,'ENABLED' FROM products p, markets m WHERE p.product_ref LIKE 'PRD-SCR-%' AND m.code='KM';
INSERT INTO product_market_price_drafts (product_id,market_id,amount,currency,status,reason,authorized_at,authorization_snapshot,active_at)
SELECT p.id,m.id,p.price_kmf,'KMF','LOCAL_ACTIVE','seed audit',NOW(),'{}'::jsonb,NOW() FROM products p, markets m WHERE p.product_ref LIKE 'PRD-SCR-%' AND m.code='KM';"
setsid nohup node server.js > /tmp/server.log 2>&1 < /dev/null &
sleep 15 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health   # 200
curl -s "http://localhost:3000/api/products?limit=1000&market=KM" | grep -o '"total":[0-9]*'   # "total":40
```
Tous les scripts ci-dessous s'enregistrent dans `/tmp/` et se lancent avec :
`NODE_PATH=$(pwd)/public/boutique/node_modules node /tmp/<script>.js`
(ils importent `@playwright/test`). Aucune commande ne doit dépasser ~250 s :
lancer les formats par petits groupes.

Les rayons en base ont les valeurs `data-cat` : `all`, `Soldes`,
`Mode & Beauté`, `Maison`, `Tech`, `Bricolage`, `Créations personnelles`, `Auto`.
La catégorie produit `Mode` s'affiche dans le rayon `Mode & Beauté`.

## Annexe B — `pager-touch.js` (G-02)

```js
const { chromium } = require('@playwright/test');
const URL = 'http://localhost:3000/boutique.html';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const c = await p.context().newCDPSession(p);
  const drag = async (y0, dy) => { await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
    for (let i = 1; i <= 15; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + dy * i / 15 }] }); await p.waitForTimeout(16); }
    await p.waitForTimeout(120); await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(900); };
  const act = () => p.evaluate(() => { const s = [...document.querySelectorAll('#k-grid > .k-cat-section')].find(x => Math.abs(x.getBoundingClientRect().left) < 20); return { cat: s.dataset.cat, st: Math.round(s.scrollTop), max: s.scrollHeight - s.clientHeight }; });
  const goCat = async (cat) => { await p.tap(`#k-sticky-bar [data-cat="${cat}"]`); await p.waitForTimeout(1200); };
  const setTop = (v) => p.evaluate((v) => { const s = [...document.querySelectorAll('#k-grid > .k-cat-section')].find(x => Math.abs(x.getBoundingClientRect().left) < 20); s.scrollTop = v === 'max' ? s.scrollHeight : v; }, v);
  await goCat('Mode & Beauté'); const m = (await act()).max; await drag(700, -(m - 21)); console.log('A1', JSON.stringify(await act()));
  await goCat('Mode & Beauté'); await setTop('max'); await p.waitForTimeout(300); await drag(700, -60); console.log('A2', JSON.stringify(await act()));
  await goCat('Mode & Beauté'); await setTop('max'); await p.waitForTimeout(300); await drag(700, -40); console.log('A3', JSON.stringify(await act()));
  await goCat('Maison'); await setTop(0); await p.waitForTimeout(300); await drag(300, 60); console.log('B1', JSON.stringify(await act()));
  await goCat('all'); await setTop(0); await p.waitForTimeout(300); await drag(300, 60); console.log('B2', JSON.stringify(await act()));
  await b.close();
})();
```
Attendu : A1 `Mode & Beauté` ; A2 `Maison` ; A3 `Mode & Beauté` ;
B1 `Mode & Beauté` avec `st == max` ; B2 `all`.

## Annexe C — `swap-warm.js` (G-01)

```js
const { chromium } = require('@playwright/test');
(async () => { const url = process.argv[2]; const n = 20; const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, ignoreHTTPSErrors: true })).newPage(); const res = {};
  await p.goto(url, { waitUntil: 'load' });
  for (let i = 0; i < n; i++) { await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(700);
    const r = await p.evaluate(() => { const l = document.querySelector('#k-components-preload'); return l ? l.rel : 'absent'; }); res[r] = (res[r] || 0) + 1; }
  console.log(JSON.stringify(res)); await b.close(); })();
```
Usage : `node /tmp/swap-warm.js http://localhost:3000/boutique.html` puis avec l'URL
de production. Attendu : `{"stylesheet":20}`.

## Annexe D — Audit responsive complet (`audit-probe.js` + `audit-run.js`)

`/tmp/audit-probe.js` :
```js
module.exports = function probe(label) {
  const W = innerWidth, H = innerHeight;
  const vis = el => { if (!el) return false; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const path = el => { const p = []; for (let e = el; e && e !== document.body && p.length < 3; e = e.parentElement) p.unshift(e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : '')); return p.join('>'); };
  const inHScroller = el => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && e.clientWidth < e.scrollWidth + 1) return true; } return false; };
  const header = document.querySelector('.k-header'); const hb = vis(header) ? header.getBoundingClientRect().bottom : 0;
  const bnav = document.querySelector('.k-bnav'); const nt = vis(bnav) ? bnav.getBoundingClientRect().top : H;
  const wrap = document.querySelector('#k-hero-fixed-wrap'); const fixedTop = vis(wrap) ? Math.max(hb, wrap.getBoundingClientRect().bottom) : hb;
  const out = { label, overflowX: [], underHeader: [], tapSmall: [] };
  if (document.documentElement.scrollWidth > W + 1) out.overflowX.push({ sel: 'document', w: document.documentElement.scrollWidth });
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    const chrome = s.position === 'fixed' || el.closest('.k-header,.k-bnav,#k-hero-fixed-wrap');
    if (!chrome) {
      if ((r.right > W + 1 || r.left < -1) && r.width < W * 3 && !inHScroller(el) && out.overflowX.length < 6) out.overflowX.push({ sel: path(el), left: Math.round(r.left), right: Math.round(r.right) });
      if (el.children.length === 0 && (el.textContent || '').trim().length > 2 && r.top < fixedTop - 2 && r.bottom > hb + 2 && r.bottom < H && !el.closest('.k-cat-section') && out.underHeader.length < 4) out.underHeader.push({ sel: path(el), top: Math.round(r.top) });
    }
    if (el.matches('button, a[href], [role="button"], input:not([type=hidden]), .k-chip, .k-bnav-item') && r.top < H && r.bottom > 0 && r.left < W && r.right > 0 && Math.min(r.width, r.height) < 32 && out.tapSmall.length < 30) out.tapSmall.push({ sel: path(el), w: Math.round(r.width), h: Math.round(r.height) });
  }
  out.fixedShare = Math.round(100 * (fixedTop + (H - nt)) / H);
  return out;
};
```
`/tmp/audit-run.js` (argument : formats séparés par des virgules) :
```js
const { chromium } = require('@playwright/test'); const probe = require('/tmp/audit-probe.js');
const VPS = { 320: [320, 568, 1], 360: [360, 780, 1], 390: [390, 844, 1], 412: [412, 915, 1], 768: [768, 1024, 1], land: [844, 390, 1], 900: [900, 800, 0], 1024: [1024, 768, 0], 1440: [1440, 900, 0] };
(async () => { const b = await chromium.launch();
  for (const k of process.argv[2].split(',')) { const [w, h, mob] = VPS[k];
    const p = await (await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mob, hasTouch: !!mob, deviceScaleFactor: mob ? 2 : 1 })).newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:3000/boutique.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
    const snap = async (v) => { const r = await p.evaluate(`(${probe.toString()})(${JSON.stringify(k + ' ' + v)})`);
      console.log(r.label.padEnd(14), 'fixe=' + r.fixedShare + '%', r.overflowX.length ? 'OVERFLOW-X ' + JSON.stringify(r.overflowX.slice(0, 2)) : '', r.underHeader.length ? 'SOUS-HEADER ' + JSON.stringify(r.underHeader.slice(0, 2)) : '', 'cibles<32=' + r.tapSmall.length); };
    await snap('shop');
    const tap = async (sel) => { const el = await p.$(sel); if (!el || !(await el.isVisible())) return false; mob ? await el.tap() : await el.click(); return true; };
    for (const t of ['track', 'shares', 'fav', 'komerce']) { if (await tap(`.k-bnav-item[data-tab="${t}"]`) || await tap(`.k-header-actions .k-header-nav-btn[data-tab="${t}"]`)) { await p.waitForTimeout(t === 'fav' ? 800 : 3200); await snap(t); } }
    (await tap('.k-bnav-item[data-tab="shop"]')) || (await tap('.k-logo')); await p.waitForTimeout(900);
    if (await tap('#k-search')) { await p.waitForTimeout(500); await snap('search'); await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
    if (await tap('#k-grid .k-card')) { await p.waitForTimeout(1300); await snap('modal'); }
    if (errs.length) console.log(k, 'ERREURS JS', JSON.stringify(errs.slice(0, 3)));
    await p.close(); }
  await b.close(); })();
```
Usage : `node /tmp/audit-run.js 320,360` ; `… 390,412` ; `… 768,land` ;
`… 900,1024` ; `… 1440`. Ignorer `#k-hero-h1` (sr-only).

## Annexe E — `nav-history.js` (G-03 / G-04)

```js
const { chromium } = require('@playwright/test'); const URL = 'http://localhost:3000/boutique.html';
(async () => { const b = await chromium.launch(); const mk = async () => (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  const tab = p => p.evaluate(() => { const a = document.querySelector('.k-bnav-item.active'); return a ? a.dataset.tab : null; });
  for (const t of ['track', 'shares', 'fav', 'komerce']) { const p = await mk(); await p.goto('data:text/html,prev'); await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
    await p.tap(`.k-bnav-item[data-tab="${t}"]`); await p.waitForTimeout(1200); await p.goBack({ waitUntil: 'commit' }).catch(() => {}); await p.waitForTimeout(900);
    console.log('RETOUR Android depuis', t, '->', p.url().startsWith('data:') ? '❌ quitte le site' : '✅ reste : tab=' + await tab(p)); await p.context().close(); }
  { const p = await mk(); await p.goto('data:text/html,prev'); await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
    await p.tap('.k-bnav-item[data-tab="fav"]'); await p.waitForTimeout(900); await p.tap('.k-bnav-item[data-tab="track"]'); await p.waitForTimeout(1500);
    await p.goBack({ waitUntil: 'commit' }).catch(() => {}); await p.waitForTimeout(900);
    console.log('Fav -> Commandes -> retour ->', p.url().startsWith('data:') ? '❌ quitte le site' : '✅ reste : tab=' + await tab(p)); await p.context().close(); }
  { const p = await mk(); await p.goto('data:text/html,prev'); await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
    await p.evaluate(() => { const s = [...document.querySelectorAll('#k-grid > .k-cat-section')].find(x => Math.abs(x.getBoundingClientRect().left) < 20); s.scrollTop = 600; }); await p.waitForTimeout(400);
    for (const c of await p.$$('#k-grid .k-card')) { const bb = await c.boundingBox(); if (bb && bb.y > 300 && bb.y < 650 && bb.x >= 0 && bb.x < 300) { await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + 40); break; } }
    await p.waitForTimeout(1300); const opened = await p.evaluate(() => document.body.classList.contains('modal-open'));
    await p.goBack({ waitUntil: 'commit' }).catch(() => {}); await p.waitForTimeout(1000);
    const r = await p.evaluate(() => ({ open: document.body.classList.contains('modal-open'), st: Math.round([...document.querySelectorAll('#k-grid > .k-cat-section')].find(x => Math.abs(x.getBoundingClientRect().left) < 20).scrollTop) }));
    console.log('RETOUR depuis fiche -> ouverte avant:', opened, '| après:', r.open, '| site:', !p.url().startsWith('data:'), '| scroll:', r.st); await p.context().close(); }
  { const p = await mk(); await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForTimeout(800); await p.tap('.k-bnav-item[data-tab="fav"]'); await p.waitForTimeout(800);
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500); console.log('RECHARGER sur Favoris -> tab=' + await tab(p)); await p.context().close(); }
  { const p = await mk(); await p.goto('data:text/html,prev'); await p.goto(URL + '?tab=track', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    await p.goBack({ waitUntil: 'commit' }).catch(() => {}); await p.waitForTimeout(800); console.log('LIEN ?tab=track puis retour ->', p.url().startsWith('data:') ? 'quitte le site (attendu)' : 'reste'); await p.context().close(); }
  await b.close(); })();
```

## Annexe F — `landscape.js` (G-06)

```js
const { chromium } = require('@playwright/test');
(async () => { const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost:3000/boutique.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  const m = () => p.evaluate(() => { const s = [...document.querySelectorAll('#k-grid > .k-cat-section')].find(x => Math.abs(x.getBoundingClientRect().left) < 30); const w = document.querySelector('#k-hero-fixed-wrap').getBoundingClientRect(); const h = document.querySelector('.k-hero');
    return { hero: getComputedStyle(h).display === 'none' ? 'none' : 'visible', sectionH: s.clientHeight, gap: Math.round(s.getBoundingClientRect().top - w.bottom) }; });
  console.log('portrait ', JSON.stringify(await m()));
  for (const [w, h, l] of [[844, 390, 'paysage  '], [390, 844, 'portrait ']]) { await p.setViewportSize({ width: w, height: h }); await p.evaluate(() => window.dispatchEvent(new Event('orientationchange'))); await p.waitForTimeout(900); console.log(l, JSON.stringify(await m())); }
  await b.close(); })();
```
Attendu : paysage `hero:"none"`, `sectionH ≥ 220`, `gap 0` ; portrait
`hero:"visible"`, `sectionH 553`, `gap 0`.

## Annexe G — `tap-targets.js` (G-07)

```js
const { chromium } = require('@playwright/test');
(async () => { const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost:3000/boutique.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  const probe = (sel) => p.evaluate((sel) => { const el = [...document.querySelectorAll(sel)].find(e => { const r = e.getBoundingClientRect(); return r.top > 260 && r.bottom < 780 && r.width > 0; }); if (!el) return 'absent';
    const r = el.getBoundingClientRect(); const cy = r.top + r.height / 2; const t = document.elementFromPoint(r.left - 4, cy);
    return { visuel: Math.round(r.width) + 'x' + Math.round(r.height), bord_gauche_moins4: !!(t && (t === el || el.contains(t))) }; }, sel);
  console.log('bouton + ', JSON.stringify(await probe('.k-card-add-trigger')));
  const card = await p.$('#k-grid .k-card'); const bb = await card.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + 60); await p.waitForTimeout(1200);
  console.log('flèche   ', JSON.stringify(await p.evaluate(() => { const el = document.querySelector('#k-modal-prev'); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left - 4, r.top + r.height / 2); return { visuel: Math.round(r.width) + 'x' + Math.round(r.height), bord_gauche_moins4: !!(t && (t === el || el.contains(t))) }; })));
  await b.close(); })();
```
Attendu : `bouton + {"visuel":"30x30","bord_gauche_moins4":true}` ;
`flèche {"visuel":"28x28","bord_gauche_moins4":true}`.
