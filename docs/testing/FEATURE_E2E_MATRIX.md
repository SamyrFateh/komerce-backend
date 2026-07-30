# Matrice E2E Feature First

> Fichier **généré** par `scripts/gen-feature-e2e-matrix.js`. Ne pas éditer à la main.

## Bilan

| Statut | Features |
|---|---|
| `PROVEN` | 7 |
| `PARTIAL` | 18 |
| `MISSING` | 0 |
| `NOT_APPLICABLE` | 1 |

## Harnais exécutables

| Harnais | Commande | Prérequis |
|---|---|---|
| E2E API (Feature First) | `npm run test:e2e:features` | DATABASE_URL vers une base de test (garde fail-closed : tests/helpers/e2eDbKit.js) |
| Intégration | `npm run test:integration` | `DATABASE_URL` (voir `.github/workflows/ci.yml`) |
| E2E navigateur | `npm run test:e2e:business (depuis public/boutique)` | BASE_URL vers un environnement de staging + compte de test |

E2E navigateur : 46 specs Playwright, dont 17 sous `authenticated/`.

## Lot 1

| Feature | Nature | Cycle | Routes | Invariants (exéc./décl.) | Preuves exécutables | Couverture | Gap |
|---|---|---|---|---|---|---|---|
| `auth` | feature / transversal | production | 0 | 0/1 | unit:8 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 1/1 invariant(s) non exécutable(s). |
| `auth-identity` | feature / transversal | production | 20 | 1/2 | integration:2 invariant:1 unit:2 | `PROVEN` | Aucun E2E fonctionnel possédé. 1/2 invariant(s) non exécutable(s). |
| `catalog` | feature / feature | production | 31 | 0/18 | integration:1 unit:36 | `PARTIAL` | Aucun E2E fonctionnel possédé. 18/18 invariant(s) non exécutable(s). |
| `orders` | feature / feature | production | 34 | 3/7 | e2e-api:2 integration:1 invariant:1 unit:25 | `PROVEN` | 4/7 invariant(s) non exécutable(s). |
| `payments` | feature / feature | production | 18 | 2/3 | e2e-api:1 invariant:2 unit:17 | `PROVEN` | 1/3 invariant(s) non exécutable(s). |
| `shared-cart` | feature / feature | production | 33 | 2/6 | e2e-api:1 unit:41 | `PROVEN` | Aucune preuve traversant les couches réelles (unitaire seul). 4/6 invariant(s) non exécutable(s). |

## Lot 2

| Feature | Nature | Cycle | Routes | Invariants (exéc./décl.) | Preuves exécutables | Couverture | Gap |
|---|---|---|---|---|---|---|---|
| `customs` | feature / feature | production | 20 | 0/1 | unit:6 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 1/1 invariant(s) non exécutable(s). |
| `inventory` | feature / feature | staging | 8 | 1/1 | e2e-api:1 integration:1 unit:2 | `PROVEN` |  |
| `logistics` | feature / feature | production | 69 | 0/6 | integration:1 unit:32 | `PARTIAL` | Aucun E2E fonctionnel possédé. 6/6 invariant(s) non exécutable(s). |
| `loyalty` | feature / feature | production | 7 | 0/2 | unit:3 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 2/2 invariant(s) non exécutable(s). |
| `purchasing` | feature / feature | production | 10 | 0/3 | unit:8 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 3/3 invariant(s) non exécutable(s). |
| `refunds` | feature / feature | production | 0 | 0/1 | e2e-api:1 unit:3 | `PROVEN` | Aucune preuve traversant les couches réelles (unitaire seul). 1/1 invariant(s) non exécutable(s). |
| `unsold-resolution` | feature / feature | production | 7 | 0/2 | unit:1 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 2/2 invariant(s) non exécutable(s). |
| `wallet` | feature / feature | production | 9 | 1/2 | invariant:1 unit:3 | `PROVEN` | Aucun E2E fonctionnel possédé. 1/2 invariant(s) non exécutable(s). |

## Lot 3

| Feature | Nature | Cycle | Routes | Invariants (exéc./décl.) | Preuves exécutables | Couverture | Gap |
|---|---|---|---|---|---|---|---|
| `business-rules` | feature / transversal | production | 5 | 0/3 | unit:2 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 3/3 invariant(s) non exécutable(s). |
| `dashboard` | feature / transversal | production | 65 | 0/4 | autre:1 unit:31 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 4/4 invariant(s) non exécutable(s). |
| `decision-signals` | capability | staging | 0 | 0/2 | unit:3 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 2/2 invariant(s) non exécutable(s). |
| `documents` | feature / feature | production | 3 | 0/1 | unit:10 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 1/1 invariant(s) non exécutable(s). |
| `economic-engine` | feature / feature | production | 73 | 0/1 | integration:2 unit:44 | `PARTIAL` | Aucun E2E fonctionnel possédé. 1/1 invariant(s) non exécutable(s). |
| `incident-management` | feature / transversal | production | 0 | 0/3 | unit:1 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 3/3 invariant(s) non exécutable(s). |
| `infrastructure` | feature / transversal | production | 5 | 0/4 | autre:3 integration:2 unit:12 | `PARTIAL` | Aucun E2E fonctionnel possédé. 4/4 invariant(s) non exécutable(s). |
| `notifications` | feature / feature | production | 4 | 0/2 | autre:1 notifications:5 unit:10 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 2/2 invariant(s) non exécutable(s). |
| `platform-ops` | feature / transversal | production | 33 | 0/3 | integration:6 unit:14 | `PARTIAL` | Aucun E2E fonctionnel possédé. 3/3 invariant(s) non exécutable(s). |
| `recommendations` | feature / feature | staging | 1 | 0/1 | unit:2 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 1/1 invariant(s) non exécutable(s). |
| `sourcing` | feature / feature | production | 11 | 0/4 | unit:1 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 4/4 invariant(s) non exécutable(s). |

## Hors lot

| Feature | Nature | Cycle | Routes | Invariants (exéc./décl.) | Preuves exécutables | Couverture | Gap |
|---|---|---|---|---|---|---|---|
| `wallet-loyalty` | feature / feature | deprecated | 0 | 0/0 | — | `NOT_APPLICABLE` | Feature dépréciée — ne pas lui inventer de comportement (chantier §3). |

## Lecture

- `unit` ne prouve aucun parcours : mocks internes, aucune traversée de couche.
- `PROVEN` exige un E2E fonctionnel possédé, ou un invariant exécutable adossé à une preuve d'intégration/contrat.
- Un fichier de test appartient à **exactement une** feature (`files.tests`). Les features traversées par un scénario vertical sont documentées dans l'en-tête du scénario, jamais par une seconde déclaration d'ownership.
