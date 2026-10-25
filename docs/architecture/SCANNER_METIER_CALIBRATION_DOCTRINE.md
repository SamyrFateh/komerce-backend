# Doctrine — étalonnage du scanner de bugs métier

**Statut : expérimental, branche d'audit.** Ne remplace pas la gouvernance Feature First ni les tests E2E Chromium. Aucune écriture sur Railway ou en production n'est autorisée par cette doctrine.

## Objectif

Un motif statique est une **suspicion**, jamais un bug. Pour décider qu'une règle sait reconnaître une rupture métier, il faut construire deux **preuves symétriques à partir du même état canonique** : NOMINAL et DEVIATION. La reproduction doit expliquer *ce qui devrait arriver* (invariant) et *ce qui arrive réellement* (service et stockage). Une CI verte atteste seulement que les preuves ont été exécutées et observées.

## Contrat obligatoire par règle et par cas

1. **Invariant vérifiable** : formuler une relation entre identités, montants, statuts, quantités ou historique ; indiquer l'owner de chaque donnée et l'API/service qui écrit.
2. **NOMINAL — contrôle positif du métier** : créer un jeu de données valide sur le schéma PostgreSQL réel et lancer le véritable service, sans changer son code. Comparer les conséquences persistées et le résultat exposé aux attentes, y compris un éventuel autre domaine concerné. Si le nominal ne passe pas, le détecteur n'est pas étalonné.
3. **DEVIATION — contre-exemple discriminant** : repartir du même état via savepoint puis provoquer une contradiction admissible pour le point d'entrée (identifiant discordant, conflit d'unicité, réexécution, statut interdit...). Enregistrer le comportement de protection attendu et l'état réellement observé ; un désaccord confirme le bug dans la portée testée, un accord prouve que cette perturbation précise est correctement gardée.
4. **Contrôle négatif pour le détecteur** : présenter du code ou un scénario légitime proche de la forme suspecte et vérifier qu'il n'est pas faussement considéré comme bug. Vérifier aussi qu'une suspicion sans preuve reste `REVIEW`.
5. **Fiabilité de la preuve** : test réel, schéma référencé, SHA, scénario, données anonymes/minimales, résultats SQL et service, sortie reproduisible et nettoyage transactionnel. Les tests utilisant un `rowCount` simulé apportent un indice, **pas** la preuve PostgreSQL.
6. **Garde d'admission** : le vérificateur rejette un cas sans paire, sans stimulus d'écart, avec un nominal rompu, ou dont le verdict n'est pas cohérent avec les valeurs. Ne jamais convertir automatiquement les `findings` du scanner en bugs.

## États de qualification

`SUSPICION_STATIQUE` → `CALIBRATION_EN_COURS` → `BUG_REPRODUIT` ou `GARDE_VALIDEE_POUR_CE_CAS` → `CORRECTION_EN_PR` → `CORRECTION_CERTIFIEE`.

**Important :** un test diagnostique qui attend la présence d'un défaut doit être réécrit comme test de non-régression lors de sa correction. Ce passage n'est pas automatique ; le test de correction doit alors exiger que le scénario DEVIATION soit rejeté sans side effect, tout en gardant le nominal vert.

## Artefacts

- Cas déclarés : `scripts/audits/calibration-cases.json` (extensible sans modifier le vérificateur).
- Audit statique : `scripts/audits/governance-graph-discovery.js`. Les patterns réutilisables sont combinés à `scripts/audits/lib/exemption-invariant-detectors.js` et `novel-bug-patterns.js`. Le détecteur d'exemptions tire ses paires de colonnes du schéma PostgreSQL et les limite aux tables déclarées dans les feature cards. Tout signal reste `REVIEW` tant qu'il n'est pas étalonné.
- Vérificateur fail-closed : `scripts/audits/verify-calibration-evidence.js`.
- Tests réels Inventory et Auto-parcel : `tests/integration/*calibration*.test.js` et `tests/integration/inventory-cross-order-governance-discovery.test.js`.
- Sortie CI : `audit-results/calibration/calibration.json`, `calibration.md`, journaux sources.

## Portée actuelle et limites

- Inventory : preuve réelle PostgreSQL du rattachement A→B, pas de preuve d'occurrence en production.
- Auto-parcel : preuve PostgreSQL d'un conflit d'unicité avec entrelacement déterministe entre vérification et insertion, **pas** encore reproduction de deux transactions concurrentes réellement indépendantes.
- Hub / Catalog / Sourcing : preuve PostgreSQL qu'un produit `repack_exempt=TRUE` peut recevoir un `repack_volume_cm3` incompatible avec l'interdiction de reconditionner et que le moteur de densité de valeur préfère cette mesure à la mesure initiale ; contrôle nominal non exempt et contrôle négatif exempt avec volume normal. Voir issue #2951.
- Un scénario négatif unique ne mesure ni taux de faux positifs global, ni taux de faux négatifs du scanner. Chaque nouveau pattern doit ajouter ses propres contre-exemples et échantillons qualifiés ; un scan sur les 36 feature cards n'est pas une certification exhaustive du dépôt.
