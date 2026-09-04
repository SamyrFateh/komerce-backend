# Doctrine — Fulfillment mixte local / import

> **Statut** : proposition amendée après challenge repo, avant activation code  
> **Date** : 2026-09-04  
> **Portée** : `catalog`, `local-stock`, `orders`, `logistics`, checkout Boutique et Discovery.  
> **Hiérarchie** : complète `FEATURE_DOCTRINE.md` et `DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md`.

---

## 1. Principe directeur

Komerce ne crée pas deux parcours parce qu'un article est déjà présent localement et qu'un autre doit encore être importé.

> **Une seule commande peut contenir plusieurs temporalités de disponibilité.**

Le contrat client reste :

```text
1 panier
→ 1 checkout
→ 1 paiement
→ 1 commande
→ disponibilité suivie par ligne
```

La complexité d'exécution appartient au système, pas au client.

---

## 2. Product local = Product Komerce normal

Un Product Komerce déjà présent physiquement dans le marché reste un Product Komerce.

`AVAILABLE_NOW` modifie uniquement sa promesse de disponibilité.

Conséquence UX :

- produit simple : le quick-add canonique `+` est autorisé ;
- produit à variantes : ouverture du détail puis ajout ;
- le rail `Disponible ici` ne remplace pas la capacité panier du Product par un parcours parallèle.

> **Disponible maintenant n'est pas un nouveau kind.**

---

## 3. Trois notions à ne jamais confondre

La V1 sépare explicitement trois questions :

```text
fulfillment_source
→ Comment cette ligne doit-elle être exécutée ?

availability_status
→ Où en est opérationnellement cette ligne ?

customer_promise
→ Que peut-on honnêtement annoncer maintenant au client ?
```

Exemple valide :

```text
fulfillment_source = LOCAL_STOCK
availability_status = pending
customer_promise = Disponible maintenant
```

Cela signifie : le stock physique est déjà dans le marché et réservé à cette commande, mais la remise au relais n'est pas encore terminée.

### Invariant

> **`Disponible maintenant` ne signifie pas automatiquement `Prêt au retrait`.**

`availability_status='available'` reste un état opérationnel de la ligne ; il ne doit pas être forcé à la création de commande uniquement parce que la source est locale.

---

## 4. Source de vérité de la disponibilité locale

`local-stock` reste seul owner de la vérité locale.

```text
qty_physical
- allocations actives
= disponibilité réelle
```

Le frontend n'invente jamais `AVAILABLE_NOW`.

Une promesse locale n'est valable que si le backend la projette comme exposable.

---

## 5. Résolution transactionnelle du fulfillment par ligne

Deux sources suffisent en V1 :

```text
LOCAL_STOCK
IMPORT
```

Le serveur les résout dans la transaction de checkout.

### Règle V1 simple

```text
ligne local_stock commercialement exposée dans le market
+ quantité réellement suffisante
→ LOCAL_STOCK

aucune ligne locale commercialement exposée
→ IMPORT

ligne locale exposée mais quantité insuffisante
→ 409 local_stock_insufficient
```

Interdit :

```text
LOCAL_STOCK attendu
→ quantité devenue insuffisante
→ bascule silencieuse IMPORT
```

Le client doit revoir la nouvelle promesse avant de s'engager.

### Verrou transactionnel

Pour éviter un classement local qui deviendrait faux quelques millisecondes plus tard, la résolution locale doit réutiliser le client transactionnel de `orders` et verrouiller la ligne `local_stock` concernée pendant le checkout. Le verrou est conservé jusqu'au `COMMIT/ROLLBACK` qui contient également la création de la commande et l'allocation.

> **Classer, pricer et allouer appartiennent au même verdict transactionnel.**

Le frontend peut afficher une projection de disponibilité ; il ne devient jamais l'autorité de la source de fulfillment.

---

## 6. Snapshot historique minimal

La provenance d'exécution est différente de l'état opérationnel et doit rester lisible après la fin du cycle.

Le snapshot minimal V1 est :

```text
order_items.fulfillment_source
  LOCAL_STOCK
  IMPORT
```

Ce champ est immuable après création de la ligne.

Il répond uniquement à :

> **Comment cette ligne devait-elle être exécutée au moment de la commande ?**

Il est nécessaire car `local_stock_allocations` porte aujourd'hui `local_stock_id + order_id + quantity`, mais pas `order_item_id`. La présence d'allocations ne permet donc pas de reconstruire sans ambiguïté la provenance d'une ligne lorsqu'un même Product apparaît plusieurs fois dans une commande avec des variantes/rails différents.

`availability_status` continue de répondre à :

> **Où en est cette ligne maintenant ?**

---

## 7. Commande mixte

Exemple :

```text
Veste      → LOCAL_STOCK → disponibilité physique immédiate
Savon      → LOCAL_STOCK → disponibilité physique immédiate
Téléphone  → IMPORT      → à venir
```

Le checkout présente deux groupes de lecture :

```text
Disponible maintenant
- Veste
- Savon

À venir
- Téléphone — estimation selon le rail / sourcing
```

Ces groupes sont une **projection de lecture**.

Ils ne justifient pas :

- une deuxième `order` ;
- un deuxième paiement ;
- une nouvelle feature ;
- une table `fulfillment_groups`.

---

