# Komerce Boutique — Source de Vérité Unique

> **Ce document est la carte maître.**
> Il gèle la version gagnante de chaque composant : fichier propriétaire, rôle exact,
> état du code, et dette connue.
>
> Statut : **GEL v1.7 — 28 mai 2026** · PR-M3 livrée 22/05 · PR-1 livrée 24/05 (panier partagé créateur + fix scroll-to-top modal) · audit 0 violation · B-SOT-1 résolu 26/05 (6 fichiers actifs ajoutés, 3 orphelins documentés) · **refactor/group-owner-css livré 28/05** (`group-cart-flow.css` owner officiel `.k-group-*`, `b-group-view.js` sans injection CSS)
> Hiérarchie : se place sous `BOUTIQUE_ARCHITECTURE.md` (normatif) et au-dessus des docs composants.
> Mis à jour uniquement lors d'une PR qui change un propriétaire ou un rôle.
>
> **Changelog v1.7 vs v1.6** :
> - **refactor/group-owner-css livré (28/05/2026)** : `group-cart-flow.css` devient owner officiel de tous les sélecteurs `.k-group-*` (cockpit groupe, panier partagé, vue participant)
>   - `b-group-view.js` : `injectStyles()` réduit à no-op, 3 inline styles migués en classes CSS (−1 534 lignes CSS injectées par JS)
>   - 18 tokens alpha groupe ajoutés dans `tokens.css` (`--green-alpha-*`, `--coral-bg-*`, `--amber-bg-*`, `--danger`, etc.)
>   - Section `/* GROUP MOBILE COMPACT */` créée dans `group-cart-flow.css` (@media ≤700px + sous-mode ≤390px)
>   - Multi-owner résiduel : 19 sélecteurs `.k-group-*` dans `cart.css` (legacy PR-0) — écrasés par `group-cart-flow.css`, nettoyage prévu lot suivant
>

> - **PR-1 livrée (24/05/2026)** : feature panier partagé côté créateur
>   - `b-share-cart.js` créé — owner exclusif `.k-share-modal-*` (déclaré §2B) — flow A→B→C→D (nom + OTP + shared-cart API + WhatsApp)
>   - `index.html` : bouton "En groupe" → "Partager" (mobile drawer + side-cart desktop), badge "Partagé" (hidden par défaut)
>   - `b-group-cart-flow.js` → stub vide (DEPRECATED, sélecteurs supprimés du DOM)
>   - Import inutile `installShareCart` retiré de `b-cart.js`
>   - **Fix scroll-to-top modal** (`b-modal.js`) : `scrollTop=0` repositionné APRÈS `overlay.classList.add('open')` + rAF (bug : display:none ignore scrollTop sur descendants) — valide pour catalog, suggestions et navigation prev/next
>   - Fix v5 CTA bar déjà intégré : architecture fix `setupModal()` + `_syncScrollPadding()` court-circuit + CSS `modal.css` règles `>` (enfant direct)
>
> **Changelog v1.4 vs v1.3** :
> - **PR-M3 livrée (22/05/2026)** : `.k-modal-specs` conditionné sur `k-modal--has-specs` (remplace `display:block` inconditionnel en §3) · `injectPriceHero()` nettoyé (plus de `style.display` inline) · commentaire §5 modal.css mis à jour avec carte complète des blocs conditionnels · invariants B-M-10 et B-M-12 validés
> - Classes contractuelles lues par CSS : **1/10 → 10/10** ✅
> - Snapshot santé régénéré au 22/05/2026
>
> **Changelog v1.3 vs v1.2** :
> - **PR-M4 livrée (21/05/2026)** : 2 hex `modal.css` migrés vers tokens CSS sémantiques — audit `npm run audit:arch` à **0 violation**
>   - `#F0A500` → nouveau token `--star-gold` (aucun token existant ne correspondait à cet or punchy étoile notation)
>   - `#EBF5EE` → réutilisation de `--green-bg` existant (`#e8f7ee`, ΔE ≈ 1.5, imperceptible, même use case dans `cart.css`, `event.css`, `interactions.css`) — décision définitive : **ne pas créer `--delivery-bg`**
>   - Bundle `css/dist/components.css` rebundlé, `BOUTIQUE_ARCHITECTURE_LIVE.md` régénéré
>   - Polish prix clamp / swatches ronds / trust bar horizontale : déjà appliqués historiquement, validés post-PR-M4
> - PR-M5 livrée (nettoyage `!important` modal.css) : **14 → 2** dans modal.css, dépassement de la cible initiale (5)
>   - Cat. A (spécificité `#k-modal`) : `.k-modal-fullscreen`, `.k-topbar-search-expanded`, `body.modal-open footer`, doublon footer supprimé
>   - Cat. B (refactor sélecteur) : `.k-modal-meta-rank`, `.k-modal-actions` mobile, `.k-sku.k-sku--active`, `.k-vp.k-vp--active`
>   - Cat. C (conservés, légitimes JS runtime) : `.k-sug-card.search-hidden`, `.k-sug-card.subcat-hidden`
> - Bundle `css/dist/` régénéré (était périmé de 1h30 — 25 → 13 `!important` dans `components.css`)
> - `BOUTIQUE_ARCHITECTURE_LIVE.md` régénéré (était périmé de 5 jours, listait encore 7 orphelins / 213 hex)
> - `!important` total projet : 21 → **12** (modal.css passe sous la cible « < 10, idéal 0 »)
> - **PR-M3 livrée 22/05/2026** : `.k-modal-specs` conditionné sur `k-modal--has-specs` · `injectPriceHero()` nettoyé (plus de `style.display` inline) · commentaire §5 mis à jour avec la carte complète des blocs. Les 10 classes contractuelles sont désormais toutes lues par le CSS. Voir `MODAL_DESKTOP_ARCHITECTURE.md` §8 PR-M3 pour le détail.
>
> **Changelog v1.2 vs v1.1** :
> - PR-M2 livrée : grille modal.css unifiée, 2 sections fantômes supprimées (§4 intermédiaire, §5 large)
> - modal.css renuméroté à 6 sections (était 8 sections + sous-sections)
> - `!important` : 25 → **23** (suppression overrides redondants)
> - Sections cibles atteintes : §6 LAYOUT DESKTOP est l'unique owner de grid-template-columns
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

