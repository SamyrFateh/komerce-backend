# Refacto « responsabilité unique » — modale produit

**Objectif** : guérir définitivement le multi-ownership de la modale et **empêcher la récidive**
par un gate exécutable, pas par une intention dans un en-tête.

---

## 1. Diagnostic chiffré (preuve, pas ressenti)

Analyse statique du stack modale (18 fichiers JS, ~230 Ko) :

- **13 zones DOM sur 21 sont écrites par plusieurs modules.**
- **Cause unique** : `b-modal-core.js` (`openModal`) peint du contenu produit
  — nom, réf, description, prix, prix barré, catégorie, stock, badge promo, variantes,
  rail suggestions, boutons CTA, quantité — **puis** les renderers PDC
  (`b-modal-desktop-product.js` / `b-modal-mobile-product.js`) repeignent les mêmes nœuds.
- Deux modules du stack sont **morts** (injoignables depuis `main.js`) :
  `b-mobile-modal-v1.js`, `b-modal-approche-c-hybrid.js`.

Chaque violation se lit : *« zone X appartient au renderer PDC / suggestions / cart,
mais est aussi écrite par `b-modal-core.js` ».* Toute la maladie tient dans un point.

### Bug aigu associé (« le desktop ne se matérialise pas »)
`renderDesktopProductDetail()` commençait par `if (!container || !isDesktop()) return;`
avec `isDesktop() = innerWidth >= 900`, tandis que le bootstrap routait via
`matchMedia('(max-width: 899px)')`. Divergence en largeurs **fractionnaires** `[899,900)`
(zoom, scrollbar, devicePixelRatio) → le bootstrap route « desktop », le renderer
**s'auto-avorte** → la modale reste sur le paint legacy dépouillé. Miroir exact côté mobile.

---

## 2. Exécuté et vérifié (dans ce lot)

| # | Action | Vérification |
|---|--------|-------------|
| 1 | **Gate de propriété unique** `scripts/audit-modal-ownership.js` + contrat `modal-ownership.contract.json` | Exécuté : détecte les 13 violations, exit 1. Conscient de la joignabilité (le code mort ne compte pas comme violation runtime mais est signalé). |
| 2 | **Unification du verdict viewport** — bootstrap + renderer mobile alignés sur `isDesktop()` (source unique, `b-scroll-owner.js`). Supprime le self-abort. | `node --check` OK sur les 2 fichiers ; zéro `matchMedia` viewport résiduel dans le routage de rendu. |
| 3 | **Correction dérive de doc** `index.html` : le commentaire désignait `b-modal-desktop-enhancers.js` (no-op depuis D-P1/T-016) comme owner des zones enrichies → corrigé vers `b-modal-desktop-product.js`. | Relecture. |
| 4 | **Câblage CI** : `audit:modal-ownership` ajouté dans `check:all`, `check:all:verbose`, `check:fast`. | `package.json` re-validé (JSON.parse OK). |

Fichiers touchés : voir `refacto-propriete-unique.patch` (applicable tel quel).

---

## 3. Le mécanisme anti-récidive

Le gate rend la **responsabilité unique exécutable**. Tant qu'il est dans la CI :

- toute nouvelle écriture d'un module non-owner dans une zone → **échec de build** ;
- tout **réveil** d'un module déclaré mort (redevenu joignable) → **échec de build** ;
- le contrat `modal-ownership.contract.json` est la **source de vérité unique** de la
  propriété, lisible par un humain **et** par un agent (Sonnet peut l'exécuter et lire
  son verdict pass/fail sans ambiguïté).

C'est *ça* la guérison définitive : pas un one-shot héroïque, mais un invariant que la
machine refuse de laisser régresser. Un refacto sans ce gate rerottait ; le gate est la
partie non-négociable.

---

## 4. Étape restante — l'excision de `openModal` (spécifiée, oracle fourni)

Ce qui fait passer le gate de 13 → 0. **Non exécuté à l'aveugle ici volontairement** :
c'est une motion cross-fichiers qui touche aussi les tests unitaires
(`tests/unit/b-modal-desktop-product.test.js`, etc.), dont l'oracle d'acceptation est la
suite Playwright/Jest — non exécutable hors de l'environnement du projet. La simuler
« verte » sans ces tests reproduirait exactement le problème d'origine.

**Cible** : `b-modal-core.js` = cycle de vie **uniquement** (ouverture/fermeture/historique/
scroll/carrousel). Zéro écriture de contenu produit.

**Transformation (pure relocation, aucune réécriture de logique)** :
1. Créer `js/b-modal-product-fields.js` = owner unique des zones scalaires
   (`name, sku, desc, price, old-price, cat, stock, promo, qty-val`).
2. Y déplacer **verbatim** le bloc provisionnel de `openModal` (`b-modal-core.js` l.247-294)
   dans `paintProvisionalFields(product)` — préserve l'instant-paint pré-fetch.
3. Y déplacer les corps de `renderIdentity` / `renderPriceAndReference` / `renderStock`
   des renderers dans `paintDetailFields(detail, selection)`.
4. `openModal` → `paintProvisionalFields(product)` ; renderers → `paintDetailFields(...)`.
5. Mettre à jour le contrat : owner de ces zones = `b-modal-product-fields.js`, `allow: []`.

**Oracle de complétion** :
```
npm run audit:modal-ownership   # doit passer au vert (exit 0)
npm run test:unit && npm run test:e2e   # parité UX / prix
```

Les zones `k-sug-rail`, `k-add-cart-btn`, `k-buy-now-btn`, `k-qty-val` suivent la même
logique : retirer les écritures de `b-modal-core.js` au profit de leur owner déclaré.

---

## 5. Suppression du code mort (opération gouvernée)

`b-mobile-modal-v1.js` et `b-modal-approche-c-hybrid.js` sont morts mais **référencés
par des tests et manifestes** :
- `features/boutique.feature.js`, `features/modal-product.feature.js`
- `tests/unit/b-mobile-modal-v1.test.js`, `tests/unit/b-modal-approche-c-hybrid.test.js`
- en-tête `@used-by` de `b-bus.js`

Supprimer les `.js` **et** ces entrées ensemble (sinon la suite casse). Le gate signale
leur présence tant qu'ils sont sur disque.

---

## 6. Pistes connexes repérées (hors périmètre, à trancher)

- `js/dist/main-*.js` : bundle JS présent mais **non chargé** (l'`index.html` sert la source
  `main.js?v=351`) → mort, à supprimer ou à réintégrer explicitement.
- Pipeline CSS à rebuild **manuel** (`npm run bundle:css`) : sources `css/*.css` éditables ≠
  bundles servis `css/dist/*.css`. Vérifié : actuellement **en phase**. Piège latent —
  votre gate `check:css-dist-only` couvre déjà en partie ce risque.
- `b-modal-image-ux.js` conserve 2 `matchMedia('max-width:899px')` (gating zoom/tactile,
  concern distinct du routage de rendu) — à aligner sur `isDesktop()` pour une source
  unique totale.
