# Komerce Boutique — Architecture LIVE

> **Document généré automatiquement.** Ne pas éditer à la main.
> Régénération : `npm run boutique:arch`. Date : 2026-05-23T13:09:59.231Z
>
> Le pendant normatif est `BOUTIQUE_ARCHITECTURE.md` — édité à la main.
> Comparer les deux montre l'écart entre l'état souhaité et l'état réel.

---

## 1. Inventaire CSS

16 fichier(s) sur disque, 1 orphelin(s).

| Fichier | Lignes | Bundle |
|---|---:|---|
| `boutique-desktop.css` | 1459 | desktop.css |
| `cart.css` | 903 | components.css |
| `categories.css` | 470 | components.css |
| `desktop-commerce-skeleton.css` | 330 | desktop.css |
| `desktop.css` | 1793 | 🔴 **ORPHELIN** |
| `event.css` | 861 | event.css |
| `group-cart-flow.css` | 3 | components.css |
| `hero-cart-proxy.css` | 113 | components.css |
| `hero.css` | 146 | base.css |
| `interactions.css` | 529 | components.css |
| `layout.css` | 765 | base.css |
| `modal.css` | 1872 | components.css |
| `products.css` | 737 | components.css |
| `reset.css` | 86 | base.css |
| `shared-followup.css` | 3 | components.css |
| `tokens.css` | 278 | event.css |

## 2. Ordre de chargement CSS (index.html)

Cascade : un fichier plus bas écrase ses prédécesseurs sur les sélecteurs communs.

```
 1. /boutique/css/dist/base.css?v=3
 2. /boutique/css/dist/components.css?v=6
 3. /boutique/css/dist/desktop.css?v=3
 4. /boutique/css/dist/event.css?v=3
```

## 3. Cartographie des sélecteurs critiques

Pour chaque sélecteur tracké : où il est défini (base = hors @media, desktop = @media ≥900px).

| Sélecteur | Owners trouvés (base / desktop) |
|---|---|
| `.k-chip` ⚠️ | `boutique-desktop.css` (6/5)<br>`categories.css` (27/0)<br>`desktop.css` (6/5)<br>`interactions.css` (2/0) |
| `.k-cats-shell` ⚠️ | `boutique-desktop.css` (0/1)<br>`categories.css` (2/0)<br>`desktop-commerce-skeleton.css` (0/1)<br>`desktop.css` (0/2)<br>`hero.css` (1/0) |
| `.k-hero-cats-sticky` ⚠️ | `boutique-desktop.css` (0/1)<br>`desktop.css` (0/1)<br>`hero.css` (2/0) |
| `#k-subcats-wrap` ⚠️ | `boutique-desktop.css` (16/8)<br>`desktop.css` (16/8) |
| `.k-subchip` ⚠️ | `boutique-desktop.css` (25/1)<br>`desktop.css` (25/1) |
| `.k-grid` ⚠️ | `cart.css` (2/0)<br>`interactions.css` (6/0)<br>`layout.css` (0/1)<br>`products.css` (3/3) |
| `.k-card` ⚠️ | `boutique-desktop.css` (0/16)<br>`desktop-commerce-skeleton.css` (0/2)<br>`desktop.css` (0/18)<br>`products.css` (6/0) |
| `.k-card-add` ⚠️ | `boutique-desktop.css` (0/4)<br>`cart.css` (0/2)<br>`desktop.css` (0/4)<br>`products.css` (10/1) |
| `.k-card-fav` ⚠️ | `boutique-desktop.css` (0/3)<br>`cart.css` (0/1)<br>`desktop.css` (0/3)<br>`products.css` (4/0) |
| `.k-side-cart` ⚠️ | `boutique-desktop.css` (0/6)<br>`desktop.css` (0/6)<br>`layout.css` (2/0) |
| `#k-desktop-catalog-wrap` ⚠️ | `desktop-commerce-skeleton.css` (0/1)<br>`desktop.css` (0/1)<br>`layout.css` (1/6) |
| `.k-header` ⚠️ | `desktop-commerce-skeleton.css` (0/1)<br>`desktop.css` (0/1)<br>`hero-cart-proxy.css` (4/2)<br>`layout.css` (3/2) |
| `.k-hero-media` ⚠️ | `desktop-commerce-skeleton.css` (0/2)<br>`desktop.css` (0/2)<br>`hero.css` (1/0) |
| `.k-modal` ⚠️ | `boutique-desktop.css` (0/1)<br>`desktop-commerce-skeleton.css` (0/1)<br>`desktop.css` (0/2)<br>`interactions.css` (4/0)<br>`modal.css` (1/2) |

> ⚠️ = sélecteur défini dans plus d'un fichier. Vérifier que c'est conforme à `BOUTIQUE_ARCHITECTURE.md` §3.

## 4. Tokens cassés (`var(--x)nnn`)

Aucun. ✅

## 5. Hex hardcodés hors tokens.css

2 occurrence(s) au total, répartition :

| Fichier | Nombre |
|---|---:|
| `event.css` | 2 |

## 6. `!important` par fichier

14 déclaration(s) au total.

| Fichier | Nombre |
|---|---:|
| `hero-cart-proxy.css` | 6 |
| `boutique-desktop.css` | 2 |
| `desktop.css` | 2 |
| `modal.css` | 2 |
| `layout.css` | 1 |
| `shared-followup.css` | 1 |

## 7. Variables CSS posées par JS

| Variable | Owner(s) JS trouvé(s) |
|---|---|
| `--pager-top` | `js/b-pager.js` (×1) |
| `--pager-h` | `js/b-pager.js` (×1)<br>`js/b-subcat.js` (×1) ⚠️ multi-owner |
| `--pager-w` | `js/b-pager.js` (×1) |
| `--bnav-h` | `js/b-pager.js` (×1) |
| `--modal-scroll-y` | `js/b-modal.js` (×1) |

> ⚠️ multi-owner = variable posée par plusieurs fichiers JS. Vérifier la cohérence.

## 8. Score architecture

- **CSS orphelins** : 1 (cible : 0)
- **Tokens cassés** : 0 (cible : 0)
- **Hex hardcodés** : 2 (cible : 0 ou allowlist)
- **`!important`** : 14 (cible : <10, idéal 0)
- **Sélecteurs multi-owner** : 14 (vérifier vs `BOUTIQUE_ARCHITECTURE.md` §3)

---

*Généré par `boutique/scripts/gen-boutique-arch-live.js`.*
