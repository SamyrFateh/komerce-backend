# B5 — Agent Remediation Contract

## Objectif

Komerce ne doit pas seulement détecter une régression. Un agent doit pouvoir partir du diagnostic et retrouver sans reconstituer l’architecture :

1. un **code de remédiation stable** ;
2. le **scope** (`backend`, `dashboard`, `boutique`, `governance`) ;
3. l’**owner canonique attendu** ;
4. la **cause** que le gate mesure ;
5. l’**action corrective autorisée** ;
6. ce qu’il est **interdit de faire pour rendre la CI verte** ;
7. l’**evidence** ayant déclenché l’écart.

Principe :

> **1 écart mesuré = 1 code stable = 1 owner canonique = 1 chemin de correction.**

Le registre exécutable unique est `scripts/agent-remediation-contract.js`.

L’index courant, généré depuis les mesures réelles, est `docs/AGENT_REMEDIATION_INDEX.json`.

## Règle anti-bruit

Une baseline, allowlist, exception ou snapshot est un cliquet ou une preuve — jamais un bouton « accepter la nouvelle dette ».

Tous les contrats portent la politique :

`baselinePolicy = never-increase-to-pass`

Un agent doit d’abord corriger la cause. Une modification d’exception n’est acceptable que lorsque la responsabilité ou la doctrine change réellement, avec preuve explicite.

## Backend

Le backend combine plusieurs types de preuve :

- `backend:audit` / invariants `I-BACK-*` ;
- `backend:debt --json` pour l’inventaire des dettes et exceptions revues ;
- Quality Gate ;
- Feature Guard / ownership canonique ;
- Contract Check ;
- Security 360 ;
- immutabilité migrations ;
- fraîcheur et anti-résurrection du schéma ;
- Golden CDR sur le comportement économique.

Les `remedy` déjà portés par `COLUMN_OWNERSHIP` restent la consigne la plus précise. B5 ne les remplace pas : il les enveloppe dans le contrat agent global.

Les exceptions réauditées sont conservées comme **information documentée**, pas comme dette ouverte. Si leur responsabilité change, elles doivent être réauditées avant de rester exemptées.

## Dashboards

`DASHBOARDS_360` suit cinq catégories :

| Mesure | Code agent | Statut |
|---|---|---|
| `orphanRoutes` | `DASH-ORPHAN-ROUTE` | bloquant |
| `deadApiMethods` | `DASH-DEAD-API-METHOD` | bloquant |
| `missingApiMethods` | `DASH-MISSING-API-METHOD` | bloquant |
| `doctrineViolations` | `DASH-DOCTRINE-FETCH` | bloquant |
| `unprovenContracts` | `DASH-UNPROVEN-CONTRACT` | informatif à rembourser par preuve |

Les quatre anomalies structurelles sont actuellement sous baseline zéro. `unprovenContracts` reste un inventaire de preuve à compléter : un agent doit ajouter le témoin backend/OpenAPI, jamais changer `UNKNOWN` en `PROVEN` manuellement.

Toute modification sous `public/dashboards/**` réveille désormais un scope CI Dashboard explicite et exécute `dashboards:360:check`.

## Boutique

B5 réutilise les protections Debt Zero déjà fermées :

- cascade 0 ;
- spécificité 0 ;
- dette `!important` ouverte 0 ;
- ownership applicatif 100% ;
- contrat des sélecteurs critiques ;
- contrat des variables CSS runtime.

Chaque famille dispose d’un code de remédiation spécifique et interdit de relever sa baseline pour passer.

## Index généré

`npm run agent:remediation:gen` reconstruit `docs/AGENT_REMEDIATION_INDEX.json` depuis :

- `backend:debt --json` ;
- `docs/DASHBOARDS_360.json` + `.dashboards-360-baseline.json` ;
- les baselines et registres exécutables Boutique ;
- `docs/GATE_FINDINGS.json` ;
- le catalogue B5.

`npm run agent:remediation:check` vérifie simultanément :

- que chaque contrat possède owner/cause/action/interdit ;
- que chaque métrique dashboard a un code de remédiation ;
- que toute dette backend actuellement mesurée est résoluble par le contrat ;
- que les Gate Findings sont résolubles ;
- que les gates critiques restent réellement branchés dans `pr-enforcement.yml` ;
- que l’index généré est frais.

Si une nouvelle classe de gate ou une nouvelle métrique apparaît sans contrat B5, la CI doit échouer avant merge.

## Règle pour les agents

Quand un gate échoue :

1. lire le code B5 associé ;
2. ouvrir l’owner indiqué ;
3. utiliser l’evidence (fichier, règle, message, feature) ;
4. appliquer l’action corrective dans l’owner existant ;
5. relancer le gate source ;
6. régénérer l’index si la mesure a changé ;
7. ne modifier baseline/allowlist/exception que si la doctrine elle-même a changé et que cette décision est explicitement prouvée.
