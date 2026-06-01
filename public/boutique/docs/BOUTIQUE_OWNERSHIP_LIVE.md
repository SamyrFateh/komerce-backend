# Boutique — Carte de propriété (LIVE / auto-générée)

> ⚠️ **NE PAS ÉDITER À LA MAIN.** Généré par `scripts/gen-ownership.js` depuis le code réel.
> Régénérer après chaque PR : `node scripts/gen-ownership.js`
> Dernière génération : 2026-06-01

Ce fichier répond à une seule question : **quand je touche X, qu'est-ce que j'impacte ?**

---

## 1. Multipropriété CSS — qui style chaque composant

🔴 = plusieurs fichiers stylent la même famille (risque de cascade incontrôlée).

| Composant | Fichiers CSS (sélecteurs) | Owners | État |
|-----------|---------------------------|:------:|:----:|
| **Modal produit** `.k-modal*` | modal-shell.css (18), modal-product.css (4), interactions.css (2), boutique-desktop.css (1) | 4 | 🔴 |
| **Side-cart desktop** `.k-side-cart*` | boutique-desktop.css (19), layout.css (9) | 2 | 🔴 |
| **Carte produit** `.k-card*` | products.css (22), boutique-desktop.css (4), layout.css (1) | 3 | 🔴 |
| **Grille produits** `.k-grid*` | products.css (15), layout.css (6), interactions.css (3), cart.css (2) | 4 | 🔴 |
| **Header** `.k-header*` | layout.css (17), hero.css (1), tokens.css (1) | 3 | 🔴 |
| **Hero** `.k-hero*` | hero.css (3), cart.css (1) | 2 | 🔴 |
| **Chips catégories** `.k-chip*` | categories.css (51), layout.css (2), interactions.css (1) | 3 | 🔴 |
| **Bottom-nav mobile** `.k-bnav*` | interactions.css (2), layout.css (2) | 2 | 🔴 |

---

## 2. Multipropriété DOM — quels modules JS écrivent le DOM

Tri par volume d'écriture (DOM + CSS injecté). Les modules en tête sont les owners de fait.

| Module JS | DOM | CSS-inj | bus on/emit | Composants ciblés |
|-----------|:---:|:-------:|:-----------:|-------------------|
| `b-cart.js` | 58 | 35 | 1/5 | Modal produit, Side-cart desktop, Panier, Carte produit, Header, Chips catégories, Bottom-nav mobile |
| `b-modal-core.js` | 33 | 52 | 2/3 | Modal produit, Side-cart desktop, Carte produit |
| `b-checkout.js` | 67 | 2 | 0/1 | Bottom-nav mobile |
| `b-checkout-render.js` | 52 | 0 | 0/0 | — |
| `b-modal-desktop-enhancers.js` | 44 | 6 | 4/2 | Modal produit |
| `b-modal-product.js` | 42 | 6 | 0/1 | Modal produit |
| `b-phone.js` | 16 | 17 | 0/0 | — |
| `b-modal-approche-c-hybrid.js` | 31 | 0 | 2/0 | Modal produit |
| `b-cart-pill.js` | 8 | 18 | 3/0 | Grille produits, Section catalogue |
| `b-share-cart.js` | 25 | 1 | 0/0 | Panier, Header, Bottom-nav mobile |
| `b-catalog-desktop-enhancers.js` | 23 | 2 | 1/0 | Carte produit, Grille produits, Header, Hero, Chips catégories |
| `b-mini-cart.js` | 4 | 19 | 2/0 | Panier |
| `b-modal-nav.js` | 10 | 9 | 1/4 | Modal produit |
| `b-pager.js` | 3 | 16 | 2/1 | Grille produits, Header, Hero, Chips catégories, Bottom-nav mobile |
| `event-public.js` | 2 | 13 | 0/0 | — |
| `b-pdp-curation-suggestions.js` | 14 | 0 | 1/0 | Modal produit |
| `b-tracking.js` | 14 | 0 | 0/0 | Section catalogue |
| `b-modal-image-ux.js` | 8 | 5 | 4/0 | Modal produit |
| `b-subcat.js` | 4 | 9 | 0/0 | Carte produit, Grille produits, Header, Hero, Section catalogue |
| `b-catalog.js` | 10 | 2 | 3/1 | Carte produit, Grille produits, Chips catégories |
| `event-pay.js` | 2 | 8 | 0/0 | — |
| `b-modal-social-proof.js` | 9 | 0 | 2/0 | Modal produit |
| `event-manage.js` | 2 | 7 | 0/0 | — |
| `b-group-view.js` | 7 | 1 | 0/1 | Header, Panier groupe, Bottom-nav mobile, Section catalogue |
| `b-identity.js` | 7 | 1 | 0/0 | — |
| `b-desktop-upgrade.js` | 3 | 4 | 0/0 | Side-cart desktop |
| `b-home-premium-v1.js` | 6 | 0 | 1/0 | Side-cart desktop, Header, Hero, Chips catégories, Section catalogue |
| `b-mobile-premium-v1.js` | 4 | 2 | 1/0 | Modal produit, Carte produit, Grille produits, Header, Hero, Chips catégories, Section catalogue |
| `b-nav.js` | 5 | 1 | 0/1 | Panier, Grille produits, Header, Hero, Panier groupe, Bottom-nav mobile, Section catalogue |
| `b-favs.js` | 5 | 0 | 0/0 | Carte produit, Grille produits, Bottom-nav mobile, Section catalogue |
| `boutique.js` | 0 | 5 | 2/0 | Modal produit, Grille produits, Chips catégories |
| `b-group-banner.js` | 4 | 0 | 0/0 | Header, Panier groupe, Bottom-nav mobile |
| `b-mobile-modal-v1.js` | 2 | 2 | 1/0 | Modal produit |
| `b-modal-suggestions.js` | 4 | 0 | 2/3 | Modal produit |
| `b-scroll-owner.js` | 0 | 4 | 0/0 | Modal produit, Side-cart desktop, Panier, Grille produits |
| `komerce-api.js` | 4 | 0 | 0/0 | — |
| `b-greeting.js` | 2 | 0 | 0/0 | — |
| `b-modal-cart.js` | 2 | 0 | 0/0 | — |
| `b-cart-core.js` | 1 | 0 | 1/2 | Modal produit, Panier, Bottom-nav mobile |
| `b-desktop-global-cart-access.js` | 0 | 1 | 0/0 | Modal produit, Side-cart desktop, Panier |
| `b-desktop-sidebar.js` | 1 | 0 | 0/1 | Chips catégories |
| `b-store.js` | 0 | 1 | 0/1 | Modal produit, Panier, Grille produits, Hero |
| `b-utils.js` | 1 | 0 | 0/0 | Carte produit |

