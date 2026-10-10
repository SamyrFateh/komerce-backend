# Autonomie des Markets — delta

**SHA :** `main` = `10c5b0daa` · **Méthode :** registre des capacités (migrations), routes `market-delegation-*` et `admin-*`, consommateurs de `public/dashboards/canonical/js`. Aucun code n'a été modifié.
**Suspendus par décision :** D4b, D5, D6b, D8, D9, D10. Paiements existants intacts.

## 1. Verdict exécutif

1. **L'autonomie fonctionnelle est largement construite.** Les capacités d'équipe, de catalogue, de prix, de réseau, d'exécution terrain, de litiges, de signaux et de lecture finance et opérations sont **LIVE**, déléguées par Market, plafonnées et auditées.
2. **Un Market ne peut pas encore opérer seul sur trois points démontrés :**
   - le remboursement, qui est une autorité centrale par doctrine ;
   - la vérification et la contestation des dépôts de caisse, réservées au rôle `admin` ;
   - l'encaissement sur un compte dont le Market est juridiquement titulaire, puisque D4a n'est pas lu par les flux.
3. **L'autonomie financière n'existe pas encore juridiquement.** Les fonds passent par les comptes de la plateforme (Stripe, PayPal) ou par les identifiants de prestataire posés en variables d'environnement (Orange Money CM). Le titulaire réel n'est tracé nulle part dans le flux.
4. **Quatre lectures backend sont livrées sans écran :** performance, relevé de coûts (D7), douane (D6a) et comptes de paiement (D4a).
5. **Le chemin le plus court** est de raccorder l'existant (§5), sans nouveau système. La vraie autonomie financière reste une **décision juridique** (titulaire, contrat), pas un chantier technique.

## 2. Matrice d'autonomie

