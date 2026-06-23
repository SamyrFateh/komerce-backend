# Komerce Boutique — Architecture LIVE

> **Document généré automatiquement.** Ne pas éditer à la main.
> Régénération : `npm run boutique:arch`. Date : 2026-06-23T19:57:44.235Z
>
> Le pendant normatif est `BOUTIQUE_ARCHITECTURE.md` — édité à la main.
> Comparer les deux montre l'écart entre l'état souhaité et l'état réel.

---

## 1. Inventaire CSS

21 fichier(s) sur disque, 21 orphelin(s).

| Fichier | Lignes | Bundle |
|---|---:|---|
| `boutique-desktop.css` | 1268 | 🔴 **ORPHELIN** |
| `cart.css` | 2146 | 🔴 **ORPHELIN** |
| `categories.css` | 1078 | 🔴 **ORPHELIN** |
| `event.css` | 860 | 🔴 **ORPHELIN** |
| `group-cart-flow.css` | 2755 | 🔴 **ORPHELIN** |
| `hero-cart-proxy.css` | 22 | 🔴 **ORPHELIN** |
| `hero.css` | 996 | 🔴 **ORPHELIN** |
| `identity.css` | 332 | 🔴 **ORPHELIN** |
| `interactions.css` | 473 | 🔴 **ORPHELIN** |
| `layout.css` | 1182 | 🔴 **ORPHELIN** |
| `modal-media.css` | 306 | 🔴 **ORPHELIN** |
| `modal-product-lot4-hybrid.css` | 361 | 🔴 **ORPHELIN** |
| `modal-product.css` | 1155 | 🔴 **ORPHELIN** |
| `modal-shell.css` | 902 | 🔴 **ORPHELIN** |
| `paypal.css` | 102 | 🔴 **ORPHELIN** |
| `products.css` | 964 | 🔴 **ORPHELIN** |
| `reset.css` | 84 | 🔴 **ORPHELIN** |
| `share-cart.css` | 71 | 🔴 **ORPHELIN** |
| `shared-followup.css` | 3 | 🔴 **ORPHELIN** |
| `tokens.css` | 511 | 🔴 **ORPHELIN** |
| `wallet.css` | 154 | 🔴 **ORPHELIN** |

## 2. Ordre de chargement CSS (index.html)

Cascade : un fichier plus bas écrase ses prédécesseurs sur les sélecteurs communs.

```
 1. /boutique/css/dist/base.css?v=105
 2. /boutique/css/dist/components.css?v=120
 3. /boutique/css/dist/desktop.css?v=44
 4. /boutique/css/dist/event.css?v=26
```

## 3. Cartographie des sélecteurs critiques

Pour chaque sélecteur tracké : où il est défini (base = hors @media, desktop = @media ≥900px).

| Sélecteur | Owners trouvés (base / desktop) |
|---|---|
| `.k-chip` ⚠️ | `categories.css` (46/11)<br>`interactions.css` (1/0) |
| `.k-cats-shell` ⚠️ | `boutique-desktop.css` (0/1)<br>`categories.css` (4/2)<br>`hero.css` (2/0) |
| `.k-hero-cats-sticky` ⚠️ | `categories.css` (0/2)<br>`hero.css` (7/3) |
| `#k-subcats-wrap` ⚠️ | `boutique-desktop.css` (12/14)<br>`categories.css` (7/0) |
| `.k-subchip` ⚠️ | `boutique-desktop.css` (19/3)<br>`categories.css` (6/0) |
| `.k-grid` ⚠️ | `cart.css` (2/0)<br>`layout.css` (0/1)<br>`products.css` (10/3) |
| `.k-card` ⚠️ | `boutique-desktop.css` (0/2)<br>`categories.css` (9/0)<br>`products.css` (7/16) |
| `.k-card-add` ⚠️ | `cart.css` (0/2)<br>`products.css` (10/5) |
| `.k-card-fav` ⚠️ | `cart.css` (0/1)<br>`products.css` (4/3) |
| `.k-side-cart` ⚠️ | `boutique-desktop.css` (0/7)<br>`layout.css` (2/0) |
| `#k-desktop-catalog-wrap` | `layout.css` (1/7) |
| `.k-header` | `layout.css` (9/7) |
| `.k-hero-media` | `hero.css` (4/5) |
| `.k-modal` ⚠️ | `modal-product.css` (0/1)<br>`modal-shell.css` (5/3) |

> ⚠️ = sélecteur défini dans plus d'un fichier. Vérifier que c'est conforme à `BOUTIQUE_ARCHITECTURE.md` §3.

## 4. Tokens cassés (`var(--x)nnn`)

Aucun. ✅

## 5. Hex hardcodés hors tokens.css

26 occurrence(s) au total, répartition :

| Fichier | Nombre |
|---|---:|
| `paypal.css` | 14 |
| `group-cart-flow.css` | 10 |
| `event.css` | 1 |
| `layout.css` | 1 |

## 6. `!important` par fichier

9 déclaration(s) au total.

| Fichier | Nombre |
|---|---:|
| `hero.css` | 4 |
| `boutique-desktop.css` | 3 |
| `share-cart.css` | 2 |

## 7. Variables CSS posées par JS

| Variable | Owner(s) JS trouvé(s) |
|---|---|
| `--pager-top` | `js\b-pager.js` (×1)<br>`js\dist\chunks\chunk-WCB2FJJ3.js` (×1) ⚠️ multi-owner |
| `--pager-h` | `js\b-pager.js` (×1)<br>`js\b-subcat.js` (×1)<br>`js\dist\chunks\chunk-WCB2FJJ3.js` (×2) ⚠️ multi-owner |
| `--pager-w` | `js\b-pager.js` (×1)<br>`js\dist\chunks\chunk-WCB2FJJ3.js` (×1) ⚠️ multi-owner |
| `--bnav-h` | `js\b-pager.js` (×1)<br>`js\dist\chunks\chunk-WCB2FJJ3.js` (×1) ⚠️ multi-owner |
| `--modal-scroll-y` | `js\b-modal-core.js` (×1)<br>`js\dist\chunks\chunk-WCB2FJJ3.js` (×1) ⚠️ multi-owner |

> ⚠️ multi-owner = variable posée par plusieurs fichiers JS. Vérifier la cohérence.

## 8. Score architecture

- **CSS orphelins** : 21 (cible : 0)
- **Tokens cassés** : 0 (cible : 0)
- **Hex hardcodés** : 26 (cible : 0 ou allowlist)
- **`!important`** : 9 (cible : <10, idéal 0)
- **Sélecteurs multi-owner** : 11 (vérifier vs `BOUTIQUE_ARCHITECTURE.md` §3)

---

*Généré par `boutique/scripts/gen-boutique-arch-live.js`.*
