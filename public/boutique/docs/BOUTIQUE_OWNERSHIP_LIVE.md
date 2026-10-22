# Boutique — Carte de propriété (LIVE / auto-générée)

> ⚠️ **NE PAS ÉDITER À LA MAIN.** Généré par `scripts/gen-ownership.js` depuis le code réel.
> Régénérer après chaque PR : `node scripts/gen-ownership.js`

Ce fichier répond à une seule question : **quand je touche X, qu'est-ce que j'impacte ?**

---

## 1. Multipropriété CSS — qui style chaque composant

🔴 = plusieurs fichiers stylent la même famille (risque de cascade incontrôlée).

| Composant | Fichiers CSS (sélecteurs) | Owners | État |
|-----------|---------------------------|:------:|:----:|
| **Modal produit** `.k-modal*` | modal-shell.css (37), modal-product.css (4), interactions.css (2), boutique-desktop.css (1), discovery-rail.css (1), modal-mobile-canonical.css (1) | 6 | 🔴 |
| **Side-cart desktop** `.k-side-cart*` | boutique-desktop.css (10), layout.css (7), shared-list-side-cart.css (4), hero.css (3), responsive-desktop-matrix.css (2) | 5 | 🔴 |
| **Carte produit** `.k-card*` | products.css (24), critical-home.css (15), categories.css (9), boutique-desktop.css (4), discovery-rail.css (1), layout.css (1) | 6 | 🔴 |
| **Grille produits** `.k-grid*` | products.css (16), critical-home.css (7), layout.css (6), interactions.css (3), cart.css (2), responsive-desktop-matrix.css (2) | 6 | 🔴 |
| **Header** `.k-header*` | layout.css (23), mobile-shell-convergence.css (7), hero.css (1), tokens.css (1) | 4 | 🔴 |
| **Hero** `.k-hero*` | hero.css (9), hero-ultra-mobile.css (3), critical-home.css (2), mobile-catalog-convergence.css (2), cart.css (1) | 5 | 🔴 |
| **Chips catégories** `.k-chip*` | categories.css (70), critical-home.css (42), layout.css (2), category-cutout-navigation-desktop.css (1), category-cutout-navigation.css (1), interactions.css (1) | 6 | 🔴 |
| **Bottom-nav mobile** `.k-bnav*` | layout.css (4), interactions.css (2), mobile-shell-convergence.css (1) | 3 | 🔴 |

---

## 2. Multipropriété DOM — quels modules JS écrivent le DOM

Tri par volume d'écriture (DOM + CSS injecté). Les modules en tête sont les owners de fait.

