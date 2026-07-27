# LEDGER — état de clôture Komerce

Mis à jour : 2026-07-28

## Source de vérité opérationnelle

- Branche unique : `main`.
- Parcours : `AGENTS.md` → `docs/CARTE_FIRST_INDEX.md` → carte de feature → présent ledger.
- Aucun ancien fichier de tâche, state, worklog, lane, prompt ou preuve brute ne peut rouvrir un travail.

## Paliers acquis

- **P0-A** : clos ; rapport conservé dans `paliers/`.
- **P1** : cinq invariants exécutables acquis.
- **P2** : 25/25 gates applicables couverts par un test de détection, plus une exclusion documentée.
- **P3** : split réalisé ; le manifeste transversal `boutique` ne possède plus de source active et reste à 15 arêtes de compatibilité.
- **P3b** : clos ; 18/18 sources de gates attribuables, 0 source en échec, projection sur 28/28 features et contrat rendu bloquant.
- **O6** : inventaire classifié sans paire `UNCLASSIFIED` ; 7 décisions étroites enregistrées dans le ledger d'exceptions :
  - 3 imports directs observés et acceptés, 0 import direct non arbitré ;
  - 2 cycles topologiques expliqués direction par direction, sans masquer les coutures brutes ;
  - 0 exception stale, dupliquée, vide ou illégitime au run de clôture.
- **P5-N1/N2/N3** : clos sur le périmètre contesté :
  - matrice `payment_status` centralisée, `paid → refunded` seul remboursement autorisé ;
  - émission, rotation et consommation QR centralisées et atomiques ;
  - `total_kmf` reste facial et immuable ;
  - duplicate wallet sans réécriture de `wallet_applied_kmf` ni appel à `markPaid()` ;
  - test du scénario application partielle puis second `/wallet/apply` présent.

## P3b `gateHealth` — CLOS

Mesure de clôture :

- 18 sources configurées ;
- 18 sources attribuables ;
- 0 source en échec ;
- couverture vérifiée avant interprétation des violations ;
- `gateHealth` présent sur 28/28 features ;
- 43 findings projetés et attribués ;
- 0 finding non attribué ;
- 0 fichier non projetable ;
- 0 double projection ;
- 0 feature `gateHealth` bloquée ;
- messages détaillés conservés ;
- tests négatifs et seuil `MIN_GATE_SOURCES = 18` exécutables dans `feature:360:check`.

Preuve d'exécution :

```text
GitHub Actions run : 30312357239
Commit vérifié    : ad6addfa3bdfa06edfb7db8e4e362e8272c6ea7f
Résultat           : tests ciblés, feature:360:check et map:check verts
```

Rapport : `.agent/paliers/P3b-rapport.md`.

## Nettoyage dépôt

Clos pour le périmètre indiscutable :

- ancien runtime `.agent` supprimé ;
- tâches, states, worklogs, handoffs, lanes, prompts, preuves brutes, livraisons et sources PDP retirés ;
- coverage versionné retiré ;
- ancien prompt racine pré-golive retiré ;
- `.gitignore` empêche leur réintroduction ;
- `.agent` ne conserve que `README.md`, `LEDGER.md` et `paliers/` ;
- finaliseur P3b one-shot supprimé après son run vert ;
- job temporaire `p3b-closure` retiré de `carte-first.yml` ;
- workflow Carte First remis en permissions de lecture seule.

## Verdict global du périmètre traité

- **P3b : CLOS.**
- **P5 : CLOS.**
- **Nettoyage runtime : CLOS.**
- Les dettes et attentions encore projetées restent visibles dans Feature 360 et O6 ; elles ne sont pas transformées en faux vert.
- Ce ledger ne déclare pas P6, P7 ou P8 ouverts ou clos : ces paliers restent hors du chantier terminé ici.
