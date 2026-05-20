# Komerce Boutique — Source de Vérité Unique

> **Ce document est la carte maître.**
> Il gèle la version gagnante de chaque composant : fichier propriétaire, rôle exact,
> état du code, et dette connue.
>
> Statut : **GEL v1.0 — 20 mai 2026**
> Hiérarchie : se place sous `BOUTIQUE_ARCHITECTURE.md` (normatif) et au-dessus des docs composants.
> Mis à jour uniquement lors d'une PR qui change un propriétaire ou un rôle.

---

## 0. Protocole de lecture obligatoire (agents et humains)

Avant toute modification du projet :

```
1. README.md                         ← point d'entrée absolu
2. docs/BOUTIQUE_DOCS_INDEX.md       ← guide vers la bonne doc
3. docs/BOUTIQUE_ARCHITECTURE.md     ← 6 invariants normatifs
4. docs/BOUTIQUE_ARCHITECTURE_LIVE.md ← état réel du code aujourd'hui
5. CE FICHIER                        ← carte propriétaire + état
```

Ne jamais sauter une étape. Ne jamais modifier un fichier sans avoir identifié
son propriétaire dans la table §2 ci-dessous.

---

## 1. État de santé du projet (snapshot 20 mai 2026)

| Indicateur | Valeur actuelle | Cible |
|---|---|---|
| CSS orphelins | **7** | 0 |
| Hex hardcodés hors tokens | **213** | 0 (ou allowlist) |
| `!important` | **21** | < 10, idéal 0 |
| Sélecteurs multi-owner | **14** | 0 (ou documentés §3 ARCH) |
| Tokens cassés `var(--x)nnn` | 0 ✅ | 0 |
| `modal-view-model.js` | **MANQUANT** | Créer (PR-M1) |
| Sections CSS modal desktop | **8 blocs @media** | 3 blocs propres (PR-M2) |

**Les 7 orphelins CSS à traiter (décision par PR avant tout autre travail) :**

| Fichier | Lignes | Décision |
|---|---|---|
| `boutique-wow.css` | 4 | **Supprimer** — commentaire seul |
| `desktop-horizontal-nav.css` | 12 | **Supprimer** — désactivé, cache via `?v=N` |
| `mini-cart.css` | 288 | **Décider** : bundler si vivant, sinon supprimer |
| `cart-groups.css` | 3 | **Décider** |
| `cart-product-open.css` | 87 | **Décider** |
| `group-cart-flow.css` | 3 | **Décider** |
| `shared-followup.css` | 3 | **Décider** |

---

## 2. Carte des composants — version gagnante

### 2A. CSS — fichiers propriétaires

| Fichier | Bundle | Rôle exact | Owner de… | Ne doit PAS posséder |
|---|---|---|---|---|
| `tokens.css` | `base` | Variables CSS — **seule source** couleurs, typo, radius, ombres | Tout token `var(--)` | Aucune règle de composant |
| `reset.css` | `base` | Reset box-model, scroll-behavior | Box model global | CSS composant |
| `layout.css` | `base` | Structure page mobile : `#k-hero-fixed-wrap`, `#k-page-scroll`, `.k-side-cart` | Squelette mobile | Comportement desktop, pager |
| `hero.css` | `base` | `.k-hero` base mobile, `.k-hero-cats-sticky` mobile, `.k-cats-shell` contexte hero | Hero mobile uniquement | Desktop hero (→ `desktop-commerce-skeleton.css`) |
| `categories.css` | `components` | `.k-chip` base mobile, `.k-cats-shell` base, `#k-subcats-wrap` base, couleurs par catégorie | Chips mobile | Mega-nav desktop, pager correction |
| `products.css` | `components` | `.k-grid`, `.k-sec-grid`, `.k-card` base — **source de vérité unique toutes tailles** | Grille + cartes | Layout desktop global, panier, modal |
| `modal.css` | `components` | Cycle modal complet : overlay, shell, topbar, carousel, infos, actions, suggestions | **Tout `.k-modal-*`** | Sélecteurs extérieurs au modal |
| `cart.css` | `components` | État panier, rendu panier, `.k-card-add`, `.k-card-fav` | Panier complet | Rendu produit global, schéma catégories |
| `interactions.css` | `components` | Animations, toasts, transitions chips, `.k-chip.transitioning` | Micro-interactions | Structure, layout, pager |
| `hero-cart-proxy.css` | `components` | `.k-hero-bubble` proxy mobile uniquement | Bulle hero mobile | Desktop |
| `boutique-desktop.css` | `desktop` | **Owner desktop ≥900px** : `.k-chip` desktop, `.k-cats-shell` desktop, mega-nav, side-cart, `.k-card` hover, footer | Tout premium desktop | Mobile pager, `#k-page-scroll`, `!important` contre mobile |
| `desktop-commerce-skeleton.css` | `desktop` | Layout desktop : header shape, hero desktop, `#k-desktop-catalog-wrap` grid, `.k-card` overrides visuels | Squelette commerce desktop | `.k-chip`, `.k-cats` (→ `boutique-desktop.css`) |
| `event.css` | `event` | Pages événement uniquement | CSS event | CSS boutique principale |

