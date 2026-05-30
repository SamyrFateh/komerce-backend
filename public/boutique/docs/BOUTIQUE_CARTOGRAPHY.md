# Boutique Komerce — Cartographie Maître

> **Généré / vérifié le 30 mai 2026** depuis le code réel (`boutique.zip` du 30/05).
> **Ce document fait autorité** sur tout ce qui concerne "qui possède quoi".
> Il réconcilie `BOUTIQUE_SOURCE_OF_TRUTH.md` (v1.7, 28/05) avec l'état réel du code.
> Mis à jour à chaque PR qui change une propriété. En cas de conflit avec un autre doc → **ce fichier gagne**.
>
> **⚠️ Écarts vs SOT v1.7 documentés en §6.**

---

## §1 — Invariants à ne jamais violer

### Invariants Architecture (BOUTIQUE_ARCHITECTURE.md)

| ID | Règle | Vérifié par |
|----|-------|-------------|
| **I-1** | Aucun CSS orphelin — tout fichier source est bundlé ou supprimé | `npm run audit:arch` |
| **I-2** | Un sélecteur, un owner (exceptions documentées §4) | `npm run audit:arch` |
| **I-3** | Aucun hex en dur hors `tokens.css` (sauf allowlist) | `npm run audit:arch` |
| **I-4** | Aucun token cassé `var(--x)nnn` | `npm run audit:arch` |
| **I-5** | Toute règle desktop sous `@media (min-width: 900px)` | `npm run audit:arch` |
| **I-6** | Variables CSS owned par JS jamais posées par CSS (`--pager-top`, `--bnav-h`, `--modal-scroll-y`) | `npm run audit:arch` |
| **I-7** | Dette ne peut que décroître : breakpoints hors 900/1200 ≤ 35 (baseline), exceptions multi-owner ne peuvent qu'augmenter | `npm run check:breakpoints --strict` |

### Invariants Modal Mobile (MODAL_MOBILE_ARCHITECTURE.md — 13 invariants)

| ID | Règle critique |
|----|----------------|
| **M-MOB-01** | `.k-modal-scroll` = seul scroll owner mobile. Aucun ancêtre `overflow-y:auto` |
| **M-MOB-02** | `.k-modal-actions` = `position:fixed` mobile (jamais sticky) |
| **M-MOB-03** | `padding-bottom` sur `.k-modal-scroll` ≥ 140px + `env(safe-area-inset-bottom)` |
| **M-MOB-04** | `.k-modal-actions` background `var(--white) !important` mobile — jamais transparent |
| **M-MOB-05** | `.k-modal-product-zone` = `display:contents` mobile (jamais flex/grid) |
| **M-MOB-11** | Aucun `@media (min-width:600px)` sans borne supérieure dans §1 et §2 |
| **M-MOB-13** | `.k-modal-delivery-mobile` et `.k-modal-trust-mobile` masqués via `@media(min-width:900px){display:none}` |

> Invariants M-MOB-06→10, M-MOB-12 : voir `MODAL_MOBILE_ARCHITECTURE.md`.

---

## §2 — Breakpoints autorisés

**Un seul système :** `900px` (mobile → desktop), `1200px` (large).

**Exceptions documentées et intentionnelles** (ne pas supprimer) :
- `@media (max-width: 899px)` dans `modal.css` §2 : mobile guard haute spécificité `#k-modal` — équivalent fonctionnel de la base, gardé pour la spécificité.
- `@media (min-width: 768px)` dans `modal.css` lignes 1235/1292/1313 : composants dialogue (guide des tailles `.k-sg-*`) — centrage avant 900px, comportement de panneau, **marqués INTENTIONNEL** dans le code.

**Violations actives (baseline 35 — à réduire sprint par sprint) :**

| Fichier | Breakpoints hors charte |
|---------|------------------------|
| `group-cart-flow.css` | 390, 600, 700, 999, 1000, 1100, 1400px |
| `cart.css` | 380, 600, 768, 899px |
| `modal.css` | ~~480, 600px~~ → **Sprint 1** · 768px (intentionnel) · 899px (intentionnel) |
| `hero.css` | 140, 767, 899px |
| `shared-followup.css` | 390, 899, 1280px |
| `categories.css` | 767, 899px |
| et 9 autres... | voir `npm run check:breakpoints` |

---

