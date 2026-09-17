# Doctrine — Canonical Unit Purchasing

## Frontière

La chaîne cible est :

`product_sku.id → Canonical Unit → Supplier Order Identity → provider adapter → preflight → buildOrderPayload → HARD STOP`.

Le `HARD STOP` sépare la préparation exacte de l'acte fournisseur externe : aucun `placeOrder` implicite n'est autorisé.

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

`product_suppliers` choisit le fournisseur opérationnel / compte fournisseur. Pour une ligne vendue avec `product_sku_id` + SOI exacte, il n'est plus autorité du prix fournisseur : le prix et la devise viennent de la Canonical Unit résolue.

## Supplier money

Une Purchase Order canonique snapshotte toujours la monnaie fournisseur native :

- `supplier_unit_price` = prix unitaire natif au moment de la création de la PO ;
- `supplier_currency` = devise native explicite ;
- `supplier_total_price` = prix unitaire × quantité ;
- aucune conversion silencieuse vers AED n'est permise.

`unit_price_aed` et `product_suppliers.supplier_price_aed` restent des champs legacy de compatibilité. Ils sont encore utilisés pour les produits sans SKU/SOI canonique, mais une Unit en PLN, USD, CNY, etc. ne doit jamais être écrite dans un champ nommé AED.

## Readiness

Provider capability, Unit readiness et disponibilité fournisseur actuelle sont trois verdicts distincts. Une identité exacte ne suffit pas.

Le gate bloque explicitement : SOI absente, ambiguïté Product/Unit, Unit inactive/supprimée, adapter absent, quantité invalide, stock inconnu ou insuffisant, prix/devise indisponible, exception de résolution, échec/exception de preflight et impossibilité de construire le payload fournisseur.

Un état fournisseur manquant ne doit jamais être interprété comme disponible : `STOCK_UNAVAILABLE` est distinct de `OUT_OF_STOCK`.

## Comparaison et cutover

Statuts shadow : `PARITY`, `CANONICAL_MORE_PRECISE`, `LEGACY_ONLY`, `CANONICAL_ONLY`, `MISMATCH`, `AMBIGUOUS`, `BLOCKED`.

`MISMATCH` et `AMBIGUOUS` bloquent le cutover. Une divergence de Supplier Order Identity est un hard failure, même lorsque la ref textuelle paraît identique. Les comparaisons de refs restent namespacées ; deux fournisseurs peuvent légitimement employer la même valeur textuelle sans représenter la même Unit.

Le Golden Allegro réel a fourni la première preuve nécessaire au cutover du **snapshot prix/devise** : le Purchasing exact-SKU résout désormais la Canonical Unit et snapshotte sa monnaie native sur la PO. Les autres comportements historiques (sélection du supplier opérationnel, réception, administration des PO) restent inchangés tant qu'ils n'ont pas leur preuve de parité.

## Fournisseurs

CJ conserve `supplier_unit_ref = vid` et la SOI `{ provider: "cj", version: 1, payload: { pid, vid, variant_sku } }`.

AliExpress conserve son `supplier_unit_ref` exact et son payload actuel. Aucun champ natif CJ ou AliExpress n'est interprété par le core.

Allegro Sandbox conserve l'identité exacte `{ provider: "allegro", version: 1, payload: { environment: "sandbox", offer_id } }`. Son prix natif PLN reste PLN jusque dans la Purchase Order.

Manual/CSV peuvent être valides pour Sourcing/Catalog sans être commandables. Aucune fausse SOI n'est fabriquée pour les rendre compatibles.

## Sécurité

Toute exception interne du resolver, du preflight ou de `buildOrderPayload()` échoue fermée et ne devient jamais une commande implicite.

La préparation fournisseur et l'acte externe restent séparés. `place_order_invoked=false` demeure invariant tant qu'un adapter n'expose pas explicitement une capacité d'achat automatique prouvée.
