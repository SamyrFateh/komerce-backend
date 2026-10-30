# Catalogue opérateur unifié — Lot 1 (lecture & inspection)

**Décision** : issue #3135 (29/10/2026). Branche dépendante de #3113, #3101, #3083. Aucun merge ni déploiement implicite.

## Règle produit
Un seul écran humain de qualification : `/admin/workspaces/catalog`. Sourcing et Raffinerie gardent leurs services, leurs validations, leur traçabilité et leurs permissions. Aucune écriture trans-domaines, aucun changement aux prix/commandes/expositions/marchés.

## Ce lot implémente
1. `services/catalog-unified-registry.js` : lecture SQL paginée de tous les produits `products` (y compris historiques sans candidate) et des candidats `sourcing_candidates` encore sans produit. Une observation canonique préférée par `product_id` avec `DISTINCT ON`, aucune duplication lors de la remise ; un candidat orphelin reste visible comme anomalie.
2. Cinq catégories **internes** de projection : `correction`, `review`, `validated`, `processing`, `excluded`. Les trois catégories principales de travail sont « À corriger », « À valider », « Validés ». « En préparation » n’est PAS un défaut humain.
3. `validated` exige une décision Catalogue auditée `CATALOG_PRODUCT_APPROVED` ou `CATALOG_PRODUCT_OVERRIDDEN_AND_APPROVED` comme dernier événement. Un actif sans cette preuve est `approval_unproven`, non validé fictivement.
4. `catalog-workspace.js` demande explicitement `unified=1` pour le registre opérateur. L’ancien `listRegistry()` est intact pour les consommateurs historiques. La vente et l’exposition marché restent indépendantes.
5. Inspection contextuelle en lecture seule des candidats sans `product_ref`, et compteurs issus de toute la sélection serveur (pas uniquement de la page). Aucun bouton d’approbation/product update pour un candidat non promu.
6. L’API exige, pour `unified=1`, **à la fois l’autorité globale Catalogue et l’autorité globale Sourcing**. Le rôle `admin` n’accorde aucun de ces droits implicitement.

## Ce lot NE prouve PAS
- que la quantité réelle de candidats, produits validés, doublons ou exceptions sur Railway est correcte : requêtes non exécutées sur staging ;
- que toutes les anomalies relevées sont corrigibles dans le même panneau : seuls les candidats disposent pour l’instant d’un inspecteur non-mutant ; les autres actions restent héritées ;
- une validation Chromium/authentification sur staging, ni une recette transactionnelle ;
- un déplacement de la traduction FR navigateur vers un worker backend ;
- la capacité d’un opérateur Catalogue à agir sur les candidats : la délégation Sourcing est distincte et doit être conçue sans privilège implicite ;
- la réconciliation des actifs historiques qui n’ont pas d’événement d’approbation.

## Matrice de recette exigée avant déploiement
| Cas | Attendu |
| --- | --- |
| Candidat RAW importé | Identité `candidate_ref` affichée ; « En préparation » ; zéro faux défaut |
| Candidat scanné / test_ready | « À examiner », pas de `product_ref` fictif |
| Candidat `imported_to_catalog` sans produit associé | Alerte `handoff_missing` ; non disparu |
| Candidat remis (lien produit présent) | Une seule ligne avec deux références, pas de doublon |
| Produit hérité sans candidat lié | Une ligne visible, provenance/qualité à réconcilier |
| Actif sans preuve de validation | `approval_unproven`, jamais « Validé » |
| Actif audité, complétude prouvée | « Validé » ; visibilité boutique reste une décision distincte |
| Deux autorisations | Requête `unified=1` refusée 403 sans grant Sourcing |
| Recherche + filtres + pagination | Total exact, tri stable, pas d’injection SQL |
| Décision humaine | Aucun POST depuis l’inspecteur en lecture seule |

## Suite (lots 2–3)
- Mesurer les volumes réels et vérifier les oracles PostgreSQL (comptages, handoffs, audit des approbations) en lecture seule.
- Construire le panneau de correction complet : proposition taxonomique, preuve indépendante, FR, médias, champs nécessaires et actions autorisées.
- Concevoir un dispatcher sécurisé vers les services Sourcing/Raffinerie/Catalogue existants, avec capacité explicite par action et relecture canonique après écriture.
- Orchestrer la préparation/normalisation côté serveur, sans déclenchement au montage d’un onglet.
- Captures desktop 1440, avant/après, scénarios utilisateur et contrôles de non-régression, puis arbitrage de fusion.

**Statut** : PR draft, lot 1 incomplet tant que tests locaux/CI, PostgreSQL et acceptation UI ne sont pas certifiés.