---

## 3. Breakpoints — violation V1

Charte projet : **un seul breakpoint, 900px** (1200px toléré). Tout le reste est une violation.

**Breakpoints distincts trouvés (5)** : 140px, 400px, 899px, 900px, 1200px

| Fichier CSS | Breakpoints utilisés | Violations |
|-------------|----------------------|:----------:|
| hero.css | 140px, 899px, 900px | 🔴 140px, 899px |
| interactions.css | 899px | 🔴 899px |
| modal-media.css | 400px, 900px | 🔴 400px |
| boutique-desktop.css | 900px, 1200px | ✅ |
| cart.css | 900px | ✅ |
| categories.css | 900px, 1200px | ✅ |
| event.css | 900px | ✅ |
| group-cart-flow.css | 900px, 1200px | ✅ |
| hero-cart-proxy.css | 900px | ✅ |
| identity.css | 900px | ✅ |
| layout.css | 900px, 1200px | ✅ |
| modal-product.css | 900px | ✅ |
| modal-shell.css | 900px, 1200px | ✅ |
| products.css | 900px, 1200px | ✅ |
| reset.css | 900px | ✅ |
| shared-followup.css | 900px, 1200px | ✅ |
| tokens.css | 900px, 1200px | ✅ |

---

## 4. Dette CSS

### `!important` — total : 8

| Fichier | Occurrences |
|---------|:-----------:|
| hero.css | 2 |
| cart.css | 1 |
| categories.css | 1 |
| group-cart-flow.css | 1 |
| interactions.css | 1 |
| layout.css | 1 |
| products.css | 1 |

### CSS injecté via JS (devrait être 0 — le CSS vit dans .css)

| Module JS | Injections |
|-----------|:----------:|
| b-cart.js | 5 |

---

## 5. Score de contrôle

| Indicateur | Valeur | Cible |
|------------|:------:|:-----:|
| Composants en multipropriété CSS | 8 | 0 |
| Modules JS écrivant le DOM | 39 | ≤ 5 |
| Breakpoints distincts | 5 | ≤ 2 |
| Violations breakpoint | 4 | 0 |
| `!important` | 8 | < 5 |

*Quand toutes les cibles sont vertes, la boutique est sous contrôle : chaque composant a un owner unique et un seul système de breakpoints.*
