# Shadow quantity trial — périmètre et conditions de preuve

Statut : essai **strictement hors transaction**. Le Golden offline 3→1 et la
comparaison Unit canonique ↔ SKU catalogue (#1688) prouvent des observations,
pas une disponibilité commerciale réservée.

## Contrat du lot

L'API pure evaluateShadowQuantityTrial(items, report, now, maxObservationAgeMs)
consomme seulement le rapport stock_observations déjà produit par
collectCanonicalOfferUnitComparison en lecture seule.

- Agréger toutes les demandes par sku_id exact avant de comparer la quantité
  demandée au stock fournisseur **observé** et au stock catalogue **photographié**.
- Exiger un rattachement canonique non ambigu, sans hard failure, sans partage
  d'une Unit avec un autre SKU commercial et sans valeur UNKNOWN.
- Le caller fournit explicitement une date de référence ET une durée maximale
  d'âge positive. Cette durée dans les tests est une **valeur de fixture**, pas
  une politique contractuelle Allegro ni une garantie de fraîcheur réelle.
- UNKNOWN pour erreur/absence d'identité, manque de quantité, timestamp absent,
  observation future ou trop ancienne, duplication, source non prouvée.
  Un zéro observé est un **déficit** et n'est jamais assimilé à UNKNOWN.
- OBSERVED_SUFFICIENT signifie seulement que les deux valeurs observées au
  moment de leurs captures couvrent la quantité totale, **pas** que la commande
  peut être acceptée. SHORTFALL est un constat sur ces valeurs. En cas d'un
  seul SKU UNKNOWN, le verdict agrégé est UNKNOWN.

Le résultat conserve authority=shadow_read_only,
commercial_readiness=NOT_EVALUATED, supplier_reservation=NOT_PROVED,
checkout_gate_invoked=false et provider_called=false, quel que soit le
verdict numérique.

## Explicitement NON autorisé

Aucune modification de product_skus.stock, de l'interrupteur Sourcing, des
routes, de la boutique, des listes partagées, du checkout, de l'autorisation
ou capture du paiement, de Purchasing ou d'un fournisseur. Aucune nouvelle
migration, aucun service/cron Railway. Ce test ne valide pas une disponibilité
réelle au moment où le client s'engage.

## Gate séparé avant toute connexion transactionnelle

Auditer la quantité agrégée sur le vrai checkout et la liste partagée, le
moment de l'engagement et de la capture du paiement, les commandes concurrentes,
les réservations internes, l'identité fournisseur exacte, les droits d'accès
à l'API du compte, la fraîcheur contractuelle, puis le preflight sur l'unité
et le Procurement Hub au moment approprié. Sans preuve de réservation
atomique, un contrôle fournisseur à T1 ne garantit jamais le stock à T2.
Un échec au gate ne doit ni capturer de paiement sans consentement approprié,
ni annuler une commande engagée à partir d'une simple observation.
