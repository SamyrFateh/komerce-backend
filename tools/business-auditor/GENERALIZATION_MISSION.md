# Scanner logique indépendant Komerce — cap initial et critères de généralisation

**Rappel de mission (ne jamais perdre cet objectif)** : fournir une **commande unique** (ex. `npm run audit:logic`) permettant de parcourir les domaines métier du dépôt, de proposer des anomalies pertinentes, de reproduire un scénario nominal et son écart sur un environnement isolé, puis de valider une correction contre un oracle **indépendant du code modifié**. Les campagnes PayPal V2.2–V2.6 sont des **échantillons d'étalonnage**, jamais le produit fini.

## Architecture cible — trois couches

1. **Découverte exhaustive et triage déterministe (sans effets)** : inventorier les routes, owners, écritures, invariants, tables, événements, devises et workflows ; classifier le statut de preuve `STATIC_SUSPICION`, `PHYSICAL_WITNESS`, `DOMAIN_VIOLATION`, `RECOVERY_GAP`, `CONFIRMED_REACHABLE_BUG`. Afficher les domaines non couverts **sans les déclarer sains**.
2. **Oracle métier externe et qualification des données** : déclarer chaque invariant à partir de sa règle métier, du schéma et d'une revue indépendante, non du résultat courant du code. Vérifier effets financiers, transitions, identités, stocks, quantité, provenance et idempotence. Les contrôles SQL locaux sont en lecture seule ; aucun accès à la production.
3. **Exécution physique adversariale à budget borné** : rejouer de vrais propriétaires et routes selon un sélecteur de paires préfigé ; comparer nominal, inversion, parallélisme, retries, crash, incohérences injectées et contre-factuels ; exiger des traces d'entrées/sorties et bases clonées détruites.

## Domaines à traiter (référence pour l'industrialisation)

| Domaine | Parcours critiques à explorer |
|---|---|
| Sourcing / raffinerie / taxonomie | suggestions, validation humaine, preuve de catégorie et héritage marché |
| Décision économique / atelier prix | snapshots FX, douane, marge, approbation, devise par marché |
| Catalogue / exposition marchés | éligibilité à publication, disponibilité, variantes, isolation market |
| Commandes / paiements / remboursements | propriétaires exclusifs, bornes économiques, idempotence, retries |
| Achats / inventaire / Hub | appartenance `order_item`, réception, quarantaine, couverture physique |
| Logistique / relais / remise | composition de colis, quantité, attribution, statut, trace de retrait |
| Portefeuille / finance | encaissements, double comptabilisation, réconciliation et clôture |
| Habilitations / marchés | acteur, membership, accès cross-market, navigation et opérations HTTP |

## Contrat minimal d'une preuve de bug

- **Sélection :** règle métier + propriétaire + fichier/route + grain de données + SHA, retenue avant l'expérience.
- **Nominal :** un chemin métier admissible, paramètres et résultat attendus décidés avant le test.
- **Contre-exemple :** fixture reproductible, ordre d'exécution, observation brute DB et effet externe, invariant violé.
- **Contrôle négatif :** modifier délibérément un composant ou une preuve pour vérifier que l'oracle **refuse** un résultat trompeur.
- **Correction :** rejouer la même matrice avant/après, vérifier non-régression et résistance à la concurrence/au crash.
- **Qualification :** `TEST_TOOL_ERROR` distinct de `BUSINESS_FAIL`, de `UNPROVEN` et de `PASS_WITH_EVIDENCE`. Pas d'incident production déduit d'un test sur clone.

## Budget de fonctionnement (« mode éco »)

1. Scan statique et données **rapides**, regroupement en classes d'équivalence ; conserver les anomalies nouvelles et les priorités P0/P1.
2. Exécution PR bornée aux cinq premières paires différentes, plus les régressions existantes (ordre de sélection **figé avant la base**). nightly jusqu'à dix classes ; campagne complète à la demande.
3. Réutilisation des fixtures et des oracles ; archives JSON/Markdown, SHA, empreinte du sélecteur et résultats. Ne pas confondre « 171 tests verts » avec couverture complète métier.
4. Synthèse utile : bugs confirmés, suspects prioritaires, domaines non couverts, coût de la preuve et actions de correction.

## État de l'étalonnage PayPal au V2.6

- V2.2 : vrai double remboursement détecté sur clone, réel parcours HTTP **non prouvé**.
- V2.3 : un faux fix séquentiel est réfuté par l'épreuve parallèle.
- V2.4 : intention financière test-only rend les quatre scénarios conformes.
- V2.5 : le crash ne provoque pas de second paiement, mais peut laisser un rapprochement incomplet.
- V2.6 : test-only rapprochement sur preuve positive issue d'un prestataire **simulé** ; vérifications de cohérence, rejets des mauvaises preuves, rejeu et transaction. Il manque la capacité PayPal réelle de retrouver un remboursement ambigu par clé de requête, les accès HTTP, les écritures alternatives et les partiels.

**Règle de gouvernance :** cette R&D ne doit pas dériver vers le déploiement d'un orchestrateur PayPal tant que la couverture du scanner multi-domaines n'a pas progressé. Aucun `main`, staging ou données réelles ne sont modifiés par les expériences.
