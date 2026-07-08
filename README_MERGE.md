# Comment appliquer ce zip sur D:\komerce-backend

Ce zip reproduit l'arborescence RELATIVE À LA RACINE du monorepo
(donc `public/...` = `D:\komerce-backend\public\...`, etc.).

## Étapes
1. Dézipper à la racine du repo en écrasant les fichiers existants
   (chaque chemin ci-dessous correspond à un fichier déjà connu, pas de nouveau dossier à créer) :

   - public/dashboards/admin/js/api-client.js
   - public/dashboards/admin/js/views/HubRelaisView.js
   - public/dashboards/admin/js/views/SourcingScannerView.js
   - public/dashboards/tests/unit/SourcingScannerView.test.js
   - middleware/rate-limit.js
   - routes/shares.js
   - tests/unit/shares-route.test.js
   - scripts/audit-backend-arch.js
   - audit-backend-arch.js               (copie racine, doublon connu — voir dette D-15/duplication)
   - routes/admin/system.js
   - docs/DASHBOARDS_360.md
   - docs/DASHBOARDS_360.json
   - docs/META_GRAPH.md
   - docs/META_GRAPH.json
   - scripts/.dashboards-360-baseline.json
   - DETTE_TECHNIQUE_CRUD_2026-07-08.md  (mis à jour : D-12 ✅, nouveau D-16)

2. Vérifier :
   cd D:\komerce-backend
   node scripts/audit-backend-arch.js        # doit dire "Aucune violation"
   node scripts/gen-dashboards-360.js --check # doit dire 0/0/0/0
   cd public\dashboards && npx jest           # 38/38 suites, 972/972 tests
   cd ..\..\ && npx jest                      # 5703/5738 (13 échecs connus, voir D-16)

## Items mergés dans ce zip
D-03 (méthodes API mortes), D-04 (fetch → KmcApi), D-08 (rate-limit shares),
D-12 (endpoint fantôme /v2/scan), D-14 (SQL interpolé commenté).

## Nouveau dans le doc de dette
D-16 : `tests/unit/catalog-enrichment-fixtures.js` fait 0 octet (confirmé vide
dans backend.zip lui-même) → 13 échecs dans catalog-enrichment-extended.test.js.
Ce n'est PAS lié à D-10 (schema drift) contrairement à ce qu'une note précédente
supposait — c'est un fichier de fixtures manquant/non commité. Ce fichier n'est
PAS inclus dans ce zip (je ne l'ai pas reconstruit, décision 👤 à prendre d'abord).
