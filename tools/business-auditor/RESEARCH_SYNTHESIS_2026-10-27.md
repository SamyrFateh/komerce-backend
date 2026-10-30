# Komerce Business Auditor — Synthèse R&D consolidée

**Périmètre :** recherche sur `research/golden-continuity-checkpoints-20261026`. Aucun merge `main`, aucun Railway staging/production, aucune API Stripe/PayPal réelle.

## 1. Besoin d'origine et verdict

L'objectif n'est pas de rendre les tests existants toujours verts. Il est de **découvrir des bugs logiques existants** en comparant (1) le code et les écritures métier, (2) les invariants contractuels indépendants, (3) les états réels dans PostgreSQL et (4) le comportement observé sur parcours nominal **et** contre-épreuve, sans réimplémenter une deuxième fois les services métier.

**Verdict : prototype indépendant opérationnel, pas audit exhaustif.** Les 13 frontières P1–P7 déclarées sont lues par des adaptateurs propriétaires ; le moteur séparé `tools/business-auditor/` exécute un scan statique complet, sept SELECT d'intégrité indépendants, deux familles de détecteurs de code et un observateur distinct du chaînage de remboursement PayPal. Il n'est pas encore distribué dans un autre dépôt, dépend de l'analyseur lexical existant et n'a pas scanné les données réelles.

## 2. Preuves de qualité vérifiées

