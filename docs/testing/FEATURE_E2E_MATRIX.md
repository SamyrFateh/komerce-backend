# Matrice E2E Feature First

> Fichier **généré** par `scripts/gen-feature-e2e-matrix.js`. Ne pas éditer à la main.

## Bilan

| Statut | Features |
|---|---|
| `PROVEN` | 9 |
| `PARTIAL` | 18 |
| `MISSING` | 0 |
| `NOT_APPLICABLE` | 1 |

## Harnais exécutables

| Harnais | Commande | Prérequis |
|---|---|---|
| E2E API (Feature First) | `npm run test:e2e:features` | DATABASE_URL vers une base de test (garde fail-closed : tests/helpers/e2eDbKit.js) |
| Intégration | `npm run test:integration` | `DATABASE_URL` (voir `.github/workflows/ci.yml`) |
| E2E navigateur | `npm run test:e2e:business (depuis public/boutique)` | BASE_URL vers un environnement de staging + compte de test |

E2E navigateur : 53 specs Playwright, dont 22 sous `authenticated/`.

## Lot 1

| Feature | Nature | Cycle | Routes | Invariants (exéc./décl.) | Preuves exécutables | Couverture | Gap |
|---|---|---|---|---|---|---|---|
| `auth` | feature / transversal | production | 0 | 0/5 | unit:13 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 5/5 invariant(s) non exécutable(s). |
| `auth-identity` | feature / transversal | production | 22 | 2/5 | e2e-api:1 integration:2 invariant:1 unit:5 | `PROVEN` | 3/5 invariant(s) non exécutable(s). |
| `auth-passkey` | feature / transversal | production | 8 | 2/13 | e2e-api:2 unit:6 | `PROVEN` | Aucune preuve traversant les couches réelles (unitaire seul). 11/13 invariant(s) non exécutable(s). |
| `catalog` | feature / feature | production | 31 | 0/18 | integration:1 unit:40 | `PARTIAL` | Aucun E2E fonctionnel possédé. 18/18 invariant(s) non exécutable(s). |
| `orders` | feature / feature | production | 28 | 3/7 | e2e-api:3 integration:2 invariant:1 unit:28 | `PROVEN` | 4/7 invariant(s) non exécutable(s). |
| `payments` | feature / feature | production | 18 | 3/4 | e2e-api:2 invariant:2 unit:17 | `PROVEN` | 1/4 invariant(s) non exécutable(s). |
| `shared-cart` | feature / feature | production | 16 | 0/9 | unit:13 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 9/9 invariant(s) non exécutable(s). |

## Lot 2

| Feature | Nature | Cycle | Routes | Invariants (exéc./décl.) | Preuves exécutables | Couverture | Gap |
|---|---|---|---|---|---|---|---|
| `customs` | feature / feature | production | 20 | 0/1 | unit:6 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 1/1 invariant(s) non exécutable(s). |
| `inventory` | feature / feature | staging | 8 | 1/1 | e2e-api:1 integration:1 unit:2 | `PROVEN` |  |
| `logistics` | feature / feature | production | 71 | 1/8 | e2e-api:1 integration:1 unit:35 | `PROVEN` | 7/8 invariant(s) non exécutable(s). |
| `loyalty` | feature / feature | production | 7 | 0/2 | unit:3 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 2/2 invariant(s) non exécutable(s). |
| `purchasing` | feature / feature | production | 10 | 1/4 | e2e-api:1 unit:9 | `PROVEN` | Aucune preuve traversant les couches réelles (unitaire seul). 3/4 invariant(s) non exécutable(s). |
| `refunds` | feature / feature | production | 0 | 0/1 | e2e-api:1 unit:3 | `PROVEN` | Aucune preuve traversant les couches réelles (unitaire seul). 1/1 invariant(s) non exécutable(s). |
| `unsold-resolution` | feature / feature | production | 7 | 0/2 | unit:1 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 2/2 invariant(s) non exécutable(s). |
| `wallet` | feature / feature | production | 9 | 1/2 | e2e-api:1 invariant:1 unit:3 | `PROVEN` | 1/2 invariant(s) non exécutable(s). |

## Lot 3

| Feature | Nature | Cycle | Routes | Invariants (exéc./décl.) | Preuves exécutables | Couverture | Gap |
|---|---|---|---|---|---|---|---|
| `business-rules` | feature / transversal | production | 5 | 0/3 | unit:2 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 3/3 invariant(s) non exécutable(s). |
| `dashboard` | feature / transversal | production | 65 | 0/8 | autre:1 unit:33 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 8/8 invariant(s) non exécutable(s). |
| `decision-signals` | capability | staging | 0 | 0/2 | unit:3 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 2/2 invariant(s) non exécutable(s). |
| `documents` | feature / feature | production | 9 | 0/7 | unit:14 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 7/7 invariant(s) non exécutable(s). |
| `economic-engine` | feature / feature | production | 73 | 0/2 | integration:2 unit:49 | `PARTIAL` | Aucun E2E fonctionnel possédé. 2/2 invariant(s) non exécutable(s). |
| `incident-management` | feature / transversal | production | 0 | 0/3 | unit:2 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 3/3 invariant(s) non exécutable(s). |
| `infrastructure` | feature / transversal | production | 4 | 0/4 | autre:3 integration:2 unit:12 | `PARTIAL` | Aucun E2E fonctionnel possédé. 4/4 invariant(s) non exécutable(s). |
| `notifications` | feature / feature | production | 6 | 0/8 | autre:1 notifications:5 unit:12 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 8/8 invariant(s) non exécutable(s). |
| `platform-ops` | feature / transversal | production | 33 | 0/3 | integration:6 unit:14 | `PARTIAL` | Aucun E2E fonctionnel possédé. 3/3 invariant(s) non exécutable(s). |
| `recommendations` | feature / feature | staging | 1 | 0/1 | unit:2 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 1/1 invariant(s) non exécutable(s). |
| `sourcing` | feature / feature | production | 11 | 0/4 | unit:2 | `PARTIAL` | Aucun E2E fonctionnel possédé. Aucune preuve traversant les couches réelles (unitaire seul). 4/4 invariant(s) non exécutable(s). |

## Hors lot

| Feature | Nature | Cycle | Routes | Invariants (exéc./décl.) | Preuves exécutables | Couverture | Gap |
|---|---|---|---|---|---|---|---|
| `market` | feature / feature | draft | 0 | 0/29 | integration:6 unit:3 | `PARTIAL` | Aucun E2E fonctionnel possédé. 29/29 invariant(s) non exécutable(s). |
| `wallet-loyalty` | feature / feature | deprecated | 0 | 0/0 | — | `NOT_APPLICABLE` | Feature dépréciée — ne pas lui inventer de comportement (chantier §3). |

## Lecture

- `unit` ne prouve aucun parcours : mocks internes, aucune traversée de couche.
- `PROVEN` exige un E2E fonctionnel possédé, ou un invariant exécutable adossé à une preuve d'intégration/contrat.
- Un fichier de test appartient à **exactement une** feature (`files.tests`). Les features traversées par un scénario vertical sont documentées dans l'en-tête du scénario, jamais par une seconde déclaration d'ownership.
