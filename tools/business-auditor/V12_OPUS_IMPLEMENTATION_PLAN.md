# Plan Opus repris — scanner Komerce R&D V1.2 → V2.0

**Décision d'architecture :** conserver V0.6–V0.9 comme sélecteur de cibles. Déplacer la preuve vers l'exécution de séquences de vrais services sur PostgreSQL jetable et des prédicats d'état indépendants. Ne pas considérer un Golden Master comme vérité métier.

## Les dix interventions, reprises dans l'ordre d'Opus

| Ordre | Intervention | État sur PR #3090 | Gate de sortie |
|---|---|---|---|
| 1 | CI push/PR sur code métier et probes | Implémenté, CI à vérifier | Changer `services/auto-parcel.js` déclenche l'audit |
| 2 | Baseline de verdicts et distinction `TOOL_ERROR` / régression | Première tranche implémentée | Tout verdict modifié exige une revue; un nominal erroné produit `NOMINAL_REGRESSION`, pas un succès silencieux |
| 3 | Prédicats indépendants, observations brutes | Pilote PG TEMP implémenté | Changer les booléens du vieux Jest ne change pas la preuve indépendante; les hashes SHA code/prédicat/harness sont archivé |
| 4 | Harness PostgreSQL canonique et fixtures valides | À faire | Vrai schéma, vraies opérations, rollback/cleanup et isolation réseau démontrés |
| 5 | 10–15 prédicats interdomaines | À faire | Logistique, remboursements, cash, marché, FX; chaque règle possède attendu + contre-épreuve |
| 6 | Explorateur de séquences de longueur <= 4 | À faire | Découvrir distribuer → annuler → redistribuer sans encoder le scénario comme issue connue |
| 7 | Courses à deux connexions PG | À faire | Retour, affectedRows et delta physique comparés sur interleavings réels |
| 8 | Benchmark de résurrection de bugs corrigés | À faire | >= 10 cas historiques, rappel >= 70 %, précision/temps analyste suivis |
| 9 | Remplacer les chiffres magiques par contrôles de delta | Implémenté pour la réconciliation CI | Une nouvelle écriture non incorrecte ne provoque pas un changement de constant |
| 10 | Nouvelle anomalie de colis annulé | Hypothèse à qualifier | Reproduction canonique plus vérification atteignabilité HTTP, puis issue spécifique |

**Rétention :** artefacts CI 90 jours. **Limite de coût :** cible moins de dix minutes pour les tests PR; recherche étendue en nightly.

## Observations du pilote V1.2 (portée limitée)

Le banc `v12-physical-parcel-runner.js` appelle le vrai `distributeOrder` et exécute son `INSERT INTO parcel_items` sur PostgreSQL local, sous table **temporaire** avec `UNIQUE(order_item_id)`. Les lectures de commande/colis sont encore simulées. Cela mesure le `rowCount` réel, la différence de nombre de lignes et le compteur renvoyé **sans consommer les booléens déclarés par le vieux Jest**.

Il ne prouve **pas** une annulation réellement exécutée via `transitionParcelStatus`, ni une séquence sous le schéma complet, ni deux sessions concurrentes. Il ne constitue donc pas la certification attendue aux étapes 4, 6 ou 7.

La baseline représente des défauts connus **non acceptés métier**, uniquement pour détecter que les verdicts changent. Une correction doit faire modifier explicitement sa baseline après vérification.

## Décision métier à faire valider avant le test canonique

Une commande encore active et exécutable doit pouvoir retrouver une affectation physique valide après annulation du colis. En revanche une commande annulée/remboursée ne doit pas être réexpédiée. Réaffecter un article ne veut pas dire perdre l'historique, la traçabilité des quantités ou les événements de garde.

## Politique de branche

Aucune fusion sur `main` sans ces gates ; ni nettoyage de données staging/prod ; aucun vrai PSP ni secret connecté aux tests. Les prédicats et baselines sont candidats à une protection CODEOWNERS + règles de protection de branche, mais une simple empreinte SHA dans un artifact **n'empêche pas** un auteur de modifier le code de l'oracle dans la même PR.

## Critères d'acceptation cumulés

1. Pour chaque prédicat : introduire/réparer un mutant, voir verdict et statut CI changer sans retoucher l'attendu.
2. Anti-falsification : tests falsifiés rejetés ou requalifiés si la trace brute persiste; attestation via runner indépendant et hashes vérifiables.
3. Séquence annulation/redistribution et course à deux connexions reproduites avec schéma réel.
4. Benchmark de >= 10 bugs ressuscités, rappel >= 70%, taux de faux positifs et coût de revue chiffrés.
5. Baseline versionnée, 90 jours d'artefacts, test PR cible < 10 minutes.

**Non-certification :** V1.2 est une R&D instrumentée. Deux défauts historiques reproduits ne prouvent toujours pas le rappel sur bugs inconnus.
