# #3304 — Livraison V1 : Responsable marché autonome

## Diagnostic vérifié le 02/11/2026

- `routes/admin/users.js` sait créer `market_operator`, requiert `market_scope` unique lors de la création et fournit des routes addition/révocation de scope marché.
- `services/market-operator-provisioning.js` crée une membership de délégation par marché; `manager` reçoit exclusivement les capabilities LIVE de classe `DELEGATION` figurant dans le ceiling. Ce n'est pas la preuve d'un profil métier capable d'exercer toutes les actions attendues.
- `operator_market_scopes` est une projection; la source d'autorité reste `market_operating_assignments` → `assignment_memberships` → `membership_capabilities`, limitée par le ceiling.
- `#3303` corrige uniquement le contexte de navigation du Hub. Ne pas y intégrer de mutations d'autorisations marché.

## Contrat de réalisation

1. **Provisioning** : entrée métier `markets: ['KM','CM']` / profil `market_operator` (n'exposer ni `viewer` ni `manager` ni les capacités fines). Résoudre chaque code côté serveur, valider marchés actifs, rejeter doublons et entrées non reconnues. Transaction unique : utilisateur + memberships + audit + projection. Conserver les API historiques si nécessaires pour leurs appelants, sans les rendre visibles dans le parcours principal.
2. **Affectations** : ajouter/retirer des marchés à un responsable existant en transaction, avec révocation effective de l'autorité backend et actualisation de la navigation; ne jamais tirer autorité d'un `market_id` client.
3. **Capacités V1** : établir une liste serveur déclarative d'actions métier LIVE requises par le responsable (commerciales et opérationnelles du marché), croisée avec le registre et le ceiling du marché. Ne jamais inclure `CENTRAL_ONLY`, autorité Admin, opérations physiques Hub/Relais, step-up financier ou mouvement de fonds réservé. Ne pas élargir aveuglément le ceiling. Si un droit nécessaire n'est pas disponible, remonter une erreur explicite et un écart de recette au lieu de prétendre que tout fonctionne.
4. **UI** : Admin > Utilisateurs, profil et multi-sélection des marchés; afficher les affectations, connexion et choix de marché, sans matrice technique. Éviter les messages de capacités au quotidien.
5. **Certification** : compte réel KM, ajout CM, suppression KM, accès CG refusé; route par route, GET et mutation, deep links, altération de paramètre marché, 1440/390 Chromium, SHA /health/version; journaux audit vérifiables. Aucun GO de sécurité/finance sans tests séparés.

## Ordre de livraison

- L1 — contrat backend + tests atomiques et non-régression d'isolation.
- L2 — UI Admin création/édition/affectation simple.
- L3 — audit routes métiers réellement accessibles, résolution des trous de permissions strictement nécessaires.
- L4 — certification Chromium avec profil réel / matrice écrans × API × marchés × résultats.

## Interdits

Pas de rôle Admin global pour résoudre un 403. Pas de permissions non bornées, pas de bypass des plafonds, pas de mélange avec #3303, pas de GO basé seulement sur des écrans qui s'ouvrent.


## État d'implémentation au 03/11/2026 (non certifié)

- APIs de provisioning et promotion multi-marchés ajoutées sous garde Admin + autorité globale.
- Interface Utilisateurs reliée aux routes d'affectation et à la création par invitation; aucune saisie de mot de passe de l'employé.
- Token d'activation chiffré ? **Non** : secret aléatoire, seule son empreinte SHA-256 persiste; il est consommé atomiquement. Ne pas confondre hash et chiffrement.
- Identités invitées marquées `account_activation_required` avant émission et bloquées dans les principales chaînes JWT.
- Réinitialisation : lien personnel, réponses publiques non énumérantes, invalidation des sessions antérieures via `credentials_changed_at`.
- Pages publiques activation/oubli/reset : aucun tiers embarqué, secret extrait du fragment et supprimé de l'historique visible.
- Migrations nécessaires : 367 et 368 **avant** activation de ces routes sur staging.
- CI: `Required verdict` doit être constaté vert sur HEAD de PR après contrôle gouvernance et gates code. E2E navigateur/DB réel non certifiés à cette date.

## Points bloquants pour GO

1. Vérifier l'email transactionnel Brevo et l'URL HTTPS `APP_URL` avec un compte réel de staging et un secret à usage unique.
2. Prouver en PostgreSQL rollback sur erreur du deuxième marché et consommation simultanée du même lien.
3. Exécuter le contrôle inter-marchés KM/CM autorisés contre CG/DJ interdits, sur GET et mutations, et tester retrait/reconnexion.
4. Revoir le plafond et les grants `manager` existants, surtout `finance.act`, `settlement.receive`, `cash.custody.receive`: aucun geste financier sensible ne doit être autorisé sans le contrôle indépendant attendu.
5. Vérifier les paths de session token OTP et magic-link après changement de mot de passe.
