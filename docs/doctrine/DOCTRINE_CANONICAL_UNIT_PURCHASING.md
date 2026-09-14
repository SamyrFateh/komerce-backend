# Doctrine — Canonical Unit Purchasing

## Frontière

La chaîne cible est :

`product_sku.id → Canonical Unit → Supplier Order Identity → provider adapter → preflight → buildOrderPayload → HARD STOP`.

Ce lot n'expose aucun `placeOrder` et n'exécute aucune commande externe.

## Cardinalité absolue

- zéro Unit exacte : `BLOCKED_SUPPLIER_IDENTITY` ;
- une Unit exacte : résolution possible ;
- plusieurs Units : `BLOCKED_SUPPLIER_IDENTITY`.

Les correspondances utilisent uniquement les références fournisseur exactes, namespacées par Source et contraintes par le provider lorsque la SOI legacy le fournit. Aucun label ou SKU ressemblant n'est accepté.

## Ownership

Sourcing possède `resolveCanonicalUnitForProductSku()` et tout SQL Resolution. Purchasing consomme cette API et ne lit jamais directement les tables internes Resolution.

La SOI reste `{ provider, version, payload }`. Son payload est opaque au core et seul l'adapter du provider peut le traduire.

## Readiness

Provider capability, Unit readiness et disponibilité fournisseur actuelle sont trois verdicts distincts. Une identité exacte ne suffit pas.

Le gate bloque : SOI absente, ambiguïté, Unit inactive/supprimée, adapter absent, stock insuffisant, prix ou devise indisponible, et tout échec de preflight/freight retourné par l'adapter.

## Comparaison et cutover

Statuts shadow : `PARITY`, `CANONICAL_MORE_PRECISE`, `LEGACY_ONLY`, `CANONICAL_ONLY`, `MISMATCH`, `AMBIGUOUS`, `BLOCKED`.

`MISMATCH` et `AMBIGUOUS` bloquent le cutover. Le resolver et le gate sont prêts, mais le chemin Purchasing historique ne sera remplacé qu'après une preuve de parité sur les données réelles.

## Fournisseurs

CJ conserve `supplier_unit_ref = vid` et la SOI `{ provider: "cj", version: 1, payload: { pid, vid, variant_sku } }`.

AliExpress conserve son `supplier_unit_ref` exact et son payload actuel. Aucun champ natif CJ ou AliExpress n'est interprété par le core.

## Sécurité

Le résultat terminal de ce lot est `HARD_STOP`, même après un preflight réussi et un payload construit. `place_order_invoked=false` est invariant.
