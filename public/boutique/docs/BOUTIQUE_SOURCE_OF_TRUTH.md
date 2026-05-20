# Komerce Boutique — Source de Vérité Unique

> **Ce document est la carte maître.**
> Il gèle la version gagnante de chaque composant : fichier propriétaire, rôle exact,
> état du code, et dette connue.
>
> Statut : **GEL v1.1 — 20 mai 2026** (rev. snapshot + PR-M1 livrée)
> Hiérarchie : se place sous `BOUTIQUE_ARCHITECTURE.md` (normatif) et au-dessus des docs composants.
> Mis à jour uniquement lors d'une PR qui change un propriétaire ou un rôle.
>
> **Changelog v1.1 vs v1.0** :
> - Snapshot §1 régénéré depuis `npm run audit:arch:live` (chiffres réels)
> - Section "7 CSS orphelins" supprimée (5 fichiers n'existent plus, 2 sont déjà bundlés)
> - 6 fichiers JS manquants ajoutés à §2B (b-cart-core, b-product-open-contract, etc.)
> - `modal-view-model.js` marqué CRÉÉ (PR-M1 livrée le 20/05/2026)
> - 3 classes contractuelles additionnelles documentées §3B (no-price, stock-out, fulfillment-*)
> - Invariant §4 reformulé (la couleur de marque WhatsApp n'est pas une dépendance fournisseur)
> - Co-ownership `modal.css` ↔ `modal-view-model.js` explicité §2A

---

## 0. Protocole de lecture obligatoire (agents et humains)

Avant toute modification du projet :

```
1. README.md                         ← point d'entrée absolu
2. docs/BOUTIQUE_DOCS_INDEX.md       ← guide vers la bonne doc
3. docs/BOUTIQUE_ARCHITECTURE.md     ← 6 invariants normatifs
4. docs/BOUTIQUE_ARCHITECTURE_LIVE.md ← état réel du code aujourd'hui (généré)
5. CE FICHIER                        ← carte propriétaire + état
```

Ne jamais sauter une étape. Ne jamais modifier un fichier sans avoir identifié
son propriétaire dans la table §2 ci-dessous.

---

## 1. État de santé du projet (snapshot 20 mai 2026, post-PR-M1)

Source officielle : `docs/BOUTIQUE_ARCHITECTURE_LIVE.md` (régénéré par `npm run audit:arch:live`).
**En cas d'écart entre ce tableau et le LIVE, le LIVE fait foi** — relancer `audit:arch:live`
puis re-synchroniser cette section.

| Indicateur | Valeur actuelle | Cible | Tendance |
|---|---|---|---|
| CSS orphelins | **0** ✅ | 0 | atteint |
| Hex hardcodés hors tokens | **4** | 0 (ou allowlist) | proche cible |
| `!important` | **25** | < 10, idéal 0 | au-dessus cible |
| Sélecteurs multi-owner | **12** | 0 (ou documentés §3 ARCH) | au-dessus cible |
| Tokens cassés `var(--x)nnn` | **0** ✅ | 0 | atteint |
| `modal-view-model.js` | **PRÉSENT** ✅ | Présent | livré PR-M1 le 20/05/2026 |
| Blocs `@media min-width:900px` dans modal.css | **13 occurrences** (8 blocs sémantiques) | 3 blocs propres (PR-M2) | refonte prévue |

**Les 4 hex hardcodés restants** (signalés par `npm run audit:arch`) :

| Fichier | Ligne | Valeur | Décision |
|---|---|---|---|
| `modal.css` | 300 | `#F0A500` | Migrer vers token sémantique (PR-M4 polish) |
| `modal.css` | 564 | `#EBF5EE` | Migrer vers token sémantique (PR-M4 polish) |
| `event.css` | 2 occurrences | — | Hors périmètre boutique principale |

> **Note historique** : la version v1.0 de ce doc annonçait "7 CSS orphelins" et "213 hex hardcodés".
> Vérifié le 20/05/2026 : ces chiffres étaient hérités d'un snapshot antérieur. Les 7 fichiers
> listés sont soit supprimés (5), soit bundlés (2 — `group-cart-flow.css` et `shared-followup.css`).
> Les 213 hex remontaient à avant la consolidation `tokens.css`. État réel : 4 hex, 0 orphelin.

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
| `modal.css` | `components` | Cycle modal complet : overlay, shell, topbar, carousel, infos, actions, suggestions. **Co-owner avec `modal-view-model.js`** pour les classes contractuelles (cf. §3B) | **Tout `.k-modal-*`** + réactions aux classes `.k-modal--*` | Sélecteurs extérieurs au modal, logique de sourcing (whitelist : `var(--whatsapp)` autorisé comme couleur de marque) |
| `cart.css` | `components` | État panier, rendu panier, `.k-card-add`, `.k-card-fav` | Panier complet | Rendu produit global, schéma catégories |
| `interactions.css` | `components` | Animations, toasts, transitions chips, `.k-chip.transitioning` | Micro-interactions | Structure, layout, pager |
| `hero-cart-proxy.css` | `components` | `.k-hero-bubble` proxy mobile uniquement | Bulle hero mobile | Desktop |
| `group-cart-flow.css` | `components` | Flux paniers partagés — résiduel (3L) | Group cart flow | Hors group cart |
| `shared-followup.css` | `components` | Followup partagé — résiduel (3L) | Shared followup | Hors followup |
| `boutique-desktop.css` | `desktop` | **Owner desktop ≥900px** : `.k-chip` desktop, `.k-cats-shell` desktop, mega-nav, side-cart, `.k-card` hover, footer | Tout premium desktop | Mobile pager, `#k-page-scroll`, `!important` contre mobile |
| `desktop-commerce-skeleton.css` | `desktop` | Layout desktop : header shape, hero desktop, `#k-desktop-catalog-wrap` grid, `.k-card` overrides visuels | Squelette commerce desktop | `.k-chip`, `.k-cats` (→ `boutique-desktop.css`) |
| `event.css` | `event` | Pages événement uniquement | CSS event | CSS boutique principale |

**15 fichiers CSS, 0 orphelin** (vérifié `npm run audit:arch:live`).

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
| `js/b-catalog-desktop-enhancers.js` | | Enrichissements catalogue desktop | Catalogue desktop | Mobile |
| `js/b-pager.js` | **🔒** | Cage mobile Temu, `--pager-top`, `--pager-h`, scroll sync, ghost loop, auto-advance | **Moteur pager mobile** | Rendu rail, cartes, layout desktop, patch CSS hero |
| `js/b-subcat.js` | | Mode flat sous-catégorie mobile, pager sous-catégorie | Sous-catégories mobile | Pager principal, données catégories |
| `js/render/render-home-sections.js` | | Markup des sections catalogue home | Sections home | Filtrage, pagination, rail |
| `js/render/render-product-card.js` | | HTML d'une carte produit, cohérent tous contextes | **Carte produit** | Mutation panier/favoris, ouverture modal, pagination |
| **PANIER (5 fichiers)** | | | | |
| `js/b-cart-core.js` | | Utilitaires panier centraux : `saveCart`, `showToast`, `updateCartBadge`, `cartQty`, `cartTotal`, `isFav`, `saveFavs`. Verrouille `CART_VERSION` (vérité unique avec b-store) | **Persistance + helpers panier** | Logique modal, rendu produit catalogue |
| `js/b-cart.js` | | État panier, rendu panier, actions panier (add/remove/qty), partage WhatsApp, panier partagé | Panier UI | Rendu produit global, schéma catégories |
| `js/b-cart-groups-tab.js` | | Compatibilité locale paniers partagés (onglet groupes) | Onglet groupes panier | Hors paniers partagés |
| `js/b-cart-pill.js` | | Pilule panier flottante | Pilule panier | |
| `js/b-mini-cart.js` | | Mini-cart drawer | Mini-cart | |
| **MODAL (4 fichiers + 1 ViewModel)** | | | | |
| `js/b-modal.js` | | Cycle ouverture/fermeture modal, rendu détail produit, carousel, suggestions, bus events `modal:opened` / `modal:close` / `modal:open` | **Orchestrateur modal** | Correction pager, hero, navigation globale |
| `js/b-modal-desktop-enhancers.js` | | Enrichissements desktop ≥900px : breadcrumb, partage, zoom loupe, accordéon specs, sous-total, vu-récemment. **Hôte du listener `setupModalContractClasses()` (PR-M1)** qui pose les classes ModalViewModel | Desktop modal extras + branchement VM | Mobile, cycle modal de base |
| `js/b-modal-image-ux.js` | | UX image modal : lightbox fullscreen, swipe, pinch-zoom | Image UX modal | Logique produit, panier |
| `js/b-modal-social-proof.js` | | Social proof conditionnel (rank, sold_count, rating) — zéro chiffre inventé | Social proof modal | Données inventées |
| `js/view-models/modal-view-model.js` | | **PRÉSENT** ✅ (PR-M1 livrée 20/05/2026) — Traduit produit brut → contrat d'affichage modal. Pose 10 classes contractuelles sur `.k-modal` (cf. §3B) | **ViewModel modal** | HTML, DOM, CSS fournisseur, network |
| **VIEWMODELS** | | | | |
| `js/view-models/product-card-view-model.js` | | Traduit produit brut → contrat d'affichage carte | **ViewModel carte** | HTML, DOM, état |
| **NAVIGATION + OUVERTURE PRODUIT** | | | | |
| `js/b-product-open-contract.js` | | Contrat unique d'ouverture produit depuis les surfaces panier (mobile/desktop → fiche). Branché dans `main.js` au boot | Pont surfaces → modal | Logique modal interne |
| `js/b-cart-product-open-style.js` | | Affordance visuelle "image cliquable" sur les vignettes panier. Branché au boot | Affordance UX panier | Logique métier |
| **FONDATIONS** | | | | |
| `js/b-store.js` | **🔒** | Refs DOM partagées, `initDom()`, state global, `CART_VERSION`, `PAGE_SIZE` | **État DOM partagé** | Logique métier, CSS |
| `js/b-scroll-owner.js` | **🔒** | Détection mobile/desktop, scroll owner | **Détection breakpoint** | Layout, rendu |
| `js/b-bus.js` | | Bus d'événements inter-modules | Events bus | |
| `js/b-utils.js` | | Utilitaires partagés purs : `sanitize`, `fmt`, `fmtPrice`, `optimizeImgUrl`, `promoImgUrl`, `productEmoji`, `genIdempotencyKey`, `renderProductCarousel`, `bindCarouselDots`, `detectCurrency`, `apiGet`, `apiPost`, constantes `_rates`/`_currency` | Fonctions utilitaires + appels API génériques | Logique métier, DOM mutations |
| **DESKTOP UPGRADE** | | | | |
| `js/b-desktop-upgrade.js` | | Orchestrateur enhancers desktop (appelle `setupModalDesktopEnhancers`, `setupCatalogDesktopEnhancers`, etc.) | Boot enhancers desktop | Mobile |
| `js/b-desktop-sidebar.js` | | Sidebar desktop : sous-catégories sticky desktop | Sidebar desktop | Mobile |
| `js/b-desktop-global-cart-access.js` | | Accès global panier desktop, fallback drawer | Accès panier desktop | Bottom nav mobile |
| **AUTRES** | | | | |
| `js/b-favs.js` | | Favoris | Favoris | |
| `js/b-nav.js` | | Navigation principale, drawer, switchView, bnav | Nav globale | |
| `js/b-tracking.js` | | Tracking commandes + analytique | Suivi commandes | |
| `js/b-checkout.js` | | Flow checkout | Checkout | |
| `js/b-phone.js` | | Détection/format téléphone | Téléphone | |
| `js/b-friendly-group-redirect.js` | | Compatibilité lien public court `/g/:token` (paniers partagés) | Redirect short URL | Hors group cart |
| `js/b-group-cart-flow.js` | | Flux ultra court pour lancer un panier partagé | Lancement group cart | Hors group cart |
| `js/b-boutique-wow-style.js` | | Couche visuelle expérimentale réversible | Expérimentation | Vérité définitive, structure |
| **BOOT** | | | | |
| `js/boutique.js` | | Orchestrateur principal — init et boot, §13 INIT, imports nominatifs depuis tous les modules b-* | Boot applicatif | Logique métier dupliquée |
| `js/main.js` | | Point d'entrée ES module. Branche `setupDesktopUpgrade`, `setupProductOpenContract`, `setupCartProductOpenStyle`, **`setupModalContractClasses` (PR-M1)** | Entrée module + hook initial | Logique métier |
| `js/komerce-api.js` | | Appels API Komerce | Réseau | |
| `js/product-store.js` | | Store produits en mémoire | Cache produits | |

**~37 fichiers JS racine + 4 sous-dossiers (controllers/render/view-models)** — vérifié `npm run check:imports` (0 import fantôme, 0 module manquant).

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

Propriétaires : `modal.css` §1 (L17-587) + §2 (L588-659) + `b-modal.js` + `b-modal-image-ux.js` + `b-modal-social-proof.js` + **`modal-view-model.js`** (classes contractuelles)

Finitions F1-F5 appliquées :
- F1 : Prix promo coral via `.k-modal--has-promo` (classe désormais posée par `ModalViewModel`)
- F2 : Ancien prix même ligne (`flex-wrap:nowrap`)
- F3 : Encart livraison mobile minimal
- F4 : Trust bar 3 pills mobile
- F5 : Swatches couleur ronds (`.k-sku--color border-radius:50%`)

**13 invariants M-MOB-01→13 à ne jamais violer** — voir `MODAL_MOBILE_ARCHITECTURE.md`.

### 3B. Desktop (DRAFT v1.0 — plan de migration en 4 PR, M1 livrée)

Propriétaires : `modal.css` §3→§7 + `b-modal-desktop-enhancers.js` + **`modal-view-model.js`**

**Problème actuel** : 13 occurrences `@media(min-width:900px)` (8 blocs sémantiques) dans `modal.css`, §7 écrase silencieusement §3-§5.

**Cible** : 3 blocs propres, grille déclarée une seule fois dans §5, `modal-view-model.js` comme traducteur unique.

| PR | Action | Durée estimée | Bloquant | Statut |
|---|---|---|---|---|
| **PR-M1** | Créer `modal-view-model.js` — ViewModel traduit produit → classes contractuelles | ~3h | **OUI — fondation de tout** | ✅ **LIVRÉE 20/05/2026** |
| **PR-M2** | Unifier les 13 occurrences `@media` (8 blocs) → 3 blocs, grille unique dans §5 | ~2h | Après PR-M1 | À faire |
| **PR-M3** | Blocs conditionnels `display:none` par défaut, révélés par classe ModalViewModel | ~2h | Après PR-M1 | À faire |
| **PR-M4** | Polish Temu : prix clamp, swatches ronds, trust bar horizontale + migration des 2 hex modal.css restants | ~1h30 | Après PR-M2 + M3 | À faire |

**Classes contractuelles ModalViewModel** (CSS réagit uniquement à ces classes) — **10 classes au total** :

Les 7 classes principales du contrat (§3 de `MODAL_DESKTOP_ARCHITECTURE.md`) :

| Classe | Activée si | Blocs concernés |
|---|---|---|
| `k-modal--has-promo` | `oldPriceKmf` non null | `.k-modal-promo-bar`, `.k-modal-promo-badge`, prix coral |
| `k-modal--has-variants` | `variants[]` non vide | `.k-modal-variants` |
| `k-modal--has-delivery` | `deliveryEstimate` non null | `.k-modal-delivery` enrichi |
| `k-modal--stock-low` | `stockStatus === 'low'` | `.k-modal-stock-bar` |
| `k-modal--has-social-proof` | `socialProof` non null ET données API réelles | `.k-modal-social-proof` |
| `k-modal--has-specs` | `specs[]` non vide | `.k-modal-specs` |
| `k-modal--low-confidence` | `dataQualityScore < 40` | `.k-modal-low-confidence` (bandeau "infos à confirmer") |

Les 3 classes utilitaires ajoutées en PR-M1 (cas réels rencontrés sur le terrain) :

| Classe | Activée si | Utilisation |
|---|---|---|
| `k-modal--no-price` | `priceKmf` null ou 0 | Masquer la ligne prix, afficher "Prix à confirmer" |
| `k-modal--stock-out` | `stockStatus === 'unavailable'` | Bouton "Ajouter" désactivé, message rupture |
| `k-modal--fulfillment-{local\|relay\|preorder\|custom}` | Toujours posée selon le sourcing | Personnalisation de la zone livraison |

**12 invariants B-M-01→12** — voir `BOUTIQUE_MODAL_ARCHITECTURE.md` + `MODAL_DESKTOP_ARCHITECTURE.md`.

**Branchement PR-M1** : `setupModalContractClasses()` est exporté par `b-modal-desktop-enhancers.js`, appelé depuis `main.js` au boot (mobile + desktop), écoute `bus.on('modal:opened')`. Idempotent — peut être appelé en plus du code legacy qui pose déjà manuellement `k-modal--has-promo` dans `b-modal.js` sans conflit.

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
    └──► ModalViewModel         →  10 classes contractuelles  →  modal.css
              (modal-view-model.js — ✅ PRÉSENT depuis PR-M1)
```

**Invariant fondamental (reformulé v1.1)** : aucune règle CSS ni aucun sélecteur dans `products.css` ou `modal.css` ne doit dépendre d'une **source de données identifiable** (`.k-card--dubai-source`, `/* CSV imports */`, etc.). Le CSS connaît uniquement des classes sémantiques.

> **Exception explicite — couleurs de marque** : `var(--whatsapp)` (vert WhatsApp #25D366) est une couleur de marque pour le bouton de partage, pas une dépendance fournisseur. Même règle si jamais ajoutées : `var(--instagram)`, `var(--facebook)`. Ces tokens vivent dans `tokens.css`.
>
> **Vérification** : `grep -iE "\.[a-z-]*(dubai|csv|whatsapp|excel)[a-z-]*[ ,{]" css/modal.css css/products.css` → doit renvoyer 0 résultat (cible : sélecteurs liés au sourcing, pas les références à un token de couleur).

---

## 5. Ordre de chargement CSS (production)

```
1. base.css      = tokens + reset + layout + hero
2. components.css = categories + products + modal + cart + interactions + hero-cart-proxy + group-cart-flow + shared-followup
3. desktop.css   = boutique-desktop + desktop-commerce-skeleton
4. event.css     = tokens + event (chargé sur toutes les pages — autonomie totale du bundle)
```

**Règle de cascade** : `desktop.css` charge avant `event.css` et gagne sur tout pour le desktop.
Conséquence directe : aucune règle `.k-chip`, `.k-cats-shell`, `.k-cats` dans
`desktop-commerce-skeleton.css` — elle écraserait silencieusement le mega-nav de
`boutique-desktop.css`.

---

## 6. Fichiers verrouillés — revue obligatoire avant toute PR

| Fichier | Raison du verrouillage |
|---|---|
| `js/b-pager.js` | Moteur cage mobile + ghost loop — une erreur casse tout le scroll mobile |
| `js/b-store.js` | Refs DOM partagées + `CART_VERSION` — mutation = breaking change global |
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
[ ] Si CSS modal modifié : classes contractuelles .k-modal--* réagies, pas posées par CSS
[ ] npm run bundle:css après toute modif source CSS
[ ] npm run audit:arch avant tout commit
[ ] npm run audit:arch:live pour mettre à jour la photo LIVE
[ ] Sources + dist + LIVE dans le même commit
```

---

## 8. Dette technique priorisée (post-PR-M1)

| Priorité | Action | Fichier(s) | Bloquant |
|---|---|---|---|
| 🟠 **P1** | Enregistrer `MODAL_DESKTOP_ARCHITECTURE.md` et `MODAL_MOBILE_ARCHITECTURE.md` dans `BOUTIQUE_DOCS_INDEX.md` | `docs/BOUTIQUE_DOCS_INDEX.md` | Cohérence doc |
| 🟠 **P1** | Ajouter `modal.css` co-ownership avec ModalViewModel dans la table d'ownership de `BOUTIQUE_ARCHITECTURE.md` | `docs/BOUTIQUE_ARCHITECTURE.md` | Invariant I-2 |
| 🟠 **P1** | Ajouter `<source type="image/webp">` dans `<picture>` hero | `index.html` | Performance |
| 🟠 **P1** | Masquer `.k-hero-bubble` sur desktop proprement | `hero.css` ou `boutique-desktop.css` | Non-premium desktop |
| 🟡 **P2** | Unifier les 13 occurrences `@media` modal → 3 blocs (PR-M2) | `css/modal.css` | Après PR-M1 ✅ |
| 🟡 **P2** | Blocs conditionnels modal via ModalViewModel (PR-M3) | `css/modal.css` + `b-modal-desktop-enhancers.js` | Après PR-M1 ✅ |
| 🟡 **P2** | Migrer les 4 hex hardcodés restants vers tokens (2 modal + 2 event) | `modal.css`, `event.css` | Invariant I-3 |
| 🟡 **P2** | Réduire les 25 `!important` vers < 10 (focus : modal.css = 15, hero-cart-proxy.css = 6) | `modal.css`, `hero-cart-proxy.css` | Invariant général |
| 🟢 **P3** | Polish Temu modal (PR-M4) | `css/modal.css` | Après PR-M2 + M3 |
| 🟢 **P3** | Décision sur les 12 sélecteurs multi-owner (documenter ou résorber) | Voir `BOUTIQUE_ARCHITECTURE_LIVE.md` §3 | Invariant I-2 |

> **Notes v1.1** :
> - La P0 "Créer modal-view-model.js" est **fermée** ✅ (livrée PR-M1).
> - La P0 "Traiter les 7 CSS orphelins" est **supprimée** (5 fichiers n'existent plus, 2 sont déjà bundlés depuis le bundler v3).
> - La cible "213 hex hardcodés" est ramenée à **4** (chiffre réel) — la dette n'a jamais été aussi importante que le snapshot v1.0 ne le laissait croire.

---

*Komerce · Source de Vérité Unique · GEL v1.1 · 20 mai 2026 · Un composant = une vérité = un fichier propriétaire*
