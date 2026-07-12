# Décision — Modèle de stock variantes : « une unité vendable = un SKU »

> **Statut** : décision actée — implémentation progressive en cours
> **Décision du** : 2026-07-12
> **Code porteur** : `product_skus`, `services/product-admin-service.js`, `routes/orders/create.js`, `services/order-payment-confirmation.js`, `services/order-status-machine.js`, `services/parcel-operations.js`
> **Doctrine liée** : `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`

---

## 1. Phrase de vérité

> **Une unité vendable = un SKU. Le stock appartient exclusivement au SKU dans le modèle cible. Couleur, taille ou autre option décrivent la sélection ; elles ne portent jamais une vérité de stock indépendante.**

Exemple :

```text
Robe Dubaï
- Noir + S  = SKU 1 — stock 3
- Noir + M  = SKU 2 — stock 8
- Rouge + S = SKU 3 — stock 2
- Rouge + M = SKU 4 — stock 0
```

Il n'existe pas de « stock Noir » ni de « stock M » comme vérités concurrentes. Le stock réel est celui de l'unité vendable précise.

---

## 2. Constat de départ vérifié

Le modèle legacy représente `product_variants` comme des lignes indépendantes `(product_id, variant_type, variant_value)` avec leur propre stock.

Deux axes donnent donc deux stocks séparés, sans notion d'intersection.

Acheter `Noir + M` décrémente historiquement la ligne `Noir` puis la ligne `M`. Ce modèle est faux dès que couleur et taille varient indépendamment.

`order_items.variant_combo` existe déjà et reste utile pour l'affichage et l'historique de commande. Il ne doit plus piloter le stock cible une fois `sku_id` résolu.

---

## 3. Modèle cible

### `product_skus`

Source de vérité de l'unité vendable.

Une ligne représente :

```text
product_id
sku
variant_combo
stock
price_kmf éventuel
is_active
```

- `variant_combo = null` : SKU par défaut d'un produit sans variantes ;
- `variant_combo = jsonb` : combinaison précise réellement vendue.

La table ne doit pas être remplie par un produit cartésien automatique avec des stocks inventés.

### `product_variants`

Responsabilité cible : décrire les axes et valeurs disponibles pour le catalogue et l'UX.

Exemples :

```text
Couleur : Noir, Rouge
Taille : S, M, L
```

`product_variants.stock` est legacy et doit disparaître comme vérité de stock après extinction du modèle legacy.

### `order_items.sku_id`

Référence transactionnelle explicite vers l'unité vendue.

`variant_combo` reste la photographie lisible/historique de la sélection au moment de la commande.

---

## 4. Bascule explicite par produit

Aucun fallback implicite basé sur l'existence de lignes dans `product_skus`.

Le modèle de stock est porté explicitement par :

```text
products.inventory_model = LEGACY_VARIANTS | SKU
```

Un produit reste entièrement `LEGACY_VARIANTS` pendant la préparation de ses SKU.

La bascule est explicite et atomique :

```text
LEGACY_VARIANTS → SKU
```

Une fois le produit en mode `SKU` :

- aucune lecture de stock depuis `products.stock` pour cette unité vendable ;
- aucune lecture/écriture de stock depuis `product_variants.stock` ;
- résolution de `sku_id` obligatoire ;
- stock lu/écrit exclusivement dans `product_skus`.

L'état métier ne doit jamais être deviné par « il existe au moins un SKU ».

---

## 5. Création de commande

Pour un produit `inventory_model = SKU` :

1. recevoir la sélection utilisateur ;
2. canonicaliser `variant_combo` ;
3. résoudre un SKU actif précis pour `(product_id, variant_combo)` ;
4. refuser explicitement toute combinaison inexistante ou inactive ;
5. vérifier le stock du SKU ;
6. persister `order_items.sku_id` ;
7. conserver `order_items.variant_combo` pour l'affichage/historique.

Le frontend cible transmet le `sku_id` sélectionné depuis le contrat détail produit. Le backend garde une validation autoritaire et ne fait jamais confiance au stock frontend.

---

## 6. Moteur stock

Cible : deux chemins explicitement séparés pendant la migration.

