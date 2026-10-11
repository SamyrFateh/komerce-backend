# Recette Cameroun — autonomie de gestion d'un Market

Périmètre : voir, décider, agir sur le Market Cameroun (CM). Hors périmètre : remboursements, rémunérations, encaissement automatisé.

## Prérequis (à fournir avant de commencer)
- Un **staging isolé** avec la migration 286 appliquée et les parités KMF/XAF présentes.
- 4 comptes : administrateur central, responsable CM (`finance.act` + lecture sur CM), agent relais CM (affecté à un relais CM), responsable d'un autre Market (ex. Comores).
- Aucune donnée ni action en production. Si un prérequis manque : noter `NON PROUVÉ` et le prérequis.

## Parcours

| # | Acteur | Action | Résultat attendu | Preuve à noter |
|---|---|---|---|---|
| 1 | Responsable CM | Ouvrir « Mon Market » | Performance, coûts, douane, comptes de paiement affichés, aucun bouton d'écriture | Capture + valeurs |
| 2 | Responsable CM | Comparer 2 valeurs affichées à la base ou à l'API | Données CM uniquement, montants en KMF | Valeur écran = valeur API |
| 3 | Agent relais CM | Déclarer un dépôt de 100 000 XAF avec référence | Dépôt `pending` : 100 000 XAF → 75 000 KMF (taux 0,75), référence conservée | Ligne `cash_deposits` (`declared_*`, `fx_*`, `amount_kmf`) |
| 4 | Responsable CM | Contester (motif) puis vérifier le dépôt | `pending → disputed → verified`, note conservée | Statut + `verified_by` |
| 4b | Administrateur | Lire l'audit | 2 lignes `finance.act`, Market CM, avant/après | `market_delegation_audit` |
| 5a | Responsable sans `finance.act` | Vérifier un dépôt CM | Refus 403 | Réponse API |
| 5b | Responsable d'un autre Market | Vérifier un dépôt CM | Refus (404 dépôt introuvable) | Réponse API |
| 5c | Agent relais CM | Vérifier son propre dépôt | Refus 403 `deposit_self_review_forbidden` | Réponse API |
| 6 | Responsable CM | Re-vérifier ou contester un dépôt déjà `verified` | Refus 409, statut inchangé, aucune ligne d'audit ajoutée | Réponse + audit |
| 7 | Administrateur | Consulter une commande et un dépôt des Comores | Valeurs inchangées, dépôt en KMF au taux 1 | Avant/après |

## Contrôle du cron (après chaque déploiement)
Logs Railway : aucune occurrence de `[signal-service] cash_expiring error` sur 2 cycles de 15 min. Une occurrence de `cash_expiring tronqué` signifie plus de 50 encaissements non déposés : traiter les dépôts, l'auto-résolution reprend toute seule.

## Verdict
`CONFORME` / `LIMITÉ VOLONTAIREMENT` / `BLOQUÉ` / `NON PROUVÉ` par parcours, puis **GO / GO SOUS CONDITIONS / NO GO** pour la clôture. Preuves de référence : PR #2417, #2418, #2419, #2420.
