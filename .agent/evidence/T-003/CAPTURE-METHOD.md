# T-003 — Méthode de capture

Même méthode que T-002 (`.agent/evidence/T-002/CAPTURE-METHOD.md`) : pas de
backend/API live dans cet environnement d'exécution, donc pas de capture
depuis l'app complète. Un harnais HTML statique temporaire (non committé)
a été utilisé pour reconstruire le fragment DOM réel produit par
`renderMobileProductDetail()` / `renderAxis()` dans
`public/boutique/js/b-modal-mobile-product.js` :

- charge exactement `css/dist/base.css` + `css/dist/components.css` (mêmes
  bundles compilés que produit `npm run deploy:css`, donc les règles CSS
  capturées sont bien celles du vrai pipeline, y compris l'override mobile
  M2 ajouté dans `modal-mobile-canonical.css`) ;
- reconstruit `#k-modal .k-vg[data-axis-key="couleur"]` avec la structure
  réelle (`k-vg-label`, `k-vg-skus`, `.k-sku`, `.k-sku--active`, `.k-sku-name`)
  telle que produite par `renderAxis()` — 6 vignettes pour couvrir le scroll
  horizontal (> 5 items, spec §5.4), une active (Bleu), une hors stock (Vert,
  classe réelle `.k-sku--out`) ;
- pour le cas LEGACY, reconstruit un `.k-mdm-root` vide, conforme à ce que
  produit `renderMobileProductDetail()` quand `selection.selection_supported`
  est faux (aucun appel à `renderAxis()` dans ce cas, cf. le code source —
  pas une simulation arbitraire) ;
- capture via Playwright (Chromium) aux viewports 360px et 430px, wrapper
  `#k-modal` uniquement (comme T-002).

Fichiers requis par la tâche :
- `sku-color-360.png` — SKU avec axe Couleur, viewport 360px.
- `legacy-no-color.png` — LEGACY sans sélecteur, viewport 430px (nom de
  fichier imposé par la tâche T-003).

Fichiers supplémentaires (couverture des deux viewports de la matrice) :
- `sku-color-430.png`
- `legacy-no-color-360.png`

`tests.txt` = sortie de `npm --prefix public/boutique run test:unit`
(93 suites / 1742 tests, verts, incluant les 2 nouveaux tests M2).