| Module JS | DOM | CSS-inj | bus on/emit | Composants ciblés |
|-----------|:---:|:-------:|:-----------:|-------------------|
| `b-cart.js` | 93 | 24 | 5/8 | Modal produit, Side-cart desktop, Panier, Carte produit, Chips catégories, Bottom-nav mobile |
| `b-checkout.js` | 103 | 6 | 0/5 | Bottom-nav mobile |
| `b-modal-desktop-product.js` | 95 | 1 | 0/0 | Modal produit |
| `b-modal-mobile-product.js` | 87 | 1 | 0/0 | Modal produit |
| `b-modal-core.js` | 17 | 70 | 4/5 | Modal produit, Side-cart desktop, Carte produit, Grille produits |
| `b-checkout-render.js` | 79 | 0 | 0/0 | — |
| `boutique.js` | 15 | 49 | 3/0 | Modal produit, Grille produits, Chips catégories |
| `b-tracking.js` | 38 | 0 | 0/0 | Section catalogue |
| `b-modal-product.js` | 26 | 11 | 0/1 | Modal produit |
| `b-phone.js` | 16 | 17 | 0/0 | — |
| `b-komerce.js` | 31 | 0 | 0/1 | Section catalogue |
| `b-cart-pill.js` | 6 | 18 | 3/0 | Grille produits, Section catalogue |
| `b-wallet.js` | 24 | 0 | 0/0 | Section catalogue |
| `b-mini-cart.js` | 4 | 19 | 2/0 | Panier |
| `b-modal-buybox-shared.js` | 22 | 0 | 0/1 | Modal produit |
| `b-pager.js` | 1 | 20 | 0/1 | Grille produits, Header, Hero, Chips catégories, Bottom-nav mobile |
| `b-modal-nav.js` | 10 | 10 | 1/4 | Modal produit |
| `b-catalog.js` | 16 | 2 | 3/3 | Carte produit, Grille produits, Hero, Chips catégories, Section catalogue |
| `b-identity.js` | 11 | 5 | 0/0 | — |
| `b-modal-image-ux.js` | 11 | 5 | 1/1 | Modal produit |
| `b-passkey-security.js` | 15 | 0 | 0/0 | — |
| `b-subcat.js` | 4 | 9 | 0/0 | Carte produit, Grille produits, Header, Hero, Section catalogue |
| `b-modal-social-proof.js` | 9 | 0 | 0/0 | Modal produit |
| `b-modal-product-detail-bootstrap.js` | 8 | 0 | 2/2 | Modal produit |
| `b-nav.js` | 5 | 3 | 4/1 | Panier, Grille produits, Header, Hero, Panier groupe, Bottom-nav mobile, Section catalogue |
| `b-notifications.js` | 8 | 0 | 0/1 | — |
| `hero-bootstrap.js` | 0 | 8 | 0/0 | Grille produits, Hero, Section catalogue |
| `b-desktop-upgrade.js` | 3 | 4 | 0/0 | Side-cart desktop |
| `b-modal-suggestions.js` | 6 | 0 | 3/2 | Modal produit |
| `b-favs.js` | 5 | 0 | 1/0 | Carte produit, Grille produits, Bottom-nav mobile, Section catalogue |
| `b-paypal.js` | 5 | 0 | 0/0 | — |
| `b-home-premium-v1.js` | 4 | 0 | 2/0 | Hero, Chips catégories |
| `b-modal-discovery-detail.js` | 4 | 0 | 2/0 | Modal produit |
| `b-scroll-owner.js` | 0 | 4 | 0/0 | Modal produit, Side-cart desktop, Panier, Grille produits |
| `komerce-api.js` | 4 | 0 | 0/0 | — |
| `local-stock-badge.js` | 4 | 0 | 0/0 | — |
| `b-catalog-desktop-enhancers.js` | 0 | 3 | 1/0 | Header, Chips catégories |
| `b-modal-cart.js` | 1 | 2 | 1/0 | Modal produit |
| `b-passkey-enrollment.js` | 3 | 0 | 0/0 | — |
| `b-passkey-login.js` | 3 | 0 | 0/0 | — |
| `b-utils.js` | 3 | 0 | 0/0 | Carte produit |
| `discovery-rail.js` | 3 | 0 | 3/0 | Modal produit, Carte produit, Grille produits, Chips catégories |
| `b-greeting.js` | 2 | 0 | 0/0 | — |
| `b-pdp-curation-suggestions.js` | 2 | 0 | 2/0 | Modal produit |
| `checkout-desktop-style.js` | 2 | 0 | 0/0 | — |
| `discovery-desktop-style.js` | 2 | 0 | 0/0 | — |
| `market-hydration.js` | 2 | 0 | 0/0 | Hero |
| `b-desktop-global-cart-access.js` | 0 | 1 | 0/0 | Modal produit, Side-cart desktop, Panier |
| `b-desktop-sidebar.js` | 1 | 0 | 0/1 | Chips catégories |
| `b-store.js` | 0 | 1 | 1/2 | Modal produit, Panier, Grille produits, Hero |
| `local-stock-badge-mount.js` | 1 | 0 | 2/0 | Modal produit |

---

## 3. Breakpoints — violation V1