## 8. Transport

Le transport international ne s'applique qu'aux lignes `IMPORT`.

```text
LOCAL_STOCK → 0 contribution au transport import
IMPORT      → pricing transport existant
```

`orders` connaît le snapshot de source des lignes et filtre la collection transmise au moteur de pricing. `transport-pricing` n'a pas à devenir propriétaire de la vérité locale et ne doit pas recevoir une branche métier `if local-stock`.

Le coût éventuel d'une livraison locale future est un autre besoin métier et ne doit pas être injecté implicitement dans le rail import.

---

## 9. Disponibilité et lots physiques

Une commande globale peut rester active tandis qu'une partie de ses lignes est déjà disponible ou retirée.

> **Le client n'attend jamais artificiellement l'import pour récupérer un article déjà disponible localement.**

L'état de disponibilité appartient à `order_items`.

Lorsque des lots physiques doivent évoluer séparément, Komerce réutilise le lifecycle `parcels` / `parcel_items` existant.

Le calcul agrégé des parcels sait déjà représenter :

```text
au moins un parcel collected
+ d'autres parcels non collected
→ order.status = available
```

Le statut global de la commande ne doit donc pas être forcé à `collected` parce qu'un seul lot a été remis.

---

## 10. Retrait partiel : extension explicite du pickup canonique

Le challenge du code réel montre que `parcels` sait agréger un retrait partiel, mais que le moteur de remise canonique actuel est encore **order-level** : il synchronise tous les parcels d'une commande lors d'un scan `collected`, exige un résultat parent `collected`, puis invalide le secret de retrait de la commande.

La V1 mixte doit donc étendre ce contrat ; elle ne peut pas prétendre que le retrait partiel est déjà résolu.

### Règle simple

```text
1 événement de retrait
→ 1 parcel ciblé
→ ce parcel devient collected
→ parent recomputé depuis tous les parcels
```

Si d'autres parcels restent à retirer :

```text
order.status reste available
secret utilisé = invalidé
nouveau secret de retrait = généré pour le prochain retrait
```

Si tous les parcels actifs sont retirés :

```text
order.status = collected
secret utilisé = invalidé
pas de régénération
```

### Invariant sécurité

> **Un secret de retrait reste one-shot. Un retrait partiel ne transforme jamais le code actuel en secret réutilisable.**

La V1 ne réactive pas `parcels.pickup_code` en clair comme nouvelle source d'autorité.

---

## 11. Ownership Feature First

### `catalog`

Possède le Product et sa capacité panier.

### `local-stock`

Possède :

- disponibilité physique locale ;
- exposition commerciale locale ;
- résolution engageable sous verrou ;
- allocations `allocate → consume | release`.

Il ne possède ni checkout, ni pricing transport, ni retrait.

### `orders`

Possède :

- la commande ;
- `order_items` ;
- `order_items.fulfillment_source` ;
- orchestration transactionnelle du checkout ;
- projection checkout ;
- états de disponibilité des lignes.

### `logistics`

Possède :

- `parcels` / `parcel_items` ;
- évolution physique autonome des lots ;
- collecte d'un parcel ciblé ;
- synchronisation agrégée vers le statut parent.

### `payments`

Encaisse une seule commande ; aucun split de paiement induit par cette doctrine.

### `recommendations`

Compose Discovery en lecture uniquement.

---

## 12. Réutiliser avant de créer

Le repo possède déjà :

- `local_stock_allocations` ;
- `order_items.availability_status` ;
- `order_items.estimated_available_at` ;
- le service owner de disponibilité des lignes ;
- `parcels` / `parcel_items` ;
- le calcul agrégé partial-collected ;
- le partial shipping / backorder.

La V1 étend ces contrats existants.

> **Ne pas ressusciter `sub_orders`. Ne pas créer `fulfillment_groups` tant qu'un invariant impossible à porter par `order_items + parcels` n'est pas démontré.**

---

## 13. Non-objectifs V1

- multi-entrepôt ;
- livraison locale tarifée ;
- réservation panier TTL ;
- split de paiement ;
- split de commande ;
- nouvelle state machine globale ;
- nouveau kind Discovery ;
- nouveau domaine `fulfillment` ;
- ETA calculé par `local-stock` ;
- fallback automatique local → import ;
- réutilisation d'un secret de retrait après une remise partielle.

---

## 14. Critères d'acceptation

La doctrine est correctement implémentée si :

1. un Product `AVAILABLE_NOW` se comporte comme un Product normal dans le panier ;
2. une commande peut mélanger local et import ;
3. le checkout affiche clairement ce qui est disponible physiquement maintenant et ce qui arrive plus tard ;
4. le serveur, pas le client, détermine la provenance locale ;
5. la résolution locale, le pricing et l'allocation restent cohérents dans une même transaction ;
6. une ligne locale ne contribue pas au transport import ;
7. un conflit de stock local ne produit jamais de fallback silencieux ;
8. `fulfillment_source` et `availability_status` restent deux concepts distincts ;
9. une partie disponible peut être retirée sans clôturer toute la commande ;
10. chaque retrait consomme un secret one-shot ; un nouveau secret n'est généré que s'il reste un lot à retirer ;
11. aucun nouveau domaine, `sub_order` ou `fulfillment_group` n'est créé sans nécessité démontrée.
