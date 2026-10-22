# Étape 6 — Certification fonctionnelle métier KM / CM / CG / DJ

Statut : **contrat de recette prêt, exécution non encore prouvée**. Cette pièce prépare les scénarios, elle ne constitue ni un PASS technique ni une acceptation métier.

## Périmètre et dépendances

- Base **PostgreSQL 16 jetable**, provisionnée et migrée au dernier `main` incluant les PR-A/B/C/D. Ne jamais utiliser staging ou production pour nettoyer les scénarios.
- Réutiliser les APIs et écrans canoniques, sans routes de simulation métier alternatives ; les fixtures portent `simulation_scope` lorsque requis.
- Ne jamais inventer de taux FX, de tarif de vente transport, d'approbation ou de preuve de paiement réel. Les tarifs de test sont des **fixtures explicites, non commerciaux**, réservées à la base jetable.
- Ne pas lancer de RESET, purge, encaissement ou virement réel.
- Synchroniser le jeu de tests seulement **après** la fusion des branches de Sonnet, afin de ne pas dupliquer ou masquer #2829.

## Matrice de recette obligatoire

| Cas | KM (KMF) | CM (XAF) | CG (XAF) | DJ (DJF) | Preuve |
| --- | --- | --- | --- | --- | --- |
| A. Sourcing, décision de prix, catalogue et projection locale | ✓ | ✓ | ✓ | ✓ | Sources, coûts, prix, scope du marché |
| B. Panier et checkout sur relais appartenant au marché | ✓ | ✓ | ✓ | ✓ | API + écran + commande en DB |
| C. Absence de tarif transport propre, refus contrôlé | ✓ | ✓ | ✓ | ✓ | Code d'erreur, aucune commande créée |
| D. Tarif propre attesté, snapshot de transport et devise corrects | ✓ | ✓ | ✓ | ✓ | Identifiant tarif, pièce, FX legs, montant figé |
| E. Affichage d'un tarif d'un autre marché interdit, même devise CM/CG | ✓ | ✓ | ✓ | ✓ | Appels croisés et comparaison des IDs |
| F. Absence ou péremption FX refusée, y compris DJF | N/A | N/A | N/A | ✓ | 503 `fx_rate_unavailable`, aucune valeur de repli |
| G. Saisie FX, approbation distincte issue de la session, alerte >3 % | Global | Global | Global | ✓ | Journaux/audit et réponse des routes |
| H. Paiement et remboursement : devise et taux de la commande conservés | ✓ | ✓ | ✓ | ✓ | Snapshot immuable, transaction idempotente |
| I. Fournisseur, réception Hub, SPLIT/MERGE/LOST/remplacement | ✓ | ✓ | ✓ | ✓ | Quantités C2 conservées et preuve physique |
| J. Douane, trajet, relais, remise puis marge réelle | ✓ | ✓ | ✓ | ✓ | Coûts inconnus ≠ zéro, unité conservée |
| K. Dashboards, rôles, isolation et rapports financiers | ✓ | ✓ | ✓ | ✓ | API, capture écran, lecture des valeurs DB |

Les cases sont des **exigences à exécuter**, pas des résultats. Refus attendus = PASS seulement si code et absence d'effet secondaire sont vérifiés.

## Ordre d'exécution et contrôle

1. Preflight des migrations sur PostgreSQL jetable, contrôle de versions, seed minimal **explicitement traçable**.
2. Jest PostgreSQL : `fx-chain-postgres`, `fx-authority-postgres`, `market-transport-sale-rates-postgres`, `hub-physical-identity-postgres`, et `order-fx-snapshot-postgres` une fois #2829 fusionnée.
3. API E2E : provisionner/activer les marchés, confirmer l'isolation **par market_id et relais_id** ; pour CM/CG, vérifier que le partage de XAF n'autorise aucun partage de tarif, commande, droit ou règlement.
4. Playwright **desktop et mobile**, avec vraie API E2E attachée à la base jetable. La configuration `playwright.config.js` actuelle est une suite dashboards à API simulée : sa réussite n'est **pas** une preuve d'E2E métier réel.
5. Pour chaque scénario, enregistrer **objectif, entrée, attendu, observé, preuve DB, capture, écart, verdict humain**. Identifier explicitement les scénarios non jouables faute de décision de tarif commercial.
6. Revue contradictoire Opus puis GPT sur les **mêmes preuves** ; verdict métier final en **15 lignes maximum**.

## Critères d'arrêt (NO GO)

- Une valeur manquante présentée comme zéro, une devise reconvertie à un taux courant après commande, ou un taux FX périmé utilisé.
- Une approbation de taux par son auteur ou une identité injectée par le corps HTTP au lieu de la session authentifiée.
- Un tarif transport global ou d'un autre marché utilisé implicitement ; CM et CG ne doivent jamais être confondus.
- Une quantité LOST encore reçue, double comptage après MERGE, ou remboursement supérieur au capturé.
- Une suite marquée « verte » alors que les cas ont été sautés, mockés au lieu de l'API réelle, ou qu'une validation humaine manque.

## Références déjà disponibles dans le dépôt

- `tests/integration/fx-chain-postgres.test.js`
- `tests/integration/fx-authority-postgres.test.js`
- `tests/integration/market-transport-sale-rates-postgres.test.js`
- `tests/integration/hub-physical-identity-postgres.test.js`
- `tests/e2e-api/market-control-plane.provision-to-first-order.e2e.test.js`
- `playwright.config.js` (API simulée : ne pas confondre avec navigateur E2E métier)
