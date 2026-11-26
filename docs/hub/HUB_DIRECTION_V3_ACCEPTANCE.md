# Direction Hub V3 — doctrine et critères de recette (26 novembre 2026)

## Organisation validée
Deux postes : Kanban V8 (exécution) et Direction Hub (gestion). Direction : Pilotage et Gestion seulement. Pilotage = indicateurs et liens filtrés, aucune mutation. Gestion = dossiers uniques, filtres Tous / À décider / À contrôler / À résoudre. Achats, finance et administration sont des volets du dossier, pas des applications. Une PO peut porter plusieurs tâches mais ne doit pas être dupliquée dans la même liste. Les autorisations d'engagement et de paiement restent distinctes, avec droits et preuves distincts. Pas de nouveaux écrans pour les budgets ou les ressources à ce stade.

## Invariant commercial
Le Hub ne crée pas le besoin commercial. Toute ligne d'achat commercial doit être issue d'un article IMPORT d'une commande client dont le paiement est confirmé par le système canonique. Aucun ajout libre de quantité, aucun achat orphelin, aucun double approvisionnement. Les reliquats doivent rester dans la couverture commerciale admissible. Les consommables et dépenses de fonctionnement relèveront d'un circuit séparé.

## Audit initial (lecture statique, non certifié)
- purchasing-grouped-service : IDs uniques, variantes exigées, verrouillage des lignes, rattachement seulement si non affectées et non annulées.
- hub-authorization-service : verrou PO, grant actif, preuve, engagement avant soumission, paiement distinct plafonné par engagement et devise.
- La requête poAmount ne vérifie pas directement le statut de paiement de la commande. Examiner les gardes amont, la base et les transitions concurrentes avant de conclure à une faille exploitable.
- Vérifier toutes les entrées de création, rattachement, engagement, soumission et reprise fournisseur. Ne pas ajouter un second writer.

## Critères bloquants
| Cas | Attendu |
|---|---|
| Article IMPORT payé, quantité disponible | autorisé |
| Commande non payée ou paiement révoqué avant engagement | refus |
| Commande annulée avant engagement | refus |
| Article orphelin / identifiant inventé | refus |
| Quantité supérieure au besoin net | refus |
| Double rattachement ou concurrence | refus sans double achat |
| Reliquat légitime | autorisé dans la couverture résiduelle |
| Achat local sans besoin import | aucune PO commerciale |
| Agent sans grant / admin sans grant | refus de décision |
| Paiement supérieur à engagement ou devise différente | refus |
| Tentative directe API | mêmes gardes serveur |

Les annulations ou remboursements après engagement nécessitent un arbitrage explicite du passif fournisseur, pas une suppression rétroactive des preuves. Vérifier les verrous et la couverture sous concurrence. Dans le dossier canonique afficher références commerciales, éligibilité de paiement, quantités demandées/couvertes/restantes, destination, prix fournisseur, écarts, justificatifs et historique sans identité client inutile.

## Recette
Gestes métier positifs et négatifs par Chromium sur staging jetable, oracles HTTP et PostgreSQL, preuve d'absence de mutation pour refus. Tests serveur séparés pour contournements directs et concurrence. Desktop 1280x720, 1366x768, 1440x900, 1920x1080. Conservation des filtres et dossiers, pas de scroll imbriqué ni de retour historique. Aucun GO sans preuves de recette. Ce document ne constitue pas une certification.
