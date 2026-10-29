# Business auditor V2.4 — contrat de contre-expertise indépendante

**Statut : démonstrateur de recherche, pas un correctif de production.** L'issue de référence est #3106. Les propriétaires réels `processRefund` (annulation / wallet) et `refundPaypalOrder` (PayPal) restent inchangés. Les adaptateurs `v24-*` existent uniquement sous `tools/business-auditor/`, sur des bases PostgreSQL `kba_*` clonées et détruites dans GitHub Actions.

## Hypothèse vérifiable

Une réservation économique **persistée et exclusive par commande** peut empêcher les deux propriétaires de rembourser chacun le montant total. La réservation PayPal est `COMMIT` **avant** l'appel au PSP et porte la clé `PayPal-Request-Id` stable. L'annulation écrit sa réservation **dans sa propre transaction**, avant de créditer le wallet. Un conflit empêche le propriétaire perdant de produire un effet externe.

Ce prototype ne couvre que les **remboursements complets**. La réservation par commande (une seule opération au total) serait trop grossière pour les remboursements partiels et n'est pas une spécification finale du registre de production.

## Oracle indépendant (inchangé)

`v22-financial-invariants.js` ne doit PAS être modifié pour faire passer V2.4. Il compare les événements PSP, crédits wallet et lignes `refunds` à la capture et au snapshot d'origine :
- **I1** : sorties économiques cumulées <= capturé ;
- **I2** : chaque remboursement PSP a une ligne traçable du bon montant et de la bonne méthode ;
- **I3** : pas de succès d'un propriétaire si le PSP a remboursé sans inscription au registre.

La CI doit d'abord **reproduire le défaut sur le code d'origine** en AB/AB_REPEAT/PAR, puis exécuter le contre-factuel sur quatre clones séparés. AB et AB_REPEAT doivent finir en wallet seul. BA et PAR doivent finir en PayPal seul, clé d'idempotence du PSP = clé persistée. Tous les scénarios doivent satisfaire I1, I2 et I3. Une cinquième épreuve falsifie une deuxième sortie PSP dans la trace observée : l'oracle doit déclencher I1 et I2.

## Conditions NON démontrées

1. **Crash / timeout PSP** : l'intention peut rester `reserved` ou `reconciliation_required`. Ne jamais la considérer comme remboursée, libérée ou définitivement échouée sans preuve externe.
2. **Idempotence après crash / reprise multi-processus** : un simple appel répété à une clé stable ne suffit pas sans rapprochement PayPal par ID, montant, devise et capture.
3. **Tous les autres propriétaires** : annulations admin, Stripe, reprises wallet, partiels, remboursements commerciaux, shared-cart, et éventuelles tâches asynchrones doivent respecter la même autorité financière.
4. **Autorisation HTTP** : les handlers sont appelés directement ; middleware d'authentification, validation, appartenance marché et accessibilité publique ne sont pas éprouvés.
5. **Propriétés économiques** : annulation payée localement vs PSP, remboursements partiels successifs, remboursements EUR/KMF à taux figé, chargebacks et reversements doivent être arbitrés.
6. **Échec lors de l'enregistrement après PSP** : le prototype marque `reconciliation_required` et refuse de prétendre au succès ; il ne répare pas encore automatiquement l'écriture comptable.
7. **Exécution asynchrone** : la réservation et l'envoi PSP ne constituent pas une architecture outbox certifiée. Le worker idempotent, les délais et les reprises restent à concevoir.

## Gates d'acceptation V2.5 à soumettre à Opus

Conserver les invariants hors du service, injecter crash avant PSP / après effet PSP / avant écriture `refunds` / après écriture, pertes de réponse et retries avec la même clé. Rejouer deux workers simultanés, tester les interventions manuelles concurrentes, et exiger conservation de l'argent, absence de duplication PSP, preuve par événement et restitution compréhensible à l'opérateur. N'autoriser aucune promotion vers `main` sans preuve sur les frontières HTTP et sur chaque propriétaire de remboursement.

**Doctrine :** un scénario séquentiel devenu vert, un verrou ou une transaction sérialisable ne démontre pas à eux seuls la correction économique. Le scanner doit rester capable de réfuter le correctif proposé.