| # | Domaine | Existant | Preuve | Manque réel | Décision |
|---|---|---|---|---|---|
| 1 | Équipe et habilitations | `team.read`, `team.invite`, `team.grant`, `team.revoke` LIVE ; écran Équipe ; mandat ACTIVE/SUSPENDED/ENDED (D2) | `routes/market-delegation-team.js` ; JS canonique `…/team`, `…/team/invitations`, `…/team/X/capabilities` ; e2e-api `market-delegation.authority-team-network` | — | **EXISTANT ET PROUVÉ** |
| 2a | Catalogue et prix | `catalog.read`, `catalog.expose`, `local_offer.manage`, `pricing.*` LIVE ; écrans Exposition, Offre locale, revue catalogue | JS canonique `…/catalog/exposure`, `…/local-offer`, `…/catalog/review` ; e2e-api `market-delegation.pricing`, `.commerce-network` | — | **EXISTANT ET PROUVÉ** |
| 2b | Fournisseurs et achats | Centraux **par décision** (sourcing et achats groupés) | décision du propriétaire | — (le siège reste propriétaire) | Hors autonomie, assumé |
| 2c | Commandes | Transitions terrain par capability : `execution.order.mark_ordered`, `inventory.assign`, `parcel.*`, `distribution.run` | registre des capacités ; `services/order-status-machine.js` | `cancelled` et `refunded` restent `admin` (`order-status-machine.js:110-111`) | Voir dépendance S-1 |
| 3 | Relais et logistique | `network.create/update/suspend`, `provider.manage`, `hub.supervise`, `logistics.read` LIVE ; écran Réseau | JS canonique `…/network/relais`, `…/network/providers` | — | **EXISTANT ET PROUVÉ** |
| 4 | Comptes et prestataires de paiement | `market_payment_providers` (CM → `orange_money` XAF, migration 169) + adaptateur `services/mobile-money/orange-money-cm.js` ; `market_payment_accounts` (D4a) | `payment-mobile-money.js:99-109` (disponibilité par Market) ; migration 285 | Les identifiants Orange Money CM viennent de `process.env.ORANGE_MONEY_CM_*`, sans titulaire tracé. D4a n'est lu par aucun flux | **PARTIEL** ; résolveur = D4b **suspendu** |
| 5a | Encaisser | Stripe et PayPal globaux ; Mobile Money par Market ; confirmation cash locale (`execution.cash.confirm`) | `routes/admin-operations-workspace.js:244-248` | Encaissement CM réel **NON VÉRIFIABLE** (présence des variables en prod inconnue) | **NON VÉRIFIABLE** |
| 5b | Contrôler sa caisse | Politique de caisse déléguée (`cash_control.policy.manage`, écran) ; dépôts relais | `routes/market-delegation-cash-control.js:86` | **Vérifier et contester un dépôt exige `requireRole(['admin'])` en plus de `finance.act`** : un `market_operator` qui détient `finance.act` est refusé | **EXISTANT MAIS NON BRANCHÉ** (S-2) |
| 5c | Rapprocher | `services/mobile-money-reconciliation.js` ; lecture Comptabilité (`finance.read`) | fichiers cités | Pas d'action de rapprochement côté Market prouvée | **PARTIEL**, sans besoin opérationnel démontré |
| 5d | Payer, règlements | Le Market demande et réceptionne (`settlement.receive`) ; le siège met « prêt » et « payé » | `routes/market-delegation-settlement.js:93,109` ; `routes/admin-market-settlement.js:90,115` | Le sens est siège → Market, ce qui suppose que la plateforme encaisse. C'est cohérent avec l'état actuel, à inverser seulement avec D8 | Assumé tant que D8 est suspendu |
| 6 | Anomalies et litiges | `decision_signal.manage`, `client.case.handle` LIVE ; écran Litiges ; Action Center Market (`admin`, `market_operator`) et agents (`agent-action-center.js`) | `routes/admin-action-center.js:154-188` ; JS `…/client-cases/disputes` | Remboursement refusé côté Market (`market-delegation-client-case.js:58-64`, doctrine `refund_authority_never_delegated`) | **PARTIEL** (S-1) |
| 7 | Dashboards du Market | `dashboard.market.read`, `finance.read`, `operations.read` LIVE | e2e-api `market-delegation.dashboard-reads`, `.operations-read` | `…/performance`, `…/cost-statement` (D7), `…/customs-shipments` (D6a) et `…/payment-accounts` (D4a) n'ont **aucun consommateur** dans `public/dashboards/canonical/js` | **EXISTANT MAIS NON BRANCHÉ** (S-3) |
| — | Douane | Lecture locale (D6a) ; transitaire `execution.transit.confirm` | `routes/transitaire-api.js` | Gestion douanière = D6b **suspendu** | Hors périmètre actuel |
| — | Configuration du Market | `market_config.read` LIVE | `routes/market-delegation-market-config.js` (GET seul) | `market_config.update` reste MISSING (aucune route) | **ABSENT**, aucun besoin opérationnel démontré : ne rien faire |

## 3. Dépendances au siège démontrées

| ID | Dépendance | Preuve | Nature |
|---|---|---|---|
| S-1 | Annuler et rembourser une commande | `order-status-machine.js:110-111` (`cancelled`, `refunded` → `admin`) ; `market-delegation-client-case.js:63` | Doctrine voulue jusqu'à D5 (suspendu) |
| S-2 | Vérifier et contester les dépôts de caisse | `admin-finance-accounting-workspace.js:35,187,201` | Garde de rôle redondante avec `finance.act`, déjà délégable |
| S-3 | Voir sa performance, ses coûts, sa douane et ses comptes de paiement | Aucun consommateur JS (vérifié par recherche) | Écrans manquants sur des API existantes |
| S-4 | Activer un prestataire et ses identifiants | `market_payment_providers` piloté par `admin-market-control-plane` ; identifiants en variables d'environnement | Gouvernance centrale voulue |

## 4. GAP financier

- **Comptes.**
  - Ce qui existe : la table `market_payment_accounts` (titulaire, vendeur juridique, opérateur, porteur du remboursement, vérification tracée) et `market_payment_providers` (prestataire activé par Market).
  - Ce qui manque : aucun lien entre les deux, et aucun lien vers les identifiants réellement utilisés.
