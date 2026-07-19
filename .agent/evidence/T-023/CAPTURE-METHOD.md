# T-023 — Méthode de capture

Même méthode que T-017/T-018 : harnais HTML statique (`harness.html`) qui :

- charge les bundles CSS compilés réels (`public/boutique/css/dist/{base,components,desktop}.css`,
  vérifiés à jour via `npm run deploy:css` avant capture — aucune règle de complaisance
  hors du vrai pipeline) ;
- reconstruit le fragment DOM réel `.k-modal-product-zone` > `.k-modal-actions`
  (`#k-qty`, `#k-add-cart-btn`, `#k-buy-now-btn`) tel que produit par le markup de
  `public/boutique/index.html` (lignes 439-450) ;
- applique exactement la même logique que `renderActions()`
  (`b-modal-desktop-product.js:171-178`) via `page.evaluate` : toggle de la classe
  `.k-modal-actions--filled` sur `#k-modal-actions` selon l'état `inCart` (qty > 0) ;
- capture via Playwright + le binaire Chromium local du sandbox
  (`~/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome`, résolu en
  pointant explicitement `executablePath` — le téléchargement des navigateurs
  Playwright depuis son CDN reste hors allowlist réseau, mais ce binaire
  pré-existant est accessible).

Image produit remplacée par un data-URI SVG local (fond neutre) dans le harnais :
`picsum.photos` n'est pas sur l'allowlist réseau du sandbox et bloquait le
chargement de page (timeout de navigation). Sans incidence sur la zone capturée
(`.k-modal-actions` uniquement), qui ne dépend pas du visuel produit.

## Fichiers requis par la tâche

- `desktop-actions-empty.png` — état `AVAILABLE_EMPTY` (1024px) : deux CTA flex:1
  côte à côte (`Ajouter au panier` / `Acheter maintenant`), stepper masqué.
- `desktop-actions-filled.png` — état `AVAILABLE_FILLED` (1024px) : stepper largeur
  auto + `Acheter maintenant` flex:1, CTA `Ajouter` masqué.

## Contrôle de layout shift

`capture.js` mesure le `boundingBox()` de `#k-modal-actions` dans les deux états et
compare les hauteurs. Résultat mesuré : **0px de delta** entre EMPTY et FILLED
(x: 500.8, y: 809, width: 499.2, height: 73 — identiques dans les deux états).
Seul le contenu interne change (stepper show/hide, CTA Ajouter show/hide), jamais
la boîte englobante du bloc actions — conforme au critère d'acceptation
« Aucun layout shift notable entre EMPTY et FILLED ».

`capture.js` reproduit la capture (nécessite d'être copié temporairement dans
`public/boutique/` pour la résolution de `playwright-core` via `node_modules`,
comme pour T-017/T-018).
