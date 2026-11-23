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


---

## 12. HUB–RELAIS — doctrine canonique complémentaire (décision du 23 novembre 2026)

Cette section précise le tri, le regroupement et la remise aval. Elle complète HUB-001/HUB-002 sans transférer leurs autorités. En cas de formulation antérieure divergente sur la lettre ou sur la référence commerciale, la présente décision tranche **le périmètre Hub–Relais**. La certification technique et le GO restent indépendants.

### 12.1. Identités et responsabilités

- **Décision propriétaire finale (23/11/2026)** : une seule référence commerciale immuable pour toute nouvelle commande sous le moteur de vagues, de format `CM-YA01-B7Q01` : `CM` marché, `YA01` relais stable (deux lettres et deux chiffres), `B7Q` regroupement temporaire du destinataire (B = lettre de tri), `01` rang séquentiel de commande dans la vague. Ce format remplace K+6 seulement pour les nouvelles commandes éligibles après activation contrôlée du moteur ; les références K+6 historiques ne sont jamais renumérotées. Aucun deuxième identifiant commercial/logistique parallèle.
- Une étiquette d'unité physiquement reçue s'écrit `CM-YA01-B7Q01-01`, `-02`, `-03` pour les trois unités de la commande ; elle n'est pas un nouveau numéro de commande ni l'identifiant technique primaire des unités. Les UUID, SKU, allocations, quantités et scans canoniques font autorité.
- Les notions restent distinctes sans imposer deux références de commande : référence unique commerciale structurée ; unité physique/COMBOX ; vague et regroupement temporaire encodé dans la référence ; lettre prévisionnelle de tri ; emplacement physique réel ; secret de retrait.
- Le Hub identifie la destination **marché + relais**, contrôle, étiquette, affecte et expédie. Le relais réceptionne, trie finement par commande/destinataire, localise et remet.
- Le Hub ne réassigne ni la commande, ni la destination, ni l'allocation Purchasing. Aucun sac numérique obligatoire ; lecture des sacs historiques conservée.

### 12.2. Moteur de vagues et lettres

- À la validation du checkout, le moteur **attribue et persiste une lettre de pré-tri par relais et vague**, incluse dans la référence commerciale structurée lors de la création ; celle-ci devient immuable après émission.
- Rotation initiale A à Z, puis extension AA, AB, etc. si utile. L'attribution utilise les quantités d'articles attendues, et non le nombre de commandes ou clients. Cible indicative de dix unités par lettre, configurable et non assimilée à une capacité réelle.
- Choisir une lettre admissible à charge prévisionnelle minimale, avec départage par rotation transactionnelle ; répartir les premières commandes plutôt que tout concentrer en A. Les opérations concurrentes doivent rester déterministes, idempotentes et sans doublons.
- Un destinataire **vérifié** au même relais et dans la même vague ouverte conserve son regroupement entre commandes ; ni nom, ni téléphone, ni payeur seul ne suffisent à établir l'identité. Une vague fermée n'est pas réouverte par une nouvelle commande.
- Une attribution existante n'est jamais réécrite silencieusement. Le regroupement est temporaire, non public, sans pouvoir d'autorisation de retrait. Les lettres peuvent être réutilisées après clôture, grâce à la clé interne relais + vague + attribution.
- **Deux niveaux distincts :** lettre prévisionnelle dès le checkout ; localisation physique confirmée au relais uniquement après constat réel. La lettre ne garantit pas qu'une étagère A soit libre. L'agent peut ne pas utiliser de bac, choisir une zone compatible ou déclarer un débordement traçable. Une suggestion ne constitue jamais une présence physique.
- Le moteur suit séparément charge prévue et occupation physique confirmée. Une COMBOX fermée compte comme une unité physique tant qu'elle n'est pas ouverte ; après déconditionnement, compter les unités réellement rangées. Ne pas assimiler quantité commerciale et nombre de contenants.

### 12.3. Hub : réception, étiquettes et COMBOX

- Réception fournisseur : rapprocher PO, SKU, variantes, quantités et lignes de commande ; attester seulement ce qui est réellement reçu. Les colis entrants peuvent contenir plusieurs commandes et marchés et n'héritent d'aucune lettre unique.
- Imprimer des étiquettes sur les unités effectivement reçues ou sur un lot explicitement traçable : référence commerciale structurée, suffixe séquentiel d'unité, article/variante, quantité, marché, relais, lettre de tri incluse, code de scan stable. Jamais de nom, téléphone ou secret de retrait.
- Préparer directement dans une KOM-BOX en scannant COMBOX et articles. Une KOM-BOX peut agréger plusieurs commandes et destinataires, **mais un seul marché et un seul relais de destination**. Une commande peut être répartie sur plusieurs KOM-BOX.
- À PACKED, imprimer/réimprimer l'étiquette COMBOX avec identité physique, marché, relais et compteurs dérivés du contenu réel. Réimpression sans mutation de custody ni d'inventaire.
- Les opérations SPLIT/MERGE/REPACK déplacent la matière et conservent l'historique d'allocations, quantités et custody. Pas de sac numérique intermédiaire.