- **Encaissements.**
  - Techniquement routables par Market pour le Mobile Money (adaptateur Orange Money CM).
  - Ce n'est **pas** une autonomie financière, car le titulaire du compte marchand utilisé n'est ni tracé ni contractualisé dans le système.
- **Décaissements.**
  - Les règlements vont du siège vers le Market.
  - Les remboursements sont centraux.
  - Pour un Market qui rembourse lui-même : il faut D5, après D4b.
- **Responsabilité.**
  - Elle est **indéterminée** tant que la base juridique (contrat, titulaire) n'est pas renseignée.
  - C'est une décision et un dossier hors code. D4a permet déjà de la consigner.

## 5. Plan Sonnet minimal

Ces lots ne sont à lancer que si le besoin opérationnel du Cameroun est confirmé.

1. **S-3 (lecture, sans risque).** Un onglet « Mon marché » en lecture dans l'espace Market existant consomme `performance`, `cost-statement`, `customs-shipments` et `payment-accounts`.
   - Il suit le patron `market-team.js`.
   - Il n'y a aucune nouvelle API.
   - Acceptation : chaque bloc affiche la réponse serveur, l'état vide honnête et le refus sans `finance.read`, avec un e2e Playwright sur API simulée.
2. **S-2 (autorité).** Remplacer `requireRole(['admin'])` par `requireRole(['admin','market_operator'])` sur les routes de dépôt `verify` et `dispute`. `finance.act`, délégué et plafonné, reste la vraie garde.
   - C'est un **changement d'autorité** : il demande une **validation humaine avant merge**.
   - Acceptation : un `market_operator` avec `finance.act` sur son Market obtient 200 ; sans `finance.act`, ou sur un autre Market, il obtient 403 ; l'audit est écrit.
3. Rien d'autre. S-1 (remboursements) et S-4 restent gouvernés par D5 et D4b, tous deux suspendus.

## 6. Conditions de certification d'un Market autonome

- [ ] Control Plane `readiness.ready_for_activation = true` sur la base live (`market-control-plane.js:74-83`).
- [ ] Mandat ACTIVE, un responsable opérationnel, un détenteur de `team.grant` et un référent central.
- [ ] Un prestataire de paiement disponible (`available: true`), avec un compte `market_payment_accounts` ACTIVE et vérifié qui documente le titulaire et la base juridique (D4a, saisie manuelle).
- [ ] Politique de caisse définie ; dépôts vérifiables localement (S-2).
- [ ] Le Market lit ses chiffres sans le siège (S-3).
- [ ] Remboursements : tant que D5 est suspendu, une procédure siège écrite avec un délai de traitement. C'est une dépendance assumée, pas une autonomie.

## 7. Verdict final

**A. Ce qui est déjà construit.**
- La délégation complète du fonctionnel quotidien : équipe, catalogue, prix, réseau, exécution terrain, litiges, signaux et lecture finance et opérations, avec plafonds, audit et cycle de vie du mandat.
- La consignation juridique des comptes de paiement (D4a).
- Un adaptateur Mobile Money par Market.

**B. Ce qui empêche encore d'opérer de bout en bout sans le siège.**
- Les remboursements et annulations (S-1, voulu).
- La vérification des dépôts de caisse (S-2, garde redondante).
- L'absence d'écran pour quatre lectures existantes (S-3).
- Surtout : **l'absence de titulaire juridique et de contrat** pour les fonds encaissés. Aucun code ne règle ce point.

**C. Le chemin le plus court.**
- S-3, puis S-2 (avec validation humaine) : deux petits raccordements, sans migration ni flux de paiement touché.
- En parallèle, côté propriétaire : désigner le titulaire du compte Orange Money CM et sa base juridique, puis les saisir via D4a.
- D4b et D5 ne se rouvrent que si ce dossier juridique l'exige.
