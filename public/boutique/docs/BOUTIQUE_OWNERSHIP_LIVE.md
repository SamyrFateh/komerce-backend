# Boutique — Carte de propriété (LIVE / auto-générée)

> ⚠️ **NE PAS ÉDITER À LA MAIN.** Généré par `scripts/gen-ownership.js` depuis le code réel.
> Régénérer après chaque PR : `node scripts/gen-ownership.js`

Ce fichier répond à une seule question : **quand je touche X, qu'est-ce que j'impacte ?**

---

## 1. Multipropriété CSS — qui style chaque composant

🔴 = plusieurs fichiers stylent la même famille (risque de cascade incontrôlée).

| Composant | Fichiers CSS (sélecteurs) | Owners | État |
|-----------|---------------------------|:------:|:----:|
| **Modal produit** `.k-modal*` | modal-shell.css (29), modal-product.css (4), interactions.css (2), boutique-desktop.css (1), modal-mobile-canonical.css (1) | 5 | 🔴 |
| **Side-cart desktop** `.k-side-cart*` | boutique-desktop.css (18), layout.css (11), shared-list-side-cart.css (4), hero.css (1) | 4 | 🔴 |
| **Carte produit** `.k-card*` | products.css (23), categories.css (9), boutique-desktop.css (4), layout.css (1) | 4 | 🔴 |
| **Grille produits** `.k-grid*` | products.css (16), layout.css (6), interactions.css (3), cart.css (2) | 4 | 🔴 |
| **Header** `.k-header*` | layout.css (21), hero.css (2), tokens.css (1) | 3 | 🔴 |
| **Hero** `.k-hero*` | hero.css (9), cart.css (1) | 2 | 🔴 |
| **Chips catégories** `.k-chip*` | categories.css (61), layout.css (2), interactions.css (1) | 3 | 🔴 |
| **Bottom-nav mobile** `.k-bnav*` | interactions.css (2), layout.css (2) | 2 | 🔴 |

---

## 2. Multipropriété DOM — quels modules JS écrivent le DOM

Tri par volume d'écriture (DOM + CSS injecté). Les modules en tête sont les owners de fait.

| Module JS | DOM | CSS-inj | bus on/emit | Composants ciblés |
|-----------|:---:|:-------:|:-----------:|-------------------|
| `b-cart.js` | 74 | 26 | 5/8 | Side-cart desktop, Panier, Carte produit, Chips catégories, Bottom-nav mobile |
| `b-modal-desktop-product.js` | 94 | 1 | 0/0 | Modal produit |
| `b-modal-mobile-product.js` | 81 | 1 | 0/0 | Modal produit |
| `b-checkout.js` | 77 | 4 | 0/4 | Bottom-nav mobile |
| `b-modal-core.js` | 17 | 49 | 4/2 | Modal produit, Side-cart desktop, Carte produit, Grille produits |
| `b-checkout-render.js` | 58 | 0 | 0/0 | — |
| `b-modal-product.js` | 25 | 12 | 0/1 | Modal produit |
| `b-phone.js` | 16 | 17 | 0/0 | — |
| `b-cart-pill.js` | 6 | 18 | 3/0 | Grille produits, Section catalogue |
| `b-wallet.js` | 24 | 0 | 0/0 | Section catalogue |
| `b-mini-cart.js` | 4 | 19 | 2/0 | Panier |
| `b-modal-buybox-shared.js` | 22 | 0 | 0/0 | Modal produit |
| `b-modal-nav.js` | 10 | 10 | 1/4 | Modal produit |
| `b-pager.js` | 3 | 16 | 2/1 | Grille produits, Header, Hero, Chips catégories, Bottom-nav mobile |
| `b-tracking.js` | 19 | 0 | 0/0 | Section catalogue |
| `b-identity.js` | 11 | 5 | 0/0 | — |
| `b-catalog.js` | 11 | 2 | 3/3 | Carte produit, Grille produits, Chips catégories, Section catalogue |
| `b-modal-image-ux.js` | 8 | 5 | 1/1 | Modal produit |
| `b-subcat.js` | 4 | 9 | 0/0 | Carte produit, Grille produits, Header, Hero, Section catalogue |
| `b-pdp-curation-suggestions.js` | 12 | 0 | 2/0 | Modal produit |
| `b-komerce.js` | 11 | 0 | 0/1 | Section catalogue |
| `boutique.js` | 0 | 11 | 3/0 | Modal produit, Grille produits, Chips catégories |
| `b-modal-product-detail-bootstrap.js` | 9 | 0 | 2/2 | Modal produit |
| `b-modal-social-proof.js` | 9 | 0 | 2/0 | Modal produit |
| `hero-bootstrap.js` | 0 | 9 | 0/0 | Grille produits, Hero, Section catalogue |
| `b-desktop-upgrade.js` | 3 | 4 | 0/0 | Side-cart desktop |
| `b-nav.js` | 5 | 1 | 4/1 | Panier, Grille produits, Header, Hero, Panier groupe, Bottom-nav mobile, Section catalogue |
| `b-favs.js` | 5 | 0 | 1/0 | Carte produit, Grille produits, Bottom-nav mobile, Section catalogue |
| `b-paypal.js` | 5 | 0 | 0/0 | — |
| `b-home-premium-v1.js` | 4 | 0 | 2/0 | Hero, Chips catégories |
| `b-modal-suggestions.js` | 4 | 0 | 1/3 | Modal produit |
| `b-scroll-owner.js` | 0 | 4 | 0/0 | Modal produit, Side-cart desktop, Panier, Grille produits |
| `komerce-api.js` | 4 | 0 | 0/0 | — |
| `b-catalog-desktop-enhancers.js` | 0 | 3 | 1/0 | Header, Chips catégories |
| `b-modal-cart.js` | 1 | 2 | 1/0 | Modal produit |
| `b-utils.js` | 3 | 0 | 0/0 | Carte produit |
| `b-greeting.js` | 2 | 0 | 0/0 | — |
| `b-desktop-global-cart-access.js` | 0 | 1 | 0/0 | Modal produit, Side-cart desktop, Panier |
| `b-desktop-sidebar.js` | 1 | 0 | 0/1 | Chips catégories |
| `b-store.js` | 0 | 1 | 1/2 | Modal produit, Panier, Grille produits, Hero |

