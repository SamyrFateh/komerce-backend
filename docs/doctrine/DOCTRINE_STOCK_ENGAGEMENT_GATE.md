# Disponibilité fournisseur à l'engagement client — audit de frontière

Date : 2026-09-22. Statut : **audit du code et correctif local SKU agrégé uniquement**.
Ne constitue pas une preuve de réservation ou de vendabilité fournisseur.

## Parcours constaté dans le code

1. Checkout : order-checkout-item-resolution.js résout l'identité SKU et lit
   product_skus.stock. order-checkout-service.js persiste ensuite une commande
   pending et les order_items. Pour une liste partagée, la résolution verrouille
   la ligne shared_cart_items, compare SKU et quantité, et la contrainte unique
   empêche que deux commandes réclament **la même ligne**.
2. Paiement : confirmPaymentCycle dans order-payment-confirmation.js exécute
   les transitions confirmed/ordered, puis vérifie/décrémente le stock Komerce
   dans la transaction DB de l'appelant. Une insuffisance entraîne une réponse
   stockBlocked : le paiement cash est annulé par rollback chez son appelant ;
   les parcours déjà encaissés (ex. Stripe) passent par un incident/alerte.
   Le wallet 100 % traverse ce cycle dans la transaction de création de
   commande.
3. Achat fournisseur : purchasing-trigger-service.js exécute un preflight
   distinct sur le SKU vendu et peut produire une commande fournisseur. Il
   intervient **après** la frontière de création/confirmation client ; un
   preflight Purchasing n'est pas une réservation à la création du panier.
4. Les preuves sourcing shadow (captures 3 → 1, comparaison Unit ↔ SKU et
   quantité agrégée) ne sont branchées sur aucun de ces flux transactionnels.

## Défaut local établi et correction de ce lot

Deux lignes distinctes de la **même commande** peuvent référencer le **même
product_skus.id**. Auparavant chaque ligne de quantité 2 était comparée
séparément à un stock 3 : 2 <= 3 et 2 <= 3, alors que la demande totale
est 4. Le verrou sur la ligne de SKU ne corrige pas ce problème de somme.

Ce lot regroupe les quantités par SKU exact :
- au checkout, avant persistance de la commande ;
- à la confirmation, à partir des order_items déjà persistés, avec un seul
  SELECT FOR UPDATE par SKU exact (ordre de verrouillage déterministe), avant
  tout décrément ;
- avec tests 2+2 > 3, 2+2 = 4, SKU différents et absence de décrément en cas
  d'insuffisance. Le checkout et la confirmation restent responsables du
  stock **interne Komerce** uniquement.

Aucun effet sur products.stock ou product_variants.stock dans le chemin SKU,
aucun changement de décision de capture/autorisation, aucune migration,
aucun appel fournisseur, aucun achat ni activation de source.

## Gates restant à prouver avant une promesse fournisseur

- **Identité et provenance** : SKU exact ↔ Unit canonique ↔ SOI validée
  chez le provider/compte autorisé ; fournisseur économique et périmètre
  de relecture prouvés, absence d'ambiguïté ou de source mélangée.
- **Quantité complète** : agréger tous les engagements concurrents pertinents
  pour le même SKU / même Unit, en distinguant stock fournisseur quantitatif,
  disponibilité bornée à une quantité, et stock interne/réservations.
  La somme d'une seule commande ne réserve pas une quantité pour d'autres
  commandes en parallèle.
- **Moment réel de l'engagement** : auditer séparément Stripe, PayPal, mobile
  money, wallet, espèces et paiements de plusieurs participants ; identifier
  autorisation versus capture effective, droits d'annulation et états des
  listes. Une vérification pré-checkout devient périmée avant une capture
  ultérieure sans réservation valide ou revalidation.
- **API fournisseur et fraîcheur** : vérifier le contrat exact de lecture
  de l'unité tierce, la validité de checked_at, quota, pannes, retrait et
  version ; UNKNOWN n'est ni zéro ni disponibilité. La comparaison shadow
  3 → 1 et une simple durée de fraîcheur injectée ne prouvent pas une
  réservation atomique chez Allegro.
- **Preflight Purchasing** : recontrôler quantité, prix, devise, fret,
  identité exacte et destination au point d'achat autorisé, avec idempotence,
  gestion de la course stock T1 → T2 et incidents d'une commande déjà payée.

Ne pas raccorder la sortie OBSERVED_SUFFICIENT du trial shadow aux routes
checkout, payments ou purchasing : son contrat indique explicitement
commercial_readiness=NOT_EVALUATED et supplier_reservation=NOT_PROVED.
