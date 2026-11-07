# Preuves de certification V1 sur staging

Ce dossier réunit, pour chaque run de certification sur le staging, le rapport JSON produit par les scripts de `scripts/recette/`, et parfois son rapport markdown. Les captures d'écran restent dans les artefacts des runs GitHub Actions.

On ajoute ici chaque nouvelle preuve, dans un sous-dossier `<marché>-<AAAAMMJJ>/`. La procédure se trouve dans `docs/recette/CERTIFICATION_V1_HANDOFF.md`.

## Runs réussis

| Date | Marché | Fixture | Preuve | Verdict | Fichier |
|---|---|---|---|---|---|
| 2026-11-06 | KM | 43BE86B3 | Certification en 13 étapes, exécutée dans une transaction staging | PASS_STAGING_TRANSACTION_13_STEPS | `km-20261106/hub-v1-certification-43BE86B3.json` |
| 2026-11-06 | KM | 8D2B143C | Chaîne achats HTTP | 35 PASS, 1 étape hors HTTP | `km-20261106/hub-v1-http-actions-8D2B143C.json` |
| 2026-11-06 | KM | 7DC2A4D9 | Création de la fixture (étapes 1 et 2) | PARTIAL_STOP_AFTER_STEP_PASS | `km-20261106/hub-v1-certification-7DC2A4D9.json` |
| 2026-11-06 | KM | 7DC2A4D9 | Chaîne achats HTTP | 35 PASS, 1 étape hors HTTP | `km-20261106/hub-v1-http-actions-7DC2A4D9.json` |
| 2026-11-06 | KM | 7DC2A4D9 | Chaîne physique HTTP (étapes transitaire jouées par admin) | 52 PASS, 1 INFO | `km-20261106/hub-v1-http-physical-7DC2A4D9.json` |
| 2026-11-07 | KM | 71B671EB | Création de la fixture | PARTIAL_STOP_AFTER_STEP_PASS | `km-20261107/hub-v1-certification-71B671EB.json` |
| 2026-11-07 | KM | 71B671EB | Chaîne physique HTTP avec le vrai transitaire | 53 PASS sur 53 | `km-20261107/hub-v1-http-physical-71B671EB.json` |
| 2026-11-07 | KM | 50A59BFD | Clics Chromium réels (run 42362671815) | 32 CLICK_PASS, 5 NOT_REACHABLE_IN_UI | `km-20261107/hub-v1-clicks-50A59BFD-evidence.json` |
| 2026-11-07 | KM | 2C2EB181 | Clics Chromium réels après #3473 (run 42369442085) | 36 CLICK_PASS sur 36 | `km-20261107/hub-v1-clicks-2C2EB181-evidence.json` |
| 2026-11-07 | KM, CM, CG | - | Isolation croisée (agent relais KM : 200 sur KM, 403 sur CM et CG ; admin lit les trois) | ISOLATION_PASS | `isolation-20261107/staging-market-isolation-42375312269.json` |
| 2026-11-07 | CM, CG, KM | - | Isolation réelle des responsables pays avec deux comptes E2E distincts, 18 sondes HTTP (lectures + mutation fictive) | MARKET_OPERATOR_ISOLATION_PASS | `isolation-20261107/staging-market-operator-isolation-42385877161.json` |
| 2026-11-07 | KM, CM, CG | - | Frontières Admin/Hub/Transitaire/Relais : 37 sondes HTTP sur staging, 0 franchissement de rôle | ROLE_BOUNDARY_PASS (37/37) | `isolation-20261107/staging-negative-role-boundaries-42391311145.json` |
| 2026-11-07 | KM | BD3CE8A5 | LOCAL_STOCK direct relais, sans Hub ni faux shipped, HTTP + PostgreSQL (run 42396288384) | LOCAL_STOCK_HTTP_PASS (17/17) | [Synthèse durable](LOCAL_STOCK_DIRECT_RELAIS_KM_CM_CG_20261107.md) |
| 2026-11-07 | CM | 7590132A | LOCAL_STOCK direct relais, sans Hub ni faux shipped, HTTP + PostgreSQL (run 42396467536) | LOCAL_STOCK_HTTP_PASS (17/17) | [Synthèse durable](LOCAL_STOCK_DIRECT_RELAIS_KM_CM_CG_20261107.md) |
| 2026-11-07 | CG | 338A2CD4 | LOCAL_STOCK direct relais, sans Hub ni faux shipped, HTTP + PostgreSQL (run 42396651329) | LOCAL_STOCK_HTTP_PASS (17/17) | [Synthèse durable](LOCAL_STOCK_DIRECT_RELAIS_KM_CM_CG_20261107.md) |
| 2026-11-07 | CM | - | Tarifs vente RECETTE via API admin, source KM courante + pivot EUR | TARIFFS_APPLIED_AND_VERIFIED | `cm-20261107/staging-market-transport-sale-42381811718.json` |
| 2026-11-07 | CG | - | Tarifs vente RECETTE via API admin, source KM courante + pivot EUR | TARIFFS_APPLIED_AND_VERIFIED | `cg-20261107/staging-market-transport-sale-42382091838.json` |

