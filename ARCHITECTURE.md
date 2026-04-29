# Architecture Komerce Boutique

> ⚠️ **Lire ce document avant toute modification.**
> Toute PR touchant `public/boutique/` doit identifier la couche impactée et les modules dépendants.

---

## Règles absolues

```
❌ Jamais de couleur en dur  → toujours var(--token) dans tokens.css
❌ Jamais de !important      → revoir la spécificité CSS
❌ Jamais de window.*        → exporter/importer entre modules ES
❌ Jamais de fichier backup  → c'est le rôle de Git
✅ 1 fichier = 1 responsabilité
✅ Avant de modifier : identifier la couche + qui importe ce fichier
✅ Tester mobile (390px) + desktop (1200px) avant de merger
```

---

## Couches JS — impact par niveau

### 🟢 Fondations — audit complet obligatoire avant toute modif

Tout le monde les importe. Toucher = impact sur **tous** les modules.

| Fichier | Rôle |
|---|---|
| `b-store.js` | State global, `scroll`, refs DOM (`dom`), `initDom()` |
| `b-utils.js` | Fonctions pures : `fmt`, `sanitize`, `apiGet/Post`, renderers helpers |
| `b-bus.js` | Event bus partagé — `bus.on()` / `bus.emit()` |
| `b-cart-core.js` | Toast, badges panier, `saveCart()`, `isFav()` |

### 🔵 Métier — vérifier les imports entrants/sortants

| Fichier | Rôle | Dépend de |
|---|---|---|
| `b-catalog.js` | Grille, filtres, pagination, search, scroll sections | store, utils, cart, pager, shop-schema, render/* |
| `b-cart.js` | Drawer panier, stepper, animations | store, utils, cart-core |
| `b-checkout.js` | Tunnel commande, paiement, wallet, OTP | store, utils, cart-core, cart |
| `b-modal.js` | Fiche produit, carousel, suggestions | store, utils, cart-core, render/render-product-card |

### 🟣 Vues — impact limité, modifier avec test visuel

| Fichier | Rôle |
|---|---|
| `b-nav.js` | switchView, bnav, drawer, infinite scroll, relais |
| `b-favs.js` | Vue favoris, badge promo, partage WhatsApp |
| `b-tracking.js` | Suivi commandes, OTP, mes commandes, timeline |
| `b-subcat.js` | Flat subcat pager (mode Temu mobile) |
| `b-pager.js` | Navigation circulaire mobile (scroll horizontal) |

### 🟡 Renderers & Schéma — modifier ici = impact sur tout le rendu

| Fichier | Rôle | Utilisé par |
|---|---|---|
| `shop-schema.js` | Source unique catégories, sous-cats, ordre, icônes | b-catalog, b-subcat, b-modal, render/* |
| `product-store.js` | Cache produits, normalisation, filtres par cat | b-catalog |
| `render/render-product-card.js` | HTML carte produit (grille + suggestions) | b-catalog, b-modal |
| `render/render-home-sections.js` | HTML sections mobile/desktop | b-catalog |
| `render/render-categories.js` | HTML rail catégories | controllers/home-controller |
| `controllers/home-controller.js` | Interactions chips catégories | b-catalog (via setupCats) |

### ⚙️ Orchestrateur — ne jamais y ajouter de logique métier

| Fichier | Rôle |
|---|---|
| `boutique.js` | §13 INIT — imports + boot uniquement (~160 lignes) |
| `main.js` | Point d'entrée ES module |

---

## CSS — 1 fichier = 1 composant

| Fichier | Contenu | Modifier si... |
|---|---|---|
| `tokens.css` | **Toutes** les variables CSS | Nouvelle couleur, nouvelle taille |
| `reset.css` | Reset minimal | Rarement |
| `layout.css` | Header, sections, bottom-nav, skeletons | Navigation, header |
| `hero.css` | Hero mobile + desktop | Bannière d'accueil |
| `categories.css` | Chips, sous-cats, promo rail | Rail catégories |
| `products.css` | Grille, cartes, stepper panier | Cartes produits |
| `modal.css` | Modal produit + suggestions | Fiche produit |
| `cart.css` | Drawer, checkout, OTP, toast, FAB WA | Panier, commande |
| `interactions.css` | Carousel, succès, favoris, scroll, index | Animations, états |
| `event.css` | Panier événement (isolé) | Events uniquement |

**Règle CSS : jamais de couleur en dur. Toujours `var(--token)` depuis `tokens.css`.**

---

## Service Worker

Le SW est dans `public/sw.js`. La version du cache est `komerce-vXXX`.

**Quand bumper la version :**
- Après tout déploiement de fichiers JS ou CSS
- Bumper dans **deux endroits** :
  1. `public/sw.js` → `const CACHE = 'komerce-vXXX'`
  2. `public/boutique/index.html` → `sw_reset_vXXX` et `komerce-vXXX`

Les deux doivent avoir le **même numéro de version**.

---

## Checklist avant de merger

```
[ ] Quelle couche est impactée ? (fondation / métier / vue / renderer / CSS)
[ ] Qui importe ce fichier ? (grep "from.*mon-fichier" js/)
[ ] window.* utilisé ? → remplacer par import/export ou b-store.js
[ ] Couleur en dur ? → remplacer par var(--token)
[ ] Testé mobile 390px ?
[ ] Testé desktop 1200px ?
[ ] Version SW bumpée si JS/CSS modifié ?
```

---

## Fichiers à ne jamais recréer

Ces fichiers ont été supprimés volontairement — ne pas les recréer :

```
b-app.js      → logique migrée dans b-nav.js
b-config.js   → constantes migrées dans b-store.js
b-state.js    → state migré dans b-store.js
b-ui.js       → UI migrée dans les modules concernés
b-search.js   → search migré dans b-catalog.js
b-track.js    → tracking migré dans b-tracking.js
b-views.js    → éclaté en b-nav.js + b-favs.js + b-tracking.js
boutique_v287_backup.css → dans Git, pas dans le code
```
