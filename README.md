# Livraison — gates test-kit + lots dashboards manquants

Arborescence de ce zip = arborescence exacte du monorepo (racine = backend,
`public/boutique/`, `public/dashboards/`). Copie-colle en écrasant tel quel,
**sauf** les 4 fichiers ci-dessous qui étaient déjà présents chez toi et que
j'ai modifiés à partir de la version que tu m'avais envoyée (`archive.zip`)
— si tu as retouché ces fichiers depuis, diffe avant d'écraser :

| Fichier | Modification |
|---|---|
| `package.json` (racine) | + scripts `testkit:check` / `testkit:check:report` |
| `.github/workflows/ci.yml` | + step "Test-kit usage gate" dans le job `unit`, + `fetch-depth: 0` sur le checkout (nécessaire pour que `git diff origin/main...HEAD` fonctionne) |
| `public/boutique/package.json` | + scripts `testkit:check` / `testkit:check:report` |
| `public/dashboards/package.json` | + scripts `testkit:check` / `testkit:check:report`, wirés dans `check:all`/`precommit` |
| `public/dashboards/jest.config.js` | retiré `'!admin/js/views/**'` de `collectCoverageFrom` (régression vs état documenté — masquait la couverture des vues) |
| `public/dashboards/tests/unit/helpers/dashboardTestKit.js` | ajout de `mountContainer` + `mockEscHelpers` (nécessaires à SettingsView/ClientsView, absents de la version en place) |

Tout le reste est **nouveau**, sans risque d'écrasement :
- `scripts/test-kit-usage-check.js` (racine, backend)
- `public/boutique/scripts/test-kit-usage-check.js`
- `public/dashboards/scripts/test-kit-usage-check.js`
- `public/dashboards/tests/unit/{SettingsView,ClientsView,ProductsView,SalesView,HubRelaisView,ProblemsView}.test.js`

## Vérifié réellement avant livraison
- Backend : 311/313 suites, 5535/5552 tests (3 échecs préexistants sourcing-analysis, sans rapport)
- Boutique : 22/22 suites, 586/586 tests
- Dashboards : **21/21 suites, 177/177 tests** (avec les 6 lots + ProblemsView intégrés)

## Toujours en suspens
- **Boutique et Dashboards n'ont aucun `.github/workflows`** — le gate `testkit:check` de boutique ne tourne nulle part automatiquement ; celui de dashboards ne tourne qu'au `precommit` local. Dis-moi si je crée un `ci.yml` minimal pour les deux.
- Dette pré-existante remontée par le gate (hors scope, non touchée) : 10/313 fichiers backend, 2/20 dashboards (`SalesView.test.js`, `HubRelaisView.test.js`) réinventent encore leur mock sans passer par le kit.
