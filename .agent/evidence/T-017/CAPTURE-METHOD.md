# T-017 — Méthode de capture

Pas de backend/API live disponible dans cet environnement d'exécution (pas de
Postgres, pas de serveur `main.js` en cours). Comme pour T-002/T-003/T-004,
les captures sont prises depuis un harnais HTML statique (`harness.html`) qui :

- charge directement les bundles CSS compilés réels
  (`public/boutique/css/dist/{base,components,desktop}.css`, régénérés via
  `npm run deploy:css` avant capture — aucune règle "de complaisance" hors
  du vrai pipeline) ;
- reconstruit le fragment DOM réel `.k-modal-info` (`k-modal-name-row`,
  `k-modal-sku`, `.k-modal-price-row`, `.k-modal-desc`, `.k-modal-meta`
  avec `#k-modal-cat` / `#k-modal-stock`) tel que produit par
  `renderIdentity()` dans `b-modal-desktop-product.js` ;
- applique exactement la même logique que `renderIdentity()` lignes 84-88
  (`textContent = series || ''`, `hidden = !series`) via `page.evaluate`,
  pour les deux cas (série présente / absente) ;
- capture via Playwright + le binaire Chromium disponible dans le sandbox
  (`~/.cache/puppeteer/chrome/.../chrome`, résolu en pointant explicitement
  `executablePath` — le téléchargement des navigateurs Playwright depuis son
  CDN n'est pas accessible sur ce réseau restreint, mais un binaire
  Chromium pré-existant l'est).

Fichiers requis par la tâche :
- `desktop-series-1024.png`, `desktop-series-1440.png` — série présente,
  affichée correctement aux deux largeurs cibles.

Fichiers complémentaires (preuve du fallback silencieux, spec §9.1) :
- `desktop-series-1024-fallback.png`, `desktop-series-1440-fallback.png` —
  série absente : `#k-modal-cat` est `hidden`, `.k-modal-meta` n'affiche que
  le stock, aucune ligne vide.

`capture.js` reproduit la capture (nécessite d'être copié temporairement
dans `public/boutique/` pour la résolution de `playwright-core` via
`node_modules`, cf. commentaire en tête de fichier).

`tests.txt` = sortie complète des 5 gates + suite unitaire série desktop
ciblée (92 suites / 1751 tests, verts).
