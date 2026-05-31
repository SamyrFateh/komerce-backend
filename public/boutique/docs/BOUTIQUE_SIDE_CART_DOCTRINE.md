# Doctrine side-cart desktop — comment cohabiter avec le panneau fixe
## `BOUTIQUE_SIDE_CART_DOCTRINE.md` (31/05/2026)

> **Normatif.** Toute zone desktop (≥900px) qui cohabite avec le side-cart suit
> CETTE stratégie, et une seule. Fini les approches concurrentes par zone.

---

## La règle unique : RÉSERVE (tout le monde s'arrête avant le panneau)

Le side-cart est `position:fixed; right:0; width:--sc-reserve-w`. Le contenu de
la page **réserve** cette largeur et **ne va jamais dessous**. Personne ne
"passe sous" le panneau, personne ne "s'étend pour que le panneau le couvre".

### Le mécanisme, en 3 pièces (un seul owner chacune)

| Pièce | Owner unique | Rôle |
|---|---|---|
| `--sc-reserve-w` (240px @900 / 254px @1200) | `layout.css` | largeur réservée = largeur exacte du side-cart |
| `body.sc-reserve { padding-right: --sc-reserve-w }` | `boutique-desktop.css` | pousse TOUT le contenu du body hors de la bande du side-cart |
| `--catalog-max` → `#k-catalog-section { max-width: var(--catalog-max, none) }` | `layout.css` | cappe la grille (qui est en flex, le padding ne suffit pas) |

### L'interrupteur d'état
`renderSideCart()` (`b-cart.js`) pose sur `<body>` les classes `has-items` +
`sc-reserve` quand le panier est non vide. Panier vide → classes absentes →
`--catalog-max` absent → tout reprend la pleine largeur. **C'est le seul
déclencheur.** Aucune zone ne doit inventer son propre flag.

---

## Conséquence par zone (ne PAS faire autrement)

| Zone | Comment elle réserve | Owner |
|---|---|---|
| **Grille / sections** | `#k-catalog-section` cappé par `--catalog-max` (flex → besoin du max-width) | `layout.css` |
| **Header** | `.k-header-inner` cappé par le même calcul `min(...)` quand `sc-reserve` | `layout.css` |
| **Footer** | `.k-footer { margin-right: var(--sc-reserve-w) }` quand `sc-reserve` actif. Le `padding-right` du body ne contraint QUE le flux, **pas la peinture du fond** : sans margin-right, le fond vert déborde sous le panneau. Le contenu interne (`footer-grid`, `footer-bottom`) reste en `--container` — le parent réserve déjà, pas de double compensation. | `boutique-desktop.css` |
| **Toute nouvelle zone pleine largeur** | voir « Deux mécanismes » ci-dessous | la zone |

### Deux mécanismes de réserve — choisir selon la nature de l'élément

| Cas | Mécanisme | Pourquoi |
|---|---|---|
| Élément en **flex/grid** dans le wrap (ex. `#k-catalog-section`) | cap `max-width: var(--catalog-max, …)` **+ `minmax(0, Nfr)`** sur les colonnes | le flex/grid ignore le padding du body ; et `fr` nu refuse de rétrécir sous son contenu → il faut `minmax(0,…)` pour que le cap morde |
| Bloc **enfant direct de `<body>` qui porte un fond** (ex. `.k-footer`) | `margin-right: var(--sc-reserve-w)` quand `sc-reserve` | le fond doit s'arrêter avant le panneau ; le padding body ne suffit pas pour la peinture. **Le contenu interne reste en `--container`** (le parent réserve) |

> Règle : **une seule réserve par chaîne**. Si le parent réserve (margin-right), les enfants ne re-cappent pas (sinon double décalage).

---

## Anti-patterns INTERDITS (ce qui créait la dette)

1. ❌ **Étendre une zone SOUS le side-cart** (`width: calc(100% + --sc-reserve-w)`,
   `margin-right` négatif). C'est la stratégie inverse. Supprimé du footer le 31/05.
2. ❌ **Gagner par escalade de spécificité** (ajouter des `#id` pour qu'une règle
   batte une autre). Si deux règles se disputent une propriété → il y a un owner
   de trop. Une propriété contestée = un seul owner + une variable d'état.
3. ❌ **Réécrire `--sc-reserve-w` hors de `layout.css`** (cf. I-DESK-3).
4. ❌ **Inventer un nouveau flag** au lieu de `sc-reserve` / `has-items`.

---

## Checklist PR (zone qui touche au side-cart ou à une zone pleine largeur)

```
[ ] La zone RÉSERVE (s'arrête avant le panneau), elle ne s'étend pas dessous
[ ] Aucune règle n'ajoute d'#id juste pour gagner en spécificité
[ ] --sc-reserve-w n'est pas redéfini hors layout.css
[ ] Le déclencheur reste body.sc-reserve / has-items (pas de flag maison)
[ ] npm run deploy:css  (bundle + bump atomique)
[ ] npm run audit:arch  → conforme
[ ] Test visuel : panier plein → zone s'arrête net avant le side-cart
[ ] Test visuel : panier vide → zone reprend la pleine largeur
```

---

## Lien avec les autres docs
- `BOUTIQUE_DESKTOP_LAYOUT_CONTRACT.md` — overflow & containing block (pourquoi
  `#k-catalog-section` garde `overflow-x:clip`).
- `BOUTIQUE_DESKTOP_OWNERSHIP_MAP.md` — qui style quoi.
- Invariant à coder dans `audit:arch` : détecter toute règle qui pose
  `width: calc(100% + ...)` ou un 2ᵉ owner de `max-width` sur les zones réservées.
