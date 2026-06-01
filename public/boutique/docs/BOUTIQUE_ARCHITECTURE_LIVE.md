# Komerce Boutique — Architecture LIVE

> **Document généré automatiquement.** Ne pas éditer à la main.
> Régénération : `npm run boutique:arch`. Date : 2026-06-01T23:01:55.345Z
>
> Le pendant normatif est `BOUTIQUE_ARCHITECTURE.md` — édité à la main.
> Comparer les deux montre l'écart entre l'état souhaité et l'état réel.

---

## 1. Inventaire CSS

17 fichier(s) sur disque, 0 orphelin(s).

| Fichier | Lignes | Bundle |
|---|---:|---|
| `boutique-desktop.css` | 1257 | desktop.css |
| `cart.css` | 1118 | components.css |
| `categories.css` | 890 | components.css |
| `event.css` | 859 | event.css |
| `group-cart-flow.css` | 1884 | components.css |
| `hero-cart-proxy.css` | 22 | components.css |
| `hero.css` | 449 | base.css |
| `identity.css` | 184 | components.css |
| `interactions.css` | 514 | components.css |
| `layout.css` | 995 | base.css |
| `modal-media.css` | 306 | components.css |
| `modal-product.css` | 965 | components.css |
| `modal-shell.css` | 793 | components.css |
| `products.css` | 880 | components.css |
| `reset.css` | 84 | base.css |
| `shared-followup.css` | 3 | components.css |
| `tokens.css` | 425 | base.css |

## 2. Ordre de chargement CSS (index.html)

Cascade : un fichier plus bas écrase ses prédécesseurs sur les sélecteurs communs.

```
 1. /boutique/css/dist/base.css?v=21
 2. /boutique/css/dist/components.css?v=28
 3. /boutique/css/dist/desktop.css?v=30
 4. /boutique/css/dist/event.css?v=6
```

## 3. Cartographie des sélecteurs critiques

Pour chaque sélecteur tracké : où il est défini (base = hors @media, desktop = @media ≥900px).

| Sélecteur | Owners trouvés (base / desktop) |
|---|---|
| `.k-chip` ⚠️ | `categories.css` (40/9)<br>`interactions.css` (1/0) |
| `.k-cats-shell` ⚠️ | `boutique-desktop.css` (0/1)<br>`categories.css` (3/1)<br>`hero.css` (2/0) |
| `.k-hero-cats-sticky` ⚠️ | `categories.css` (0/1)<br>`hero.css` (6/1) |
| `#k-subcats-wrap` ⚠️ | `boutique-desktop.css` (14/8)<br>`categories.css` (6/0) |
| `.k-subchip` ⚠️ | `boutique-desktop.css` (22/1)<br>`categories.css` (6/0) |
| `.k-grid` ⚠️ | `cart.css` (2/0)<br>`layout.css` (0/1)<br>`products.css` (9/3) |
| `.k-card` ⚠️ | `boutique-desktop.css` (0/2)<br>`products.css` (6/16) |
| `.k-card-add` ⚠️ | `cart.css` (0/2)<br>`products.css` (10/5) |
| `.k-card-fav` ⚠️ | `cart.css` (0/1)<br>`products.css` (4/3) |
| `.k-side-cart` ⚠️ | `boutique-desktop.css` (0/6)<br>`layout.css` (2/0) |
| `#k-desktop-catalog-wrap` | `layout.css` (1/6) |
| `.k-header` | `layout.css` (7/5) |
| `.k-hero-media` | `hero.css` (1/15) |
| `.k-modal` ⚠️ | `modal-product.css` (0/1)<br>`modal-shell.css` (5/3) |

> ⚠️ = sélecteur défini dans plus d'un fichier. Vérifier que c'est conforme à `BOUTIQUE_ARCHITECTURE.md` §3.

## 4. Tokens cassés (`var(--x)nnn`)

Aucun. ✅

## 5. Hex hardcodés hors tokens.css

4 occurrence(s) au total, répartition :

| Fichier | Nombre |
|---|---:|
| `event.css` | 2 |
| `interactions.css` | 2 |

## 6. `!important` par fichier

Aucun. ✅

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

- **CSS orphelins** : 0 (cible : 0)
- **Tokens cassés** : 0 (cible : 0)
- **Hex hardcodés** : 4 (cible : 0 ou allowlist)
- **`!important`** : 0 (cible : <10, idéal 0)
- **Sélecteurs multi-owner** : 11 (vérifier vs `BOUTIQUE_ARCHITECTURE.md` §3)

---

*Généré par `boutique/scripts/gen-boutique-arch-live.js`.*