## §3 — Carte CSS (qui style quoi)

### Règle de lecture

**Owner principal** = fichier qui possède le sélecteur.
**Override desktop légitimes** = `boutique-desktop.css` peut surcharger sous `@media (min-width:900px)` — documenté dans `audit-boutique-arch.js`.
🔴 = multipropriété non résolue (violation I-2 à résorber).

### Table de propriété CSS

| Composant | Owner CSS principal | Overrides légitimes | Multi-own ? |
|-----------|--------------------|--------------------|:-----------:|
| **Tokens / Reset** | `tokens.css`, `reset.css` | — | ✅ |
| **Squelette page mobile** | `layout.css` | `boutique-desktop.css` (`≥900px`) | ✅ |
| **Hero mobile** | `hero.css` | `desktop-commerce-skeleton.css` | ✅ |
| **Hero bubble proxy** | `hero-cart-proxy.css` | — | ✅ |
| **Chips catégories** | `categories.css` (33 sélecteurs) | `boutique-desktop.css` (11), `interactions.css` (animations) | ⚠️ |
| **Grille + cartes produit** | `products.css` | `boutique-desktop.css` (hovers), `desktop-commerce-skeleton.css` | ⚠️ |
| **Modal produit** `.k-modal*` | `modal.css` (352 règles) | `boutique-desktop.css` (20, scope desktop) | ⚠️ |
| **Panier / Side-cart** | `cart.css` | `boutique-desktop.css` (layout side-cart) | ⚠️ |
| **Micro-interactions** | `interactions.css` | — | ✅ |
| **Groupe / panier partagé** `.k-group-*` | `group-cart-flow.css` | — | ✅ |
| **Desktop premium** (mega-nav, chips desktop) | `boutique-desktop.css` | — | ✅ |
| **Squelette commerce desktop** | `desktop-commerce-skeleton.css` | — | ✅ |
| **Shared followup** | `shared-followup.css` | — | ✅ |
| **Event** | `event.css` | — | ✅ |

---

## §4 — Carte JS (qui touche quoi)

### Fichiers verrouillés 🔒 — review obligatoire avant toute modif

| Fichier | Ce qu'il contrôle |
|---------|-------------------|
| `js/b-pager.js` 🔒 | Moteur cage mobile Temu, `--pager-top`, ghost loop — ne pas toucher |
| `js/b-store.js` 🔒 | Refs DOM partagées, `initDom()`, `CART_VERSION` — fondation |
| `js/b-scroll-owner.js` 🔒 | Détection mobile/desktop, `isDesktop()` — breakpoint logique |
| Script `<body>` inline 🔒 | Proxy `window.scrollY` (index.html ~480-550) |

### Modal JS — architecture réelle (post-ARCH-2)

> ⚠️ **La SOT v1.7 parle de `b-modal.js` comme orchestrateur** — c'est périmé.
> `b-modal.js` est une **façade pure** (28 lignes, ré-exporte seulement).
> La logique réelle est dans les sous-modules ci-dessous.

| Module | Rôle | DOM (écritures) | Gating |
|--------|------|:---:|--------|
| `b-modal.js` | Façade / ré-export — **ne contient pas de logique** | 0 | — |
| `b-modal-core.js` | Cycle open/close, overlay, scroll-lock, carousel, zoom, bus | 33 | tous contextes |
| `b-modal-product.js` | Rendu fiche : prix, images, variants, trust-mobile, delivery-mobile | 42 | tous contextes |
| `b-modal-nav.js` | Navigation prev/next, retour catalogue, historique | 10 | tous contextes |
| `b-modal-cart.js` | Stepper qty + ajout panier | 2 | tous contextes |
| `b-modal-suggestions.js` | Rail suggestions + filtre sous-catégorie | 4 | tous contextes |
| `b-modal-desktop-enhancers.js` | Trust, delivery, breadcrumb, flash timer, zoom loupe | 44 | `isDesktop()` |
| `b-modal-approche-c-hybrid.js` | Réorganisation PDP type-C | 31 | `isDesktop()` |
| `b-modal-image-ux.js` | Lightbox fullscreen, swipe, pinch-zoom | 8 | tous contextes |
| `b-modal-social-proof.js` | Rendu `.k-modal-meta` (social proof réel) | 9 | tous contextes |
| `b-pdp-curation-suggestions.js` | Rail suggestions curées | 14 | tous contextes |

