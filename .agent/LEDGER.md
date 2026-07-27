# LEDGER — état de clôture Komerce

Mis à jour : 2026-07-27

## Source de vérité opérationnelle

- Branche unique : `main`.
- Parcours : `AGENTS.md` → `docs/CARTE_FIRST_INDEX.md` → carte de feature → présent ledger.
- Aucun ancien fichier de tâche, state, worklog, lane, prompt ou preuve brute ne peut rouvrir un travail.

## Paliers acquis

- **P0-A** : clos ; rapport conservé dans `paliers/`.
- **P1** : cinq invariants exécutables acquis.
- **P2** : 25/25 gates applicables couverts par un test de détection, plus une exclusion documentée.
- **P3** : split réalisé ; mojibake du lot ciblé réparé.
- **O6** : dépendance `shared-cart → catalog` acceptée en lecture seule, avec périmètre et déclencheur de revue.
- **P5-N1/N2/N3** : clos sur le périmètre contesté :
  - matrice `payment_status` centralisée, `paid → refunded` seul remboursement autorisé ;
  - émission, rotation et consommation QR centralisées et atomiques ;
  - `total_kmf` reste facial et immuable ;
  - duplicate wallet sans réécriture de `wallet_applied_kmf` ni appel à `markPaid()` ;
  - test du scénario application partielle puis second `/wallet/apply` présent.

## P3b `gateHealth` — PARTIEL, NON CLOS

Livré :

- `gateHealth` existe sur les 28 features ;
- messages détaillés conservés, verdicts agrégés ;
- 13 findings projetés ;
- 0 finding non attribué ;
- 0 fichier non projetable ;
- 0 double projection ;
- tests négatifs de projection présents.

Écart bloquant :

- le contrat d'audit exige au moins **18 gates sur 24** avec sortie attribuable ;
- l'implémentation courante n'en collecte que **3** ;
- la cible ne doit pas être abaissée pour déclarer le palier clos.

Prochaine action unique : rendre au moins 15 gates supplémentaires attribuables ou documenter formellement, gate par gate, les exclusions qui ramènent le dénominateur applicable à une valeur validée architecturalement.

## Nettoyage dépôt

Clos pour le périmètre indiscutable :

- ancien runtime `.agent` supprimé ;
- tâches, states, worklogs, handoffs, lanes, prompts, preuves brutes, livraisons et sources PDP retirés ;
- coverage versionné retiré ;
- ancien prompt racine pré-golive retiré ;
- `.gitignore` empêche leur réintroduction ;
- `.agent` ne conserve que `README.md`, `LEDGER.md` et `paliers/`.

## Verdict global

- **P5 : CLOS.**
- **Nettoyage runtime : CLOS.**
- **P3b : OUVERT**, uniquement pour l'écart de couverture 3/18 minimum.
- Le chantier global ne doit pas être annoncé « 100 % clos » avant résolution de cet écart et exécution verte des gates dans un environnement complet.
