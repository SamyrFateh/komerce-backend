# Komerce Boutique — Architecture LIVE

> **Document généré automatiquement.** Ne pas éditer à la main.
> Régénération : `npm run boutique:arch`.
>
> Source canonique des bundles : `scripts/css-bundles.js`.
> Le pendant normatif est `BOUTIQUE_ARCHITECTURE.md`.

---

## 1. Inventaire CSS

39 fichier(s) source sur disque, 0 orphelin(s), 0 source(s) bundle manquante(s).

| Fichier | Lignes | Bundle(s) |
|---|---:|---|
| `boutique-desktop.css` | 1320 | desktop.css |
| `cart.css` | 2141 | components.css |
| `categories.css` | 983 | components.css |
| `category-cutout-navigation.css` | 376 | components.css |
| `category-cutout-navigation-desktop.css` | 651 | desktop.css |
| `checkout-vertical-rail.css` | 1241 | components.css |
| `hero.css` | 962 | base.css |
| `hero-cart-proxy.css` | 22 | components.css |
| `hero-ultra-mobile.css` | 39 | base.css |
| `identity.css` | 346 | components.css |
| `interactions.css` | 443 | components.css |
| `komerce.css` | 330 | components.css |
| `layout.css` | 1193 | base.css |
| `mobile-cart-convergence.css` | 109 | components.css |
| `mobile-catalog-convergence.css` | 39 | components.css |
| `mobile-shell-convergence.css` | 50 | base.css |
| `modal-cart-sku-guard.css` | 20 | components.css |
| `modal-desktop-density.css` | 50 | components.css |
| `modal-enriched-content.css` | 223 | components.css |
| `modal-media.css` | 429 | components.css |
| `modal-mobile-canonical.css` | 831 | components.css |
| `modal-mobile-suggestion-actions.css` | 62 | components.css |
| `modal-product.css` | 1510 | components.css |
| `modal-product-lot4-hybrid.css` | 651 | components.css |
| `modal-product-polish.css` | 419 | components.css |
| `modal-shell.css` | 1373 | components.css |
| `modal-suggestion-card-polish.css` | 26 | components.css |
| `modal-suggestion-filter.css` | 22 | components.css |
| `notifications.css` | 64 | components.css |
| `paypal.css` | 102 | components.css |
| `products.css` | 926 | components.css |
| `reset.css` | 85 | base.css |
| `shared-list-library-remove.css` | 42 | components.css |
| `shared-list-lists-tab.css` | 278 | components.css |
| `shared-list-side-cart.css` | 935 | components.css |
| `shared-list-side-cart-responsive.css` | 91 | components.css |
| `side-cart-desktop-polish.css` | 262 | desktop.css |
| `tokens.css` | 599 | base.css |
| `wallet.css` | 191 | components.css |

## 2. Ordre de chargement CSS (index.html)

Cascade réelle des bundles livrés :

```
 1. /boutique/css/dist/base.css?v=227
 2. /boutique/css/dist/components.css?v=629
 3. /boutique/css/dist/desktop.css?v=148
```

## 3. Cartographie des sélecteurs critiques

| Sélecteur | Owners trouvés (base / desktop) |
|---|---|
| `.k-chip` ⚠️ | `categories.css` (45/21)<br>`interactions.css` (1/0) |
| `.k-cats-shell` ⚠️ | `boutique-desktop.css` (0/1)<br>`categories.css` (4/4) |
| `.k-hero-cats-sticky` ⚠️ | `categories.css` (0/2)<br>`hero.css` (7/1) |
| `#k-subcats-wrap` ⚠️ | `boutique-desktop.css` (12/30)<br>`categories.css` (7/0) |
| `.k-subchip` ⚠️ | `boutique-desktop.css` (19/12)<br>`categories.css` (6/0) |
| `.k-grid` ⚠️ | `cart.css` (2/0)<br>`layout.css` (0/1)<br>`products.css` (10/3) |
| `.k-card` ⚠️ | `boutique-desktop.css` (0/2)<br>`categories.css` (9/0)<br>`products.css` (7/16) |
| `.k-card-add` ⚠️ | `cart.css` (0/2)<br>`products.css` (10/3) |
| `.k-card-fav` ⚠️ | `cart.css` (0/1)<br>`products.css` (4/3) |
| `.k-side-cart` ⚠️ | `boutique-desktop.css` (0/7)<br>`layout.css` (2/0) |
| `#k-desktop-catalog-wrap` | `layout.css` (1/6) |
| `.k-header` ⚠️ | `layout.css` (9/7)<br>`mobile-shell-convergence.css` (1/0) |
| `.k-hero-media` ⚠️ | `hero.css` (2/8)<br>`hero-ultra-mobile.css` (3/0)<br>`mobile-catalog-convergence.css` (1/0) |
| `.k-modal` ⚠️ | `modal-product.css` (0/1)<br>`modal-shell.css` (6/3) |

> ⚠️ = plusieurs fichiers touchent le sélecteur ; confronter au contrat d’ownership avant modification.

## 4. Tokens cassés (`var(--x)nnn`)

Aucun. ✅

## 5. Hex hardcodés hors tokens.css

15 occurrence(s) au total.

| Fichier | Nombre |
|---|---:|
| `paypal.css` | 14 |
| `layout.css` | 1 |

## 6. `!important` par fichier

3 déclaration(s) au total.

| Fichier | Nombre |
|---|---:|
| `boutique-desktop.css` | 3 |

## 7. Variables CSS posées par JS

| Variable | Owner(s) JS trouvé(s) |
|---|---|
| `--pager-top` | `js/b-pager.js` (×1)<br>`js/hero-bootstrap.js` (×1) ⚠️ multi-owner |
| `--pager-h` | `js/b-pager.js` (×1)<br>`js/b-subcat.js` (×1)<br>`js/hero-bootstrap.js` (×1) ⚠️ multi-owner |
| `--pager-w` | `js/b-pager.js` (×1) |
| `--bnav-h` | `js/b-pager.js` (×1) |
| `--modal-scroll-y` | `js/b-modal-core.js` (×1) |

## 8. Score architecture

- **CSS orphelins** : 0 (cible : 0)
- **Sources bundle manquantes** : 0 (cible : 0)
- **Tokens cassés** : 0 (cible : 0)
- **Hex hardcodés** : 15 (cible : 0 ou exceptions documentées)
- **`!important`** : 3 (cible : 0 ou exceptions indispensables)
- **Sélecteurs multi-owner observés** : 13 (à classifier par ownership)

## 9. Dette structurelle exécutable

- **Conflits de cascade suivis** : 0 (cible : 0)
- **Overrides de spécificité suivis** : 0 (cible : 0)
- **Dette `!important` ouverte** : 0 (cible : 0)
- **`!important` physiques** : 3 (guards revus inclus)
- **Guards `!important` revus** : 1 registre(s)

> Les compteurs cascade/spécificité/!important ouvert proviennent des baselines exécutables, pas d’un recompte documentaire.

---

*Généré par `scripts/gen-boutique-arch-live.js` depuis les sources réelles.*
