# R&D Scanner Komerce — essai réel d'un nouveau contre-exemple Catalogue

**25 octobre 2026 — R&D en lecture seule du code, SQL limité à un PostgreSQL CI isolé et ROLLBACK.**
**Branche** : audit/discover-governance-blindspots-20261025
**Main testé** : 10b6408839890a2a7d700aa449a51dd69bac4184
**Issue constat** : https://github.com/SamyrFateh/komerce-backend/issues/2957

## Question expérimentale

Peut-on déduire d'une règle de données source un invariant non utilisé pour concevoir les cinq détecteurs initiaux, trouver un contre-exemple exécutable sur un vrai service, observer la persistance puis un effet métier chez un consommateur indépendant ?

**Réponse pour cet essai précis : oui.** Cela ne prouve pas que notre scanner peut découvrir entièrement *sans aide humaine* de nouveaux bugs : la première hypothèse a été formulée par inspection de la fonction de promotion et de la doctrine. Un détecteur générique a ensuite été construit, pas l'inverse.

## Contrat et chemin démontré

1. Source : normalized_source_contract V2, sellable_units[].media_refs. Les références explicites priment les associations heuristiques (migrations/109_product_sku_media.sql et services/catalog-promotion/sku-media.js).
2. Writer canonique : services/catalog-promotion.js -> promoteCatalog -> promoteSkuMedia -> product_sku_media.
3. Base : vrai PostgreSQL 16 du job de CI, schéma canonique ; chaque test rejoue depuis un SAVEPOINT dans une transaction ROLLBACK.
4. Consumer réel : services/product-sellable-service.js -> resolveSellableUnit -> _resolveCanonicalImage ; choisit la première association par created_at ASC LIMIT 1.

## Résultats constatés en base

| Test | Expected invariant (oracle source explicite) | Observed réel | Verdict |
|---|---|---|---|
| NOMINAL, A -> A | SKU stable, une relation A | une relation A | conforme |
| DEVIATION, A -> B | une relation B | **A et B** | contradiction |
| DOWNSTREAM après A -> B | image de l'unité vendable B | **image A** | contradiction métier |
| NEGATIVE_ADDITIVE, A -> [A,B] | deux relations A et B | deux relations A et B | conforme |
| NEGATIVE_FRESH_B, nouvel SKU B seul | choix image B | image B | conforme |

**Observation cruciale :** ce n'est pas un dysfonctionnement général du lecteur d'image ou de l'UPSERT ; c'est la conservation silencieuse d'une relation qui a disparu d'une liste de références explicites. Le test A -> B garde les deux médias présents au niveau du produit ; seule leur association à ce SKU est retirée par le fournisseur. Cela isole la responsabilité de reconciliation SKU-media.

Le dernier job d'investigation avant vérificateur : https://github.com/SamyrFateh/komerce-backend/actions/runs/40196176041. La campagne complète de la branche s'exécute automatiquement après chaque commit.

## Détecteur générique secondaire

Nouveau code : scripts/audits/lib/reconciliation-detectors.js

Il recherche les chemins de type promote/reconcile/sync/import qui effectuent un INSERT de table d'association sur deux identifiants avec ON CONFLICT DO NOTHING, **sans instruction DELETE/UPDATE de cette table dans le module**. Les opérations d'inbox idempotente, commentaires SQL et rapprochements avec DELETE sont contrôlés négativement. Il classe les résultats comme REVIEW seulement.

**Mesure sur main** : 1 signal du nouveau pattern sur 1 438 sources runtime analysées ; le site proposé est la fonction qui vient d'être reproduite. La classification du scan global passe de 162 à 163 signaux. Aucun de ces nombres n'est une précision ou un rappel scientifique : le détecteur est *post-hoc*.

## Validateur indépendant

- tests/integration/catalog-sku-media-replay-hypothesis-real-db.test.js : cinq scénarios sur vrai service et vrai PostgreSQL avec traces BLIND_CATALOG_TRIAL.
- scripts/audits/verify-blind-catalog-trial.js : refuse toute absence de contrôle, doublon, mauvais type de DB ou contradiction non observée ; archive audit-results/blind-trial/proof.json.
- .github/workflows/governance-graph-discovery.yml : job read-only avec base PostgreSQL CI, artefacts sur GitHub Actions.

Le succès CI correspond ici à « diagnostic prouvé », **pas** à « bug corrigé ». Ne pas merger les tests qui attendent une valeur défectueuse comme s'il s'agissait de tests d'acceptation du correctif.

## Suite R&D

1. Conserver séparément le rapport de découverte, l'issue de correction et les tests de non-régression attendue.
2. Renforcer la frontière « snapshot fournisseur complet / patch partiel » pour éviter qu'un média_refs omis efface des associations intentionnelles. Pour une liste explicite de remplacement, réconcilier exactement les associations, avec transactions et verrouillage adaptés. Aucune correction métier n'a été appliquée dans cette expérience.
3. Évaluer le nouveau détecteur **hors de cette fonction**, avec des traces de modifications historiques, des propriétés manuelles et des cas d'association volontairement append-only. Mesurer le taux de confirmations et le temps de preuve indépendamment.
4. Étendre aux autres collections canoniques et transitions P1–P7 sans transformer une corrélation lexicale en conclusion de bug.

**Règle R&D :** signaux, hypothèses et preuves restent trois niveaux différents. Ce pilote démontre la faisabilité du processus d'investigation, pas encore sa complète autonomie.
