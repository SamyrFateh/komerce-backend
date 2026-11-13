# Brief Fable : audit à charge des flux d'argent Komerce

**Mode ÉCO « super héros »** : rigueur maximale et tokens minimum. Lis seulement le code qui porte la preuve (`git grep`, puis lecture ciblée par plage de lignes), jamais un fichier entier par réflexe. Pas de reformulation de ce brief ni de narration : seulement des constats prouvés, triés et actionnables. Arrête-toi dès que le rendu est complet.

**Mode** : lecture seule. Aucun test, aucun workflow, aucune modification de code ni écriture sur le staging. Toute affirmation est prouvée par `fichier:ligne` sur `main` ou par une preuve en base (lecture seule).

## Contexte
- Komerce est une plateforme e-commerce multi-marchés : KM (KMF), CM et CG (XAF). Dépôt `SamyrFateh/komerce-backend` (Node.js/Express, PostgreSQL).
- Parcours : client → achat fournisseur (CJ, AliExpress, Fournisseur central Hub manuel) → Hub → transitaire et douane → relais → remise au client par code → SAV.
- Doctrines à lire d'abord, dans `docs/doctrine/` :
  - `DOCTRINE_ANNULATION` (paliers F1, F2, F3) ;
  - `DOCTRINE_NON_CONFORMITE` (compensation) ;
  - `DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE` ;
  - les doctrines cash custody et monétaire : EUR pivot, `currency_parities` comme autorité FX unique, `*_kmf` comme base technique.
- Décisions du propriétaire : issue #3927, commentaires 6828953843 (A1 à A8, A2-bis, A2-ter) et suivants. Matrice des scénarios : PR #3944.

## Mission
Chercher **toutes les façons de créer, perdre, doubler, bloquer ou détourner de l'argent**, y compris par des gestes légitimes enchaînés dans un ordre inattendu, rejoués, concurrents ou interrompus (timeout, coupure réseau, double clic, webhook rejoué, redéploiement en cours de geste).

## Périmètre (writers et lecteurs)
1. **Encaissement**
   - Cash au relais et chaîne de garde (`execution.cash.confirm`, `cash_collections`, remises de garde, clôture).
   - Mobile money (MTN CG), Stripe, PayPal : webhooks, signatures, idempotence, confirmation de paiement.
2. **Commande** : idempotence de `POST /api/orders` (`Idempotency-Key`, migration 408), prix confirmé (`expected_total_kmf`, `price_changed`), réservation de stock local (pool par marché).
3. **Wallet multi-devise** (W1, migration 405) : crédit, débit, application à une commande XAF via `fx-authority`, retrait, annulation, arrondis, conversions croisées, soldes négatifs.
4. **Remboursements et avoirs** : annulation F1, F2 et F3 ; remboursement par ligne (`refund-intent-ledger`, `item-refund-psp-orchestrator`) ; avoir partiel (L4) ; remboursement « vers le payeur » ; plafonds `quantity − collected`.
5. **SAV après remise** (L6, migrations 406 et 409) : décision de compensation (wallet, remboursement via le ledger, ré-expédition), double compensation, compensation sans retour physique.
6. **Achats fournisseurs** :
   - deux autorisations (engagement, paiement) ;
   - vendeur réel et achats manuels (`manual_purchase_executions`, L5) ;
   - décision d'écart (migration 407) ;
   - plafonds cumulés, devise de la PO contre devise client ;
   - paiement au-delà du justifié ;
   - annulation client après engagement.
7. **Documents financiers** : facture, avoir, reçu wallet, preuve de retrait. Ils doivent être émis seulement sur un fait confirmé, sans doublon ni manque. Vérifier aussi la réémission (`document-reconciliation`).
8. **Moteur économique** : uniquement là où il fixe un montant encaissé ou remboursé (snapshots de prix et de FX à la commande).

## Méthode attendue
- Pour chaque flux : inventaire des writers, de leurs transactions et verrous, puis des invariants attendus (somme encaissée = somme due ; remboursé + compensé ≤ encaissé ; un mouvement par événement ; devise conservée…). Cherche ensuite les chemins qui les violent.
- Croise les flux, car c'est là que se cachent les bugs : annulation pendant une remise, remboursement de ligne puis SAV sur la même ligne, wallet appliqué puis commande annulée en XAF, PO payée puis client remboursé, etc.
- Concurrence : deux requêtes simultanées, un rejeu après commit, un webhook en double ou désordonné.
- Pour chaque constat, distingue **prouvé** (chemin de code complet) et **plausible** (hypothèse à vérifier en base ou en test). Donne un scénario de reproduction en étapes métier.

## Rendu
Publie dans une **nouvelle issue** « Audit Fable : flux d'argent ».
- Un tableau des constats : `ID | Flux | Scénario | Impact € | Prouvé ou plausible | Preuve (fichier:ligne) | Correctif minimal proposé | Scénario de la matrice #3944 concerné ou à créer`.
- Trié par gravité : perte ou création d'argent, puis blocage de fonds, puis incohérence documentaire, puis confort.
- À la fin : les invariants à surveiller pendant les E2E et le stress, sous forme de requêtes SQL en lecture seule, ainsi que les ambiguïtés de doctrine à faire trancher par le propriétaire.

Ne propose aucune nouvelle doctrine. Ne corrige rien. Mode économe : va droit au code concerné.
