# Komerce Boutique — Architecture LIVE

> **Document généré automatiquement.** Ne pas éditer à la main.
> Régénération : `npm run boutique:arch`. Date : 2026-05-16T09:41:17.746Z
>
> Le pendant normatif est `BOUTIQUE_ARCHITECTURE.md` — édité à la main.
> Comparer les deux montre l'écart entre l'état souhaité et l'état réel.

---

## 1. Inventaire CSS

20 fichier(s) sur disque, 7 orphelin(s).

| Fichier | Lignes | Bundle |
|---|---:|---|
| `boutique-desktop.css` | 1185 | desktop.css |
| `boutique-wow.css` | 4 | 🔴 **ORPHELIN** |
| `cart-groups.css` | 3 | 🔴 **ORPHELIN** |
| `cart-product-open.css` | 87 | 🔴 **ORPHELIN** |
| `cart.css` | 932 | components.css |
| `categories.css` | 561 | components.css |
| `desktop-commerce-skeleton.css` | 360 | desktop.css |
| `desktop-horizontal-nav.css` | 12 | 🔴 **ORPHELIN** |
| `event.css` | 890 | event.css |
| `group-cart-flow.css` | 3 | 🔴 **ORPHELIN** |
| `hero-cart-proxy.css` | 110 | components.css |
| `hero.css` | 299 | base.css |
| `interactions.css` | 529 | components.css |
| `layout.css` | 1155 | base.css |
| `mini-cart.css` | 288 | 🔴 **ORPHELIN** |
| `modal.css` | 1309 | components.css |
| `products.css` | 725 | components.css |
| `reset.css` | 86 | base.css |
| `shared-followup.css` | 3 | 🔴 **ORPHELIN** |
| `tokens.css` | 206 | base.css |

## 2. Ordre de chargement CSS (index.html)

Cascade : un fichier plus bas écrase ses prédécesseurs sur les sélecteurs communs.

```
 1. /boutique/css/dist/base.css?v=3
 2. /boutique/css/dist/components.css?v=3
 3. /boutique/css/dist/desktop.css?v=3
 4. /boutique/css/dist/event.css?v=3
```

## 3. Cartographie des sélecteurs critiques

Pour chaque sélecteur tracké : où il est défini (base = hors @media, desktop = @media ≥900px).

| Sélecteur | Owners trouvés (base / desktop) |
|---|---|
| `.k-chip` ⚠️ | `boutique-desktop.css` (0/5)<br>`categories.css` (33/0)<br>`interactions.css` (2/0) |
| `.k-cats-shell` ⚠️ | `boutique-desktop.css` (1/1)<br>`categories.css` (2/0)<br>`desktop-commerce-skeleton.css` (0/1)<br>`hero.css` (1/0) |
| `.k-hero-cats-sticky` ⚠️ | `boutique-desktop.css` (0/1)<br>`hero.css` (2/0) |
| `#k-subcats-wrap` ⚠️ | `boutique-desktop.css` (0/14)<br>`categories.css` (7/2) |
| `.k-subchip` ⚠️ | `boutique-desktop.css` (0/9)<br>`categories.css` (17/0) |
| `.k-grid` ⚠️ | `cart.css` (2/0)<br>`interactions.css` (6/0)<br>`layout.css` (0/1)<br>`products.css` (3/3) |
| `.k-card` ⚠️ | `boutique-desktop.css` (0/19)<br>`desktop-commerce-skeleton.css` (0/2)<br>`products.css` (6/0) |
| `.k-card-add` ⚠️ | `boutique-desktop.css` (0/1)<br>`cart.css` (0/2)<br>`products.css` (10/1) |
| `.k-card-fav` ⚠️ | `boutique-desktop.css` (0/4)<br>`cart.css` (0/1)<br>`products.css` (4/0) |
| `.k-side-cart` ⚠️ | `desktop-commerce-skeleton.css` (0/1)<br>`layout.css` (2/3) |
| `#k-desktop-catalog-wrap` ⚠️ | `desktop-commerce-skeleton.css` (0/3)<br>`layout.css` (1/6) |
| `.k-header` ⚠️ | `desktop-commerce-skeleton.css` (0/1)<br>`hero-cart-proxy.css` (4/2)<br>`layout.css` (3/2) |
| `.k-hero-media` ⚠️ | `desktop-commerce-skeleton.css` (0/2)<br>`hero.css` (1/3) |
| `.k-modal` ⚠️ | `boutique-desktop.css` (0/1)<br>`desktop-commerce-skeleton.css` (0/1)<br>`interactions.css` (4/0)<br>`modal.css` (1/1) |

> ⚠️ = sélecteur défini dans plus d'un fichier. Vérifier que c'est conforme à `BOUTIQUE_ARCHITECTURE.md` §3.

## 4. Tokens cassés (`var(--x)nnn`)

Aucun. ✅

## 5. Hex hardcodés hors tokens.css

213 occurrence(s) au total, répartition :

| Fichier | Nombre |
|---|---:|
| `cart.css` | 41 |
| `event.css` | 36 |
| `modal.css` | 32 |
| `boutique-desktop.css` | 22 |
| `cart-groups.css` | 20 |
| `interactions.css` | 18 |
| `desktop-commerce-skeleton.css` | 16 |
| `mini-cart.css` | 8 |
| `hero.css` | 6 |
| `categories.css` | 5 |
| `shared-followup.css` | 5 |
| `group-cart-flow.css` | 3 |
| `cart-product-open.css` | 1 |

## 6. `!important` par fichier

21 déclaration(s) au total.

| Fichier | Nombre |
|---|---:|
| `modal.css` | 9 |
| `hero-cart-proxy.css` | 6 |
| `boutique-desktop.css` | 2 |
| `mini-cart.css` | 2 |
| `layout.css` | 1 |
| `shared-followup.css` | 1 |

## 7. Variables CSS posées par JS

| Variable | Owner(s) JS trouvé(s) |
|---|---|
| `--pager-top` | `js\b-pager.js` (×1) |
| `--pager-h` | `js\b-pager.js` (×1)<br>`js\b-subcat.js` (×1) ⚠️ multi-owner |
| `--pager-w` | `js\b-pager.js` (×1) |
| `--bnav-h` | `js\b-pager.js` (×1) |
| `--modal-scroll-y` | `js\b-modal.js` (×1) |

> ⚠️ multi-owner = variable posée par plusieurs fichiers JS. Vérifier la cohérence.

## 8. Score architecture

- **CSS orphelins** : 7 (cible : 0)
- **Tokens cassés** : 0 (cible : 0)
- **Hex hardcodés** : 213 (cible : 0 ou allowlist)
- **`!important`** : 21 (cible : <10, idéal 0)
- **Sélecteurs multi-owner** : 14 (vérifier vs `BOUTIQUE_ARCHITECTURE.md` §3)

---

*Généré par `public/boutique/scripts/gen-boutique-arch-live.js`.*
