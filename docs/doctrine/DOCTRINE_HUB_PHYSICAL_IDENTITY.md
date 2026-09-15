# Doctrine — HUB Physical Identity, Allocation & Custody

**Statut : canonique — HUB-001**  
**Domaine : logistics**  
**Date : 2026-09-15**

## 1. Principe

Le Hub ne décide jamais à qui appartient économiquement un article. Il reçoit une vérité déjà décidée en amont et ne possède que sa matérialisation physique.

La chaîne autoritative est :

`Purchase Order exacte → order_item → product_sku → Supplier Order Identity → orders.market_id + destination → allocation Hub immuable → placement physique → custody`

L'identité physique est donc distincte de l'identité commerciale. Un opérateur peut déplacer, séparer, fusionner ou reconditionner de la matière ; il ne peut pas changer silencieusement le client, le Market, la destination, le SKU ou l'identité fournisseur auxquels cette matière est rattachée.

## 2. Autorités

Purchasing possède `purchase_orders` et la Supplier Order Identity utilisée pour acheter. Orders/Market possèdent la commande, `market_id` et la destination commerciale. Sourcing possède la résolution canonique en amont. Logistics/Hub possède les unités physiques, leurs placements, leur état et la custody.

HUB-001 est donc un consommateur des vérités amont, jamais un mécanisme de réparation de ces vérités.

## 3. Allocation économique

`hub_purchase_allocations` est un snapshot append-only/immutable créé à partir d'une Purchase Order exacte. Il conserve au minimum :

- `purchase_order_id` ;
- `order_id` et `order_item_id` ;
- `product_sku_id` ;
- `supplier_id`, `supplier_unit_ref`, `supplier_order_identity` ;
- la quantité achetée ;
- `market_id` ;
- la destination autoritative (`destination_ref`).

Une PO historique ou ambiguë qui ne permet pas de reconstruire exactement cette identité n'est jamais devinée. Le physique correspondant est mis en quarantaine ou l'opération échoue fermé.

Une allocation ne se modifie pas. Changer son Market, son order item, sa destination ou son identité fournisseur signifierait une nouvelle décision économique amont, hors autorité Hub.

## 4. Identité et placement physiques

`hub_physical_units` représente ce que l'opérateur peut réellement manipuler : colis fournisseur entrant, unité de manutention ou colis Market sortant.

`hub_physical_unit_placements` répond à la question : « quelle quantité de quelle allocation se trouve actuellement dans quelle unité physique ? »

Les opérations `SPLIT`, `MERGE` et `REPACK` ferment les anciens placements et en ajoutent de nouveaux. Elles ne changent jamais `hub_purchase_allocations`.

La somme des placements actifs d'une allocation ne peut jamais dépasser la quantité achetée, y compris sous concurrence.

## 5. Multi-market

Un colis fournisseur entrant peut légitimement contenir des allocations destinées à plusieurs Markets. Le Hub est alors un point de transit neutre : aucune destination n'est encore inventée au niveau du contenant.

Avant la sortie, la matière doit être séparée explicitement. Toute unité qui passe à `PACKED` ou `DISPATCHED` doit contenir au moins une allocation active et exactement un `market_id` distinct. Le `market_id` de l'unité physique est dérivé par le système depuis ces allocations puis devient immuable.

Conséquence : KM, CM, CG ou tout futur Market peuvent partager un inbound, mais ne peuvent jamais se mélanger silencieusement dans un outbound.

## 6. Custody

`hub_custody_events` est append-only. Il trace les transitions d'état, entrées/sorties de placement, opérations physiques et constats irréversibles.

Cycle nominal :

`RECEIVED → IDENTIFIED → QUALITY_CHECKED → LOCATED → ALLOCATED → PICKED → PACKED → DISPATCHED`

`QUARANTINED` est le fail-closed opérationnel lorsqu'une identité ou un état physique ne permet pas de poursuivre avec certitude. `SUPERSEDED` clôt une unité vidée par une opération physique explicite.

Aucune suppression d'historique n'est autorisée.

## 7. Outcomes physiques

Les constats `LOST`, `STOLEN`, `DESTROYED`, `DAMAGED_UNUSABLE` appartiennent à la vérité physique. Leur persistance et l'événement `physical_outcome_reported` de l'outbox F0 sont écrits dans la même transaction.

Le Hub ne rembourse, ne recommande et ne répare pas une Purchase Order dans cette transaction. Les domaines autoritaires aval consomment le fait durablement et décident de leur propre conséquence.

Un rejeu du même outcome est idempotent ; un outcome différent après un premier constat est refusé.

## 8. HARD STOP

HUB-001 échoue fermé notamment si :

- la Purchase Order n'a pas d'`order_item_id` / `product_sku_id` exact ;
- la Supplier Order Identity est absente ou invalide ;
- le SKU de la PO contredit le SKU vendu ;
- `market_id` ou la destination amont ne sont pas résolvables ;
- une quantité physique dépasserait la quantité achetée ;
- un opérateur tente de modifier une allocation économique ;
- une unité outbound est vide ou multi-market ;
- une opération tente de modifier le contenu d'une unité déjà `PACKED`, `DISPATCHED`, `QUARANTINED` ou `SUPERSEDED`.

## 9. Non-objectifs HUB-001

Ce lot n'introduit pas de commande fournisseur automatique, de paiement fournisseur, de remboursement client, de réassignation commerciale, de nouvelle résolution Sourcing, ni de nouvelle preuve d'incident. Les preuves d'incident physiques restent dans `scan_events` conformément à HUB-000/F3.
