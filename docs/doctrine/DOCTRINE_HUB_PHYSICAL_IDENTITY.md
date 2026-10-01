# Doctrine — HUB Physical Identity, Allocation & Custody

**Statut : canonique — HUB-001 + HUB-002**  
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

Lorsqu'une vérité amont nécessaire manque ou se contredit, Hub peut constater l'impossibilité physique et mettre l'unité en quarantaine, mais le dossier d'exception reste gouverné par Incident Management. `resolver_domain` et `due_at` sont déterminés dès l'ouverture ; Hub ne peut pas fermer une erreur `UPSTREAM_TRUTH` par décision manuelle.

## 3. Allocation économique

`hub_purchase_allocations` est un snapshot append-only/immutable créé à partir d'une Purchase Order exacte. Il conserve au minimum :

- `purchase_order_id` ;
- `order_id` et `order_item_id` ;
- `product_sku_id` ;
- `supplier_id`, `supplier_unit_ref`, `supplier_order_identity` ;
- la quantité achetée ;
- `market_id` ;
- la destination autoritative (`destination_ref`).

Une PO historique ou ambiguë qui ne permet pas de reconstruire exactement cette identité n'est jamais devinée. Le physique correspondant est mis en quarantaine avec un incident gouverné, ou l'opération échoue fermé.

Une allocation ne se modifie pas. Changer son Market, son order item, sa destination ou son identité fournisseur signifierait une nouvelle décision économique amont, hors autorité Hub.

## 4. Identité et placement physiques

`hub_physical_units` représente ce que l'opérateur peut réellement manipuler : colis fournisseur entrant, unité de manutention ou colis Market sortant.

`hub_physical_unit_placements` répond à la question : « quelle quantité de quelle allocation se trouve actuellement dans quelle unité physique ? »

Les opérations `SPLIT`, `MERGE` et `REPACK` ferment les anciens placements et en ajoutent de nouveaux. Elles ne changent jamais `hub_purchase_allocations`.

La somme des placements actifs d'une allocation ne peut jamais dépasser la quantité achetée, y compris sous concurrence.

## 5. Multi-market et destination

Un colis fournisseur entrant peut légitimement contenir des allocations destinées à plusieurs Markets ou destinations. Le Hub est alors un point de transit neutre : aucune destination n'est inventée au niveau du contenant.

Avant la sortie, la matière doit être séparée explicitement. Toute unité qui passe à `PACKED` ou `DISPATCHED` doit contenir au moins une allocation active, exactement un `market_id` distinct **et exactement une `destination_ref` distincte**. Être mono-Market ne suffit pas : deux relais différents du même Market ne peuvent jamais partager silencieusement un même outbound.

Le `market_id` de l'unité physique est dérivé par le système depuis les allocations puis devient immuable. La destination reste dérivée de l'allocation économique immuable et n'est jamais saisie par l'opérateur Hub.

Conséquence : KM, CM, CG ou tout futur Market peuvent partager un inbound, mais ni deux Markets ni deux destinations commerciales ne peuvent se mélanger silencieusement dans un outbound.

## 6. Custody et quarantaine

`hub_custody_events` est append-only. Il trace les transitions d'état, entrées/sorties de placement, opérations physiques et constats irréversibles.

Cycle nominal :

`RECEIVED → IDENTIFIED → QUALITY_CHECKED → LOCATED → ALLOCATED → PICKED → PACKED → DISPATCHED`

`QUARANTINED` est le fail-closed opérationnel lorsqu'une identité ou un état physique ne permet pas de poursuivre avec certitude. `SUPERSEDED` clôt une unité vidée par une opération physique explicite.

Une quarantaine provoquée par une vérité Purchasing/Orders non prouvée ouvre dans la même transaction un incident `UPSTREAM_TRUTH`. La sortie de quarantaine exige :

1. correction durable par le domaine `resolver_domain` ;
2. revalidation F3 du prédicat original ;
3. résolution de l'incident ;
4. rematérialisation des allocations/placements sur **la même unité physique**.