**Propriété DOM du modal** : `core` (shell/cycle) + `product` (contenu fiche) + `nav` (navigation) sont les 3 owners de fait. Les autres émettent via le bus ou passent par leurs hooks.

### Modules à fort impact (surveiller en refacto)

| Module | Écritures DOM | Composants touchés | Risque |
|--------|:---:|---|:---:|
| `b-checkout.js` | **116** | Bottom-nav, checkout flow | 🔴 Haut |
| `b-cart.js` | **58** + 37 CSS | Modal, side-cart, panier, cartes, header, chips, bnav | 🔴 Haut |
| `b-catalog-desktop-enhancers.js` | 23 | Cartes, grille, header, hero, chips | 🟠 Moyen |

### Orphelins confirmés (ne pas importer, à supprimer)

| Fichier | Statut |
|---------|--------|
| `js/b-mobile-premium-v1.js` | ❌ Orphelin — aucun import trouvé |
| `js/b-mobile-modal-v1.js` | ❌ Orphelin — CSS neutralisé |
| `js/b-modal-social-proof-mock.js` | ❌ Orphelin — mock non connecté |
| `js/b-group-cart-flow.js` | ❌ Stub vide (DEPRECATED PR-1) |

---

## §5 — Ordre de chargement

### CSS (bundles → dist, chargés par index.html)

```
base.css       = tokens + reset + layout + hero
components.css = categories + products + modal + cart + interactions
                 + hero-cart-proxy + group-cart-flow + shared-followup
desktop.css    = boutique-desktop + desktop-commerce-skeleton
event.css      = event (pages événement uniquement)
```

### JS (main.js — 15 imports dans l'ordre)

```
b-utils → b-bus → b-store → boutique → share-phone-guard →
desktop-upgrade → scroll-owner → product-open-contract →
cart-product-open-style → modal-desktop-enhancers →
modal-approche-c-hybrid → pdp-curation-suggestions →
home-premium-v1 → greeting (⚠️ importé mais NON appelé — dead import)
```

---

## §6 — Écarts vs SOT v1.7 (28/05/2026)

| Point | Ce que dit SOT v1.7 | Réalité du code au 30/05 | Action |
|-------|--------------------|--------------------------|----|
| `b-modal.js` | "Orchestrateur modal, cycle ouverture/fermeture" | Façade pure 28 lignes, 0 logique | **Corriger SOT §2B** |
| Owner modal CSS | `modal.css` owner unique | 6 fichiers CSS stylent `.k-modal*` | Sprint 3 |
| `b-greeting` | Non mentionné | Importé dans main.js mais jamais appelé | Supprimer import |
| `!important` total | "35 ⚠️" | **35** — inchangé | Sprint 6 |
| Breakpoints modal | Non problématisé | 480px + 600px violations actives | **Sprint 1** |
| `b-mobile-premium-v1.js` | "Orphelin ❌" | Confirmé orphelin | À supprimer |

---

## §7 — Score de contrôle (cliquet I-7)

Mis à jour après chaque sprint. Régénéré par `npm run audit:ownership`.

| Indicateur | 30/05/2026 | Après S1 | Après S3 | Cible |
|------------|:---:|:---:|:---:|:---:|
| Composants multipropriété CSS | 8 | 8 | 0 | 0 |
| Breakpoints distincts | 20 | ~18 | ~10 | ≤ 2 |
| Violations breakpoint | 35 | **33** | ~20 | 0 |
| Modules JS écrivant le DOM | 39 | 39 | 35 | ≤ 10 |
| `!important` | 35 | 35 | 35 | < 5 |

---

## §8 — Workflow PR (rappel)

```bash
# 1. Modifier uniquement les sources (jamais css/dist/)
# 2. Rebundler
npm run bundle:css

# 3. Vérifier tout
npm run check:all   # inclut breakpoints + audit:arch + ownership + tests e2e

# 4. Si breakpoints améliorés → geler le gain
npm run check:breakpoints:save

# 5. Régénérer la carte
npm run audit:ownership

# 6. Committer sources + dist + docs ensemble (règle d'or)
git add css/ docs/
git commit -m "..."
```

**Règle d'or** : sources, dist et `BOUTIQUE_OWNERSHIP_LIVE.md` dans le **même commit**.
