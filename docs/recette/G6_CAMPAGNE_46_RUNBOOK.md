# Campagne G6 des 46 scénarios : runbook de lancement

Ce document permet à **n'importe quel agent** (GPT, Opus, Sonnet) ou au propriétaire de rejouer la campagne seul, sur le même SHA, et de comparer ses résultats.

- Source métier unique : `docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json`.
- Suivi : issue #4550 et `docs/chantier/STATUS.md`.

## 1. Règles non négociables
- **Staging uniquement**, sans production, sans PSP réel et sans fournisseur réel.
- **Gestes humains dans Chromium**, depuis l'écran du rôle concerné.
- **API** : seulement pour une réponse externe sans écran (fournisseur simulé, webhook PSP simulé) et pour une sonde négative signalée `API_PROBE_NO_SCREEN_GESTURE`.
- **PG** en lecture seule, comme oracle. Seule exception : les fixtures d'identité.
- **Un écran manquant est un FAIL** (`SCREEN_MISSING_*`), jamais un contournement.
- **Lancement** : seul le propriétaire du dépôt peut lancer un run, en ouvrant une issue dont le titre est exact (gardes propriétaire, SHA et identité Railway).

## 2. Lancer un scénario
Ouvrir une issue intitulée :

`[staging-op] g6-dynamic-fresh-full-<ID>-<MARCHÉ>`

- `<ID>` : M01, M02, M03, M06, ou N01 à N40.
- `<MARCHÉ>` : KM, CM ou CG.

Exemple : `[staging-op] g6-dynamic-fresh-full-N23-CM`.

| Rôle | Fichier |
|---|---|
| Workflow | `.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml` |
| Orchestrateur | `scripts/recette/g6-dynamic-buyer-cash.js` |
| Séquences | `scripts/recette/canonical/stage-registry.js` |

En fresh, M01 sur CM ou CG est catalogué M04 ou M05.

### Contraintes d'enchaînement, apprises en campagne
1. **Un seul run à la fois.** Le workflow n'a qu'un groupe de concurrence (`komerce-g6-canonical-real-transaction`). Un run *en attente* est remplacé par le suivant et finit `cancelled`, sans job. Attendre la fin d'un run avant d'ouvrir l'issue suivante.
2. **Un run `cancelled` sans aucun job** (annulation à vide par GitHub) se relance par `POST /actions/runs/<id>/rerun`.
3. **Pas de fusion sur `main` pendant un run.** Le run s'arrête alors sur `G6_DYNAMIC_STAGING_SHA_DRIFT`. Attendre que le SHA servi (`/health/version`) égale `main`.
4. **N23** verrouille l'agent relais E2E pendant 15 minutes. Attendre au moins 16 minutes avant tout autre scénario qui utilise le relais.
5. **N13** laisse un reliquat fournisseur ouvert, qui se regroupe avec la commande suivante du même SKU. Lancer `g6-cleanup-recette-apply` avant de rejouer M01, N14 ou toute chaîne import sur le même marché.
6. Les scénarios négatifs laissent des commandes ouvertes. Nettoyer en fin de lot (§ 4).

Le script `scripts/recette/ops/g6-run-scenario.sh` fait l'équivalent : il ouvre l'issue, attend la fin du run, relance une annulation à vide, puis extrait le verdict.

## 3. Prérequis de données (à vérifier avant tout run)