Tant qu'un incident actif référence l'unité physique, un `QUARANTINED → RECEIVED` direct est interdit. Les outcomes destructifs (`LOST`, `STOLEN`, `DESTROYED`, `DAMAGED_UNUSABLE`) restent irréversibles.

Aucune suppression d'historique n'est autorisée.

## 7. Outcomes physiques

Les constats `LOST`, `STOLEN`, `DESTROYED`, `DAMAGED_UNUSABLE` appartiennent à la vérité physique. Leur persistance et l'événement `physical_outcome_reported` de l'outbox F0 sont écrits dans la même transaction.

Le Hub ne rembourse, ne recommande et ne répare pas une Purchase Order dans cette transaction. Les domaines autoritaires aval consomment le fait durablement et décident de leur propre conséquence.

Un rejeu du même outcome est idempotent ; un outcome différent après un premier constat est refusé.

## 8. HARD STOP

HUB-001/HUB-002 échoue fermé notamment si :

- la Purchase Order n'a pas d'`order_item_id` / `product_sku_id` exact ;
- la Supplier Order Identity est absente ou invalide ;
- le SKU de la PO contredit le SKU vendu ;
- `market_id` ou la destination amont ne sont pas résolvables ;
- une quantité physique dépasserait la quantité achetée ;
- un opérateur tente de modifier une allocation économique ;
- une unité outbound est vide, multi-market **ou multi-destination** ;
- une opération tente de modifier le contenu d'une unité déjà `PACKED`, `DISPATCHED`, `QUARANTINED` ou `SUPERSEDED` ;
- une unité QUARANTINED possède encore un incident actif ;
- une réouverture physique tente de contourner la revalidation F3 ;
- un opérateur tente de sauter une étape du cycle nominal ;
- un geste terrain tente de revenir au vieux rail `parcel/order` au lieu de la boundary physique canonique.

## 9. Non-objectifs HUB-001

HUB-001 n'introduit pas de commande fournisseur automatique, de paiement fournisseur, de remboursement client, de réassignation commerciale, de nouvelle résolution Sourcing, ni de nouveau store de preuve. Les preuves physiques d'incident restent dans `scan_events` conformément à HUB-000/F3 ; `hub_custody_events` trace la custody et le lineage, pas une preuve concurrente.

## 10. HUB-002 — Operator Execution Cutover

HUB-002 ne crée aucune nouvelle table et aucune nouvelle vérité métier. Il rend la boundary HUB-001 exécutable par les opérateurs terrain.

La réception fournisseur canonique est `POST /api/scans/hub/receive`. Le payload transporte uniquement l'identité physique du colis et un manifeste explicite `{ purchase_order_id, quantity }`. L'opérateur ne fournit jamais `market_id`, destination, SKU, Supplier Order Identity ou allocation économique : le serveur les résout depuis la Purchase Order exacte.

Les opérations terrain suivantes passent exclusivement par `services/hub-operations.js`, qui ouvre la transaction puis délègue à `services/hub-physical-identity.js` :

- création d'un contenant `HANDLING_UNIT` ou `MARKET_PARCEL` ;
- transition d'une seule étape du cycle nominal ;
- `SPLIT`, `MERGE`, `REPACK` d'un placement physique ;
- revalidation d'une quarantaine via F3 ;
- constat d'un outcome physique via F0 ;
- `PICKED → PACKED` ;
- `PACKED → DISPATCHED`.

Le vieux `POST /api/hub/scan` basé sur `parcel_ref → order_id → safeSyncScanToParcels()` et le batch équivalent sont fail-closed (`410`) : ils ne mutent plus `parcels`, `orders` ou une vérité amont.

`POST /api/hub/pack` et `POST /api/hub/seal` conservent leurs URLs historiques pour limiter le coût de cutover, mais le champ `parcel_id` y désigne désormais l'UUID de la `hub_physical_unit` canonique. Le seal est donc strictement **physical-unit scoped** ; il ne peut plus expédier d'autres colis d'une commande par effet de bord.

Les surfaces lecture legacy (`/api/hub/pending`, `/search`, `/today`, `/stats/week`) restent des projections d'observation pendant le cutover. Elles n'accordent aucune autorité d'écriture et ne sont pas une source de vérité HUB-001.

