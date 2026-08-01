# Lot 8 — Certification pré-go-live du retrait

## Objet

Ce certificat clôt la chaîne Lots 5 à 8 du retrait Komerce :

- Lot 5 : autorisation nominative exceptionnelle ;
- Lot 6 : déploiement et réconciliation du schéma ;
- Lot 7 : qualification métier sur PostgreSQL et vraies routes HTTP ;
- Lot 8 : non-régression globale et aptitude pré-go-live.

Le merge du Lot 8 n’est autorisé que lorsque le workflow canonique
`.github/workflows/lot8-pre-go-live-certification.yml` est intégralement vert sur le SHA exact de la PR.

## Doctrine certifiée

1. Le code secret reste le mode normal de retrait.
2. L’autorisation nominative est une exception liée au compte et consultée au moment exact de la remise.
3. Aucune autorisation n’est figée par commande.
4. Une seule remise peut gagner, y compris en concurrence entre code et nom.
5. Le relais ne reçoit jamais le nom attendu.
6. La pièce d’identité est contrôlée visuellement ; aucune copie, photo, référence, adresse, expiration ou signature n’est conservée.
7. L’audit conserve uniquement les éléments nécessaires à la preuve de remise.
8. La notification est émise après commit et ne peut pas annuler une remise validée.

## Matrice bloquante

### Backend et gouvernance

- registre Feature First ;
- qualité et audit backend ;
- audit des dépendances ;
- couverture unitaire complète ;
- contrat catalogue ;
- invariants de feature ;
- graphe, schéma, headers SQL et drift ;
- Security 360 ;
- gate pré-déploiement sans réexécuter les tests.

Le manifeste `business-rules` est enregistré dans le registre canonique afin de préserver la bijection stricte entre les manifests présents sur disque et `APP_FEATURE_REGISTRY.md`.

Le snapshot d’intégrité des migrations est réconcilié avec les fichiers SQL canoniques présents sur le SHA certifié ; aucune migration historique n’est modifiée pendant l’exécution de la certification.

### PostgreSQL réel

- chargement du dump Railway canonique ;
- application de toutes les migrations pendantes ;
- suite d’intégration complète ;
- campagne E2E Feature First complète ;
- preuve Lot 7 du CRUD d’autorisation ;
- preuve de concurrence code contre nom.

### Boutique et relais

- check rapide Boutique complet ;
- couverture unitaire Boutique ;
- Playwright local déterministe sur les contrats géométriques stables ;
- qualité, architecture et tests unitaires des dashboards ;
- parcours opérateur de retrait exceptionnel.

## Critère de verdict

- **PASS** : tous les jobs du workflow Lot 8 sont verts sur le SHA fusionné.
- **FAIL** : au moins un job rouge, ignoré, neutralisé ou remplacé par une dérogation.

Aucun budget, seuil, skip, allowlist ou faux vert ne peut être ajouté pour obtenir le PASS.

## Après certification

La simplification du checkout et du panier partagé peut démarrer sur `main`, en conservant :

- acheteur comme propriétaire de chaque commande unitaire ;
- organisateur comme coordinateur et destinataire initial des codes du panier partagé ;
- personne autorisée au retrait comme rôle opérationnel distinct ;
- bénéficiaire comme métadonnée descriptive facultative, sans autorité transactionnelle.
