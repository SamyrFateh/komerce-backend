# Challenge architecture — Fulfillment mixte local / import

> Date : 2026-09-04  
> Verdict : **AMENDER**  
> Base analysée : `main` au merge `e21fd80b507a7a3d3db75f2e51f62f56c02b2426`

## Questions challengées

### 1. Faut-il un `fulfillment_source` persistant ?

**Oui.**

`local_stock_allocations` est liée à `order_id` et `local_stock_id`, pas à `order_item_id`. Une commande avec plusieurs lignes du même Product ne permet donc pas de reconstruire sans ambiguïté la provenance historique de chaque ligne.

Le plus petit snapshot durable reste :

```text
order_items.fulfillment_source = LOCAL_STOCK | IMPORT
```

Ce n'est pas un statut de workflow.

### 2. Peut-on réutiliser `availability_status` à la place ?

**Non.**

`availability_status` est mutable et décrit la progression opérationnelle. Une ligne import finira elle aussi `available` sans devenir historiquement locale.

De plus, une ligne `LOCAL_STOCK` n'est pas nécessairement immédiatement `available` au sens retrait : le stock peut être au dépôt principal et devoir encore être préparé / acheminé au relais.

### 3. Où résoudre local/import ?

**Dans la transaction `orders`, via un boundary `local-stock`.**

Le resolver doit :

- recevoir le même client transactionnel ;
- verrouiller la ligne `local_stock` ;
- vérifier `commercial_exposure` et quantité engageable ;
- renvoyer `LOCAL_STOCK` ou `IMPORT` ;
- conserver le verrou jusqu'au COMMIT/ROLLBACK.

Cela supprime la fenêtre de race entre affichage, pricing et allocation.

### 4. Où exclure les lignes locales du transport import ?

**Dans l'orchestrateur `orders`, avant l'appel au moteur de pricing.**

`transport-pricing` reste générique et ne devient pas consommateur de `local-stock`.

### 5. Faut-il un nouveau `fulfillment_group` ?

**Non en V1.**

Le repo possède déjà :

- disponibilité par `order_items` ;
- `parcels` / `parcel_items` ;
- partial shipping ;
- agrégation d'une commande partiellement collectée.

Les groupes `Disponible maintenant / À venir` sont une projection de lecture.

### 6. Le retrait partiel est-il déjà couvert ?

**Non. C'est le trou principal trouvé.**

`computeOrderStatus()` sait déjà représenter un état partiellement collecté : un parcel `collected` et un autre actif donnent un parent `available`.

Mais `recordCanonicalCollection()` est encore order-level :

- il crée un scan `collected` sans cible item/parcel ;
- `parcelSync` met donc à jour tous les parcels actifs ;
- le recorder exige ensuite `orderStatus === 'collected'` ;
- il invalide enfin le secret de retrait order-level.

Le pickup doit donc devenir parcel-scoped pour ce cas.

### 7. Comment garder un pickup simple et sûr ?

V1 retenue :

```text
retrait d'un lot
→ cible un parcel
→ secret courant consommé
→ parcel collected
→ parent recomputé
→ s'il reste un parcel : nouveau secret canonique
→ sinon parent collected, aucun nouveau secret
```

On conserve le principe one-shot. On ne réactive pas `parcels.pickup_code` en clair comme source d'autorité.

## Verdict final

La direction générale était bonne, mais trois amendements sont obligatoires avant code :

1. `fulfillment_source` est confirmé comme snapshot minimal ;
2. `LOCAL_STOCK` ne doit pas forcer `availability_status='available'` à la création ;
3. le retrait partiel nécessite une extension pickup parcel-scoped + rotation du secret.

Aucun nouveau domaine `fulfillment`, aucune table de groupe et aucune seconde commande ne sont justifiés à ce stade.
