# Komerce Independent Business Logic Auditor — Programme de livraison V4.0

**Document de pilotage faisant autorité pour la R&D — G0 à G5.**

Suivi principal : [#3128](https://github.com/SamyrFateh/komerce-backend/issues/3128). Baseline de preuve : [PR V3.3 #3126](https://github.com/SamyrFateh/komerce-backend/pull/3126), [CI #40785450860](https://github.com/SamyrFateh/komerce-backend/actions/runs/40785450860). Défaut métier ouvert : [#3127](https://github.com/SamyrFateh/komerce-backend/issues/3127).

## Définition de « livré »

Un programme autonome qui **analyse le dépôt réel**, relie des invariants métier explicites aux responsabilités canoniques, sélectionne des expériences à partir des risques, exécute des scénarios autorisés en environnement isolé et distingue un bug prouvé d'une simple suspicion. Les rapports donnent les preuves indépendantes et la liste des classes/règles NON COUVERTES.

La livraison ne requiert PAS 100 % de bugs découverts. Elle requiert une **autonomie démontrée sur les classes supportées**, des mesures objectives de couverture et la reproductibilité des verdicts.

## Livraisons successives et portes

| Porte | Ticket | Livrable | Test GO |
|---|---|---|---|
| G0 | [#3128](https://github.com/SamyrFateh/komerce-backend/issues/3128) | Baseline V3.3 gelée | 243 tests, 12 cas physiques, 7 règles SQL et références des défauts dans le registre |
| G1 | [#3129](https://github.com/SamyrFateh/komerce-backend/issues/3129) | V3.4 moteur unifié + registre certifié | 1 appel source/static de base et 4 adaptateurs plats, CI 12 preuves et SHA cohérent, oracle Sourcing inchangé |
| G2 | [#3130](https://github.com/SamyrFateh/komerce-backend/issues/3130) | V3.5 couverture des invariants | Dénominateur explicite par invariant/owner/table ; distinctions exécutable, textuel, inconnu, manquant |
| G3 | [#3131](https://github.com/SamyrFateh/komerce-backend/issues/3131) | V3.6–3.7 expériences générées | Une mutation inédite et cachée aux recettes est trouvée et reproduite automatiquement avec le même oracle générique |
| G4 | [#3132](https://github.com/SamyrFateh/komerce-backend/issues/3132) | V3.8 calibration et coûts | Benchmarks aveugles, précision/rappel par classe supportée, faux positifs, omissions, temps et clones |
| G5 | [#3133](https://github.com/SamyrFateh/komerce-backend/issues/3133) | V4.0 release | Quick/targeted/full, rapport contrat versionné, documentation opérateur, audit de sécurité et décision humaine GO |

**Ordre des dépendances : G0 → G1 → G2 → G3 → G4 → G5.** Les chantiers préparatoires peuvent s'exécuter indépendamment, mais aucune porte n'est déclarée passée avant sa CI et son critère de preuve. Ni date artificielle ni fusion prématurée.

## Architecture cible

```text
Source discovery + graph owner/writer (1 passage)
  -> registre d'invariants versionné [G2]
  -> sélecteur impact × risque × budget [G3]
  -> catalogue de scénarios bornés & fixtures canoniques [G3]
  -> vraie fonction/service (SQL clone local, réseau refusé)
  -> oracle indépendant et contrôles négatifs
  -> verdict structuré (PASS / BUSINESS_VIOLATION / TOOL_ERROR / NOT_COVERED)
  -> artefacts JSON, Markdown, métriques par invariant [G4]
```

V3.4 conserve volontairement le sélecteur de recherche V2.9 et les adaptateurs certifiés ; il ne prétend pas générer des fixtures arbitraires. Le moteur plat remplace les wrappers à effet cumulatif : `v33 → v32 → v31 → v30 → v29 → v28`. La V3.3 demeure un étalon de non-régression accessible en alias. Lors de G3 les expériences seront composées sans importer les **attendus** depuis le code testé.

## Modes et coût

- `npm run audit:logic:unified` — **quick**, sans accès PG, scan complet et file de risques. Convient aux commits/PR.
- `NODE_ENV=test KOMERCE_DISABLE_CRONS=true DATABASE_URL=postgres://...@localhost/komerce_test npm run audit:logic:unified -- --mode data` — lecture SQL seule, transaction rollback.
- Même environnement + `--mode full` — source, données, preuves physiques. Pour G1: 12 cas sur clones `kba_*` et destruction obligatoire.
- **targeted G3** — impact source → quelques familles d'invariants → budget choisi et déclaré. Ne doit **jamais** simuler une couverture totale ou reprendre les 12 cas par défaut.

L'environnement autorisé est strictement `localhost/komerce_test`. Railway, bases distantes, providers réels, secrets, staging et main sont hors périmètre.

## Gestion des anomalies et des « faux fixes »

1. `SUSPECTED_STATIC` : signal heuristique, pas une anomalie certifiée.
2. `BUSINESS_VIOLATION` : scénario réellement exécuté avec état DB et oracle indépendant ; consigner service, SHA, fixture, état nominal attendu, observations, contrôle négatif.
3. `TOOL_ERROR` : base/fixture/owner/provenance non certifiés ; **aucun verdict métier permis**.
4. `NOT_COVERED` : aucune fixture/oracle pour ce risque, ou budget épuisé.
5. `FIX_VERIFIED` : même scénario et **oracle inchangé**, nouveau propriétaire corrigé, attendu nominal, mutants négatifs toujours rouges. Exige confirmation séparée d'une correction métier.

**#3127 doit rester un défaut déclaré tant qu'il est reproduit dans la branche testée.** Il ne doit pas être intégré comme vérité permanente dans le gold master ni « corrigé » en modifiant le calcul de l'attendu.

## Règles de gouvernance

- Une PR de recherche par porte majeure, revue et preuve CI attachées ; branche dérivée de la porte précédente.
- Le scanner **ne doit jamais modifier le code métier** pendant la qualification.
- Les corrections métier ouvrent une PR différente de la recherche (ex. #3127), puis le scanner rejoue la fixture originale.
- Le nombre de domaines **ayant un témoin** est une métrique de présence, pas de couverture : V3.3 est 8/8 *partiels* et **0/8 totalement certifiés**.
- GO G5 uniquement avec couverture chiffrée, taux de détection et faux positifs affichés par classe, limitations publiques et revue humaine ; pas de merge automatique dans `main`.

## Registre des livrables réellement produits

| Élément | État |
|---|---|
| G0 baseline V3.3 | CERTIFIÉ [CI #40785450860](https://github.com/SamyrFateh/komerce-backend/actions/runs/40785450860) |
| G1 moteur plat V3.4 | IMPLÉMENTÉ EN R&D — CI d'acceptation requise |
| G2 registre invariants et coverage | À développer — [#3130](https://github.com/SamyrFateh/komerce-backend/issues/3130) |
| G3 génération d'expériences | À développer — [#3131](https://github.com/SamyrFateh/komerce-backend/issues/3131) |
| G4 mesures de fiabilité | À développer — [#3132](https://github.com/SamyrFateh/komerce-backend/issues/3132) |
| G5 livraison V4.0 | À développer — [#3133](https://github.com/SamyrFateh/komerce-backend/issues/3133) |