```text
adjustLegacyStock(...)
adjustSkuStock(...)
```

Le chemin SKU est conceptuellement :

```sql
UPDATE product_skus
SET stock = stock +/- quantity
WHERE id = sku_id
  AND product_id = product_id;
```

Il doit échouer bruyamment si un produit en mode `SKU` arrive sans `sku_id`.

Le modèle final ne doit pas conserver un gros `adjustStock()` hybride mélangeant durablement deux doctrines.

---

## 7. Backorders, annulations et restaurations

Toute restauration de stock cible doit utiliser `order_items.sku_id`.

Le bug historique backorder venait d'un `SELECT` de `parcel-operations.js` qui ne ramenait pas `oi.variant_combo`. Le bloc variantes était alors silencieusement ignoré et seul `products.stock` était restauré.

Avec `sku_id` explicite :

- la restauration vise l'unité vendue ;
- l'absence de `sku_id` en mode SKU doit devenir une erreur bloquante ;
- une dépendance JSON oubliée ne doit plus produire un « aucun effet » silencieux.

---

## 8. Produits sans variantes

Le moteur cible est unifié par un SKU par défaut :

```text
product_skus.variant_combo = null
```

À terme, `products.stock` n'est plus nécessaire comme deuxième moteur de stock.

Pendant la transition, un produit reste sur le modèle explicitement indiqué par `inventory_model`.

---

## 9. Migration des données

### Produits sans variantes

Migration mécanique possible vers un SKU par défaut avec le stock connu de `products.stock`, sous contrôle de la bascule explicite.

### Produits avec variantes

Ne jamais générer automatiquement des stocks d'intersection depuis les stocks d'axes legacy.

Le vendeur/admin doit déclarer les combinaisons réellement vendues et leur stock réel.

La préparation peut proposer le produit cartésien des axes comme **candidats d'interface** ; seule l'activation/déclaration d'un SKU crée une unité vendable.

---

## 10. Readiness et extinction legacy

Avant bascule d'un produit :

- SKU actif présent ;
- références d'axes toujours valides ;
- aucune unité vendable requise oubliée selon la préparation admin ;
- audit `READY` explicite.

La couverture globale est mesurée par `scripts/check-sku-coverage.js`.

Le fallback legacy ne peut être retiré que lorsque la couverture réelle le permet. Ce retrait est une décision mesurée, pas une date arbitraire.

---

## 11. Impacts feature-first

### `catalog`

Possède :

- `product_skus` ;
- préparation / déclaration SKU ;
- résolution SKU ;
- écriture stock via service propriétaire ;
- projection publique des unités vendables.

### `orders`

Consomme `sku_id`, le persiste sur `order_items` et déclenche le service stock propriétaire.

### `logistics`

Consomme `sku_id` depuis les lignes de commande/colis pour restaurer exactement l'unité concernée lors des annulations/backorders.

Les headers `@db-read` / `@db-write`, manifestes feature-first et graphes doivent refléter `product_skus` dès qu'un fichier le lit ou l'écrit.

---

## 12. Séquencement acté

```text
Lot 0 — Schéma
product_skus + order_items.sku_id + products.inventory_model

Lot 1 — Préparation SKU
admin/candidats + déclaration + audit READY

Lot 2 — Résolution commande
variant_combo → sku_id uniquement pour inventory_model = SKU

Lot 3 — Moteur stock SKU
chemin SKU explicite et validation autoritaire

Lot 4 — Backorder / restauration
propagation sku_id + fail loud

Lot 5 — Bascule produit
READY puis LEGACY_VARIANTS → SKU atomique

Lot 6 — Extinction legacy
couverture complète puis suppression du moteur deux axes
```

Le contrat détail produit et la modal enrichie consomment cette décision via `DOCTRINE_PRODUCT_DETAIL_CONTRACT.md` : options descriptives, unités vendables explicites, sélection finale par `sku_id`.

---

## 13. Conclusion

> **Le modèle à deux axes est structurellement incapable de représenter un stock d'intersection réel. Komerce bascule vers « une unité vendable = un SKU » avec un modèle d'inventaire explicite et une bascule atomique par produit.**
