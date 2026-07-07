# Consolidation — retokenisation `modal-product` (boutique)

_2026-07-07_

## Ce qui a été fait

Suite au fix du gate (comptage réel du budget doctrine token, cf. `NOTE_doctrine_token_budget.md`),
traitement de la dette elle-même : les 21 `rgba(...)` bruts de `modal-product` (scope `boutique` :
`modal-shell.css` + `modal-product.css` + `modal-product-lot4-hybrid.css`) ont été retokenisés.

- **20 valeurs** correspondaient exactement à des tokens **déjà déclarés** dans `css/tokens.css`
  (juste pas utilisés à ces endroits) — simple remplacement par le `var(--...)` existant.
- **1 valeur** était réellement nouvelle : `rgba(0,0,0,.15)` (ombre du badge promo,
  `modal-product.css`) → nouveau token `--overlay-black-15`, ajouté à côté de ses voisins
  `--overlay-black-sm/-md` dans `tokens.css`.

Résultat : **0 `rgba(...)` restant** dans les 3 fichiers du scope. Budget déclaré dans
`features/modal-product.feature.js` redescendu de `max: 21` à `max: 0` (le commentaire du
manifeste appelait explicitement ce cliquet bas : « les 4 rgba du fix ont été retokenisés → cliquet
bas attendu »).

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `css/modal-shell.css` | 13 `rgba(...)` → `var(--token)` (aucun changement visuel : mêmes valeurs, juste nommées) |
| `css/modal-product.css` | 8 `rgba(...)` → `var(--token)`, idem |
| `css/tokens.css` | +1 token : `--overlay-black-15: rgba(0,0,0,.15);` |
| `features/modal-product.feature.js` | `doctrine.max` : `21` → `0`, commentaire mis à jour |
| `scripts/feature-guard.js` | affinage du message de rapport (le cas `max: 0` affichait à tort « au plafond, plus de marge » — corrigé en « entièrement tokenisé ») |
| `css/dist/base.css`, `css/dist/components.css` | régénérés (`node scripts/deploy-css.js --force`), car `tokens.css` et les 2 fichiers modal en font partie |
| `index.html`, `.cache-buster-state.json` | bump automatique des `?v=` par `deploy-css.js` (base.css 117→118, components.css 132→133 ; desktop.css inchangé au fond mais son hash a bougé lors du `--force`, donc 51→52 aussi) |

Aucune valeur de couleur/opacité n'a changé — uniquement le nommage (littéral → variable). Zéro
changement visuel attendu.

## Validation

```
npm run test:unit                                  → 45/45 suites, 1150/1150 tests ✅
node scripts/code-quality-gate.js --strict         → 0 violation ✅
node scripts/css-guard.js --strict                 → 0 conflit de cascade ✅
node scripts/feature-guard.js --strict --feature modal-product → 0/0, ✅ entièrement tokenisé
node scripts/deploy-css.js --dry (après régénération) → aucun changement résiduel, bundles à jour
```

Test de non-régression du gate : ajout temporaire d'un `rgba(...)` de test dans
`modal-product.css` → `1/0`, erreur bloquante, `--strict` sort en `exit(1)` ; fichier restauré,
bundle re-vérifié identique après restauration.

Reste une erreur **pré-existante et sans rapport** en `--strict` : `checkout` référence
`../../../tests/unit/b-checkout-pure.test.js`, introuvable dans ce zip — non traité (hors
périmètre de cette demande).

## Fichiers livrés

`css/tokens.css`, `css/modal-product.css`, `css/modal-shell.css`,
`css/dist/base.css`, `css/dist/components.css`, `features/modal-product.feature.js`,
`scripts/feature-guard.js`, `index.html`, `.cache-buster-state.json`.

À appliquer directement dans le checkout réel (mêmes chemins relatifs à la racine `boutique/`),
puis `npm run check:all` pour confirmer.