**Image hero :**
- Mobile : `images/Hero_1080x420.png` — cible **1080×360 WebP** < 80 Ko
- Desktop : `images/Hero_1600x360.png` — cible **1600×360 WebP** < 120 Ko
- Manque : source WebP dans le `<picture>` → ajouter `<source type="image/webp">`

---

### 2B. JS — fichiers propriétaires

| Fichier | 🔒 | Rôle exact | Owner de… | Ne doit PAS posséder |
|---|---|---|---|---|
| `js/shop-schema.js` | | Données catégories, sous-catégories, images, `dbKeys`, ordre, normalisation | **Source unique des catégories** | DOM, listeners, layout, scroll |
| `js/render/render-categories.js` | | Markup HTML chips catégories depuis `shop-schema.js` | HTML rail chips | Clics, état actif, pager, scroll |
| `js/controllers/home-controller.js` | | Montage rail, sélection catégorie, état actif, subcats desktop, synchro catalogue | Orchestration accueil | Données catégories, cartes produit, internals pager |
| `js/b-catalog.js` | | Chargement produits, filtrage, pagination, appel renderers, coordination post-render | Catalogue complet | Schéma catégories, markup rail, HTML carte dupliqué |
| `js/b-pager.js` | **🔒** | Cage mobile Temu, `--pager-top`, `--pager-h`, scroll sync, ghost loop, auto-advance | **Moteur pager mobile** | Rendu rail, cartes, layout desktop, patch CSS hero |
| `js/b-subcat.js` | | Mode flat sous-catégorie mobile, pager sous-catégorie | Sous-catégories mobile | Pager principal, données catégories |
| `js/render/render-home-sections.js` | | Markup des sections catalogue home | Sections home | Filtrage, pagination, rail |
| `js/render/render-product-card.js` | | HTML d'une carte produit, cohérent tous contextes | **Carte produit** | Mutation panier/favoris, ouverture modal, pagination |
| `js/b-cart.js` + modules cart | | État panier, rendu panier, actions panier | Panier | Rendu produit global, schéma catégories |
| `js/b-modal.js` | | Cycle ouverture/fermeture modal, rendu détail produit | **Orchestrateur modal** | Correction pager, hero, navigation globale |
| `js/b-modal-desktop-enhancers.js` | | Enrichissements desktop ≥900px : breadcrumb, partage, zoom loupe, accordéon specs, sous-total, vu-récemment | Desktop modal extras | Mobile, cycle modal de base |
| `js/b-modal-image-ux.js` | | UX image modal : lightbox fullscreen, swipe, pinch-zoom | Image UX modal | Logique produit, panier |
| `js/b-modal-social-proof.js` | | Social proof conditionnel (rank, sold_count, rating) — zéro chiffre inventé | Social proof modal | Données inventées |
| `js/b-store.js` | **🔒** | Refs DOM partagées, `initDom()`, state global | **État DOM partagé** | Logique métier, CSS |
| `js/b-scroll-owner.js` | **🔒** | Détection mobile/desktop, scroll owner | **Détection breakpoint** | Layout, rendu |
| `js/b-desktop-sidebar.js` | | Sidebar desktop : sous-catégories sticky desktop | Sidebar desktop | Mobile |
| `js/b-desktop-upgrade.js` | | Upgrade desktop général | Desktop général | Mobile |
| `js/b-desktop-global-cart-access.js` | | Accès global panier desktop, fallback drawer | Accès panier desktop | Bottom nav mobile |
| `js/b-catalog-desktop-enhancers.js` | | Enrichissements catalogue desktop | Catalogue desktop | Mobile |
| `js/b-boutique-wow-style.js` | | Couche visuelle expérimentale réversible | Expérimentation | Vérité définitive, structure |
| `js/b-nav.js` | | Navigation principale | Nav globale | |
| `js/b-cart-pill.js` | | Pilule panier flottante | Pilule panier | |
| `js/b-mini-cart.js` | | Mini-cart drawer | Mini-cart | |
| `js/b-favs.js` | | Favoris | Favoris | |
| `js/b-tracking.js` | | Tracking analytique | Analytics | |
| `js/b-phone.js` | | Détection/format téléphone | Téléphone | |
| `js/b-checkout.js` | | Flow checkout | Checkout | |
| `js/b-utils.js` | | Utilitaires partagés : `sanitize`, `fmt`, `fmtPrice`, `optimizeImgUrl` | Fonctions utilitaires | Logique métier |
| `js/b-bus.js` | | Bus d'événements inter-modules | Events bus | |
| `js/boutique.js` | | Orchestrateur principal — init et boot | Boot | |
| `js/main.js` | | Point d'entrée ES module | Entrée | |
| `js/komerce-api.js` | | Appels API Komerce | Réseau | |
| `js/product-store.js` | | Store produits en mémoire | Cache produits | |
| `js/view-models/product-card-view-model.js` | | Traduit produit brut → contrat d'affichage carte | **ViewModel carte** | HTML, DOM, état |
| `js/view-models/modal-view-model.js` | **MANQUANT** | Traduit produit brut → contrat d'affichage modal | **ViewModel modal** | HTML, DOM, CSS fournisseur |

