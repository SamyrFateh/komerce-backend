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
| 2026-11-07 | CM | - | Tarifs vente RECETTE via API admin, source KM courante + pivot EUR | TARIFFS_APPLIED_AND_VERIFIED | `cm-20261107/staging-market-transport-sale-42381811718.json` |
| 2026-11-07 | CG | - | Tarifs vente RECETTE via API admin, source KM courante + pivot EUR | TARIFFS_APPLIED_AND_VERIFIED | `cg-20261107/staging-market-transport-sale-42382091838.json` |

Bilan pour KM : la chaîne achats, la chaîne physique et le circuit local sont certifiés de bout en bout, à la fois par les routes HTTP et par des clics réels effectués avec les vrais rôles.

## Ce qui n'est pas versionné ici

- **Les rapports de la chaîne achats des fixtures 50A59BFD et 2C2EB181.** Ils sont restés dans les artefacts de leurs runs, et le proxy de l'agent ne permet pas de les télécharger. Leur verdict est PASS (35 PASS et 1 étape hors HTTP pour chacune).
- **Les runs locaux sur base éphémère et les essais en échec,** dont la fixture 8D2B143C, retirée parce qu'elle contenait un colis mixte. Ce dossier ne contient que les preuves staging réussies.
- **CM et CG :** les deux tarifs de vente RECETTE sont désormais posés et relus, preuve versionnée ci-dessus. Les fixtures de certification précédentes en échec ne constituent pas des preuves de chaînes achats/physique/Chromium réussies ; les certificats métier complets restent à produire.
