# Brief Fable : conception du stress test Komerce (avant exécution)

**Mode ÉCO « super héros »** : rigueur maximale et tokens minimum. Lis seulement le code qui porte la preuve (`git grep`, puis lecture ciblée par plage de lignes), jamais un fichier entier par réflexe. Pas de reformulation de ce brief ni de narration : seulement des constats prouvés, triés et actionnables. Arrête-toi dès que le rendu est complet.

**Mode** : conception seulement. Aucun test, aucun workflow, aucune écriture sur le staging. Le stress sera lancé plus tard, après les E2E G6 et la recette humaine (#3754), et seulement avec le GO du propriétaire.

## Contexte
- **Plateforme multi-marchés** : KM, CM et CG (puis DJ). Catalogue public par pays (`/KM`, `/CM`, `/CG`).
- **Parcours** : client → achat fournisseur multi-sources (CJ, AliExpress, Fournisseur central Hub) → Hub → transitaire et douane → relais → remise par code → SAV.
- **Staging** : un seul service Railway (`komerce-backend-production`, qui est en réalité le staging) et une base PostgreSQL partagée. Deux campagnes E2E indépendantes y tournent : cohortes GPT-G6 et CLAUDE-PAR (matrice #3944, issue #3927).
- **Contraintes connues** :
  - plafond catalogue de 120 produits actifs ;
  - les fusions redéploient le service ;
  - notifications externes coupées hors allowlist (AuthKey, Meta) ;
  - cash au relais, mobile money MTN CG, Stripe et PayPal en mode test ;
  - agents terrain sur téléphone, avec un réseau instable.

## Mission
Concevoir un plan de stress **qui mesure la justesse métier sous charge, pas seulement les temps de réponse**.
1. **Profils de charge réalistes par marché** : nombre de clients, de commandes par heure et de colis ; pics (jour de marché, fin de mois) ; répartition import / stock local, cash / mobile money / carte, retours et SAV. Base-toi sur les ordres de grandeur d'une ouverture réelle en KM puis en CM et CG, en indiquant tes hypothèses.
2. **Scénarios de stress** :
   - montée en charge progressive ;
   - pic soudain ;
   - endurance de plusieurs heures ;
   - concurrence ciblée : même produit à stock local limité, même code de retrait, même PO, même wallet ;
   - pannes : redéploiement pendant la charge, coupure de la base, webhooks PSP rejoués ou désordonnés, réseau mobile lent ou coupé côté agents.
3. **Invariants à surveiller pendant le stress**, sous forme de **requêtes SQL en lecture seule** à exécuter périodiquement. Exemples : stock jamais négatif ; une commande par clé d'idempotence ; encaissé = dû ; remboursé + compensé ≤ encaissé ; un seul retrait par colis ; un document par événement confirmé ; aucun solde wallet négatif ; devises cohérentes. Pour chacun, donne le seuil d'alerte et l'action à prendre.
4. **Outillage** : outil de charge, pilotage de Chromium pour une petite part de parcours réels, génération de données de test isolées avec un marqueur, isolation des cohortes GPT et Opus, nettoyage après campagne (sans purge non autorisée), et coût Railway estimé (plan Pro, 20 $/mois de crédits).
5. **Critères de sortie** : seuils de latence p95 et p99 et d'erreurs par parcours, **zéro violation d'invariant**, comportement sous panne acceptable. Définis ce qui bloque l'ouverture en production.

## Rendu
Publie dans une **nouvelle issue** « Plan de stress Fable » :
- les profils de charge ;
- la matrice des scénarios, avec durée, volume et pannes injectées ;
- le catalogue des invariants SQL ;
- l'outillage et son coût ;
- les critères de sortie ;
- les risques pour le staging partagé, et comment les éviter.

S'appuyer sur `fichier:ligne` quand le plan dépend du code (verrous, idempotence, limites de pool de connexions, rate limiting). Mode économe.
