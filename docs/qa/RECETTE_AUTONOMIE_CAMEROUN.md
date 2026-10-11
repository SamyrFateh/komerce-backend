# Recette Cameroun — autonomie de gestion d'un Market

Périmètre : voir, décider, agir sur le Market Cameroun (CM). Hors périmètre : remboursements, rémunérations, encaissement automatisé.

## Prérequis (à fournir avant de commencer)
- Un **staging isolé** avec la migration 286 appliquée et les parités KMF/XAF présentes. Relever d'abord `currency_parities` (XAF, KMF) : le résultat attendu du parcours 3 en dépend (aucun taux n'est figé dans cette feuille).
- 4 comptes : administrateur central, responsable CM (`finance.act` + lecture sur CM), agent relais CM (affecté à un relais CM), responsable d'un autre Market (ex. Comores) ; pour 5e, un compte responsable CM qui a lui-même déclaré un dépôt.
- Aucune donnée ni action en production. Si un prérequis manque : noter `NON PROUVÉ` et le prérequis.

## Parcours

| # | Acteur | Action | Résultat attendu | Preuve à noter |
|---|---|---|---|---|
| 1 | Responsable CM | Ouvrir « Mon Market » | Performance, coûts, douane, comptes de paiement affichés, aucun bouton d'écriture | Capture + valeurs |
| 2 | Responsable CM | Comparer 2 valeurs affichées à la base ou à l'API | Données CM uniquement, montants en KMF | Valeur écran = valeur API |
| 3 | Agent relais CM | Déclarer un dépôt de 100 000 XAF avec référence | Dépôt `pending`, devise d'origine XAF, `amount_kmf` = 100 000 × taux de parité relevé en base (ne pas supposer de valeur), référence conservée | Ligne `cash_deposits` + `currency_parities` (XAF, KMF) : recalculer `amount_kmf` à la main et comparer |
| 4 | Responsable CM | Contester (motif) puis vérifier le dépôt | `pending → disputed → verified`, note conservée | Statut + `verified_by` |
| 4b | Administrateur | Lire l'audit | 2 lignes `finance.act`, Market CM, avant/après | `market_delegation_audit` |
| 5a | Responsable CM sans `finance.act` | Vérifier un dépôt CM | 403 (capability absente) | Réponse API |
| 5b | Responsable autorisé sur un autre Market uniquement | Appeler la route du Market CM | 403 `MARKET_SCOPE_DENIED` (capability hors Market) | Réponse API |
| 5c | Responsable CM autorisé | Vérifier, via CM, la référence d'un dépôt d'un autre Market | 404 `deposit_not_found` (référence hors du Market autorisé), aucune écriture | Réponse API + statut du dépôt inchangé |
| 5d | Agent relais CM | Appeler la vérification d'un dépôt | 403 de rôle (`agent_relais` n'a pas la voie de revue) | Réponse API |
| 5e | Responsable CM (`finance.act`) ayant lui-même déclaré le dépôt | Vérifier son propre dépôt | 403 `deposit_self_review_forbidden` | Réponse API + statut inchangé |
| 6 | Responsable CM | Re-vérifier ou contester un dépôt déjà `verified` | Refus 409, statut inchangé, aucune ligne d'audit ajoutée | Réponse + audit |
| 7 | Administrateur | Consulter une commande et un dépôt des Comores | Valeurs inchangées, dépôt en KMF au taux 1 | Avant/après |

## Contrôle du cron (après chaque déploiement)
Logs Railway : aucune occurrence de `[signal-service] cash_expiring error` sur 2 cycles de 15 min. Une occurrence de `cash_expiring tronqué` signifie plus de 50 encaissements non déposés : traiter les dépôts, l'auto-résolution reprend toute seule.

## Verdict
`CONFORME` / `LIMITÉ VOLONTAIREMENT` / `BLOQUÉ` / `NON PROUVÉ` par parcours, puis **GO / GO SOUS CONDITIONS / NO GO** pour la clôture. Preuves de référence : PR #2417, #2418, #2419, #2420.
