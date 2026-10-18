# Golden 1D-B — Contrat de provenance des espèces

Statut : conception, sans écriture sur staging.

## Réutiliser l'existant

- Migration 287 : `cash_deposit_allocations` relie `deposit_id` et `collection_id`, avec `amount_kmf`, `allocation_basis` (`RECONSTRUCTED` ou `CONFIRMED`) et `allocation_source`. La contrainte interdit une allocation supérieure à la collection ou à la remise. **RECONSTRUCTED n'est pas une preuve finale.**
- Migration 289 : `cash_deposits` est l'autorité des remises `TRANSFER` et `FINAL` ; `cash_custody_receipts` enregistre `RECEIVED`, `CONTROL`, `REFUSED`, `REVERSAL`. `cash_custody_movements` reste l'unique autorité des soldes.
- Lot 1C : le verdict de clôture cash reste conservateur tant qu'une réception finale n'est pas attribuable à la commande.

## Écart à combler

Les allocations de la migration 287 couvrent une remise à partir des encaissements de **l'agent initial**. Elles ne propagent pas, à elles seules, l'identité des portions de collections à travers un transfert à un nouveau détenteur puis une remise finale. Une sortie de responsabilité, une perte, une remise déclarée ou une allocation FIFO reconstruite ne constituent pas une preuve de reversement.

## Contrat cible

1. **Portion** : identifier de manière immuable `collection_id`, `market_id`, `amount_kmf`, événement parent et détenteur courant ; autoriser la scission, sans création de montant.
2. **Transfert accepté** : relier la portion source à une réception `RECEIVED` de `TRANSFER`, et créer la portion reçue chez le destinataire uniquement pour le montant effectivement accepté.
3. **Remise finale** : relier les portions remises à la réception `RECEIVED` de `FINAL`, puis au `CONTROL` net de contre-écritures. Seul le contrôle final net constitue une preuve de reversement.
4. **Répartition partielle** : attribuer à chaque collection une fraction contrôlée explicitement et transactionnellement ; ne jamais présumer qu'un contrôle global de caisse certifie toutes les commandes.
5. **Invariants** : conservation par collection, aucune double consommation, même marché, non-négativité, idempotence, séparation des tâches et verrouillage concurrent ; perte et refus restent non clôturants.
6. **Cardinalité** : aucun nombre d'intervenants codé en dur ; un circuit direct et des circuits à N transferts utilisent le même mécanisme.
7. **Corrections** : une contre-écriture invalide les fractions de preuve finale correspondantes ; ne jamais supprimer l'historique.

## Avant migration

- Inspecter les migrations ultérieures et le schéma DB réel ; déterminer si `CONFIRMED` est déjà alimenté en production et par quel parcours.
- Décider comment attribuer explicitement des fonds fongibles lors d'une remise partielle ou d'un regroupement ; documenter l'autorité de cette décision. FIFO seul ne suffit pas à prouver l'identité matérielle des espèces.
- Concevoir des tables de provenance **additives**, sans remplacer `cash_deposit_allocations` ni `cash_custody_movements`.
- Tester sur DB jetable : 2 acteurs, 3 acteurs, 4+ acteurs, scission, regroupement, refus, perte, inversion de contrôle, concurrence et replay.
- Aucun RESET, purge, paiement réel ou mutation staging. Aucun chevauchement avec S7a.

## GO

Le code du rapprochement financier ne pourra lever le blocage 1C qu'après démonstration SQL et E2E que **100 % de la collection de la commande** est couvert par des contrôles finaux nets et attribués, sans perte ni incident bloquant.