## 1. État de santé du projet (snapshot 28 mai 2026, post-refactor/group-owner-css)

Source officielle : `docs/BOUTIQUE_ARCHITECTURE_LIVE.md` (régénéré par `npm run audit:arch:live`).
**En cas d'écart entre ce tableau et le LIVE, le LIVE fait foi** — relancer `audit:arch:live`
puis re-synchroniser cette section.

| Indicateur | Valeur actuelle | Cible | Tendance |
|---|---|---|---|
| CSS orphelins | **0** ✅ | 0 | atteint |
| Hex hardcodés hors tokens | **2** ✅ | 0 (ou allowlist) | 2 restants dans `event.css` (hors périmètre) |
| `npm run audit:arch` | **0 violation** ✅ | 0 violation | atteint (PR-M4) |
| `!important` total projet | **12** | < 10, idéal 0 | proche cible |
| `!important` dans modal.css | **2** ✅ | < 5, idéal 2 légitimes | **atteint** (PR-M5) |
| Sélecteurs multi-owner | **12** | 0 (ou documentés §3 ARCH) | stable, à arbitrer |
| Tokens cassés `var(--x)nnn` | **0** ✅ | 0 | atteint |
| `modal-view-model.js` | **PRÉSENT** ✅ | Présent | livré PR-M1 le 20/05/2026 |
| Sections `modal.css` | **6** ✅ | 6 (PR-M2) | atteint |
| Grille `.k-modal-product-zone` | **§6 unique** ✅ | §6 unique (B-M-11) | atteint (PR-M2) |
| Classes contractuelles lues par CSS | **10 sur 10** ✅ | **10 sur 10** (PR-M3) | **atteint** (PR-M3 livrée 22/05) |

**Les 2 hex hardcodés restants** (hors périmètre boutique principale — `event.css` uniquement) :

| Fichier | Occurrences | Décision |
|---|---|---|
| `event.css` | 2 occurrences | Hors périmètre boutique principale — à traiter dans une PR dédiée event.css |

> Les 2 hex `modal.css` (`#F0A500` et `#EBF5EE`) ont été migrés en PR-M4 (21/05/2026). `#F0A500` → `var(--star-gold)` (nouveau token). `#EBF5EE` → `var(--green-bg)` (réutilisation, ΔE ≈ 1.5 imperceptible). **Ne pas créer `--delivery-bg`** — cette décision est définitive.

**Les 2 `!important` restants dans modal.css** (légitimes, **NE PAS RETIRER**) :

| Ligne | Sélecteur | Raison |
|---|---|---|
| 363 | `.k-sug-card.search-hidden { display: none !important }` | Classe posée par JS pour masquer une carte qui a `display:flex` en règle de base. Sans `!important`, le masquage est ignoré. |
| 602 | `.k-sug-card.subcat-hidden { display: none !important }` | Idem — filtre sous-catégorie posé par JS. |