---

### 2C. HTML — `index.html`

| Zone | Lignes approx. | Propriétaire logique | Règle |
|---|---|---|---|
| `<head>` bundles CSS | ~1-30 | `scripts/bundle-css.js` | Ne pas éditer l'ordre manuellement |
| `#k-hero-fixed-wrap` | ~122 | `hero.css` + `layout.css` | Mobile = fixed, desktop = flux normal |
| `<picture>` hero | ~130-133 | Statique | Ajouter WebP source manquante |
| `.k-hero-bubble` | ~147 | `hero-cart-proxy.css` + JS | Masquer desktop via CSS (pas !important) |
| `#k-sticky-bar` | ~156 | `hero.css` | Ne pas dupliquer les chips catégories ici |
| `#k-cats nav` | point d'ancrage | `render-categories.js` | Contenu injecté par JS, pas statique |
| Script inline `<body>` fin | ~480-550 | **🔒 VERROUILLÉ** | Proxy `window.scrollY` — ne pas toucher |

---

## 3. Architecture modal — état et cible

### 3A. Mobile (GEL v1.0 — ne pas réouvrir)

Propriétaires : `modal.css` §1 (L17-587) + §2 (L588-659) + `b-modal.js` + `b-modal-image-ux.js` + `b-modal-social-proof.js`

Finitions F1-F5 appliquées :
- F1 : Prix promo coral via `.k-modal--has-promo`
- F2 : Ancien prix même ligne (`flex-wrap:nowrap`)
- F3 : Encart livraison mobile minimal
- F4 : Trust bar 3 pills mobile
- F5 : Swatches couleur ronds (`.k-sku--color border-radius:50%`)

**13 invariants M-MOB-01→13 à ne jamais violer** — voir `MODAL_MOBILE_ARCHITECTURE.md`.

### 3B. Desktop (DRAFT v1.0 — plan de migration en 4 PR)

Propriétaires : `modal.css` §3→§7 + `b-modal-desktop-enhancers.js`

**Problème actuel** : 8 blocs `@media(min-width:900px)` dans `modal.css`, §7 écrase silencieusement §3-§5.

**Cible** : 3 blocs propres, grille déclarée une seule fois dans §5, `modal-view-model.js` comme traducteur unique.

| PR | Action | Durée estimée | Bloquant |
|---|---|---|---|
| **PR-M1** | Créer `modal-view-model.js` — ViewModel traduit produit → classes contractuelles | ~3h | **OUI — fondation de tout** |
| **PR-M2** | Unifier les 8 blocs @media → 3 blocs, grille unique dans §5 | ~2h | Après PR-M1 |
| **PR-M3** | Blocs conditionnels `display:none` par défaut, révélés par classe ModalViewModel | ~2h | Après PR-M1 |
| **PR-M4** | Polish Temu : prix clamp, swatches ronds, trust bar horizontale | ~1h30 | Après PR-M2 + M3 |

**Classes contractuelles ModalViewModel** (CSS réagit uniquement à ces classes) :

| Classe | Activée si | Blocs concernés |
|---|---|---|
| `k-modal--has-promo` | `oldPriceKmf` non null | `.k-modal-promo-bar`, `.k-modal-promo-badge` |
| `k-modal--has-variants` | `variants[]` non vide | `.k-modal-variants` |
| `k-modal--has-delivery` | `deliveryEstimate` non null | `.k-modal-delivery` enrichi |
| `k-modal--stock-low` | `stockStatus === 'low'` | `.k-modal-stock-bar` |
| `k-modal--has-social-proof` | `socialProof` non null ET données API réelles | `.k-modal-social-proof` |
| `k-modal--has-specs` | `specs[]` non vide | `.k-modal-specs` |
| `k-modal--low-confidence` | `dataQualityScore < 40` | `.k-modal-low-confidence` |

**12 invariants B-M-01→12** — voir `BOUTIQUE_MODAL_ARCHITECTURE.md` + `MODAL_DESKTOP_ARCHITECTURE.md`.

---

## 4. Chaîne de vérité — sourcing → affichage