| Besoin | Commande (titre d'issue) | Remarque |
|---|---|---|
| Sonde en lecture seule | `[staging-op] g6-prereq-probe-<MK>` | Sources par fournisseur, stock local exposé, second relais (N21/N22). Rend `M03_READY` ou `M03_MISSING:<quoi>`. |
| Stock local (M02, N04, N09, N21 à N24, N29) | `[staging-op] g6-local-stock-declare-<MK>` | Écran W3 du `market_operator` : +10 unités, puis « Exposer ». Ne prend **jamais** KPR-000165 (produit M01) et masque son stock local s'il est exposé. |
| Produit central Hub (M03, M06, N34) | `[staging-op] g6-central-hub-product-<MK>` | **Bloqué** à la certification Catalogue : écran d'image et doctrine du contrat source en attente de GPT. |
| Comptes E2E | `staging-e2e-provision.yml` | Confirmation `PROVISION-STAGING-E2E`. |
| Remise à zéro de l'activité | `staging-reset.yml` (scope `activity`) | Confirmation `RESET-STAGING-BUSINESS-DATA`. Préserve catalogue, prix et médias, puis reprovisionne les comptes E2E. Uniquement sur GO du propriétaire. |

## 4. Nettoyage
1. `[staging-op] g6-cleanup-recette` : plan, en lecture seule.
2. `[staging-op] g6-cleanup-recette-apply` : gestes écran.
   - Classes A et B : brouillon écarté, ligne puis commande annulées.
   - Classe C : PO de recette annulé.
   - Classe D payée et disponible : **vraie remise au comptoir** (`handover_relay`).

Ce que le nettoyage ne sait pas encore clore (`SCREEN_MISSING`, écrans demandés à GPT) :
- commande dont le sac est dans une KOM-BOX figée (« Solder la recette (KOM-BOX figée) ») ;
- incident d'écart de réception N20 ;
- expédition N16 remise au transitaire.

## 5. Lire un verdict
L'artefact du run contient `test-results/` :
- `g6-dynamic-buyer-cash/report.json`, le verdict global ;
- `g6-negative-<ids>/report.json` : `attempts`, `probes`, `gaps`, `ux_signal`, `steps_reached` ;
- les traces, captures et le journal réseau de chaque étape.

| Verdict | Sens |
|---|---|
| `G6_<ID>_..._PASS` | Conforme, prouvé en PG. |
| `PRODUCT_GAP_<ID>` | **Défaut produit réel**, à corriger côté produit. |
| `SCREEN_MISSING_*` | Écran absent, compté FAIL. |
| `PREREQ_MISSING_*` | Donnée de test manquante (§ 3). |
| `BLOCKED` ou `NOT_PROVEN` | Le runner n'a pas conclu. Lire `err` et `child_error` avant toute conclusion. |

## 6. Dernier état connu côté Opus (21/11)

| Scénario | KM | CM | CG | Remarque |
|---|---|---|---|---|
| M01 (M04, M05) | PASS | PASS | PASS | KERKYQK, KCMHGQ6, KOQVJ22 |
| M02 | PASS | PASS | PASS | KM0VKLQ, KD47HXA, KWISEXJ |
| M03 | — | — | — | Codé (#4766, #4771), bloqué par le produit central |
| M06 | — | — | — | Bloqué par le produit central (certification Catalogue) |
| N04 | PASS | PASS | PASS | Refus au preview 409, sans message visible (ergonomie) |
| N07 | PASS | PASS | PASS | |
| N09 | PASS | PASS | PASS | |
| N11 | PASS | PASS | PASS | |
| N12 | PASS | PASS | PASS | |
| N13 | PASS | PASS | PASS | Nettoyer après (§ 2.5) |
| N14 | PASS | PASS | PASS | |
| N15 | PRODUCT_GAP | PRODUCT_GAP | PRODUCT_GAP | Expédition vide créée (201) |
| N16 | PASS | PASS | PASS | |
| N20 | PASS | PASS | PASS | |
| N21 et N22 | PRODUCT_GAP | PRODUCT_GAP | PRODUCT_GAP | Lecture inter-relais (`orders/:id`, `:ref`, `parcels`) |
| N23 | PASS | PASS | PASS | Verrou de 15 minutes |
| N24 | PASS | PASS | PASS | |
| N29 | PASS | PASS | PASS | |
| N33 | PASS | PASS | PASS | |
| N01 à N03, N05, N06, N08, N10, N17 à N19, N25 à N28, N30 à N32, N34 à N40 | | | | En cours de montage (lots G6-G5A, G5B et G5C) |

Le détail des runs et des PR est dans #4550 (synthèses de lots) et dans STATUS.md.
