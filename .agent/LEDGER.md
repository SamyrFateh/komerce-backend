# LEDGER — chantier actif Komerce

Mis à jour : 2026-07-27

Ce fichier contient uniquement l'état courant utile à l'exécution. L'historique détaillé appartient à Git et aux rapports canoniques.

## Source de vérité opérationnelle

- Branche unique : `main`.
- Parcours : `AGENTS.md` → `docs/CARTE_FIRST_INDEX.md` → carte de feature → présent ledger.
- Ne jamais choisir une action depuis un ancien fichier `T-*`, state, worklog, lane, audit ou preuve brute.

## Paliers déjà acquis — ne pas refaire

- **P0-A** : clos, rapport présent dans `.agent/paliers/P0-A-rapport.md`.
- **P1** : cinq invariants exécutables livrés ; rapport de clôture à consolider, aucun ré-audit général.
- **P2** : 25/25 gates applicables couverts par un test de détection, plus une exclusion documentée ; ne pas rouvrir les anciens lots.
- **P3** : split de `boutique.feature.js` réalisé partiellement ; conserver les ownerships livrés.
- **O6** : `shared-cart → catalog` accepté en lecture seule avec scope et `reviewTrigger` ; ne pas créer de contrat supplémentaire maintenant.
- **P5-N1** : contrôle des écrivains des colonnes contestées livré.
- **P5-N3** : une primitive `db.withTransaction`, aucune implémentation transactionnelle indépendante ; façades de compatibilité admises.

## Chantier actif A — P3b `gateHealth`

Objectif : terminer le livrable explicitement prévu par l'audit, sans inventer de nouveaux gates.

À faire :

- projeter les constats des gates existants vers les fichiers puis les features ;
- conserver les messages précis des gates ; agréger uniquement les verdicts ;
- viser le contrat documenté : au moins 18/24 gates attribuables, 0 fichier non projetable, 0 double attribution, `gateHealth` sur 28/28 features ;
- corriger `propriétaire: undefined` dans le rendu bus ;
- ajouter les tests négatifs de projection et de propriété.

Hors périmètre : modifier les règles métier des gates, inventer un score opaque ou ouvrir P6/P7/P8.

## Chantier actif B — P5 à fermer

### Payment status

- autoriser `paid → refunded` ;
- bloquer `pending → refunded` et `failed → refunded` ;
- préserver les no-op idempotents sans rejouer les effets de bord.

### QR de retrait

- centraliser l'émission et la rotation dans le service propriétaire ;
- laisser la route comme adaptateur HTTP ;
- supprimer le générateur tracking mort utilisant `orders.qr_token` ;
- conserver consommation, transition `available → collected` et effacement dans une opération atomique.

### Wallet

- reproduire le cas création partielle puis second `/wallet/apply` avec la même clé `checkout_<orderId>` ;
- empêcher qu'un `duplicate:true` réécrive `wallet_applied_kmf` ou marque la commande payée sans nouveau débit ;
- doctrine de clôture : une application wallet par commande, sauf futur contrat explicite de top-up avec identifiant d'événement distinct.

## Chantier actif C — réconciliation documentaire

Créer ou mettre à jour les rapports canoniques P1, P2, P3, P3b, P5 et O6.

Métriques à employer :

- invariants exécutables : 5 ;
- gates de détection : 25/25 applicables + 1 exclusion ;
- imports cross-feature observés : 1 ;
- imports cross-feature non acceptés : 0 ;
- features bloquées après O6 : 0.

## Chantier actif D — nettoyage dépôt

Phase 1 en cours : supprimer les anciennes instructions PDP et neutraliser les faux signaux de branche/tâche.

Phase 2 :

- supprimer `tasks/`, `state/`, `worklogs/`, `handoffs/`, `lanes/`, anciens prompts et preuves brutes lorsqu'aucune référence active ne subsiste ;
- supprimer les scripts d'orchestration agent devenus orphelins ;
- inventorier les documents de racine et `docs/chantier/` ; fusionner, archiver ou supprimer les doublons ;
- vérifier l'absence de `.patch`, ZIP, coverage versionné et sorties temporaires inutiles ;
- ne garder sous `.agent/` que `README.md`, `LEDGER.md` et les rapports de paliers encore canoniques.

## Définition de terminé

- `gateHealth` est reproductible et projeté sur 28/28 features ;
- P5 payment, QR et wallet possèdent leurs tests d'invariant ;
- les fichiers mojibake du split P3 sont réparés sans changement fonctionnel ;
- les rapports décrivent le code courant ;
- l'ancien runtime `.agent` n'influence plus aucun agent ;
- `node scripts/map-check.js`, les gates ciblés et les suites concernées sont verts.
