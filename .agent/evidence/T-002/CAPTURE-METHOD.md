# T-002 — Méthode de capture

Pas de backend/API live disponible dans cet environnement d'exécution
(pas de Postgres, pas de serveur `main.js` en cours). Les captures ne sont
donc pas prises depuis l'app complète, mais depuis un harnais HTML statique
minimal qui :

- charge exactement `css/dist/base.css` + `css/dist/components.css`
  (les mêmes bundles compilés que produit `npm run deploy:css`, donc
  aucune règle CSS "de complaisance" hors du vrai pipeline) ;
- reconstruit le fragment DOM `#k-modal .k-modal-info` avec la structure
  réelle (`k-modal-name-row`, `k-modal-sku`, `.k-modal-price-row` +
  `#k-modal-price` + `#k-modal-stock-pill`) telle que produite par
  `renderIdentity()` / `renderStockPill()` dans `b-modal-mobile-product.js` ;
- capture via Playwright (Chromium) aux viewports 360px et 430px.

Fichiers requis par la tâche :
- `mobile-360-stock.png`, `mobile-430-stock.png` (état "En stock", copie de
  `*-ok.png` — état par défaut/représentatif).

Fichiers supplémentaires (couverture des 3 états spec §5.5) :
- `mobile-{360,430}-stock-ok.png` — stock > 5 ("En stock")
- `mobile-{360,430}-stock-low.png` — 1 ≤ stock ≤ 5 ("Plus que N")
- `mobile-{360,430}-stock-out.png` — stock = 0 ("Épuisé")

`tests.txt` = sortie complète de `npm --prefix public/boutique run test:unit`
(93 suites / 1740 tests, verts).