---

## 3. Breakpoints — violation V1

Charte projet : **un seul breakpoint, 900px** (1200px toléré). Tout le reste est une violation.

**Breakpoints distincts trouvés (7)** : 140px, 380px, 400px, 430px, 899px, 900px, 1200px

| Fichier CSS | Breakpoints utilisés | Violations |
|-------------|----------------------|:----------:|
| hero.css | 140px, 899px, 900px | 🔴 140px, 899px |
| cart.css | 900px, 899px | 🔴 899px |
| categories.css | 900px, 1200px, 899px | 🔴 899px |
| checkout-vertical-rail.css | 380px, 900px | 🔴 380px |
| interactions.css | 899px | 🔴 899px |
| layout.css | 899px, 900px, 1200px | 🔴 899px |
| modal-enriched-content.css | 900px, 899px | 🔴 899px |
| modal-media.css | 400px, 900px | 🔴 400px |
| modal-mobile-canonical.css | 899px | 🔴 899px |
| modal-mobile-suggestion-actions.css | 899px | 🔴 899px |
| modal-product-polish.css | 899px, 900px | 🔴 899px |
| modal-product.css | 900px, 899px | 🔴 899px |
| modal-shell.css | 900px, 899px, 1200px | 🔴 899px |
| products.css | 900px, 1200px, 899px | 🔴 899px |
| shared-list-library-remove.css | 430px | 🔴 430px |
| shared-list-lists-tab.css | 899px | 🔴 899px |
| boutique-desktop.css | 900px, 1200px | ✅ |
| hero-cart-proxy.css | 900px | ✅ |
| identity.css | 900px | ✅ |
| komerce.css | 900px | ✅ |
| modal-product-lot4-hybrid.css | 900px, 1200px | ✅ |
| reset.css | 900px | ✅ |
| tokens.css | 900px, 1200px | ✅ |

---

## 4. Dette CSS

### `!important` — total : 22

| Fichier | Occurrences |
|---------|:-----------:|
| hero.css | 7 |
| boutique-desktop.css | 4 |
| categories.css | 2 |
| share-cart.css | 2 |
| shared-list-side-cart.css | 2 |
| cart.css | 1 |
| checkout-vertical-rail.css | 1 |
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
| Modules JS écrivant le DOM | 34 | ≤ 5 |
| Breakpoints distincts | 7 | ≤ 2 |
| Violations breakpoint | 17 | 0 |
| `!important` | 22 | < 5 |

*Quand toutes les cibles sont vertes, la boutique est sous contrôle : chaque composant a un owner unique et un seul système de breakpoints.*
