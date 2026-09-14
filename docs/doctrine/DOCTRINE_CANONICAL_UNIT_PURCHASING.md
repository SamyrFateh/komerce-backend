# Doctrine — Canonical Unit Purchasing

## Frontière

La chaîne cible est :

`product_sku.id → Canonical Unit → Supplier Order Identity → provider adapter → preflight → buildOrderPayload → HARD STOP`.

Ce lot n'expose aucun `placeOrder` et n'exécute aucune commande externe.

## Cardinalité absolue

- zéro Canonical Product lié : `BLOCKED_SUPPLIER_IDENTITY` ;
- plusieurs Canonical Products liés au même produit catalogue : `AMBIGUOUS_PRODUCT` puis blocage ;
- zéro Unit exacte : `BLOCKED_SUPPLIER_IDENTITY` ;
- une Unit exacte : résolution possible ;
- plusieurs Units : `AMBIGUOUS_UNIT` puis blocage.

Les correspondances utilisent uniquement les références fournisseur exactes, namespacées par Source et contraintes par le provider lorsque la SOI le fournit. Aucun label ou SKU ressemblant n'est accepté. Une `unit.source_ref` persistée par Resolution est une ref exacte valide lorsqu'elle est adossée au bon namespace/provider.

## Ownership

Sourcing possède `resolveCanonicalUnitForProductSku()` et tout SQL Resolution. Purchasing consomme cette API et ne lit jamais directement les tables internes Resolution.

La SOI reste `{ provider, version, payload }`. Son payload est opaque au core et seul l'adapter du provider peut le traduire.

## Readiness

Provider capability, Unit readiness et disponibilité fournisseur actuelle sont trois verdicts distincts. Une identité exacte ne suffit pas.

Le gate bloque explicitement : SOI absente, ambiguïté Product/Unit, Unit inactive/supprimée, adapter absent, quantité invalide, stock inconnu ou insuffisant, prix/devise indisponible, exception de résolution, échec/exception de preflight et impossibilité de construire le payload fournisseur.

Un état fournisseur manquant ne doit jamais être interprété comme disponible : `STOCK_UNAVAILABLE` est distinct de `OUT_OF_STOCK`.

## Comparaison et cutover

Statuts shadow : `PARITY`, `CANONICAL_MORE_PRECISE`, `LEGACY_ONLY`, `CANONICAL_ONLY`, `MISMATCH`, `AMBIGUOUS`, `BLOCKED`.

`MISMATCH` et `AMBIGUOUS` bloquent le cutover. Une divergence de Supplier Order Identity est un hard failure, même lorsque la ref textuelle paraît identique. Les comparaisons de refs restent namespacées ; deux fournisseurs peuvent légitimement employer la même valeur textuelle sans représenter la même Unit.

Le resolver et le gate sont prêts, mais le chemin Purchasing historique ne sera remplacé qu'après une preuve de parité sur les données réelles.

## Fournisseurs

CJ conserve `supplier_unit_ref = vid` et la SOI `{ provider: "cj", version: 1, payload: { pid, vid, variant_sku } }`.

AliExpress conserve son `supplier_unit_ref` exact et son payload actuel. Aucun champ natif CJ ou AliExpress n'est interprété par le core.

Manual/CSV peuvent être valides pour Sourcing/Catalog sans être commandables. Aucune fausse SOI n'est fabriquée pour les rendre compatibles.

## Sécurité

Toute exception interne du resolver, du preflight ou de `buildOrderPayload()` échoue fermée et ne devient jamais une commande implicite.

Le résultat terminal de ce lot est `HARD_STOP`, même après un preflight réussi et un payload construit. `place_order_invoked=false` est invariant.
