# Boutique — Correctifs visuels (register actif)

> **Rôle** : register chirurgical des bugs visuels/CSS/JS boutique à corriger, avec fichier + ligne + correctif prêt à appliquer.
> **Statut** : ACTIF — mis à jour à chaque PR qui ferme une ligne.
> **Hiérarchie** : subordonné à `BOUTIQUE_ARCHITECTURE.md` (normatif). En cas de conflit, `BOUTIQUE_ARCHITECTURE.md` gagne ; aligner ce fichier.
> **Pipeline** : tout correctif CSS édite les **sources** (`css/*.css`), jamais `css/dist/*`. Relancer `npm run bundle:css` après. Cf. `BOUTIQUE_CSS_PIPELINE.md`.
> Créé : 30 mai 2026 — source : audit visuel prod (`komerce-backend-production.up.railway.app`).

---

## 0. Tableau de bord (cocher en PR)

| ID | Bug | Surface | Sévérité | Owner principal | Statut |
|----|-----|---------|----------|-----------------|--------|
| VIS-1 | Cartes accueil poussées à gauche + rognées quand side-cart docké | Desktop ≥900px | 🟠 Haute | `css/layout.css` | ☐ |
| VIS-2 | Compteur panier de l'avatar (« petite dame ») désynchronisé | Mobile | 🟡 Moyenne | `js/b-cart-core.js` | ☐ |
| VIS-3 | Modal mobile : description + boutons qui débordent, titre chevauché | Mobile <900px | 🔴 Bloquant UX | `css/modal.css` + `js/b-modal-product.js` | ☐ |
| VIS-6 | Modal produit décalée à droite, accueil visible derrière (Samsung Internet + pager swipé) | Mobile <900px Samsung/Chrome Edge Panels | 🟠 Haute | `css/modal-shell.css` + `js/b-modal-core.js` | ✅ |
| DOC-U1 | Doc boutique dupliquée (`docs/boutique/` ↔ `public/boutique/docs/`) | Gouvernance | 🟠 Haute | ce dossier | ☐ |
| DOC-U2 | `.docx` + `.md` jumeaux des MODAL_*_ARCHITECTURE | Gouvernance | 🟢 Faible | ce dossier | ☐ |
| DOC-U3 | VIS-4 et VIS-5 référencés dans le code (`modal-shell.css:285, 438` et `:68, 76`) mais ABSENTS du tableau §0 — historique perdu | Gouvernance | 🟠 Haute | ce dossier | ☐ |

> Légende : ☐ à faire · ⏳ en cours · ✅ fait (dater + n° PR). Quand une ligne passe ✅, ajouter une entrée datée en §5 Journal.

---

## VIS-1 — Cartes accueil poussées à gauche + rognées (side-cart docké, desktop)

**Symptôme** (capture desktop, panier docké, 1 article) : l'en-tête « Tendances du moment » est coupé à gauche (« lans du moment »), le logo header et la 1ʳᵉ carte produit sont rognés hors écran. La droite paraît correcte car cachée sous le panneau panier.

**Cause racine — pure CSS, pas de JS en cause.**
La réserve d'espace du side-cart docké se fait par `padding-right` sur `body` :

- `css/boutique-desktop.css:1531-1534` → `body:has(.k-side-cart.has-items), body.sc-reserve { padding-right: 240px; }`
- `css/boutique-desktop.css:1554-1557` → idem `254px` en `@media (min-width:1200px)`

Or les conteneurs centrés sont à largeur fixe :

- `css/layout.css:422-426` → `#k-catalog-section { max-width: var(--container); margin: 0 auto; }`
- `css/layout.css:441-447` → `.k-header-inner { max-width: var(--container); margin: 0 auto; }`
- `css/tokens.css:62` → `--container: 1400px`

