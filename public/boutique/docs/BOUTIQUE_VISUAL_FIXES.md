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
| DOC-U1 | Doc boutique dupliquée (`docs/boutique/` ↔ `public/boutique/docs/`) | Gouvernance | 🟠 Haute | ce dossier | ☐ |
| DOC-U2 | `.docx` + `.md` jumeaux des MODAL_*_ARCHITECTURE | Gouvernance | 🟢 Faible | ce dossier | ☐ |

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

## 5. Journal (ajouter une ligne datée à chaque ✅)

| Date | ID | PR | Note |
|------|----|----|------|
| 2026-05-30 | — | — | Création du register (audit visuel prod). VIS-1/2/3 + DOC-U1/U2 ouverts. |

---

## 6. Règle de mise à jour

Quand une ligne du §0 passe ✅ : (1) cocher le tableau, (2) ajouter au Journal §5 (date + PR), (3) si un invariant modal/owner change, répercuter dans `BOUTIQUE_SOURCE_OF_TRUTH.md` / `MODAL_MOBILE_ARCHITECTURE.md` **dans la même PR** (règle `AGENTS.md` §3/§4).