- [CI scanner indépendant #40552611778](https://github.com/SamyrFateh/komerce-backend/actions/runs/40552611778) **verte** : 41/41 tests purs, trois tests Jest PayPal sur le vrai `payment-paypal.refundPaypalOrder` et le vrai `paypal-client.refundCapture` avec `global.fetch` intégralement simulé. Scan code : **1 493 fichiers, 23 suspicions lexicales** ; SQL : **sept règles, aucun signal sur base de test propre**. `KBA-C03` confirme la chaîne route→owner→client historique encore active sans clé durable.
- [Double Golden PostgreSQL #40549201107](https://github.com/SamyrFateh/komerce-backend/actions/runs/40549201107) **vert** : **177/177 tests purs**, deux formes de PO, 13/13 frontières lues sans erreur et comparaison A/B `NO_ASYMMETRY_OBSERVED`.
- Le `rollback` des contre-épreuves est systématique. Aucun environnement réel ni PSP n'a été sollicité. Zéro signal dans une base vierge **ne prouve rien** sur les données Railway réelles.

## 3. Registre des constats — preuve versus interprétation

| Issue | Fait reproduit ou observation | Classe de preuve | Correction / arbitrage |
|---|---|---|---|
| [#2949](https://github.com/SamyrFateh/komerce-backend/issues/2949) | `auto-parcel` annonce 1 article ajouté alors que PostgreSQL retourne `rowCount=0` après une lecture préalable volontairement périmée | **Service réel + PostgreSQL**, concurrence contrôlée, pas deux sessions concurrentes non instrumentées | Corriger compteur au nombre réellement inséré par le propriétaire logistique. Poursuivre sur vérification des résultats API et des retries |
| [#3064](https://github.com/SamyrFateh/komerce-backend/issues/3064) | Allocation de coût `order_item_id` liée à une commande étrangère | **Incohérence persistable en SQL réel** | Contrôle d'appartenance aux commandes + migration conditionnelle |
| [#3065](https://github.com/SamyrFateh/komerce-backend/issues/3065) | Fret/douane attribuable à un colis sans article et hors expédition | **Incohérence persistable en SQL réel** | Contrôles colis/article/expédition, préserver colis partagés |
| [#3068](https://github.com/SamyrFateh/komerce-backend/issues/3068) | Collection cash possible en SQL sur une commande Stripe ; writer ordinaire refuse déjà | **Incohérence persistable en SQL réel** | Auditer historiques, valider intégrité du rail |
| [#3071](https://github.com/SamyrFateh/komerce-backend/issues/3071) | Journal `ACTIVATE` sans `actor_id` accepté en SQL, **sans changement de prix effectif reproduit** | **Incohérence de piste d'audit persistable** | Garde ciblée après revue du modèle de décision humaine |
| [#3072](https://github.com/SamyrFateh/komerce-backend/issues/3072) | Settlement `READY` créé en SQL avec mandat `DRAFT` jamais actif | **Incohérence persistable en SQL réel** | Mandat actif au moment de l'attestation ; ne pas bloquer historiques terminés |
| [#3079](https://github.com/SamyrFateh/komerce-backend/issues/3079) | `wallet-service.credit` déduplique la **même** clé ; des clés `Date.now()` différentes créent deux lignes pour même utilisateur/montant | **Service réel + PostgreSQL** ; rejeu HTTP involontaire **non reproduit** | Contrat de clé stable par acte admin. Deux dons volontaires distincts doivent rester autorisés |
| [#3080](https://github.com/SamyrFateh/komerce-backend/issues/3080) | API refund PayPal active → owner historique sans `providerRequestKey`. Deux tentatives après timeout **simulé** ont deux headers PayPal distincts, alors qu'une clé durable constante fonctionne | **Vrai owner/client + transport HTTP intégralement simulé** ; aucun remboursement PSP réel | Activer progressivement l'intention durable + réconciliation fournisseur avant tout rejeu |
| [#3057](https://github.com/SamyrFateh/komerce-backend/issues/3057) | Hub sur PO historique non soumise versus PO regroupée | **Asymétrie SQL observée**, doctrine métier à arbitrer | Décider quelles opérations historiques peuvent être reçues |
| [#3062](https://github.com/SamyrFateh/komerce-backend/issues/3062) | Handoff accepté avec scan relais différent | **Observation SQL**, transferts légitimes à arbitrer | Vérifier délégation/retrait exceptionnel |
| [#3063](https://github.com/SamyrFateh/komerce-backend/issues/3063) | Clôture financière MATCHED sur Golden Stripe synthétique sans preuve PSP | **Lacune de preuve dans fixture** | Ne pas confondre statut `paid` et encaissement PSP réel ; qualifier sur cas non synthétiques |

**Toutes ces issues étaient ouvertes lors de la vérification du 27/10/2026.** Ce registre ne prouve aucune présence de ces états erronés en production, et ne vaut pas validation d'une correction.

## 4. Couverture effective / ce qui reste non couvert

- **13/13** frontières déclarées sont raccordées, mais un lecteur `EVIDENCE_GAP` est instrumenté et **non certifié**.
- **Sept** SQL détecteurs `KBA-001…007` ont été étalonnés par des insertions/modifications réelles annulées puis exécutés en lecture seule sur une base jetable.
- **23** alertes lexicales de code ont une classification de source et une empreinte Git vérifiée ; **13 candidats d'investigation ciblée** ne sont **pas** treize bugs confirmés.
- Détection code `KBA-C01` des compteurs de colis, `KBA-C02` des identités financières dérivées de l'heure, `KBA-C03` du chaînage effectif de remboursement PayPal.
- Il manque l'inventaire exécutable des centaines d'invariants métier, la détection de tous les writers, la qualification systématique des appels réels et les données existantes ; les faux positifs et exemples intentionnels doivent rester identifiés.
- La V0.x ne peut se connecter qu'à `localhost/komerce_test` en `NODE_ENV=test` et exige une transaction `REPEATABLE READ READ ONLY`. Toute lecture de données réelles demanderait nouvelle politique d'accès et validation explicite.

## 5. Plan de corrections et de maturité

**Priorité A — Réduire les risques financiers :** arbitrer et corriger **les rejouabilités** refund PayPal (#3080) et crédit admin wallet (#3079), sans retirer les gardes déjà présentes. Simuler perte de réponse, multiples remboursements partiels, PSP inconnu/GET-only et retour HTTP ; aucun remboursement réel pendant la recherche.

**Priorité B — Corriger le compteur réellement faux** sous conflit (#2949) puis tester le service historique d'optimisation ; le scanner ne corrige pas les services lui-même.

**Priorité C — Contrats relationnels SQL** : coûts, fret, rail cash/Stripe, historique des mandats, événements de décision de prix ; scanner les données **si autorisé en lecture seule** et choisir les gardes qui préservent exceptions/historiques.

**Priorité D — Étendre le scanner** avec un contrat de règle : identifiant stable, propriétaire, tables/writers, invariants, cas nominal, contre-épreuve SQL, échantillons et limites. Un signal = enquête ; un bug confirmé = preuve indépendante + arbitrage owner. L'audit complet de code doit trouver les **nouveaux** motifs, sans figer les défauts anciens comme normalité.

## 6. Règle de passage vers main

**NO GO à ce stade.** Garder l'outil dans `research/golden-continuity-checkpoints-20261026` ; aucune fusion de la branche R&D entière. Lorsque l'audit aura une couverture explicitement définie, des tests anti-faux-positifs stabilisés, un rapport de sécurité et des critères de performance, extraire sur une branche fraîche issue de `main` et procéder à des PR isolées, après approbation humaine.

## 7. Conclusion

La R&D a **prouvé l'utilité du concept**, pas l'absence de bugs dans Komerce. La combinaison **référentiel métier → vrai propriétaire → nominal → contre-épreuve → lecteur indépendant → rapport et issue** produit des écarts actionnables et sait garder les preuves manquantes en `EVIDENCE_GAP`. L'étape majeure reste de passer d'un registre fini à une couverture progressive, maintenable et indépendante de toutes les écritures métier.