| 2026-11-07 | CM | 40A162A6 | Achats 35 PASS × 2 et physique 53 PASS | PO + PHYSICAL_PASS | `cm-20261107/hub-v1-http-physical-40A162A6.json` |
| 2026-11-07 | CM | 2B13C104 | Chromium 36/36 et isolation relais | CLICK_PASS + ISOLATION_PASS | `cm-20261107/hub-v1-clicks-2B13C104-evidence.json` |
| 2026-11-07 | CM | - | Synthèse de la certification nominale (run 42382520838) | CERT_NOMINAL_PASS | `cm-20261107/full-cert-42382520838-summary.json` |

| 2026-11-07 | CG | 57030A02 | Achats 35 PASS × 2 et physique 53 PASS | PO + PHYSICAL_PASS | `cg-20261107/hub-v1-http-physical-57030A02.json` |
| 2026-11-07 | CG | 5D6F90EC | Chromium 36/36 et isolation relais | CLICK_PASS + ISOLATION_PASS | `cg-20261107/hub-v1-clicks-5D6F90EC-evidence.json` |
| 2026-11-07 | CG | - | Synthèse de la certification nominale (run 42382886270) | CERT_NOMINAL_PASS | `cg-20261107/full-cert-42382886270-summary.json` |

Bilan : les chaînes achats et physiques du parcours **importé** sont certifiées sur KM/CM/CG ; les frontières inter-rôles sont certifiées. Le circuit **LOCAL_STOCK strictement sans Hub** a désormais trois preuves indépendantes HTTP + relecture PostgreSQL sur staging (17/17 par marché, détails et limites dans [le rapport durable](LOCAL_STOCK_DIRECT_RELAIS_KM_CM_CG_20261107.md)). La première campagne KM en échec a identifié puis permis de corriger le faux rattrapage `shipped` au retrait (#3526) ; **cette ancienne campagne n'a pas été comptée comme PASS**. Le geste local natif dans Relais Live par clics Chromium reste à certifier. Aucun GO commercial n'en découle.

## Ce qui n'est pas versionné ici

- **Les rapports de la chaîne achats des fixtures 50A59BFD et 2C2EB181.** Ils sont restés dans les artefacts de leurs runs, et le proxy de l'agent ne permet pas de les télécharger. Leur verdict est PASS (35 PASS et 1 étape hors HTTP pour chacune).
- **Les runs locaux sur base éphémère et les essais en échec,** dont la fixture 8D2B143C, retirée parce qu'elle contenait un colis mixte. Ce dossier ne contient que les preuves staging réussies.
- **CM et CG :** les certificats nominaux complets, l'isolation relais et l'isolation indépendante des responsables pays sont versionnés ci-dessus. Les anciennes fixtures en échec ne constituent pas des preuves positives. Restent hors certification : prix partenaires définitifs, scénarios métier non nominaux (incidents, réceptions partielles, annulations, remboursements) et parcours LOCAL_STOCK **par clics Chromium natifs Relais Live**. Le LOCAL_STOCK HTTP + base est désormais certifié séparément sur les trois marchés.
