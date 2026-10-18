# Golden Lot 1D — Parcours de reversement cash à chaîne de garde dynamique

Statut : **doctrine proposée pour revue**. Aucun code métier, migration, mouvement de caisse ou preuve Golden n'est livré par ce document.

## Objectif
Relier sans ambiguïté chaque encaissement client `cash_collections` à la part effectivement reçue en destination finale, à travers zéro, un ou plusieurs transferts intermédiaires. La clôture financière d'une commande cash n'est autorisée que pour la part intégralement attribuée à une réception finale contrôlée.

## Principe cardinal
**Ne jamais configurer un nombre fixe de personnes.** Le circuit est une suite de responsabilités et de transferts de garde. Les règles d'habilitation et de séparation des tâches sont configurées par marché, sans affaiblir les contrôles centraux. Le nombre de détenteurs peut varier selon le marché, le montant, la disponibilité et le trajet effectif.

Exemples de scénarios à certifier :
- **Direct** : agent relais → récepteur final habilité.
- **Intermédiaire** : agent relais → collecteur → récepteur final habilité.
- **Étendu** : agent relais → collecteur A → collecteur B → récepteur final habilité.
- **Branches** : remise partielle à deux destinataires distincts, puis consolidation en réception finale.

## États et actions
1. **Encaissement** : une collection est enregistrée et liée à une commande, un détenteur et un montant immuable.
2. **Déclaration de remise** : intention uniquement ; aucun changement de détenteur ni du solde.
3. **Acceptation de transfert** : le destinataire habilité accepte tout ou partie ; seule la part acceptée change de détenteur.
4. **Refus** : la garde demeure chez le détenteur courant ; une nouvelle remise peut être proposée.
5. **Réception finale** : acceptation contrôlée par un acteur habilité distinct du remettant, avec preuve exigée.
6. **Rapprochement** : attribution de la part reçue à ses collections d'origine, sans double consommation.
7. **Clôture** : uniquement si la somme attribuée à des réceptions finales validées couvre la collection exigible de la commande, sans écart ni incident bloquant.

## Contraintes de preuve et de sécurité
- `cash_custody_movements` reste la source d'autorité des mouvements de garde ; `cash_custody_receipts` matérialise les réceptions. Ne pas créer un second solde concurrent.
- L'attribution par collection doit être **persistante, transactionnelle, auditée et traçable** (collection → mouvements acceptés → réception finale), y compris après scission et regroupement.
- Invariant de conservation : pour chaque collection, montant attribué en garde + montant final reçu + perte reconnue = montant encaissé ; aucune portion ne peut être consommée deux fois.
- Une perte reconnue ne vaut **jamais** preuve de reversement final. Une déclaration, une remise en attente ou une preuve jointe non acceptée non plus.
- La somme finale attribuée à une collection ne peut dépasser son encaissement ; les montants négatifs et les réceptions hors marché sont rejetés.
- Les devises et conversions suivent les montants KMF canoniques figés au moment des événements, sans réévaluer rétroactivement les collections.
- Habilitations par marché, contrôle central non contournable, séparation remettant/récepteur final ; le circuit direct à deux acteurs reste possible.
- Idempotence des acceptations, replays et rapprochements ; concurrence et transactions atomiques pour empêcher la double attribution.
- Aucun `FINANCIAL_CLOSE_MATCHED` sur simple couverture globale d'un détenteur : preuve attribuable **à la commande** requise.

## Articulation avec les autres lots
- **Golden 1A/1B/1C** : ne pas modifier leurs invariants ; 1C reste bloquant tant que l'attribution finale n'est pas prouvée.
- **Sonnet S7a (#2644)** : allocation des coûts de colis groupés par commande propriétaire des lignes ; **hors périmètre** de la chaîne de garde cash. Aucune réécriture de `allocate.js`, `transport-cost-allocation.js` ou `variance.js`.
- Réutiliser les espaces métiers et services existants ; pas de nouveau dashboard isolé ni de double ledger.

## Séquencement d'implémentation proposé
1. **1D-A — Audit lecture seule** : inventorier clés et contraintes réelles des tables `cash_collections`, `cash_deposits`, `cash_custody_receipts`, `cash_custody_movements`, identifier les jointures disponibles, les trous de traçabilité et les règles d'habilitation.
2. **1D-B — Modèle de provenance** : concevoir les allocations par collection et par portion avec contraintes SQL de conservation, idempotence, verrouillage, annulation et audit. Migration additive uniquement après revue.
3. **1D-C — Parcours opérationnel** : accepter les transferts directs, multi-sauts, partiels, refus et réceptions finales dans les surfaces existantes.
4. **1D-D — Golden & clôture** : lever le blocage conservateur 1C uniquement quand une preuve de réception finale entièrement attribuable existe ; tester cas directs, multi-acteurs, pertes, écarts, rejeux et concurrence.

## Critères de GO
- Tests unitaires, intégration DB jetable, E2E API et parcours humain pour 2, 3 et 4+ acteurs.
- Aucune clôture cash sur déclaration, transfert seul, perte ou réception finale non attribuable.
- Aucune régression des contrôles de séparation des tâches et plafonds centraux.
- Aucun RESET, purge, paiement réel, ni écriture sur staging pour la conception ou l'audit.
