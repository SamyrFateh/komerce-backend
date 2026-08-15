# LEDGER — état de clôture Komerce

Mis à jour : 2026-08-14

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

## Certification finale — gouvernance et tests, 2026-07-28

- Unités racine : toutes vertes avec couverture et périmètre explicite `tests/unit`.
- Intégration : 31/31 suites vertes avec PostgreSQL 16 et bootstrap CI canonique.
- Boutique et Dashboards : gates et couvertures verts.
- Projections 360, dispositions O6, invariants, sécurité, Feature 360 et `map:check` : verts.
- Preuve complète : GitHub Actions run `30349485657`.
- Audit npm : advisory réel dédupliqué ; exception dev-only `brace-expansion` expirant le 2026-08-15.
- Les anciens nombres « 13 tests/suites cassés » ne décrivent plus l’état courant.
- Les workflows de diagnostic, prompts, patches, archives de travail et marqueurs temporaires ont été retirés.

## Documents clients privés — 2026-08-14

- Le manifeste `documents` possède désormais le cycle complet des factures et documents transactionnels.
- Les PDF sont générés côté serveur, stockés avec `owner_user_id`, nom, version et SHA-256, puis servis avec contrôle d'identité et réponse `404` en cas d'IDOR.
- `Mon Komerce` donne la priorité aux factures et remboursements ; le wallet y est réduit au solde et à l'échéance, sans historique.
- L'onglet Commandes rattache à chaque commande authentifiée ses seules factures et remboursements disponibles, avec téléchargement privé, puis le solde wallet s'il est positif.
- La recherche publique par référence n'expose jamais ces ressources privées et l'API client ne fournit un lien que pour un PDF déjà disponible.
- Les routes publiques de facture et la notification WhatsApp de facture ont été retirées ; WhatsApp ne transporte ni document ni lien de document.
- Le paiement confirmé crée l'instantané de facture dans la transaction, y compris wallet et liste partagée ; les reprises restent idempotentes.
- Tests ciblés documents, paiements et boutique : verts. Suite unitaire globale : 349 suites vertes sur 352 exécutées ; trois échecs de baseline hors périmètre (ordre du modal mobile, date locale pickup, générateur sécurité sans environnement complet).

## Décision UX notifications métier — 2026-08-14

- Une notification essentielle est un petit bandeau actionnable qui reste visible jusqu'à acquittement, pas un fil bavard.
- Après acquittement, la vérité reste dans l'onglet métier concerné, notamment Commandes.
- Le statut « colis prêt au relais » peut recevoir un signal visuel fort et temporaire ; le clignotement est réservé à cette urgence actionnable pour éviter le spam perceptif.
- Le cycle client couvre trois jalons idempotents : `preparation`, `shipped` et `available`. Un jalon plus récent remplace l'ancien ; `in_transit` ne crée pas de quatrième message.
- Le contrat `order.exception.*` est disponible pour les seuls événements exceptionnels actionnables ; aucun faux déclencheur générique n'est inventé.
- Le bandeau reste compact, renvoie vers Commandes, exige un acquittement propriétaire et se résout au retrait/annulation/remboursement.
- Une lecture authentifiée réconcilie toute émission manquée depuis la vérité commande ; aucune panne de notification ne bloque une transition terrain.
- La commande disponible reste mise en évidence jusqu'au retrait, indépendamment de l'acquittement ; `prefers-reduced-motion` supprime l'animation.
- Le chargement sans session reste silencieux et ne déclenche jamais l'OTP.
- Aucun envoi WhatsApp métier n'est réintroduit.
- Les nouvelles factures utilisent le HTML canonique avec le vrai logo Komerce et la version `2026-08-html-logo-v2` ; les PDF déjà émis restent immuables.