## 11. HUB V1 — arrivée, ouverture, contrôle qualité et reconditionnement

La V1 distingue explicitement quatre identités/gestes. Ils ne doivent jamais être confondus.

### 11.1 `KOM-IN` — référence d'inbound attendue

Après création d'une Purchase Order, Komerce peut produire une référence déterministe `KOM-IN-...` et la transmettre au fournisseur.

Cette référence :

- désigne la Purchase Order Komerce à laquelle le fournisseur doit rattacher ses colis ;
- peut être imprimée en clair, CODE128 ou QR selon la capacité fournisseur ;
- est **optionnelle** : l'absence de coopération fournisseur ne bloque jamais le Hub ;
- peut être répétée sur plusieurs colis lorsque le fournisseur scinde physiquement une même PO ;
- ne remplace ni le tracking transporteur ni l'identité physique réelle du colis.

La préférence opérationnelle est :

`KOM-IN reconnu → tracking/référence fournisseur réconciliable → recherche manuelle`.

### 11.2 `KOM-RCV` — colis fournisseur physiquement reçu

Chaque colis physique arrivé au Hub reçoit une identité Hub propre `KOM-RCV-...`, distincte de `KOM-IN`.

L'arrivée peut être enregistrée **sans ouvrir le colis et sans déclarer son contenu détaillé** :

`arrivée → capture KOM-IN/tracking si disponible → RECEIVED`.

Si `KOM-IN` est reconnu, la PO attendue est connue mais le contenu physique n'est pas encore déclaré comme vrai. Si aucun rapprochement n'est disponible, le colis reste recevable en mode non réconcilié.

Le tracking fournisseur distingue notamment plusieurs colis physiques portant le même `KOM-IN`.

### 11.3 Ouverture et réconciliation du contenu

Le contenu détaillé devient une vérité Hub lorsque l'agent ouvre réellement le colis.

Le geste canonique est :

`RECEIVED → ouverture → constat SKU/quantités → réconciliation Purchase Order → IDENTIFIED`.

Une incohérence de PO, SKU, quantité, Supplier Order Identity, Market ou destination ne doit jamais être devinée : le colis passe en `QUARANTINED` avec incident gouverné.

Le contrôle qualité suit l'identification :

`IDENTIFIED → QUALITY_CHECKED`.

Le contrôle qualité est donc lié au moment où le produit est réellement visible et manipulable, et non au simple scan d'arrivée.

### 11.4 `KOM-ITEM` — identité physique après déballage, seulement si utile

Lorsqu'un produit ou lot perd une identité exploitable en sortant de l'emballage fournisseur, le Hub peut créer une `HANDLING_UNIT` étiquetée `KOM-ITEM-...`.

Le réétiquetage n'est pas systématique. Il est justifié seulement lorsqu'il préserve une identité utile pendant la manipulation : séparation de lots/destinations, code fournisseur inutilisable, regroupement, fractionnement ou autre besoin réel.

### 11.5 `KOM-BOX` — carton outbound Komerce

Le carton destiné à quitter le Hub est une `MARKET_PARCEL` avec identité `KOM-BOX-...`.

La matière contrôlée peut être déplacée du colis fournisseur ou d'un `KOM-ITEM` vers un `KOM-BOX` par `REPACK`, `SPLIT` ou `MERGE`. Ces opérations ne modifient jamais l'allocation économique.

Plusieurs sources fournisseur peuvent être consolidées dans un même `KOM-BOX` uniquement si les invariants outbound restent satisfaits, notamment mono-Market et mono-destination.

### 11.6 Principe opératoire V1

La chaîne observable est :

`KOM-IN éventuel → KOM-RCV → ouverture/réconciliation → contrôle qualité → KOM-ITEM si nécessaire → REPACK → KOM-BOX → PACKED → DISPATCHED`.

Komerce ne gère pas en V1 les racks, tables ou déplacements internes. Un scan ou une impression n'est demandé que lorsqu'il matérialise une nouvelle vérité utile.
