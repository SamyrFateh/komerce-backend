# Komerce business auditor — dossier de contre-expertise critique pour Claude Opus

## Rôle demandé à Opus

Tu es **contre-expert hostile mais constructif** d'un scanner R&D de bugs métier Node.js/PostgreSQL. **Ne valide pas les conclusions sur la foi des tests verts**. Recherche les trous de preuve, faux négatifs, faux positifs, contrats circulaires, dangers de production, cas multi-marchés, et défauts de généralisation. Challenge les mécanismes et propose des changements vérifiables, sans écrire en production et sans normaliser un bug existant comme comportement attendu.

## Contexte et état observé

- Branche V1.0 : `research/business-auditor-v10-executable-bug-hunt-20261028`; PR #3088, campagne initiale verte #40609279619 : 79/79 tests Node.
- Branche extension : `research/business-auditor-v11-multidomain-oracles-20261028`; PR #3089 (draft).
- V0.6 : 843 fragments SQL suspects détectés dans 649 fichiers applicatifs ; 759 liés à 175 tables connues, 84 cibles SQL incertaines. **Les fragments ne sont pas 843 writes exécutés.**
- V0.7 : 421 dossiers de qualification statique, dont 209 à examiner. 36 Feature Cards, 213 tables dans le snapshot SQL. Domain aliases/technical writers déclarés ne prouvent pas l'autorisation d'écriture.
- V0.8 : sept détecteurs SQL testés sur tables PG temporaires (nominal/contre-exemple/rollback) ; cela ne démontre **aucun service métier réel** sur ces sept parcours. Test PayPal réel avec HTTP/DB simulés.
- V0.9 : registre de preuves relié au même SHA/run dans CI, mais les fichiers JSON sont émis par des tests modifiables dans la même PR ; l'authenticité de la preuve est donc **relative à l'intégrité du test et de l'agent CI**.
- V1.0 : premier oracle `KBA-V10-RC9-PAYPAL-RETRY` du service réellement invoqué, mais HTTP et DB simulés. Issue existante #3080. Observation sous deux timeouts contrôlés : `ownerKeysEqual=false`, attendu `true`. Aucun double paiement PSP observé.
- V1.1 : second oracle `KBA-V11-LOGISTICS-PARCEL-COUNT`, réel `services/auto-parcel.distributeOrder` avec réponses SQL simulées. Issue existante #2949. Le verdict porte uniquement sur la cohérence du compteur sous un conflit simulé, pas une véritable concurrence PostgreSQL.
- Aucun merge `main`, aucun appel réel PayPal, aucune écriture staging/prod.

## Fichiers à lire pour la contre-expertise

1. `tools/business-auditor/writer-sql.js`, `writer-inventory.js`, `writer-ownership.js`, `v07-qualification.js`, `v07-import-hints.js` : validité du scan statique, ciblage et autorité.
2. `tools/business-auditor/v08-sql-calibration.js`, `v08-sql-fixtures.js`, `v09-integration.js` : indépendance des preuves et illusions des fixtures.
3. `tools/business-auditor/v10-oracles.js`, `v10-engine.js`, `v10-cli.js` et tests : contrat déclaratif, robustesse du verdict, comportement après fix.
4. `tests/unit/auditor-v10-paypal-owner-probe.test.js`, `tests/unit/auditor-v11-auto-parcel-owner-probe.test.js` : ce qui est réellement exécuté vs mocké.
5. `services/payment-paypal.js`, `services/paypal-client.js`, `services/auto-parcel.js`, `features/refunds.feature.js`, `features/logistics.feature.js` : invariant indépendant du code.
6. `.github/workflows/research-independent-business-auditor.yml` et issues #3080 / #2949 : chaîne CI et preuves préexistantes.

## Questions d'audit prioritaires

1. **Non-circularité :** l'attendu est-il vraiment dérivé d'une règle métier indépendante, et non d'une observation du même code ? Les faits `expectedControls` et l'observation peuvent-ils être falsifiés ensemble ?
2. **Sensibilité mutationnelle :** si on remplace provisoirement `assigned++` par un comptage exact, le même oracle devient-il vert sans ajuster ses assertions ? Si on réintroduit le défaut, revient-il rouge ?
3. **Identité des preuves :** le même SHA/run est vérifié, mais qui atteste l'exécution effective, la provenance du JSON et l'absence de modification du test ? Quelle preuve vérifiable par un second processus serait mieux ?
4. **Chemins réels :** une route qui importe un service n'est pas forcément montée ni accessible ; quel contrôle par AST/exports/route-registration/Playwright et runtime call graph ajouter ?
5. **SQL :** les regex dans `writer-sql.js` manquent-elles requêtes construites, repositories, triggers, procédures, ORM, CTE multi-writes, commentaires SQL, code généré, SQL en migrations ? Quelle solution de parser paramétré ?
6. **Multi-domaines :** comment identifier les délégations valides et les cas d'autorité partagée ? Quelles exceptions économiques par marché, devise, isolation, pricing, cash et remboursements ?
7. **Échantillonnage :** 209 dossiers à examiner ne sont pas 209 bugs ; comment estimer precision@k, taux de faux négatifs, rappel sur corpus de bugs connus, et coûts de triage ?
8. **Concurrence réelle :** comment rejouer `ON CONFLICT DO NOTHING`, idempotence, retries, race conditions sur **vrai PostgreSQL 16 jetable** avec deux connexions et rollback, sans faux positifs de simulation ?
9. **Risque d'effet réel :** qu'est-ce qui empêche un outil ou une fixture de sortir de la DB locale ou d'effectuer un appel PSP réel si un mock manque ? Tester le blocage (egress, creds, guards).
10. **Golden master :** comment séparer `expected`, `observed`, oracle externe et jugement humain, préserver le comportement valide tout en révélant les anomalies existantes ?
11. **Escalade des verdicts :** distinguer `static`, `mocked owner`, `real local PG owner`, `multi-session PG`, `real sandbox PSP`, `production incident` ; éviter toute promotion automatique.
12. **Généralisation :** qu'est-ce qui permet de passer de 2 oracles connus à 20 puis 100 sans hardcoder dans CI les chemins et les comptes exacts ?

## Expériences adversariales à exiger

- Cas témoin qui répare le bug sans changer le test d'oracle ; le scanner annonce `SATISFIED`.
- Contre-cas où le code est toujours incorrect mais le test ou le champ d'observation est falsifié ; le scanner doit rejeter les preuves incohérentes.
- Vraie concurrence PostgreSQL (deux connexions) dans un schéma jetable, avec identité de la ligne et `RETURNING/rowCount`, comparaison retour service ↔ état physique.
- Charge de fausses alertes : classes SQL dynamiques/syntaxe innocente, import mort, writers délégués et tables absentes du snapshot.
- Tests ciblés marchés KM/CM/CG/DJ/YT, paiements `cash_relais`/`stripe_eur`, devises et isolation, sans secrets.

## Format de réponse demandé à Opus

Produis **1) contradictions et erreurs prouvables, 2) failles de sécurité/preuve P0/P1, 3) faux positifs/négatifs attendus, 4) plan d'expériences concrètes, 5) patchs minimaux proposés, 6) matrice d'acceptation V1.1/V1.2**, avec pour chaque affirmation chemin/ligne, scénario de reproduction, attendu/observé et degré de confiance. Sépare clairement les erreurs confirmées des hypothèses, et **n'annonce pas un bug sans reproduction**. Critique aussi le présent dossier : un review brief ne garantit pas l'indépendance de l'examinateur.
