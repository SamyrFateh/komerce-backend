# T-018 — Méthode de capture et de validation

Pas de backend/API live disponible (mêmes contraintes que T-002/T-007/T-017).
Deux harnais HTML statiques, chargeant les bundles CSS compilés réels
(`css/dist/{base,components,desktop}.css`) :

- `harness.html` — reproduit `.k-modal-product-zone` (image + détails courts)
  pour mesurer/capturer la géométrie du hero seul.
- `harness-long-content.html` — même structure avec un bloc `.k-modal-info`
  volontairement long (caractéristiques, avis, FAQ répétés) pour forcer un
  dépassement réel de la hauteur disponible et valider le scénario "contenu
  droit long" exigé par l'arbitrage (`.agent/arbitrations/T-018.md`).

`measure.js` et `measure-long-content.js` : scripts Playwright (Chromium
local, `~/.cache/puppeteer/chrome/.../chrome` via `executablePath` — même
méthode que T-017) qui mesurent la bounding box réelle (`boundingBox()`,
`scrollHeight`/`clientHeight`, `getComputedStyle`) puis capturent une image.
Nécessitent d'être copiés temporairement dans `public/boutique/` pour la
résolution de `playwright-core`.

## Résultats mesurés

Voir `measurements-and-gates.txt` pour la sortie brute complète. Résumé :

| Viewport | Largeur hero | Hauteur hero | Ratio |
|---|---|---|---|
| 1024px | 491.5px | 368.6px | 1.333 (4:3) |
| 1440px | 666.7px | 500.0px | 1.333 (4:3) |

Scénario contenu droit long :
- `product-zone` reste à hauteur fixe (`842px` = `calc(100dvh - 58px)` pour
  un viewport de test de 900px de haut), ne dépasse jamais le viewport.
- `.k-modal-details` : `scrollHeight` (1291 à 1024px / 1135 à 1440px) >
  `clientHeight` (842) — le scroll interne se déclenche réellement.
- Le hero garde exactement le même ratio/hauteur qu'avec un contenu court
  (368.6px / 500.0px) — il ne s'étire pas.

## Fichiers

- `desktop-hero-1024.png`, `desktop-hero-1440.png` — hero seul, capture
  exacte de `.k-modal-img-wrap` (préconditions T-018).
- `long-content-1024.png`, `long-content-1440.png` — capture pleine page du
  scénario contenu long, preuve visuelle du non-débordement et du scroll
  interne.
- `measurements-and-gates.txt` — mesures brutes + sortie complète des 5
  gates déclarées (`deploy:css`, `check:cache`, `check:breakpoints`,
  `audit:ownership`, `audit:gate`) + `test:unit` par précaution.