```
Produit brut (Dubai / CSV / WhatsApp / stock local)
    │
    ▼
Catalog Komerce (normalisation)
    │
    ├──► ProductCardViewModel  →  classes contractuelles  →  products.css / boutique-desktop.css
    │
    └──► ModalViewModel (PR-M1) →  classes contractuelles  →  modal.css
              (modal-view-model.js — MANQUANT)
```

**Invariant fondamental** : ni `products.css` ni `modal.css` ne doit contenir les mots
`dubai`, `whatsapp`, `csv`, `excel`. Le CSS ne connaît que des classes sémantiques.

---

## 5. Ordre de chargement CSS (production)

```
1. base.css      = tokens + reset + layout + hero
2. components.css = categories + products + modal + cart + interactions + hero-cart-proxy
3. desktop.css   = boutique-desktop + desktop-commerce-skeleton
4. event.css     = event
```

**Règle de cascade** : `desktop.css` charge en dernier et gagne sur tout.
Conséquence directe : aucune règle `.k-chip`, `.k-cats-shell`, `.k-cats` dans
`desktop-commerce-skeleton.css` — elle écraserait silencieusement le mega-nav de
`boutique-desktop.css`.

---

## 6. Fichiers verrouillés — revue obligatoire avant toute PR

| Fichier | Raison du verrouillage |
|---|---|
| `js/b-pager.js` | Moteur cage mobile + ghost loop — une erreur casse tout le scroll mobile |
| `js/b-store.js` | Refs DOM partagées — mutation = breaking change global |
| `js/b-scroll-owner.js` | Détection mobile/desktop — tout le comportement conditionnel dépend de ça |
| Script inline `<body>` fin de `index.html` | Proxy `window.scrollY` — critique pour le pager mobile |

**Règle** : PR isolée, un seul fichier verrouillé par PR, review explicite.

---

## 7. Checklist avant toute PR

```
[ ] README lu en premier
[ ] docs/BOUTIQUE_DOCS_INDEX.md consulté
[ ] Fichier propriétaire identifié dans la table §2 ci-dessus
[ ] Aucune seconde source de vérité créée
[ ] Mobile pager non touché (sauf PR isolée b-pager.js)
[ ] CSS modifié dans le bon fichier et le bon media query
[ ] Aucun hex hardcodé ajouté hors tokens.css
[ ] Aucun !important ajouté pour masquer un conflit
[ ] Aucune règle .k-chip / .k-cats dans desktop-commerce-skeleton.css
[ ] Aucune règle .k-grid / .k-card de base dupliquée hors products.css
[ ] npm run bundle:css après toute modif source CSS
[ ] npm run audit:arch avant tout commit
[ ] npm run audit:arch:live pour mettre à jour la photo LIVE
[ ] Sources + dist + LIVE dans le même commit
```

---

## 8. Dette technique priorisée

| Priorité | Action | Fichier(s) | Bloquant |
|---|---|---|---|
| 🔴 **P0** | Créer `modal-view-model.js` (PR-M1) | `js/view-models/modal-view-model.js` | Toute la refonte modal desktop |
| 🔴 **P0** | Enregistrer `MODAL_DESKTOP_ARCHITECTURE.md` et `MODAL_MOBILE_ARCHITECTURE.md` dans `BOUTIQUE_DOCS_INDEX.md` | `docs/BOUTIQUE_DOCS_INDEX.md` | Cohérence doc |
| 🔴 **P0** | Ajouter `modal.css` dans la table d'ownership de `BOUTIQUE_ARCHITECTURE.md` | `docs/BOUTIQUE_ARCHITECTURE.md` | Invariant I-2 |
| 🟠 **P1** | Décider et traiter les 7 CSS orphelins | `css/*.css` | Score audit |
| 🟠 **P1** | Ajouter `<source type="image/webp">` dans `<picture>` hero | `index.html` | Performance |
| 🟠 **P1** | Masquer `.k-hero-bubble` sur desktop proprement | `hero.css` ou `boutique-desktop.css` | Non-premium desktop |
| 🟡 **P2** | Unifier les 8 blocs @media modal → 3 (PR-M2) | `css/modal.css` | Après PR-M1 |
| 🟡 **P2** | Blocs conditionnels modal via ModalViewModel (PR-M3) | `css/modal.css` + `b-modal-desktop-enhancers.js` | Après PR-M1 |
| 🟡 **P2** | Réduire les 213 hex hardcodés vers tokens | `modal.css`, `cart.css`, `event.css`… | Invariant I-3 |
| 🟢 **P3** | Polish Temu modal (PR-M4) | `css/modal.css` | Après PR-M2 + M3 |

---

*Komerce · Source de Vérité Unique · GEL v1.0 · 20 mai 2026 · Un composant = une vérité = un fichier propriétaire*
