# Harnais de rendu réel de la modale — mode d'emploi

Ce harnais ouvre la **vraie** modale produit (CSS/JS servis depuis le repo) avec des
données stubbées, et joue le cycle CTA `A → B → C` en **mesurant le DOM** + en prenant
des captures. Pas de backend : l'API est interceptée par Playwright.

Il est **validé** — il a servi à mettre au point le cycle bouton↔stepper et le CTA compact.

## Prérequis

```
pip install playwright
python -m playwright install chromium
```

`node` doit être disponible : le script extrait la fixture golden
(`tests/fixtures/golden-elite-pro-detail.js`) pour obtenir un **contrat détail valide**
(sinon le renderer plante sur des champs manquants).

## Lancement

Depuis `public/boutique` :

```
python render-modal.py
```

Sortie console : état `A/B/C` (positions px des boutons, stepper, pill livraison).
Captures : `/tmp/modal_A.png`, `_B.png`, `_C.png` (mets `OUT_DIR: "."` sous Windows si
`/tmp` n'existe pas).

## Adapter (bloc `CONFIG` en tête de script)

| Clé | Effet |
|---|---|
| `VIEWPORT` | `390×844` = mobile ; `1280×800` = desktop |
| `INVENTORY_MODEL` | `"SIMPLE"` = stepper actif (cycle complet) ; `"SKU"` = stepper **désactivé** (doctrine PDC-6) |
| `DELIVERY` | `"AIR"` (accent bleu, avion) ou `"SEA"` (neutre, bateau) |
| `PRICE_KMF` | prix affiché |

## Ce qu'il faut savoir avant de toucher la modale (carte du terrain)

Ces points ont coûté cher à découvrir — les ignorer = « rien ne bouge à l'écran ».

1. **Le CSS servi vient de `css/dist/*.css` (compilé), pas des sources.**
   `index.html` charge `dist/base.css`, `dist/components.css`, etc. Toute modif d'un
   CSS **source** (`css/modal-shell.css`…) est **invisible** tant que le bundle n'est pas
   reconstruit : `npm run bundle:css` (= `node scripts/deploy-css.js`, concat pur, tourne
   sans `node_modules`). Le hook pre-commit le régénère aussi automatiquement au commit.
   → Après **chaque** edit CSS source : `npm run bundle:css` avant de re-rendre.

2. **Ouverture de la modale : par le bus, pas par la grille.**
   `window._kbus` et `window._kstate` sont exposés (`main.js`, `b-store.js`). On ouvre via
   `window._kbus.emit('modal:open', {id})` après avoir poussé le produit dans
   `window._kstate.products`. La grille (`.k-card`) **ne se peuple pas** en statique
   (shop-schema vide) — inutile d'essayer de cliquer une carte.

3. **`.k-modal-actions` est reparenté hors de `.k-modal-product-zone` sur mobile.**
   `b-modal-core.js` sort la barre CTA du scroll pour l'ancrer en bas. Conséquence :
   - **mobile** → les règles de base `.k-modal-actions` pilotent le CTA ;
   - **desktop** → la barre reste dans `.k-modal-product-zone`, ce sont les règles PR-D3
     (`#k-modal .k-modal-product-zone .k-modal-actions …`, flex) qui gagnent.
   Ne scope pas une règle mobile sous `.k-modal-product-zone`, elle ne s'appliquera pas.

4. **Cycle CTA = classe `k-modal-actions--filled`.**
   Posée par `_syncModalQtyUI()` (`b-modal-cart.js`) selon la présence du produit au panier.
   `--filled` → stepper `− N +` affiché + bouton « Ajouter » masqué. Retour à 0 (quickRemove)
   → item retiré → classe retirée → bouton revient. Un seul contrôle visible à la fois.

5. **Produits SKU : stepper désactivé volontairement (PDC-6).**
   `isSku = detail.inventory_model === 'SKU'` désactive `#k-qty-minus/plus`
   (`b-modal-mobile-product.js`). Pour tester le **cycle complet**, utilise un produit
   `SIMPLE`. Sur un produit à variantes, le stepper reste inactif — c'est correct.

6. **Gates de vérification (node pur, exit 0 = vert) :**
   ```
   node scripts/audit-modal-ownership.js
   node scripts/audit-modal-layout.js
   ```
   Le gate layout flague les hauteurs fixes (`height:Npx`) sur les zones de FLUX
   (scroll/hero/variants) — pas sur les boutons. min/max/vh/% = OK.

## Points de mesure utiles (dans `inspect()`)

- `filled` : `.k-modal-actions` porte-t-elle `--filled` ?
- `add` / `stepper` / `buy` : bounding box (null si `display:none`) → vérifie le côte-à-côte
  (même `y`) et les largeurs (Ajouter ~38 %, Acheter ~62 %).
- `deliveryText` / `deliveryAir` : la pill de livraison et son accent aérien.
