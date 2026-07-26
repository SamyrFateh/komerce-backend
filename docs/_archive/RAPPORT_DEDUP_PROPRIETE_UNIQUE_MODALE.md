# Chantier Déduplication (§3) — paintDetailFields

**Point de départ** : Chantier Desktop (2.1-2.5) déjà propre sur `main` (confirmé :
`modal-ownership.contract.json` ne contient plus aucune violation résiduelle liée à
ces items). Ce lot traite uniquement le §3 du handoff : converger `renderIdentity` +
`renderPriceAndReference` (desktop) avec `renderIdentity` (mobile).

## Vérification ligne à ligne (avant toute fusion)

Comparaison exhaustive des deux implémentations, champ par champ :

| Zone | Desktop | Mobile | Verdict |
|---|---|---|---|
| name | identique | identique | **convergé** |
| sku/reference | identique | identique | **convergé** |
| price | `price != null ? fmtPrice(price) : ''` | `fmtPrice(price)` **sans garde** | **convergé** (garde desktop adopté partout) |
| old-price | identique (ternaire vs if/else, même effet) | identique | **convergé** |
| promo-badge | identique (toggle vs if/else, même effet) | identique | **convergé** |
| cat/series | identique | identique | **convergé** |
| desc | affiche la description | l'efface (MDM-7, sous le fold) | **NON convergé — divergence réelle** |
| stock | texte (`renderStock`, `#k-modal-stock`) | pill (`renderStockPill`, `#k-modal-stock-pill`, hors contrat) | **NON convergé — DOM différent par design** |
| aed-price / flash-bar / stock-bar | neutralisation de zones legacy mortes | n'existe pas côté mobile | reste desktop-only, hors périmètre §3 |

**Bug latent trouvé et corrigé au passage** : le mobile n'avait pas le garde
`price != null` — un prix `null` s'y serait affiché `"0 KMF"` au lieu d'une case
vide. `paintDetailFields` adopte le comportement desktop (plus sûr) pour les deux
compositions. Cas limite pré-existant (le prix est quasi toujours présent en
pratique), documenté en commentaire dans le code, pas un changement de
comportement nominal.

## Ce qui a été fait

- **`js/b-modal-product-fields.js`** : nouvelle fonction `paintDetailFields(detail, selection)`,
  owner unique des 6 zones convergées (name/sku/price/old-price/cat/promo-badge) au
  paint FINAL (post-fetch `/detail`). `paintProvisionalFields` (manche 1) inchangée.
- **`js/b-modal-desktop-product.js`** : `renderPriceAndReference` supprimée ;
  `activeUnit`/`currentPrice` supprimées (devenues mortes) ; `renderIdentity` réduite
  à ce qui reste réellement desktop-only (desc + neutralisation aed/flash/stock-bar
  legacy). Le call site appelle désormais `paintDetailFields(detail, selection)`.
- **`js/b-modal-mobile-product.js`** : `renderIdentity` réduite à l'appel
  `paintDetailFields`, au calcul de `unit` (toujours nécessaire pour le pill de
  stock) et à l'effacement de `desc`.
- **`scripts/modal-ownership.contract.json`** : `allow` vidé pour les 6 zones
  convergées (owner strict). Exception documentée : `k-modal-price` garde
  `b-modal-mobile-product.js` en `allow` à cause d'un **faux positif de
  l'heuristique du gate** — `renderStockPill` capture une variable `row` via
  `dom.modalPrice?.closest(...)` puis fait `row.appendChild(pill)` pour ajouter le
  pill de stock à côté du prix ; le gate suit la capture et attribue à tort cet
  `appendChild` à la zone prix, alors qu'il cible le conteneur `.k-modal-price-row`,
  pas le nœud prix lui-même. Ce n'est pas un `allow` de confort : la co-écriture
  réelle n'existe plus, seule la détection statique s'y trompe.
- **`docs/BOUTIQUE_ARCHITECTURE_LIVE.md`** : régénéré par `npm run audit:arch:live`
  (fichier non édité à la main, photographie automatique du code réel).

## Oracles — exécutés réellement, pas supposés

```
npm run audit:modal-ownership   → exit 0, 21 zones, 0 violation
npm run test:unit               → 92 suites / 1750 tests, 0 échec
```

Suites ciblées re-vérifiées isolément : `b-modal-core.test.js`,
`b-modal-desktop-product.test.js`, `b-modal-mobile-product.test.js`,
`b-modal-product-detail-bootstrap.test.js`, `modal-mobile-desktop-parity.test.js`
→ 110/110 verts.

**`check:fast` complet exécuté hors `test:e2e`** (nécessite Playwright + un serveur
vivant, hors périmètre de ce refactor statique) : `quality:gate`,
`check:group-wording`, `check:html`, `check:imports`, `check:body-classes`,
`check:no-injection`, `check:important`, `check:css-guard`,
`check:css-specificity-guard`, `check:css-dist-only`, `check:cache`,
`check:breakpoints`, `audit:arch`, `audit:arch:live`, `audit:ownership`,
`audit:modal-ownership`, `audit:registry`, `audit:gate`, `feature:guard:strict`,
`test:unit` → **tous verts**.

Un accroc en cours de route : le premier jet du docblock de
`b-modal-product-fields.js` était trop long et poussait `'use strict'` au-delà de
la fenêtre de scan des 2000 premiers caractères du `quality:gate` (règle
N2-STRICT) → gate rouge. Corrigé en raccourcissant l'en-tête et en déplaçant le
détail explicatif dans le commentaire JSDoc de `paintDetailFields` elle-même.

## Definition of done (§3, handoff) — statut

- `renderIdentity`/`renderPriceAndReference` n'existent plus qu'une fois
  (`b-modal-product-fields.js`) : **fait**.
- `allow` des zones scalaires vidé : **fait pour 6/6**, avec une exception
  documentée (faux positif du gate sur `k-modal-price`, pas une vraie
  co-écriture).
- Les deux oracles verts : **fait**.
- Parité desktop/mobile prouvée par `modal-mobile-desktop-parity.test.js` : **fait**,
  test existant maintenu tel quel (il couvrait déjà exactement le noyau
  transactionnel convergé).

## Point d'attention avant merge

Comme pour le Chantier Desktop, ceci pousserait directement sur `main` un refactor
multi-fichiers sans passage par une PR de revue — ton choix, mais je le note
explicitement. Le patch ci-joint s'applique proprement sur l'état actuel de ton
dépôt (vérifié avec `git apply --check`).
