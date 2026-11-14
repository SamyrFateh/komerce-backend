# Réconciliation ultime commande — contrat d'acceptation (#3245)

## Deux verdicts indépendants
- **Clôture client** : `MATCHED`, `PENDING`, `MISMATCH`. La commande ne sort du suivi actif que si toutes les quantités et toutes les obligations envers le client sont soldées.
- **Clôture économique** : coûts réels de fret, douane, fournisseur, paiements et marge. Son attente ne réouvre pas une clôture client valide.

## Invariant par ligne
`quantité commandée = quantité remise avec preuve valide + quantité annulée/régularisée`.
Une quantité ne peut être comptée deux fois. Le lien commande → ligne → PO → réception Hub → carton → expédition → remise doit rester traçable malgré les fractionnements.

Pour toute quantité non remise, prouver une résolution financière correspondant au montant réellement dû : remboursement terminé et/ou crédit wallet effectivement crédité, dans la bonne devise. Une intention, une autorisation ou un statut global `refunded` ne suffisent pas. Sans encaissement, l'annulation peut être soldée sans remboursement.

## Motifs de clôture
- `delivered_full`
- `delivered_partial_refunded` (incluant crédit wallet confirmé)
- `cancelled_full_refunded`
- `cancelled_unpaid`

## Motifs de surveillance
- `normal_in_progress` : pas d'alerte bloquante.
- `missing_quantity`, `missing_handoff_proof`, `refund_shortfall`, `wallet_unconfirmed`, `orphan_purchase_or_parcel_link`, `overdue_resolution` : anomalie à qualifier; seules les urgences métier alimentent « À traiter ».

## Dashboard
- **Commandes** : non réconciliées, ancienneté maximale, montant à régulariser, lien vers lignes et preuves.
- **À traiter** : seulement les anomalies bloquantes ou hors délai.
- **Historique** : clôtures avec preuves et horodatage, sans effacement.

## Risques actuels à corriger
- `services/order-financial-closure-reconciliation.js` : les branches `refundedTerminal` et `cancelledTerminal` ne rapprochent pas encore tous les montants dus.
- `services/customer-handoff-reconciliation.js` : les preuves de colis ne démontrent pas seules la couverture exhaustive des quantités.
- `cash_relais` : conserver le blocage lorsque la remise finale d'espèces n'est pas attribuable à la commande.

## Validation exigée avant fusion
Cas livré complet; PO et cartons fractionnés; livraison partielle + remboursement; livraison partielle + wallet; annulation payée; annulation non encaissée; remboursement insuffisant; wallet non crédité; scan absent; article orphelin; fret/douane en attente; idempotence; zéro double comptage. Tests ciblés, PostgreSQL 16, Chromium et contrôles gouvernance/sécurité verts.

Ce contrat décrit la cible. Il ne prétend pas que les changements de code ou les tests sont déjà réalisés.
