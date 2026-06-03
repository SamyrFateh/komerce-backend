# Pipeline CSS Boutique

> **Statut** : doc d'architecture du système CSS Boutique  
> **Date** : 3 juin 2026 — Sprint CSS final  
> **Périmètre** : `public/boutique/css/*.css` sources + `public/boutique/css/dist/*.css` production

---

## 1. Ce qui est chargé en production

La boutique ne charge pas les fichiers CSS sources individuellement. Elle charge uniquement les bundles `dist` depuis `public/boutique/index.html` :

```html
<link rel="stylesheet" href="/boutique/css/dist/base.css?v=21">
<link rel="stylesheet" href="/boutique/css/dist/components.css?v=36">
<link rel="stylesheet" href="/boutique/css/dist/desktop.css?v=31">
<link rel="stylesheet" href="/boutique/css/dist/event.css?v=7">
```

Donc modifier `tokens.css`, `hero.css`, `modal-product.css`, `cart.css`, etc. n'a aucun effet visible en production tant que le déploiement CSS n'a pas tourné.

---

## 2. Source de vérité du bundling

Le bundler actuel est :

```txt
public/boutique/scripts/deploy-css.js
```

Commande officielle :

```bash
cd public/boutique
npm run deploy:css
```

`npm run bundle:css` pointe aussi vers `scripts/deploy-css.js` dans `package.json`.

### Important

`public/boutique/scripts/bundle-css.js` est un ancien bundler Sprint 3. Il peut encore exister dans le dépôt, mais il ne doit plus être considéré comme source de vérité. Toute documentation ou vérification doit se référer à `deploy-css.js`.

---

## 3. Bundles générés par `deploy-css.js`

État réel du tableau `BUNDLES` dans `deploy-css.js` :

```js
const BUNDLES = [
  {
    out: 'base.css',
    files: ['tokens', 'reset', 'layout', 'hero'],
  },
  {
    out: 'components.css',
    files: ['categories', 'products', 'modal-shell', 'modal-media', 'modal-product', 'modal-product-lot4-hybrid',
            'cart', 'interactions', 'hero-cart-proxy', 'group-cart-flow', 'shared-followup', 'identity'],
  },
  {
    out: 'desktop.css',
    files: ['boutique-desktop'],
  },
  {
    out: 'event.css',
    files: ['tokens', 'event'],
  },
];
```

---

## 4. Mapping source → bundle

### `base.css`

| Source | Rôle |
|---|---|
| `tokens.css` | Variables globales : couleurs, espacements, ombres, rayons, statuts |
| `reset.css` | Reset minimal |
| `layout.css` | Structure globale page, footer, safe-area |
| `hero.css` | Hero mobile/base et variantes premium mobile |

### `components.css`

| Source | Rôle |
|---|---|
| `categories.css` | Catégories, chips mobile, rails, sections |
| `products.css` | Cartes produit, grille catalogue |
| `modal-shell.css` | Shell modal, overlay, topbar modal, navigation, scroll owner |
| `modal-media.css` | Media produit, images, thumbnails, zoom |
| `modal-product.css` | Infos produit, prix, livraison, paiement, suggestions PDP base |
| `modal-product-lot4-hybrid.css` | Extension officielle de `modal-product.css` pour la PDP hybride desktop. Rapatriée depuis `b-modal-approche-c-hybrid.js`, chargée immédiatement après `modal-product.css` |
| `cart.css` | Panier, side-cart base, checkout, OTP, cart pill, succès commande |
| `interactions.css` | Animations, micro-interactions, scroll helpers, reduced-motion |
| `hero-cart-proxy.css` | Interaction visuelle hero ↔ panier |
| `group-cart-flow.css` | Flux panier collectif / groupe |
| `shared-followup.css` | Suivi partagé / placeholder selon état du sprint |
| `identity.css` | Identité légère / commandeur / état OTP si applicable |

### `desktop.css`

| Source | Rôle |
|---|---|
| `boutique-desktop.css` | Enrichissements desktop : header, catégories desktop, side-cart desktop, guards desktop, home premium |

### `event.css`

| Source | Rôle |
|---|---|
| `tokens.css` | Variables globales nécessaires aux pages `/event/*` |
| `event.css` | Pages panier collectif / collective workspace |

---

## 5. Carte des owners par famille de sélecteurs

