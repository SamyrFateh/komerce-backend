# Décision R&D — Scanner de bugs métier Komerce (25 octobre 2026)

**Statut : synthèse des découvertes et clôture de la première phase de calibration.**
**Branche de recherche :** `audit/discover-governance-blindspots-20261025`.
**Aucun bug corrigé par le scanner. Aucune mutation Railway, aucun merge dans main.**

## Résultat incontestable : six reproductions PostgreSQL + une preuve de comportement conditionnel

| Issue | Domaine | Rupture métier observée | Preuve | État |
|---|---|---|---|---|
| [#2939](https://github.com/SamyrFateh/komerce-backend/issues/2939) | Inventory | `receiveItem` utilise un order_id fourni par l'appelant contradictoire avec celui de la ligne; crédite la mauvaise commande | Service réel + PostgreSQL | OPEN, non corrigé |
| [#2952](https://github.com/SamyrFateh/komerce-backend/issues/2952) | Catalogue/Sourcing | Writer JSON du Catalogue écrase un prix d'achat protégé par un verrou manuel | Services réels + PostgreSQL | OPEN, non corrigé |
| [#2953](https://github.com/SamyrFateh/komerce-backend/issues/2953) | Sourcing | Réimport 1 détruit la provenance manuelle sans changer le prix; réimport 2 écrase le prix | Service réel + PostgreSQL | OPEN, non corrigé |
| [#2958](https://github.com/SamyrFateh/komerce-backend/issues/2958) | Logistique | `POST /api/parcels/:id/items` (payload valide) renvoie HTTP 500/PG 23502 car INSERT omet `product_id` obligatoire | Route Express/Joi réelle + PostgreSQL; 6 scénarios | OPEN, non corrigé |
| [#2951](https://github.com/SamyrFateh/komerce-backend/issues/2951) | Hub/Sourcing | `repack_exempt` non respecté; volume après repack enregistré et utilisé pour calculer une densité erronée | Services réels + PostgreSQL | OPEN, non corrigé |
| [#2957](https://github.com/SamyrFateh/komerce-backend/issues/2957) | Catalogue/vente | Un snapshot V2 remplace `media_refs: [A]` par `[B]`; A+B persistent et le resolver affiche A | Promotion, DB et resolver réels; 5 scénarios | OPEN, non corrigé |
| [#2949](https://github.com/SamyrFateh/komerce-backend/issues/2949) | Auto-parcel | `INSERT ON CONFLICT DO NOTHING` suivi de `assigned++` même si `rowCount=0` | Service réel avec réponse SQL simulée; **pas encore de conflit réel PostgreSQL** | OPEN, comportement conditionnel confirmé |

**Terminologie obligatoire :** six bugs certifiés avec vraie persistance PostgreSQL ; un comportement conditionnel du service confirmé avec réponse SQL simulée mais preuve d'occurrence et concurrence PostgreSQL à compléter. Ces résultats n'attestent aucune occurrence en production.

## Décisions : ce que l'on garde

1. **Inventaire repo-wide** à base de `git ls-files` et rapport de couverture par SHA : 4 659 fichiers suivis sur le snapshot main analysé, dont 1 438 sources runtime passées par les détecteurs et 624 absentes des cartes gouvernance. Un inventaire n'est pas une preuve d'analyse sémantique exhaustive.
2. **Graphe des autorités et des identités métier** : cardinalité, ownership, provenance, statut, compatibilité marché/relais, synchronisation entre source et projection. Les délégations enregistrées restent distinguées des ruptures de contrat.
3. **Détecteurs génériques en mode `REVIEW`** : identité canonique contre identité appelant ; conflit SQL silencieux ; exemption ignorée ; provenance manuelle écrasée ; association de snapshot ajoutée sans suppression ; INSERT omettant les colonnes NOT NULL réelles.
4. **Réfutation par la vraie exécution** : cas NOMINAL, DEVIATION, contrôles négatifs, vraie route/service, PostgreSQL isolé `ROLLBACK`, sorties attendues et réellement observées, trace GitHub Actions, preuve indépendante.
5. **Registre d'issues et évaluation scientifique** : garder chaque bug distinct, ses preuves, et mesurer ultérieurement la précision des signaux sur un corpus aveugle.

## Ce qu'on ne garde PAS

- Aucun **total de signaux** comme total de bugs. L'analyse précédente avait 162 alertes brutes; l'extension de réconciliation en a ajouté une (163). Les **9** alertes du détecteur de colonnes SQL ne sont pas neuf bugs.
- Aucun blocage automatique de PR à partir des heuristiques non certifiées.
- Pas de nouvelle plateforme ni d'agent autonome complexe avant un benchmark aveugle reproductible.
- Aucune confusion entre un job vert qui **prouve un bug existant** et un test de non-régression vert qui **prouve un correctif**.
- Aucune correction de règles fondamentales, aucun RESET ou purge de données métiers, ni seed sur Railway pendant les explorations.
- Pas de merge de la branche R&D avec ses tests de diagnostic qui attendent volontairement le comportement défectueux.

## Ordre recommandé des correctifs — PR séparées et petites

**Lot A, fonctionnement et intégrité immédiate :**
- #2958 : faire déléguer la route HTTP au service canonique de mutation des articles, avec transaction, statut du colis, même destination/marché, contrôle de quantité, trace physique. **Ne pas** simplement ajouter `product_id` à l'INSERT historique : cela contournerait encore les gardes. Convertir le diagnostic en acceptance tests HTTP 201/400/409 et preuve DB.
- #2939 : `oi.order_id` est l'autorité pour Inventory ; rejeter (ou neutraliser selon doctrine) tout ordre contradictoire **avant** écriture, et tester la non-modification des compteurs de commande B.

**Lot B, protection des décisions manuelles et économie :**
- #2953 **avant** #2952 : corriger d'abord la perte de provenance dans le service propriétaire, puis rediriger le writer import JSON via ce service au lieu de dupliquer la logique.
- #2951 : protéger la valeur `repack_exempt` à l'écriture et à la lecture/calcul ; inventorier les données incohérentes en lecture seule avant une éventuelle réparation.

**Lot C, cohérence projections et preuves additionnelles :**
- #2957 : distinguer snapshot complet de patch, synchroniser les liens SKU↔médias, ne pas toucher aux autres SKU ni à l'autorité manuelle.
- #2949 : reproduire d'abord un conflit réel PostgreSQL (y compris entrelacement si pertinent), puis utiliser `rowCount`/`RETURNING` et vérifier les effets de bord; préparer tests de régression.

Chaque PR corrective doit posséder le test de succès nominal, le rejet ou non-effet de la déviation, la vérification SQL après action, la couverture des frontières et une décision explicite sur la doctrine.

## R&D à reprendre seulement après stabilisation

Faire une évaluation **en aveugle sur un autre domaine**, où la sélection des anomalies et le verdict sont indépendants des patterns conçus après les découvertes historiques. La découverte #2957 puis #2958 est venue d'une investigation guidée humainement; le scanner générique a été enrichi après la preuve. Il serait trompeur d'en déduire une autonomie de découverte prouvée.

## Références

- [CI complète verte avec scanner du schéma et 6 tests Logistique](https://github.com/SamyrFateh/komerce-backend/actions/runs/40198201470).
- [CI de preuve pour Catalogue SKU/médias](https://github.com/SamyrFateh/komerce-backend/actions/runs/40196599419).
- [Rapport de couverture initial](SCANNER_REPO_WIDE_PERTINENCE_2026-10-25.md).
- [Rapport R&D SKU-médias](SCANNER_RND_SKU_MEDIA_REPLAY_2026-10-25.md).

**Décision de fin de phase : on cesse d'élargir le scanner pour l'instant; on ouvre un cycle de corrections métier isolées, en commençant par #2958 et #2939.**
