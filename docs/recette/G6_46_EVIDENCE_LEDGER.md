# G6 — Registre des preuves des 46 scénarios (23/11/2026)

**Statut : réconciliation partielle, pas de GO 46/46.** La matrice métier demeure `docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json`. Le fichier [G6_46_EVIDENCE_LEDGER.json](G6_46_EVIDENCE_LEDGER.json) est **un index de runs contrôlés**, pas une deuxième matrice métier ni une autorité de certification.

## Doctrine de rapprochement
1. `DISPATCH_WIRED` = titre reconnu par le workflow ; ne démontre aucun geste. `PREREQ_READY` = identité SHA/PG et fixtures validées ; ne démontre aucune exécution métier. `CHROMIUM_PG_PASS` = résultat réel **dans le périmètre déclaré**.
2. Un run GitHub Actions `success` peut démontrer une seule branche, un refus de sécurité ou une répétition avec opérateurs synthétiques. Son statut ne vaut pas PASS de toutes les assertions du scénario, ni sur les autres marchés.
3. **M06** : la répétition sur staging réel #45164789641 réussit achat manuel **simulé** (deux vendeurs `NOT_REAL`, trois unités), COMBOX, transport simulé, réception, code unique et écran SAV read-only. Elle ne certifie aucun achat fournisseur, justificatif, paiement, transport ou mouvement physique réel. `docs/recette/scenarios/M06.json` reste `NOT_BOUND` pour la porte opérateur officielle ; ne pas masquer ce constat.
4. **N34** : KM #45026793593 atteste les invariants de provenance et immuabilité. CM #45026946449 et CG #45027071797 sont des **smokes d'invariants globaux sur une fixture KM**, jamais des imports marchands propres à CM ou CG.
5. **N26** exige `N26a` **et** `N26b`; **N39** exige `N39F1/F2/F3`. N03 et N05 ont des branches `ROUTE` et `SOI`. Une branche manquante n'est pas PASS.
6. Une cellule sans preuve enregistrée signifie **`NOT_YET_RECONCILED`**, et non « jamais jouée », « FAILED » ou « PASS ». Chercher le rapport enfant (JSON), l'artefact, SHA, empreinte PG, rôle, marché, et le refus ou la mutation réellement vérifiés. Contrôler aussi les oracles financiers, documents, notifications et dashboards pertinents.
7. **Aucune altération automatique des 46 verdicts métier**, ni de `binding_status`, ni fermeture automatique de #4550/#5042. Faire confirmer les décisions de portée et de production séparément.

## Provenance et étapes suivantes
- Registre issu des runs explicitement recoupés avec GitHub Actions et commentaires d'issues #4506, #5088, #5180, #5123, #5054, #5122, #5117, #5089.
- Compléter d'abord les preuves pour M01/M02/M04/M05 et les familles N déjà jouées, en liant le **run exact** et les assertions. Les vieux tableaux datés 21/11 ne doivent pas être utilisés comme statuts live.
- Priorité P0 ensuite : N26a/b, N27, N39F1/F2/F3, N40 ; vérifier N10/N31/N35/N38, N30 (arbitrage) et cohérence multi-dashboard #4975.
- Séquencer un seul run propriétaire par fois, zéro fusion pendant l'exécution, staging SHA/PG vérifiés, commandes fraîches, pas de SQL writer ni PSP/fournisseur/transport réel. La revue complète de #5042 fait office de handoff.

## Fichiers et CI
- Données : `docs/recette/G6_46_EVIDENCE_LEDGER.json`.
- Contrat de non-promotion : `tests/unit/g6-46-evidence-ledger.test.js`.