| Famille `.k-*` | Owner source | Bundle |
|---|---|---|
| `.k-hero-*` mobile/base | `hero.css` | `base.css` |
| `.k-hero-*` desktop/premium desktop | `boutique-desktop.css` ou extension documentée | `desktop.css` |
| `.k-cats-*`, `.k-chip` mobile | `categories.css` | `components.css` |
| `.k-cats-*`, `.k-chip` desktop | `boutique-desktop.css` | `desktop.css` |
| `.k-grid`, `.k-card` | `products.css` | `components.css` |
| `.k-modal-*` shell/topbar/overlay | `modal-shell.css` | `components.css` |
| `.k-modal-*` media/images/zoom | `modal-media.css` | `components.css` |
| `.k-modal-*` produit/prix/livraison/paiement/suggestions | `modal-product.css` | `components.css` |
| `.k-buybox-*` PDP hybride desktop | `modal-product-lot4-hybrid.css` comme extension de `modal-product.css` | `components.css` |
| `.k-cart-*`, `.k-side-cart`, `.k-sc-*` base | `cart.css` | `components.css` |
| guards desktop du drawer mobile | `boutique-desktop.css` | `desktop.css` |
| `.k-group-*`, `.k-group-flow-*` | `group-cart-flow.css` | `components.css` |
| `.ev-*` | `event.css` | `event.css` |
| `.k-cw-*` | `event.css` si page event | `event.css` |

---

## 6. Règles d'or

### R1 — Toute modification source doit être suivie du déploiement CSS

```bash
cd public/boutique
npm run deploy:css
```

À commiter avec la modification source :

```txt
public/boutique/css/dist/*.css
public/boutique/index.html
public/boutique/.cache-buster-state.json
```

selon les bundles réellement modifiés.

### R2 — Ne jamais éditer `dist/*.css` directement

Les fichiers `dist` sont générés. Toute correction doit être faite dans le fichier source owner, puis propagée via `npm run deploy:css`.

### R3 — Un composant = un owner principal

Exceptions acceptées uniquement si elles sont documentées :

- `modal-product-lot4-hybrid.css` est une extension officielle de `modal-product.css`.
- les guards desktop du drawer mobile vivent dans `boutique-desktop.css` car ils neutralisent un état JS mobile en desktop.
- les règles de cross-interaction légères peuvent vivre dans `interactions.css` si elles ne deviennent pas owner visuel secondaire.

### R4 — Pas de CSS injecté durablement par JS

Interdit dans `public/boutique/js` pour du style stable de composant :

```txt
document.createElement('style')
style.textContent
style.cssText
setAttribute('style')
innerHTML style=
```

Le JS peut poser des classes d'état, pas dessiner les composants.

### R5 — Pas de `!important` sauf garde documentée

État accepté au 3 juin 2026 : les seuls `!important` actifs acceptés sont les guards desktop dans `boutique-desktop.css` sur `.k-cart-drawer.open` et `.k-cart-overlay.open`, pour empêcher l'affichage du drawer mobile en desktop.

### R6 — Couleurs

Les couleurs globales doivent venir de `tokens.css`. Les variables locales dans `event.css` sont acceptées uniquement si elles sont propres au design event et commentées.

---

## 7. Vérifications utiles

```bash
cd public/boutique

# CSS injecté par JS : doit rester vide ou limité à cas explicitement justifiés
grep -RInE "createElement\(['\"]style|style\.textContent|style\.cssText|setAttribute\(['\"]style|innerHTML.*style=" js/

# !important actifs
grep -RIn "!important" css/*.css css/dist/*.css

# Hex en dur hors tokens / cas locaux documentés
grep -RInE "#[0-9a-fA-F]{3,8}" css/*.css css/dist/*.css

# Rebuild officiel
npm run deploy:css

git diff --stat
```

---

## 8. Dette connue

| Élément | Statut |
|---|:-:|
| CSS injecté par `b-mobile-premium-v1.js` | ✅ supprimé / rapatrié CSS |
| CSS injecté par `b-home-premium-v1.js` | ✅ supprimé / rapatrié CSS |
| CSS injecté par `b-modal-approche-c-hybrid.js` | ✅ supprimé / rapatrié dans `modal-product-lot4-hybrid.css` |
| `modal-product-lot4-hybrid.css` absent de l'ancienne doc pipeline | ✅ corrigé dans cette doc |
| `bundle-css.js` cité comme source de vérité | ✅ corrigé : source de vérité = `deploy-css.js` |
| `!important` hero premium mobile | ✅ supprimé |
| `!important` drawer desktop | ✅ conservés, justifiés et documentés |
| `--ev-border-soft` local event | ✅ accepté si documenté dans `event.css` |
| hook pre-commit de synchro CSS | ⏳ futur |

---

## 9. Liens de référence

- `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md`
- `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`
- `public/boutique/scripts/deploy-css.js`
- `public/boutique/package.json`