Charte projet : **un seul breakpoint, 900px** (1200px toléré). Tout le reste est une violation.

**Breakpoints distincts trouvés (5)** : 140px, 400px, 899px, 900px, 1200px

| Fichier CSS | Breakpoints utilisés | Violations |
|-------------|----------------------|:----------:|
| hero.css | 900px, 1200px, 899px, 140px | 🔴 899px, 140px |
| cart.css | 900px, 899px | 🔴 899px |
| categories.css | 900px, 1200px, 899px | 🔴 899px |
| category-cutout-navigation.css | 899px | 🔴 899px |
| checkout-vertical-rail.css | 899px, 900px | 🔴 899px |
| critical-home.css | 900px, 899px, 1200px | 🔴 899px |
| hero-ultra-mobile.css | 899px | 🔴 899px |
| interactions.css | 899px | 🔴 899px |
| layout.css | 899px, 900px, 1200px | 🔴 899px |
| mobile-cart-convergence.css | 899px | 🔴 899px |
| mobile-catalog-convergence.css | 899px | 🔴 899px |
| mobile-shell-convergence.css | 899px | 🔴 899px |
| modal-enriched-content.css | 900px, 899px | 🔴 899px |
| modal-media.css | 400px, 900px | 🔴 400px |
| modal-mobile-canonical.css | 899px | 🔴 899px |
| modal-mobile-suggestion-actions.css | 899px | 🔴 899px |
| modal-product-polish.css | 899px, 900px | 🔴 899px |
| modal-product.css | 900px, 899px | 🔴 899px |
| modal-shell.css | 900px, 899px, 1200px | 🔴 899px |
| notifications.css | 899px | 🔴 899px |
| products.css | 900px, 899px | 🔴 899px |
| service-detail.css | 899px, 900px | 🔴 899px |
| shared-list-lists-tab.css | 899px | 🔴 899px |
| shared-list-side-cart.css | 900px, 899px | 🔴 899px |
| boutique-desktop.css | 900px, 1200px | ✅ |
| category-cutout-navigation-desktop.css | 900px | ✅ |
| checkout-desktop-v2.css | 900px | ✅ |
| discovery-desktop-v2.css | 900px | ✅ |
| discovery-rail.css | 900px | ✅ |
| hero-cart-proxy.css | 900px | ✅ |
| identity.css | 900px | ✅ |
| komerce.css | 900px | ✅ |
| modal-desktop-density.css | 1200px | ✅ |
| modal-product-lot4-hybrid.css | 900px, 1200px | ✅ |
| reset.css | 900px | ✅ |
| responsive-desktop-matrix.css | 900px, 1200px | ✅ |
| side-cart-desktop-polish.css | 900px, 1200px | ✅ |
| tokens.css | 900px, 1200px | ✅ |

---

## 4. Dette CSS

### `!important` — total : 17

| Fichier | Occurrences |
|---------|:-----------:|
| boutique-desktop.css | 4 |
| hero.css | 3 |
| categories.css | 2 |
| shared-list-side-cart.css | 2 |
| cart.css | 1 |
| checkout-vertical-rail.css | 1 |
| discovery-rail.css | 1 |
| interactions.css | 1 |
| layout.css | 1 |
| products.css | 1 |

### CSS injecté via JS (devrait être 0 — le CSS vit dans .css)

| Module JS | Injections |
|-----------|:----------:|

---

## 5. Score de contrôle

| Indicateur | Valeur | Cible |
|------------|:------:|:-----:|
| Composants en multipropriété CSS | 8 | 0 |
| Modules JS écrivant le DOM | 46 | ≤ 5 |
| Breakpoints distincts | 5 | ≤ 2 |
| Violations breakpoint | 25 | 0 |
| `!important` | 17 | < 5 |

*Quand toutes les cibles sont vertes, la boutique est sous contrôle : chaque composant a un owner unique et un seul système de breakpoints.*
