# AliExpress — preuve E2E avant paiement

## But

Prouver la chaîne d'achat fournisseur aussi loin que possible sans engagement financier :

`produit Komerce promu → SKU fournisseur exact → refresh live AliExpress → stock/prix/devise → fret live → payload place-order → STOP`.

Cette preuve n'appelle jamais `place-order` et ne déclenche aucun paiement.

## API officielles visées

La surface Dropshipper documentée par AliExpress expose notamment :

- `aliexpress.logistics.buyer.freight.calculate` — calcul de fret ;
- `aliexpress.trade.buy.placeorder` — création de commande fournisseur ;
- `aliexpress.trade.ds.order.get` — détail de commande ;
- `aliexpress.logistics.ds.trackinginfo.query` — tracking.

Le premier appel est non mutatif et peut être utilisé dans la preuve staging. `placeorder` est mutatif : il reste derrière un gate humain distinct.

## Réconciliation SKU

Le `supplier_sku` V2 est l'identité stable utilisée par Komerce. Pour AliExpress, le payload de commande attend aussi `sku_attr` sous forme de couples `property:value`.

Komerce ne l'invente pas : le préflight retrouve le SKU exact dans le payload fournisseur brut conservé par V2 puis reconstruit `sku_attr` depuis :

- `sku_property_id` ;
- `sku_property_value`.

Si le SKU V2 et le payload fournisseur brut ne se réconcilient pas, la preuve échoue fermée.

## Worker de preuve

`scripts/aliexpress-prepayment-proof.js`

Garde-fous :

- staging uniquement ;
- `KOMERCE_ALLOW_ALIEXPRESS_PREPAYMENT_PROOF=1` obligatoire ;
- sélection d'un produit AliExpress réellement promu (`imported_to_catalog`) ;
- SKU `SUPPLIER` actif et en stock ;
- refresh live du même produit ;
- résolution du même SKU ;
- aucune conversion silencieuse de devise ;
- calcul de fret live ;
- payload `placeorder` construit uniquement si une adresse staging est configurée ;
- `placeorder` jamais invoqué par ce worker ;
- aucun appel de paiement.

## Gate de sortie

La preuve est verte lorsque :

1. un `product_id` Komerce promu remonte à un `supplier_product_id` AliExpress ;
2. un `product_skus.supplier_sku` est retrouvé dans le snapshot puis dans le détail AliExpress live ;
3. le stock live est positif pour la quantité demandée ;
4. prix et devise live sont explicites ;
5. `sku_attr` est reconstructible ;
6. l'appel freight répond ou produit un diagnostic d'autorisation exploitable ;
7. le payload `aliexpress.trade.buy.placeorder` est déterministe ;
8. `place_order.invoked=false` et `payment.invoked=false`.

Après ce gate, la seule mutation fournisseur restant à autoriser séparément est la création contrôlée d'une commande AliExpress non payée, puis le paiement lui-même.