> Alternative future (hors PR-M5) : utiliser l'attribut HTML `hidden` au lieu d'une classe, ce qui permettrait de retirer ces 2 `!important`. Pas prioritaire.

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
| `group-cart-flow.css` | `components` | **Owner officiel de tous les styles Groupe / shared cart view** (refactor/group-owner-css, 28/05/2026) — cockpit créateur, vue participant, mobile compact | **Tous les `.k-group-*`** : `.k-group-view`, `.k-group-cockpit`, `.k-group-cart-switcher`, `.k-group-mini-guide`, `.k-group-side-panel`, `.k-group-identity-note`, et tous les sélecteurs `.k-group-*` — mobile ≤700px + ≤390px inclus | Hors group cart. **`b-group-view.js` ne doit plus injecter de CSS massif** (injectStyles() = no-op) |
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
| `js/b-group-cart-flow.js` | | **DEPRECATED PR-1** — stub vide, sélecteurs supprimés du DOM. À supprimer lors nettoyage event/*.html | — | Tout (stub no-op) |
| `js/b-share-cart.js` | | **Owner exclusif** flow partage panier créateur (PR-1) — modal nom, OTP WhatsApp, POST /api/shared-cart/from-cart-items, ouverture WhatsApp | **Tout `.k-share-modal-*`**, `.k-share-badge-*`, state `cart.shareToken` / `cart.shareId` / `cart.cartName` | Sélecteurs hors `.k-share-*`, logique panier principal |
| `js/b-boutique-wow-style.js` | | Couche visuelle expérimentale réversible | Expérimentation | Vérité définitive, structure |
| **PANIER PARTAGÉ — ACTIFS NON LISTÉS (ajout B-SOT-1, 26/05/2026)** | | | | |
| `js/b-share-phone-guard.js` | | Guard numéro de téléphone avant partage panier — vérifie et demande le n° si absent avant de déclencher le flow WhatsApp | Validation téléphone pré-partage | Logique panier, flow commande |
| `js/b-group-view.js` | | Rendu onglet Groupe du panier partagé (`renderGroupView`, `refreshGroupBadge`, `detectParticipantToken`). Importé par `b-nav.js`, `b-group-banner.js`, `b-share-cart.js`, `b-share-phone-guard.js` | **Onglet Groupe panier partagé** | Logique panier principal, modal. **Ne doit plus injecter de CSS** : `injectStyles()` = no-op depuis refactor/group-owner-css — tous les styles `.k-group-*` sont dans `group-cart-flow.css` |
| `js/b-group-banner.js` | | Bannière statut panier partagé (auto-init si token actif dans l'URL). Import auto dans `boutique.js` ligne 80 | Bannière groupe | Onglet groupe, flow panier |
| **PDP ENRICHIE — ACTIFS NON LISTÉS (ajout B-SOT-1, 26/05/2026)** | | | | |
| `js/b-modal-approche-c-hybrid.js` | | Enrichissements PDP hybride approche-C : personnalisation fiche produit selon type. Branché dans `main.js` (`setupApprocheCHybridPdp`) | Enrichissement PDP type-C | Cycle modal de base |
| `js/b-pdp-curation-suggestions.js` | | Suggestions de curation en bas de fiche produit. Branché dans `main.js` (`setupPdpCurationSuggestions`) | Suggestions PDP | Catalogue, modal |
| `js/b-home-premium-v1.js` | | Enrichissements visuels homepage premium (mobile + desktop). Branché dans `main.js` (`setupHomePremiumV1`) | Homepage premium V1 | Catalogue, panier |
| **ORPHELINS CONFIRMÉS (B-SOT-1, 26/05/2026 — aucun import trouvé)** | | | | |
| `js/b-mobile-premium-v1.js` | | ❌ **Orphelin** — aucun import dans `main.js`, `boutique.js` ou autre module. Présent sur disque. À auditer avant suppression | — | — |
| `js/b-mobile-modal-v1.js` | | ❌ **Orphelin** — CSS neutralisé après régression visuelle (noté dans le header du fichier). Aucun import trouvé. À supprimer | — | — |
| `js/b-modal-social-proof-mock.js` | | ❌ **Orphelin** — Mock temporaire non importé (c'est `b-modal-social-proof.js` qui est importé par `b-modal.js`). Header indique ⚠️ À SUPPRIMER quand colonnes DB social proof prêtes | — | — |
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

### 3B. Desktop (plan de migration en 5 PR — M1, M2, M5 livrées)

Propriétaires : `modal.css` §3→§6 + `b-modal-desktop-enhancers.js` + **`modal-view-model.js`**

**État actuel** : 6 sections claires dans `modal.css`, grille déclarée une seule fois dans §6, `ModalViewModel` traducteur unique, 10 classes contractuelles toutes lues par le CSS. PR-M5 (nettoyage `!important`) et PR-M3 (blocs conditionnels) livrées — chantier modale complet.

| PR | Action | Durée estimée | Bloquant | Statut |
|---|---|---|---|---|
| **PR-M1** | Créer `modal-view-model.js` — ViewModel traduit produit → classes contractuelles | ~3h | **OUI — fondation de tout** | ✅ **LIVRÉE 20/05/2026** |
| **PR-M2** | Unifier les 13 occurrences `@media` (8 blocs) → 6 sections claires, grille unique dans §6 | ~2h | Après PR-M1 | ✅ **LIVRÉE 20/05/2026** |
| **PR-M5** | Nettoyage `!important` modal.css (14 → 2 légitimes) | ~1h | Après PR-M2 | ✅ **LIVRÉE 20/05/2026** (en avance — sync docs 21/05) |
| **PR-M3** | Blocs conditionnels `display:none` par défaut, révélés par les 10 classes ModalViewModel | ~2h | Après PR-M1 | ✅ **LIVRÉE 22/05/2026** |
| **PR-M4** | Polish Temu : prix clamp, swatches ronds, trust bar horizontale + création tokens `--star-gold` et `--delivery-bg` (migration des 2 hex modal.css restants) | ~1h30 | Après PR-M3 | ✅ **LIVRÉE 21/05/2026 — audit à 0 violation** |

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

## 8. Dette technique priorisée (post-PR-M5)

| Priorité | Action | Fichier(s) | Statut |
|---|---|---|---|
| ~~🔴 **P0**~~ | ~~**PR-M3**~~ | ~~`css/modal.css` §5~~ | ✅ **LIVRÉE 22/05/2026** — `.k-modal-specs` conditionné sur `k-modal--has-specs`, `injectPriceHero()` nettoyé, les 10 classes contractuelles sont lues par le CSS |
| 🟠 **P1** | Enregistrer `MODAL_DESKTOP_ARCHITECTURE.md` et `MODAL_MOBILE_ARCHITECTURE.md` dans `BOUTIQUE_DOCS_INDEX.md` | `docs/BOUTIQUE_DOCS_INDEX.md` | Cohérence doc |
| 🟠 **P1** | Ajouter `modal.css` co-ownership avec ModalViewModel dans la table d'ownership de `BOUTIQUE_ARCHITECTURE.md` | `docs/BOUTIQUE_ARCHITECTURE.md` | Invariant I-2 |
| 🟠 **P1** | Ajouter `<source type="image/webp">` dans `<picture>` hero | `index.html` | Performance |
| 🟠 **P1** | Masquer `.k-hero-bubble` sur desktop proprement | `hero.css` ou `boutique-desktop.css` | Non-premium desktop |
| 🟡 **P2** | Migrer les 2 hex restants de `event.css` vers tokens | `event.css` | Invariant I-3 — hors périmètre boutique principale |
| 🟢 **P3** | Décision sur les 12 sélecteurs multi-owner (documenter dans §3 ARCH ou résorber) | Voir `BOUTIQUE_ARCHITECTURE_LIVE.md` §3 | Invariant I-2 |
| 🟢 **P3** | Alternative `.k-sug-card[hidden]` pour retirer les 2 `!important` légitimes restants dans modal.css | `css/modal.css` + JS recherche/filtre sous-cat | Optionnel — propreté absolue |

> **Notes v1.4** :
> - **🏁 CHANTIER MODALE CLÔTURÉ** — 5 PR toutes livrées : PR-M1 (ModalViewModel), PR-M2 (grille unifiée), PR-M3 (blocs conditionnels CSS, **livrée 22/05/2026**), PR-M4 (migration hex, audit 0 violation), PR-M5 (nettoyage !important).
> - **PR-M3 fermée** ✅ (`.k-modal-specs` conditionné, `injectPriceHero()` nettoyé, 10/10 classes contractuelles lues par CSS, livrée 22/05/2026).
> - **PR-M2 fermée** ✅ (6 sections, grille unique §6, livrée 20/05).
> - **PR-M5 fermée** ✅ (14 → 2 `!important` modal.css, livrée 20/05, sync docs 21/05).
> - **PR-M4 fermée** ✅ (2 hex migrés, audit 0 violation, livrée 21/05). Décision définitive : `--green-bg` réutilisé pour `#EBF5EE` (ΔE ≈ 1.5, ne pas créer `--delivery-bg`).
> - Cible `!important` < 10 atteinte (12 total, modal.css à 2).
> - Cible classes contractuelles 10/10 atteinte (PR-M3 22/05).
>
> **Notes v1.1 (conservées pour historique)** :
> - La P0 "Créer modal-view-model.js" est **fermée** ✅ (livrée PR-M1).
> - La P0 "Traiter les 7 CSS orphelins" est **supprimée** (5 fichiers n'existent plus, 2 sont déjà bundlés depuis le bundler v3).
> - La cible "213 hex hardcodés" est ramenée à **4** (chiffre réel).

---

*Komerce · Source de Vérité Unique · GEL v1.6 · 26 mai 2026 · Chantier modale CLÔTURÉ (5/5 PR) · B-SOT-1 résolu (6 actifs ajoutés, 3 orphelins documentés) · Un composant = une vérité = un fichier propriétaire*
