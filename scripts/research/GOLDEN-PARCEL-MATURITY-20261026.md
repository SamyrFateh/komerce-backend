# R&D — Identité commande → colis partagé → maturité financière

**Statut** : contre-exemple confirmé et correctif expérimental validé, non fusionné, le 26 octobre 2026.

## Contrats propriétaires comparés

- `services/parcel-order-membership.js` : un colis appartient à une commande lorsque ses `parcel_items` correspondent à ses `order_items`. `parcels.order_id` ne représente que la commande porteuse et ne se substitue à la propriété des lignes ; fallback legacy pour colis sans lignes.
- `services/customer-handoff-reconciliation.js` : utilise `memberParcelPredicate` et ignore les colis annulés.
- `services/pricing-maturity.js` : utilisait huit fois `WHERE p.order_id = o.id` pour la couverture des colis, la clôture des colis, les expéditions et la douane. Ce chemin perdait les colis partagés appartenant économiquement à d'autres commandes.

## Preuve A/B PostgreSQL 16

[Protocole](./golden-parcel-maturity-pg.js) : vrais services, même commande B, vrais enregistrements de `orders/order_items/parcels/parcel_items`, tests isolés dans `komerce_test` et **ROLLBACK** systématique. Deux répétitions par variante. Le résultat de la maturité est mesuré via la vraie `getOrderMaturity` et confronté à `listParcelsRepresentingOrder` du propriétaire logistique.

| Situation | Appartenance canonique | Maturité avant | Maturité après |
|---|---|---|---|
| Commande porteuse B, article B | 1 | 1 | 1 |
| Commande porteuse A, article B | 1 | **0** | **1** |

- [Avant — Actions #40416850754](https://github.com/SamyrFateh/komerce-backend/actions/runs/40416850754), [artefact JSON](https://github.com/SamyrFateh/komerce-backend/actions/runs/40416850754/artifacts/12694984024) : 2 contradictions / 4 cas.
- [Après — Actions #40417352951](https://github.com/SamyrFateh/komerce-backend/actions/runs/40417352951) : 0 divergence / 4 cas, test strict `FP_EXPECT_PARCEL_MEMBERSHIP_GUARD=true`, `ROLLBACK=true` ; **28/28 tests pricing-maturity** PASS.
- [Correctif PR #3028](https://github.com/SamyrFateh/komerce-backend/pull/3028) : brouillon, deux fichiers, huit occurrences du prédicat SQL, aucune migration ni mutation métier.

## Limites

C'est une preuve de **désaccord des projections** à données physiques identiques, puis de convergence après correction. Ce n'est pas une certification de la clôture financière d'une vraie commande. Les champs tarifaires, les remboursements, la provenance du paiement et le statut des expéditions ne sont pas simulés comme complets.

Le moteur de recherche doit conserver l'identité `order_item_id` et ne jamais assimiler `parcels.order_id` à un rattachement économique unique. Les comparaisons des verdicts de `reconcileCustomerHandoff` et `getOrderMaturity` sont désormais un **cas étalon** pour la famille `CROSS_PROJECTION_MEMBERSHIP_ASYMMETRY`.

**Suite rationnelle** : tester le cas 1 colis partagé contenant des lignes A **et** B, les exclusions `cancelled`, puis l'effet sur un vrai critère applicable `parcel_flow_closed` avec frais relais attendus, sans inventer des paiements ou livraisons réussis.
