# Deuxième contre-expertise Claude Opus — Komerce Business Auditor V1.5

## Mission
Critique indépendante, économe en tokens. **Ne confirme pas nos conclusions par politesse.** Essaie de casser le dispositif de preuve et de déclasser les faux positifs, puis propose les corrections les plus courtes pour parvenir à une découverte généralisable de bugs métier inconnus.

**Dépôt** : https://github.com/SamyrFateh/komerce-backend  
**Branche R&D** : `research/business-auditor-v15-physical-concurrency-20261028`  
**PR V1.5** : https://github.com/SamyrFateh/komerce-backend/pull/3094  
**Issue nouvelle** : https://github.com/SamyrFateh/komerce-backend/issues/3095  
**Ancienne expertise Opus** : commit `442fa265ff37019e5b3787a300521292f6549fd5`, 10 recommandations; V1.0/V1.1 détectaient uniquement des bugs déjà connus.

## Ce que nous avons changé depuis l'audit Opus

| Version | Changement effectif | Limites |
|---|---|---|
| V1.2 PR #3090 | Triggers CI sensibles au métier, baseline de verdict, oracle indépendant réel PostgreSQL TEMP | Lecture commande/colis simulée |
| V1.3 PR #3091 | `distributeOrder → transitionParcelStatus(cancelled) → distributeOrder` sur vrai schéma PG, rollback, état relu après chaque pas | Parcours encore prédéfini |
| V1.3 | Rejeu en processus séparé, comparant résultats normalisés et empreintes des sources | Toujours domaine logistique |
| V1.4 PR #3093 | Générateur déterministe de profondeur ≤ 4, alphabet `ASSIGN_A`, `ASSIGN_B`, `CANCEL_OPEN`; 68 parcours, 238 actions sur vrai PG; prédicats retour ↔ état | 32 occurrences de deux défauts connus, aucune famille nouvelle |
| V1.5 PR #3094 | Premier harness à **deux connexions PostgreSQL réelles** synchronisées sur le même snapshot de capacité | Interleaving forcé par barrière de test, pas de preuve HTTP ou de fréquence prod |

## La nouvelle découverte V1.5 — à attaquer

`services/auto-parcel.js` exporte `MAX_ITEMS_PER_PARCEL = 30`. Le code lit `agg.item_count` des `parcel_items` avant d'insérer la nouvelle association. Nous avons testé deux commandes payées et éligibles d'un même relais, une ligne chacune, avec un colis existant contenant **29** associations provenant d'une troisième commande du même relais.

- **Contrôle séquentiel** : A ajoute un article au colis → 30/30 ; B détecte le plein et ouvre un second colis → maximum = **30**.
- **Course simultanée** : deux sessions PG distinctes exécutent le **vrai** `distributeOrder`. Une barrière maintient chacune après lecture SQL de capacité **29**, puis libère les deux. Elles insèrent deux articles distincts, avec succès → premier colis à **31/30**.
- Prédicat externe : `REPRODUCED_CANONICAL_PG_CONCURRENT_CAPACITY_BREACH`.
- Les données d'essai sont validées temporairement pour être visibles dans les deux sessions ; elles sont ensuite supprimées et leur absence constatée. Cible strictement `127.0.0.1/localhost` + DB `komerce_test` + `NODE_ENV=test` + crons désactivés.
- Le nettoyage utilise **`SET LOCAL session_replication_role=replica` uniquement pendant la transaction de suppression**, parce que le schéma interdit de supprimer directement des colis. **Audite particulièrement ce choix de sécurité : propose plus sûr s'il y a lieu.**
- Aucune modification des vrais services métier, aucune connexion production, aucun PSP.

**Deux campagnes GitHub Actions indépendantes, 107/107 tests chacune :**

