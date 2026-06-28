# Fix : préfixe `public/` manquant dans `touched-files-feature-gate.js`

## Problème

`declaredPath()` a un fallback codé en dur pour `public/boutique` mais pas pour `public/`
générique. Les fichiers `dash` déclarés sans préfixe (`dashboards/admin/index.html`) ne
matchent jamais les chemins touchés par git (`public/dashboards/admin/index.html`).

## Patch — chercher `declaredPath` dans `scripts/touched-files-feature-gate.js`

```diff
 function declaredPath(file) {
-  // Boutique files are stored without the public/boutique/ prefix
+  // Boutique files are stored without the public/boutique/ prefix (most specific first)
   if (file.startsWith('public/boutique/')) {
     return file.replace('public/boutique/', 'boutique/');
   }
+  // All other public/ files (dash, hub, relais, js/, css/ racine…)
+  // are declared without the public/ prefix in their feature card
+  if (file.startsWith('public/')) {
+    return file.replace('public/', '');
+  }
   return file;
 }
```

> **Ordre critique** : le cas `public/boutique/` DOIT rester avant `public/` générique,
> sinon les fichiers boutique matcheraient `boutique/…` via les deux branches
> (inoffensif mais ambigu).

## Test de régression après patch

```bash
node scripts/touched-files-feature-gate.js \
  --files "public/dashboards/admin/index.html,public/hub/index.html,public/js/auth-guard.js"
# Attendu : 0 fichier sans propriétaire (les 8 déjà déclarés passent)

node scripts/touched-files-feature-gate.js \
  --files "public/dashboards/admin/js/views/PricingView.js"
# Attendu : 0 erreur après backfill dashboard.feature.js

node scripts/touched-files-feature-gate.js \
  --files "public/boutique/pages/checkout.js"
# Attendu : toujours résolu correctement (régression boutique OK)
```