Quand le panier est docké, la largeur de contenu du body = `100vw − 254px`. Dès que cette largeur passe **sous 1400px** (ex. viewport effectif ~1520px en mise à l'échelle Windows 125 % → 1520 − 254 = 1266 < 1400), `margin: 0 auto` calcule des marges **négatives symétriques** → le bloc déborde des deux côtés ; la droite disparaît sous le panneau `position:fixed`, la gauche est clippée hors écran (logo + titre + 1ʳᵉ carte). Le `padding-right` seul ne décale rien ; c'est l'écart `--container` (1400) > largeur dispo qui produit le clip.

**Correctif chirurgical** — caper la largeur des conteneurs centrés à l'espace réellement disponible quand le panier est docké, et **unifier la largeur de réserve dans un token unique** (évite que 240/254 et le cap divergent).

Dans `css/layout.css`, bloc `@media (min-width: 900px)` (après la ligne 426) :

```css
/* VIS-1 — réserve side-cart docké : token unique partagé padding ⇄ cap largeur */
:root { --sc-reserve-w: 240px; }

/* Empêche les conteneurs centrés de déborder quand le side-cart réserve sa bande.
   Sans ce cap, max-width:1400 + margin:0 auto part en marges négatives dès que
   (100vw - réserve) < 1400 → clip gauche du logo / titre / 1ʳᵉ carte. */
body.sc-reserve #k-catalog-section,
body:has(.k-side-cart.has-items) #k-catalog-section,
body.sc-reserve .k-header-inner,
body:has(.k-side-cart.has-items) .k-header-inner {
  max-width: min(var(--container), calc(100vw - var(--sc-reserve-w)));
}
```

Dans `css/layout.css`, ajouter le palier 1200 du token (à côté des autres règles `@media (min-width:1200px)`) :

```css
@media (min-width: 1200px) { :root { --sc-reserve-w: 254px; } }
```

Puis **source de vérité unique** : dans `css/boutique-desktop.css`, remplacer les littéraux par le token —
`:1533` `padding-right: 240px;` → `padding-right: var(--sc-reserve-w, 240px);`
`:1556` `padding-right: 254px;` → `padding-right: var(--sc-reserve-w, 254px);`

Rebundler : `npm run bundle:css` (régénère `dist/base.css` + `dist/desktop.css`), bumper le `?v=` des `<link>` de `index.html` (cf. `check-cache-buster.js`).

**Validation** : à 1280 / 1366 / 1440 px de largeur CSS, panier à 1 article → logo header + « Tendances du moment » + 1ʳᵉ carte entièrement visibles, aucun clip gauche, panneau panier toujours docké à droite. Tester aussi ≥1654px (cas où ça ne clippait pas déjà) : pas de régression.

**Ne pas** : remettre `body { overflow-x: clip }` (cassait l'ancrage `position:fixed` du side-cart — cf. note `layout.css:405-417`).

---

## VIS-2 — Compteur panier de l'avatar (« petite dame ») sur mobile

**Symptôme** : le compteur de l'avatar panier (bulle en haut à droite) paraît incorrect / désynchronisé sur mobile.

**Ce qui est ÉCARTÉ (vérifié, ne pas y toucher)** :
- **CSS du badge OK** : `.k-cart-badge` est `transform: scale(0)` au repos et `.k-cart-btn.is-empty .k-cart-badge { display:none }` (`css/layout.css:153,202`) → pas de flash « 0 ». `min-width:20px; padding:0 6px` gère 2 chiffres → pas de débordement. **Le problème n'est pas visuel.**
- **`b-mini-cart.js` est mort** : non importé dans `main.js` → son badge `.kmc__badge` n'est jamais rendu. Pas la cause.
- **`b-home-premium-v1.js`** ne touche ni l'avatar ni le compteur (uniquement CSS hero/side-cart). Pas la cause.

**Source de vérité unique du compteur** : `js/b-cart-core.js:74` `updateCartBadge()` →
`count = cartQty()` (somme des `qty`), appliqué à `.k-cart-badge, .k-modal-cart-badge, #k-bnav-cart-badge`. Markup : `index.html:120` (`#k-cart-badge` avatar), `:273` (`#k-modal-cart-badge`), `:467` (`#k-bnav-cart-badge`).

**Diagnostic restant = désynchro d'état, pas CSS.** Le seul moyen d'une bulle « fausse » est qu'une mutation de `state.cart` n'appelle pas `saveCart()` (qui appelle `updateCartBadge()`). À confirmer par **repro 2 min** (impossible à figer statiquement) :

1. Après chaque action, comparer **3 valeurs** qui doivent toujours être égales à `cartQty()` :
   - bulle avatar (`#k-cart-badge`),
   - badge bnav (`#k-bnav-cart-badge`),
   - décompte side-cart / « Commander (n) ».
2. Actions à tester : ajout depuis la grille, ajout depuis la PDP (« Ajouter »), `+/−` quantité dans la PDP, suppression dans le drawer, retour après restauration shared-cart.
3. **L'action où les valeurs divergent = le chemin fautif.**

**Invariant à imposer** (à inscrire ensuite dans `BOUTIQUE_SOURCE_OF_TRUTH.md`) :
> Toute mutation de `state.cart` se termine par `saveCart()`. Jamais de `state.cart.push/splice/=` nu.

**Audit ciblé** (fichiers candidats) : `js/b-cart.js` (addToCart / qty / remove), `js/b-checkout.js`, `js/b-group-view.js` + `js/b-share-cart.js` (fusion panier groupe → mutent-ils `state.cart` sans `saveCart()` ?), `js/b-catalog.js`. Grep de départ : `grep -rn "state.cart" js/ | grep -vE "saveCart|cartQty|cartTotal|reduce|forEach|map\("`.

**Correctif type** : router chaque mutation par `saveCart()`, ou exposer un setter unique `setCart(next)` dans `b-store.js` qui persiste + `updateCartBadge()`.

---

## VIS-3 — Modal mobile : description + boutons qui débordent, titre chevauché

**Symptôme** (PDP mobile) : le titre est coupé au raccord image/carte, la description n'apparaît pas, la barre d'actions / « Acheter » déborde en bas (sous la barre du navigateur). C'est le bug « que personne n'arrive à résoudre ».

**Architecture en place** (à connaître avant de toucher) :
- `#k-modal` est `display:flex; flex-direction:column; height:100dvh` (`modal.css:41-46`).
- `.k-modal-scroll { flex:1; overflow-y:auto }` = **seul scroll owner mobile** (`modal.css:111-119`).
- `.k-modal-product-zone { display:contents }` en mobile (`modal.css:125-126`) → img-wrap, details, actions deviennent enfants directs du scroll, ordre naturel.
- **Fix v5** : `setupModal()` (`js/b-modal-core.js:408-412`) **sort `.k-modal-actions` du scroll** et la place enfant direct de `#k-modal` (`appendChild`) pour l'ancrer en bas via flex. CSS associé : `modal.css:552-563` (`#k-modal > .k-modal-actions { position:static }` + `#k-modal > .k-modal-scroll { padding-bottom:0 }`).

**Causes racines (3 compounding) :**

**(A) — La trust-bar mobile est injectée HORS du scroll.**
`js/b-modal-product.js:322-339` `_injectMobileTrust()` fait :
```js
var actions = dom.modal.querySelector('.k-modal-actions');
...
actions.parentNode.insertBefore(el, actions);
```
Mais après le Fix v5, `actions.parentNode === #k-modal`. Donc `.k-modal-trust-mobile` devient un **sibling épinglé** entre `.k-modal-scroll` et `.k-modal-actions`, au lieu d'être le dernier élément scrollable. Ça gonfle la zone basse fixe (trust ~38px + actions ~122px) que la compensation de scroll ne prévoit pas → le bas du contenu (description, boutons) passe derrière.

**Correctif** — insérer la trust-bar **dans le scroll**, en fin de `.k-modal-info`, jamais relativement aux actions :
```js
function _injectMobileTrust() {
  if (!dom.modal) return;
  var old = dom.modal.querySelector('[data-mobile-trust]');
  if (old) old.remove();

  var info = dom.modal.querySelector('.k-modal-info');   // ← ancre STABLE, dans le scroll
  if (!info) return;

  var el = document.createElement('div');
  el.className = 'k-modal-trust-mobile';
  el.setAttribute('data-mobile-trust', '1');
  el.innerHTML =
    '<span class="k-modal-trust-mobile-item">📍 Retrait en relais</span>' +
    '<span class="k-modal-trust-mobile-item">💵 Paiement cash</span>' +
    '<span class="k-modal-trust-mobile-item">🔄 Échange 14 j</span>';

  info.appendChild(el);   // dernier élément du contenu scrollable, AVANT la barre CTA épinglée
}
```
(Idem vérifier `_injectMobileDelivery`, `js/b-modal-product.js:290-317` : il insère bien dans `.k-modal-info` via `.k-modal-meta` — OK, le garder dans le scroll.)

**(B) — Le titre tombe dans le raccord image/carte.**
`.k-modal-details { margin-top:-20px; z-index:2 }` (`modal.css:319`) remonte la carte de 20px sur l'image (effet voulu), mais `.k-modal-info { padding:12px }` (`modal.css:328`) ne donne que 12px en haut → le `h2` peut passer sous le bas de l'image.

**Correctif** — `modal.css:328`, top ≥ chevauchement :
```css
.k-modal-info { padding: clamp(20px, 5vw, 26px) 12px 12px; display: flex; flex-direction: column; }
```

**(C) — « Acheter » colle/déborde sous la barre du navigateur (Android).**
`.k-modal-actions { ... padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); }` (`modal.css:475`) — **pas de fallback** sur `env()`. Sur Android, `safe-area-inset-bottom` vaut souvent 0 alors que la barre nav recouvre quand même → CTA tronqué. (Le scroll, lui, a un fallback `env(..., 48px)` `modal.css:545` → incohérence.)

**Correctif** — `modal.css:475`, ajouter un fallback :
```css
padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 12px));
```

**(D) — Double compensation de hauteur, magic number.**
La compensation de la barre basse existe en double : CSS magic `padding-bottom: calc(150px + env(...))` (`modal.css:545`) ET JS `_syncScrollPadding()` (`js/b-modal-product.js:263-285`). Aucune n'inclut la trust-bar. Une fois (A) corrigé (trust dans le scroll), la barre basse = actions seules.

**Correctif** — source unique mesurée : exposer la hauteur réelle des actions en var CSS depuis `_syncScrollPadding()` et l'utiliser :
```js
// dans _syncScrollPadding(), après mesure de actBar :
document.documentElement.style.setProperty('--k-modal-cta-h', actBar.offsetHeight + 'px');
```
```css
/* modal.css:545 — remplace le 150px magique */
.k-modal-scroll { padding-bottom: calc(var(--k-modal-cta-h, 150px) + env(safe-area-inset-bottom, 12px)); }
```
(Garder le court-circuit `#k-modal > .k-modal-scroll { padding-bottom:0 }` quand les actions sont en flex statique — `modal.css:561-563`.)

**Invariants modal mobile** : ce bug touche `MODAL_MOBILE_ARCHITECTURE.md` (M-MOB-01→13). Le SOT dit le chantier modal « CLÔTURÉ ✅ » : c'est **faux pour le mobile** — rouvrir la ligne dans `BOUTIQUE_SOURCE_OF_TRUTH.md` et `MODAL_MOBILE_ARCHITECTURE.md` une fois corrigé.

**Validation** (viewport 360×640, Android) : produit avec **description longue** → titre entièrement visible (pas sous l'image), description entièrement scrollable, pills de réassurance qui **scrollent avec le contenu** (plus épinglées), « Acheter » entièrement visible au-dessus de la barre nav, aucun contenu masqué derrière la CTA. Tester aussi un produit **sans description**.

---

## VIS-6 — Modal produit décalée à droite, accueil visible derrière (Samsung Internet)

**Symptôme** (capture mobile Samsung Internet) : la modal produit (« Article Tech raffiné », bouton Acheter visible) couvre ~92% du viewport en largeur. À droite, une bande de 15-30px laisse apparaître l'écran d'accueil derrière (chips de catégories orange). L'utilisateur perçoit la modal comme « décalée à gauche ». Reproductible UNIQUEMENT si **3 conditions sont simultanément réunies** :
1. Samsung Internet OU Chrome Android avec Edge Panels actifs (le navigateur réserve une zone de geste sur le bord droit)
2. L'utilisateur a préalablement swipé entre catégories sur le home (`#k-grid.k-grid-flat-subcat` est à `scrollLeft > 0`)
3. Ouverture d'une modal produit (n'importe laquelle)

Invisible en DevTools desktop (les Edge Panels n'existent pas en émulation) → c'est « le bug que personne ne reproduit ».

**Architecture en place** (à connaître avant de toucher) :
- `#k-modal-overlay` est `position:fixed; inset:0; z-index:300` (`modal-shell.css:12-17`).
- En mobile (`@media (max-width: 899px)`), historiquement `width:100vw; max-width:100vw` (`modal-shell.css:355-382` AVANT VIS-6).
- `#k-grid.k-grid-flat-subcat` est un container `overflow-x:auto` + `scroll-snap-type: x mandatory` (`cart.css:730-746`) — c'est le pager horizontal Temu.
- `b-modal-core.js:288-313` **neutralise** les styles inline du pager (`position:fixed` + `overflow:hidden`) à l'ouverture de la modal, parce que ces styles bloquent le scroll interne `.k-modal-scroll` sur Chrome Android.

**Causes racines (3 compounding) :**

**(A) — `width:100vw` < viewport visuel sur Samsung Internet Edge Panels.**
Sur Samsung One UI avec Edge Panels activés (paramètre par défaut sur de nombreux modèles), `100vw` correspond au layout viewport et **n'inclut pas la zone réservée aux gestes de bord**. Le viewport visuel réel est plus large de 15-30 CSS pixels. Donc `#k-modal-overlay` avec `width:100vw` ne couvre pas la zone droite. Combiné avec `inset:0`, l'effet est l'un OU l'autre — le navigateur résout `right:0 + width:100vw + left:0` par overflow visible ou troncature côté droit.

**(B) — `#k-grid.scrollLeft` non remis à zéro pendant la modal.**
Après neutralisation des styles inline du pager (`b-modal-core.js:303-312`), le `scrollLeft` du `#k-grid.k-grid-flat-subcat` reste à sa valeur courante. Si l'utilisateur était sur la page 2 du pager, `scrollLeft ≈ clientWidth`. Tout pixel d'arrière-plan visible affiche donc une catégorie potentiellement décalée — visuellement perçu comme « écran d'accueil mal cadré » derrière la modal.

**(C) — Pas de stacking context strict sur l'overlay mobile.**
Sans `contain: layout paint` ou équivalent, l'overlay reste sensible aux transforms ancestraux résiduels (animations CSS en cours, will-change posé ailleurs). Sur Chrome Android avec mode économie batterie, les optimisations de composition peuvent introduire des artefacts de subpixel rendering qui amplifient (A).

**Correctifs (les 3 ensemble — défense en profondeur) :**

*1. `css/modal-shell.css:355-415`* — remplacer le bloc `@media (max-width: 899px)` :
```css
@media (max-width: 899px) {
  #k-modal-overlay {
    position: fixed;
    /* Ancrage 4 côtés sans width:100vw : on évite le mismatch
       entre layout viewport (100vw) et visual viewport (réel). */
    top: 0; right: 0; bottom: 0; left: 0;
    width: auto;
    max-width: none;
    overflow: hidden;
    justify-content: flex-start;
    align-items: stretch;
    /* Force un stacking context strict, indépendant des transforms
       ancestraux résiduels (Chrome Android Edge Panels). */
    contain: layout paint;
  }
  #k-modal {
    width: 100%;       /* 100% du parent (overlay) plutôt que 100vw */
    max-width: 100%;
    min-width: 0;
    margin: 0;
    border-radius: 0;
    flex-shrink: 0;
  }
  #k-modal .k-modal-actions {
    left: 0; right: 0;
    width: 100%; max-width: 100%;
    margin: 0;
  }
}
```

*2. `js/b-modal-core.js` — dans `openModal()`, après la neutralisation du pager (~ligne 313)* — figer `scrollLeft` du grid :
```js
// VIS-6 — figer scrollLeft du grid pendant la modal.
if (window.innerWidth < 900) {
  var _grid = document.getElementById('k-grid');
  if (_grid && _grid.classList.contains('k-grid-flat-subcat')) {
    state._savedGridScrollLeft = _grid.scrollLeft;
    _grid.style.scrollSnapType = 'none'; // évite l'animation de snap visible
    _grid.scrollLeft = 0;
  }
}
```

*3. `js/b-modal-core.js` — dans `closeModal()`, après la restauration des styles inline du pager* — restaurer `scrollLeft` :
```js
// VIS-6 — restaurer le scrollLeft du grid.
if (window.innerWidth < 900 && typeof state._savedGridScrollLeft === 'number') {
  var _gridRestore = document.getElementById('k-grid');
  if (_gridRestore && _gridRestore.classList.contains('k-grid-flat-subcat')) {
    var _restoreLeft = state._savedGridScrollLeft;
    requestAnimationFrame(function() {
      _gridRestore.scrollLeft = _restoreLeft;
      _gridRestore.style.scrollSnapType = '';
    });
  }
  state._savedGridScrollLeft = null;
}
```

**⚠️ Tentations de simplification à NE PAS suivre** (voir `M-MOB-14` ajouté à `BOUTIQUE_CARTOGRAPHY.md`) :
- *« Remettre `width: 100vw`, c'est plus simple »* → réintroduit le bug Samsung Internet
- *« Le `contain: layout paint` est inutile »* → c'est lui qui isole l'overlay des stacking contexts parents
- *« Le `scrollLeft = 0` du grid est cosmétique »* → c'est la ceinture si le CSS rate son coup sur un device non-testé
- *« Un `overflow-x: hidden` sur body suffirait »* → tuerait le scroll horizontal du pager Temu (rupture M-MOB-01 par effet de bord)

**Validation** (Samsung Internet réel, Edge Panels ON, viewport 360×780) :
1. Aller sur le home, swiper vers la 2e catégorie (vérifier `#k-grid.scrollLeft > 0`)
2. Tapper une carte produit → modal s'ouvre
3. Dans la console : `document.getElementById('k-modal-overlay').getBoundingClientRect()` doit retourner `{ left: 0, right: window.innerWidth, width: window.innerWidth }`
4. Aucune bande d'accueil visible à droite. Fermer la modal → retour à la 2e catégorie avec `scrollLeft` restauré.
5. Tester aussi sur Chrome Android sans Edge Panels (cas standard) → pas de régression.

**Invariant émis** : `M-MOB-14` ajouté à `BOUTIQUE_CARTOGRAPHY.md §1` :
> `#k-modal-overlay` mobile interdit `width:100vw` — utiliser `top/right/bottom/left:0` + `contain: layout paint`. Le `scrollLeft` du `#k-grid.k-grid-flat-subcat` doit être figé à 0 pendant la durée de vie de la modal.

---

## DOC-U — Unicité des docs (demandé : « voir l'unicité des docs »)

Constats vérifiés à intégrer dans la gouvernance :

**DOC-U1 — Doc boutique en double ET divergente.**
`docs/boutique/` (15 fichiers) **et** `public/boutique/docs/` (24 fichiers) coexistent avec des noms qui se recouvrent (`BOUTIQUE_ARCHITECTURE.md`, `BOUTIQUE_DOCS_INDEX.md`, `BOUTIQUE_MODAL_ARCHITECTURE.md`, `BOUTIQUE_COMPONENT_OWNERSHIP.md`…). `diff` confirme qu'au moins `BOUTIQUE_ARCHITECTURE.md` **diverge** entre les deux. Le home canonique (qui a le SOT, `CARTOGRAPHY_360_BOUTIQUE.md`, les `MODAL_*`) est **`public/boutique/docs/`**.
→ **Action** : faire de `public/boutique/docs/` l'unique source ; remplacer `docs/boutique/` par un simple pointeur (`README.md` : « voir `public/boutique/docs/` »), ou l'archiver dans `docs/_archive/`. Ne pas maintenir deux copies.

**DOC-U2 — `.docx` jumeaux des `.md`.**
`public/boutique/docs/MODAL_DESKTOP_ARCHITECTURE.{docx,md}` et `MODAL_MOBILE_ARCHITECTURE.{docx,md}` coexistent. Le `.md` est la source versionnable.
→ **Action** : garder le `.md`, déplacer les `.docx` dans `_archive/` (ou supprimer).

**Connexes (hors boutique, déjà signalés à l'audit backend)** : `.cursorrules` pointe vers des docs désormais dans `docs/_archive/` (`AGENT_CONFIG.md`, `ROADMAP_KOMERCE.md`, `AUDIT_REPORT.md`) ; et `docs/CARTOGRAPHY_360.md` / `docs/ZONE_IMPACT.md` ont un double dans `docs/chantier/`. À traiter dans le lot DOC-INTEGRITY.

**Intégration de CE fichier** : ajouter `BOUTIQUE_VISUAL_FIXES.md` dans `public/boutique/docs/BOUTIQUE_DOCS_INDEX.md` (§1, ligne « correctifs visuels en cours → ce fichier »), subordonné à `BOUTIQUE_ARCHITECTURE.md`.

---

## DOC-U3 — VIS-4 et VIS-5 fantômes (référencés dans le code, absents du tableau §0)

**Constat** (audit du 8 juin 2026, pendant l'ajout de VIS-6) :
Le code contient des références à des IDs VIS-* qui ne figurent PAS dans le tableau de bord §0 :

| ID | Référencé dans | Sujet déduit du commentaire |
|----|----------------|------------------------------|
| `VIS-4` | `css/modal-shell.css:285, 438` | `#k-modal-nav { display:none; visibility:hidden }` — éliminer le flash d'une frame avant résolution de la media query |
| `VIS-5` | `css/modal-shell.css:68, 76` | Décalage du badge `.k-modal-cart-badge` de `top:-2px` à `top:-4px` pour sortir du gap `.k-modal-topbar-right` |
| `VIS-3A`, `VIS-3B`, `VIS-3C`, `VIS-3D` | `js/b-modal-product.js:275, 326` + `css/dist/components.css:2209-2211` | Sous-causes de VIS-3 (présentes dans VIS-3 du tableau ✓ mais non listées explicitement) |

**Risque** : un dev futur qui voit `/* VIS-4: ... */` dans le code va chercher dans ce register et ne trouvera rien. Conclusion possible : « commentaire obsolète, je supprime ». **Régression réintroduite silencieusement**.

→ **Action** : rétro-documenter VIS-4 et VIS-5 (entrées rapides : Symptôme + Correctif appliqué + date estimée), même si elles sont passées en ✅. Marquer les sous-causes VIS-3A/B/C/D explicitement dans la section VIS-3.

→ **Garde-fou** à ajouter à `npm run audit:arch` : signaler tout tag `VIS-N` dans le code dont l'ID N'EXISTE PAS dans `BOUTIQUE_VISUAL_FIXES.md`. Évite que la dette ne se ré-accumule.

---

## 5. Journal (ajouter une ligne datée à chaque ✅)

| Date | ID | PR | Note |
|------|----|----|------|
| 2026-05-30 | — | — | Création du register (audit visuel prod). VIS-1/2/3 + DOC-U1/U2 ouverts. |
| 2026-06-08 | VIS-6 | — | Ouvert + résolu (sliver droit Samsung Internet). Fix CSS + JS livré, invariant M-MOB-14 ajouté au carto. |
| 2026-06-08 | DOC-U3 | — | Ouvert : VIS-4/5 trouvés dans le code mais absents du tableau §0. Dette de rétro-documentation à clôturer. |

---

## 6. Règle de mise à jour

Quand une ligne du §0 passe ✅ : (1) cocher le tableau, (2) ajouter au Journal §5 (date + PR), (3) si un invariant modal/owner change, répercuter dans `BOUTIQUE_SOURCE_OF_TRUTH.md` / `MODAL_MOBILE_ARCHITECTURE.md` **dans la même PR** (règle `AGENTS.md` §3/§4).