- Push [#40671552910](https://github.com/SamyrFateh/komerce-backend/actions/runs/40671552910), SHA branche `fab8eef8ead5f0bf1f5a855cba11f367210f9053`, artifact `business-auditor-40671552910` (#12808920991).
- PR [#40671560910](https://github.com/SamyrFateh/komerce-backend/actions/runs/40671560910), même résultat (commit d'assemblage de PR distinct). Les deux produisent `sequentialMax=30`, `concurrentMax=31`, `cleanup=true`.

Cette découverte est un **candidat nouveau par rapport aux deux familles observées en V1.4** ; ce n'est pas encore une faille HTTP ni un incident client confirmé. Elle a été enregistrée comme issue #3095 et une baseline explicite du verdict la garde visible jusqu'au triage.

## Fichiers prioritaires (éviter de lire tout le dépôt)

1. `services/auto-parcel.js` : `distributeOrder`, `MAX_ITEMS_PER_PARCEL`, SQL `LEFT JOIN LATERAL` et `INSERT INTO parcel_items`.
2. `tools/business-auditor/v15-concurrency-runner.js` : fixture, barrière, deux clients, lectures, nettoyage.
3. `tools/business-auditor/v15-concurrency-predicate.js` : validation des snapshots, invariant nominal/concurrent, classification.
4. `tools/business-auditor/v15-concurrency-gate.js` et `v15-concurrency-predicate.test.js`.
5. `tools/business-auditor/v14-sequence-planner.js`, `v14-sequence-explorer.js`, `v14-sequence-predicates.js`.
6. `tools/business-auditor/v13-canonical-parcel-runner.js`, `v13-canonical-parcel-predicate.js`.
7. `.github/workflows/research-independent-business-auditor.yml` et baselines V1.4/V1.5.
8. `docs/db/railway-live-schema.sql` pour les contraintes réelles des 213 tables.

## Questions adversariales précises

- Le plafond de 30 s'applique-t-il réellement au **nombre de lignes d'articles**, à la somme des quantités ou au poids ? Notre oracle mesure des `parcel_items` ; est-ce exactement la sémantique du métier ?
- La barrière de synchronisation force-t-elle une course réellement atteignable, ou introduit-elle une anomalie artificielle ? Vérifie les vrais entrypoints et transactions.
- La course `29+1+1 = 31` est-elle un bug différent du compteur `rowCount=0` et du colis annulé déjà connus ? Propose une expérience qui les distingue.
- Peut-on tromper le prédicat avec une trace JSON cohérente mais fabriquée ? Les hashes/CI ne suffisent pas à garantir l'indépendance d'un auteur malveillant ; évalue une garde `CODEOWNERS` et des runners immuables.
- Notre fixture committée + `session_replication_role` présente-t-elle un risque ou fausse-t-elle le verdict ? Propose une base jetable créée/détruite, ou un autre teardown.
- Les `SAVEPOINT` mono-connexion de V1.4 représentent-ils le monde réel ? Quelles anomalies pourraient-ils masquer ?
- Comment dériver les paires de writers et les interleavings depuis l'inventaire V0.6/V0.7 **sans écrire chaque course à la main** ?
- Où sont les faux positifs et faux négatifs des invariants actuels ? Comment concevoir un benchmark à l'aveugle sur au moins 10 bugs corrigés ?
- Quelle est la plus petite intervention susceptible de faire découvrir **une deuxième nouvelle famille**, hors colis, sans explosion de coût CI ?
- Les retours `success:true` et `items_assigned` attestent-ils réellement le succès métier dans tous les cas ?

## Format demandé

1. **Verdict** : valide / invalide / à qualifier pour V1.5, avec justification source et expérience.
2. **3–5 objections P0/P1** avec reproducteur, preuve et probabilité de faux positif.
3. **Test adversarial supplémentaire** (code ou protocole) capable de faire basculer l'oracle si la cause est corrigée, sans éditer le prédicat.
4. **Améliorations du scanner** classées par valeur/coût, garde anti-falsification et métrique de découverte, sans réécriture inutile.
5. **Plan V1.6–V2.0** : jalons et gates objectifs, temps CI normal < 10 min, exploration nightly, 0 accès prod.
6. **Décision** : recommander ou non la suite du projet R&D au regard des données et des coûts.

**Mode économique** : commence par les 8 fichiers prioritaires, puis n'ouvre d'autres zones qu'en cas de preuve à vérifier. 1 200–1 800 mots de rapport initial suffisent. Ne modifie rien dans `main`. Laisse la PR en brouillon.

**Question finale** : « Cette V1.5 est-elle enfin une preuve crédible de notre aptitude à découvrir un bug métier auparavant inconnu, ou notre protocole nous conduit-il encore à nous fabriquer les bugs que nous souhaitons trouver ? »
