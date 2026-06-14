# Boutique — Pipeline CSS

> Mis à jour : **2026-06-14**  
> Statut : document actif pour toute modification CSS Boutique.

---

## 1. Règle générale

La boutique ne charge pas les fichiers CSS sources individuellement. Elle charge uniquement les bundles `dist` depuis `public/boutique/index.html`.

Modifier une source CSS sans relancer le bundler ne change pas la production.

---

## 2. Source de vérité du bundling

Bundler officiel :

```txt
public/boutique/scripts/deploy-css.js
```

Commande :

```bash
cd public/boutique
npm run deploy:css
```

`npm run bundle:css` est un alias de compatibilité vers le même script.

Interdit : utiliser un ancien bundler comme source de vérité.

---

## 3. Bundles production

Bundles chargés par `index.html` :

```txt
css/dist/base.css
css/dist/components.css
css/dist/desktop.css
css/dist/event.css
```

`event.css` peut encore exister pour compatibilité ou surfaces legacy, mais la doctrine produit active est Boutique First. Aucune nouvelle UX panier partagé ne doit être construite dans une surface `event/workspace`.

---

## 4. Mapping source → bundle

### `base.css`

| Source | Rôle |
|---|---|
| `tokens.css` | Variables globales : couleurs, espacements, ombres, rayons |
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
| `modal-product-lot4-hybrid.css` | Extension officielle PDP hybride desktop |
| `cart.css` | Panier, side-cart, checkout, OTP, succès commande |
| `interactions.css` | Animations, micro-interactions, scroll helpers |
| `hero-cart-proxy.css` | Interaction visuelle hero ↔ panier |
| `group-cart-flow.css` | Vue panier partagé Boutique First, suivi, lecture seule, règlement |
| `shared-followup.css` | Suivi partagé / état de retour si encore utilisé |
| `identity.css` | Identité légère, commandeur, états OTP si applicable |

### `desktop.css`

| Source | Rôle |
|---|---|
| `boutique-desktop.css` | Desktop premium : header, catégories desktop, side-cart, hero desktop, sous-catégories desktop |

### `event.css`

| Source | Rôle |
|---|---|
| `tokens.css` | Variables globales nécessaires aux pages legacy |
| `event.css` | Compatibilité legacy event/workspace. Non canonique pour les nouveaux parcours Boutique First |

---

## 5. Owners CSS rapides

| Famille `.k-*` | Owner source | Bundle |
|---|---|---|
| `.k-hero-*` mobile/base | `hero.css` | `base.css` |
| `.k-hero-*` desktop | `boutique-desktop.css` | `desktop.css` |
| `.k-cats-*`, `.k-chip` | `categories.css` + desktop documenté | `components.css` / `desktop.css` |
| `.k-grid`, `.k-card` | `products.css` | `components.css` |
| `.k-modal-*` shell/topbar/overlay | `modal-shell.css` | `components.css` |
| `.k-modal-*` media/images/zoom | `modal-media.css` | `components.css` |
| `.k-modal-*` produit/prix/livraison | `modal-product.css` | `components.css` |
| `.k-cart-*`, `.k-side-cart`, `.k-sc-*` | `cart.css` | `components.css` |
| `.k-group-*`, `.k-group-flow-*` | `group-cart-flow.css` | `components.css` |
| `.ev-*`, `.k-cw-*` | `event.css` legacy | `event.css` |

---

## 6. Règles d'or

### R1 — Toute modification source doit être suivie du déploiement CSS

```bash
cd public/boutique
npm run deploy:css
```

À commiter selon les bundles réellement modifiés :

```txt
public/boutique/css/*.css
public/boutique/css/dist/*.css
public/boutique/index.html
public/boutique/.cache-buster-state.json
```

### R2 — Ne jamais éditer `dist/*.css` directement

Les fichiers `dist` sont générés. Toute correction doit être faite dans le fichier source owner, puis propagée via `npm run deploy:css`.

### R3 — Un composant = un owner principal

Exceptions acceptées uniquement si elles sont documentées dans `BOUTIQUE_COMPONENT_OWNERSHIP.md`.

### R4 — Pas de CSS stable injecté par JS

Interdit pour du style durable de composant :

```txt
document.createElement('style')
style.textContent
style.cssText
setAttribute('style')
innerHTML style=
```

Si un overlay JS temporaire injecte du style, il doit être migré vers un owner CSS avant stabilisation.

---

## 7. Tests CSS

Après un changement CSS :

```bash
cd public/boutique
npm run deploy:css
npm run check:cache
npm run check:breakpoints
npm run audit:arch
npm run audit:ownership
```

Pour une validation complète :

```bash
npm run check:all
```