### 12.4. Relais : réception, rangement, retrait

- Scanner l'expédition/COMBOX et attester chaque ligne/quantité effectivement reçue. Si 2 unités sur 3 sont reçues, enregistrer 2/3 et ouvrir l'écart : ne pas déclarer 3/3.
- Recherche autorisée par commande ou code de retrait : afficher lignes, attendu, expédié, reçu, disponible, remis, manquant et reliquat, y compris si la commande traverse plusieurs COMBOX.
- Le repère alphabétique facilite le rangement ; le lieu exact est confirmé par l'agent, peut différer du pré-tri et reste propre au relais. Aucun bac physique ou numérique obligatoire.
- À la remise, vérifier le secret de retrait distinct et les habilitations, sélectionner **explicitement les articles et quantités physiquement tendus** ; enregistrer preuve, acteur, horodatage, commande, unité et quantités. Autoriser la remise partielle, conserver les reliquats, interdire toute deuxième remise des mêmes quantités. Le statut complet découle de la couverture réelle.
- Une livraison locale hors Hub utilise les mêmes principes de réception/placement/retrait, sans créer de fausse étape Hub.

### 12.5. Autorité, sécurité, compatibilité

- Autorités existantes : orders et order_items pour le commercial ; purchasing/PO pour les achats ; hub_purchase_allocations et placements physiques pour les quantités ; logistics pour custody, COMBOX, réception relais et remise.
- Aucun writer parallèle, aucune mutation de destination depuis le Hub, aucune fuite inter-marché/inter-relais. Le code de lettre, de vague ou d'étiquette ne vaut jamais autorisation de retrait.
- Les événements de scan, placement, déplacement, sortie et remise sont append-only/idempotents, avec acteur, site, marché, références et provenance. Mode sans scanner : saisie manuelle explicite et auditée ; perte réseau : ne pas inventer de preuve.
- Les anciennes références K+6, commandes G6 et données physiques historiques restent lisibles ; pas de renumérotation ni de suppression des sacs historiques. Tout nouveau flag est OFF par défaut ; activation staging séparée du merge.

### 12.6. Conséquence impérative pour PR #5206

**RETENIR** `CM-YA01-B7Q01` comme **unique référence commerciale** des nouvelles commandes éligibles. **CONSERVER ET ADAPTER** la transaction de vague, l'identité destinataire vérifiée, la rotation A–Z équilibrée par les unités attendues, le compteur de commande atomique, les garde-fous et l'abandon des nouvelles mutations sac. La migration 426, le checkout, les projections UI, les étiquettes et les tests doivent vérifier l'unicité par marché/relais/groupe/rang et la stabilité historique. PR #5206 non fusionnable avant vérification des contrôles et de la cohérence du parcours.

### 12.7. Critères de certification avant les 46 scénarios

- Une seule référence structurée stable `CM-YA01-B7Q01` ; commande suivante du même destinataire `CM-YA01-B7Q02` ; articles suffixés `-01`, `-02` ; homonymes distincts ; pas de réouverture après première remise ; rotation A–Z, charge par quantités, concurrence, absence de collision et absence de recyclage de groupe. Toute extension éventuelle au-delà de A–Z doit être versionnée et certifiée avant activation.
- PO partielle et étiquettes limitées aux reçus ; COMBOX multi-commandes ; commande multi-COMBOX ; scan doublé ; réimpression neutre ; marché/relais incompatible refusé.
- Réception 2/3 non complète ; remise 1/3 puis 2/3 ; aucun double retrait ; reliquats et incidents visibles ; aucune donnée sensible sur étiquette.
- Sur le **même SHA servi en staging** : préflight et CI requis verts ; gestes réels Chromium desktop, oracles API/HTTP, vérité PostgreSQL et dashboards. Verdict PASS/FAIL/BLOCKED/NOT_PROVEN, jamais PASS par simple présence d'écran.
- Aucun GO commercial, déploiement manuel ou activation de flag implicite par la fusion documentaire.

**Portée de ce document :** arbitrage canonique à intégrer dans les cartes et implémentations propriétaires ; il ne prétend pas que le code est certifié.

