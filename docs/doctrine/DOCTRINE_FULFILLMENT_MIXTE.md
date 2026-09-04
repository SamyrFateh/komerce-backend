# Doctrine — Fulfillment mixte local / import

> **Statut** : proposition à challenger avant activation code  
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

## 3. Source de vérité de la disponibilité locale

`local-stock` reste seul owner de la vérité locale.

```text
qty_physical
- allocations actives
= disponibilité réelle
```

Le frontend n'invente jamais `AVAILABLE_NOW`.

Une promesse locale n'est valable que si le backend la projette comme exposable.

---

## 4. Résolution du fulfillment par ligne

Le serveur classe chaque ligne au moment du checkout.

Deux sources suffisent en V1 :

```text
LOCAL_STOCK
IMPORT
```

Cette provenance est distincte de l'état opérationnel de disponibilité.

Exemple :

```text
fulfillment_source = IMPORT
availability_status = available
```

est valide lorsque l'article importé est finalement arrivé.

### Invariant

> **Le client ne choisit jamais autoritairement `LOCAL_STOCK`.**

Il peut exprimer un choix de transport pour l'import ; il ne peut pas déclarer lui-même qu'un produit existe physiquement localement.

---

## 5. Commande mixte

Exemple :

```text
Veste      → LOCAL_STOCK → disponible maintenant
Savon      → LOCAL_STOCK → disponible maintenant
Téléphone  → IMPORT      → à venir
```

Le checkout doit présenter :

```text
Disponible maintenant
- Veste
- Savon

À venir
- Téléphone — estimation selon le rail / sourcing
```

Ces groupes sont une **projection de lecture**.

Ils ne justifient pas à eux seuls :

- une deuxième `order` ;
- un deuxième paiement ;
- une nouvelle feature ;
- une table `fulfillment_groups`.

---

## 6. Disponibilité et retrait partiel

Une commande globale peut rester active tandis qu'une partie de ses lignes est déjà disponible.

> **Le client n'attend jamais artificiellement l'import pour récupérer un article déjà disponible localement.**

L'état de disponibilité appartient à `order_items`.

Lorsque des lots physiques doivent évoluer séparément, Komerce réutilise le lifecycle `parcels` / `parcel_items` existant.

Le statut global de la commande ne doit pas être forcé à `collected` parce qu'un seul lot a été remis.

---

## 7. Transport

Le transport international ne s'applique qu'aux lignes qui nécessitent réellement un transport international.

```text
LOCAL_STOCK → 0 contribution au transport import
IMPORT      → pricing transport existant
```

Le coût éventuel d'une livraison locale future est un autre besoin métier et ne doit pas être injecté implicitement dans le rail import.

---

## 8. Concurrence et promesse fiable

L'affichage `Disponible maintenant` reste une projection instantanée.

La décision engageante se fait pendant la création transactionnelle de la commande avec le mécanisme d'allocation `local-stock` existant.

Si le stock local n'est plus suffisant à cet instant :

```text
checkout → conflit explicite
```

Interdit :

```text
Disponible maintenant
→ stock épuisé
→ bascule silencieuse en import 3 semaines
```

Le client doit revoir la nouvelle promesse avant de s'engager.

---

## 9. Ownership Feature First

### `catalog`

Possède le Product et sa capacité panier.

### `local-stock`

Possède disponibilité physique locale et allocations.

### `orders`

Possède :

- la commande ;
- `order_items` ;
- le snapshot de provenance d'exécution par ligne ;
- la projection checkout ;
- les états de disponibilité des lignes.

### `logistics`

Possède l'exécution physique autonome via parcels.

### `payments`

Encaisse une seule commande ; aucun split de paiement induit par cette doctrine.

### `recommendations`

Compose Discovery en lecture uniquement.

---

## 10. Réutiliser avant de créer

Le repo possède déjà :

- `local_stock_allocations` ;
- `order_items.availability_status` ;
- `order_items.estimated_available_at` ;
- le service owner de disponibilité des lignes ;
- `parcels` / `parcel_items` ;
- le partial shipping / backorder.

La V1 doit donc **étendre les contrats existants**, pas réinventer une orchestration parallèle.

En particulier :

> **Ne pas ressusciter `sub_orders`. Ne pas créer `fulfillment_groups` tant qu'un invariant impossible à porter par `order_items + parcels` n'est pas démontré.**

---

## 11. Snapshot minimal pressenti

Si aucune donnée existante ne permet de conserver sans ambiguïté la provenance d'exécution, `orders` peut ajouter un snapshot immuable sur la ligne :

```text
order_items.fulfillment_source
  LOCAL_STOCK
  IMPORT
```

Ce champ n'est pas un état de workflow.

Il répond uniquement à :

> **Comment cette ligne devait-elle être exécutée au moment de la commande ?**

`availability_status` continue de répondre à :

> **Où en est cette ligne maintenant ?**

---

## 12. Non-objectifs V1

- multi-entrepôt ;
- livraison locale tarifée ;
- réservation panier TTL ;
- split de paiement ;
- split de commande ;
- nouvelle state machine globale ;
- nouveau kind Discovery ;
- nouveau domaine `fulfillment` ;
- ETA calculé par `local-stock`.

---

## 13. Critères d'acceptation

La doctrine est correctement implémentée si :

1. un Product `AVAILABLE_NOW` se comporte comme un Product normal dans le panier ;
2. une commande peut mélanger local et import ;
3. le checkout affiche clairement ce qui est disponible maintenant et ce qui arrive plus tard ;
4. le serveur, pas le client, détermine la provenance locale ;
5. une ligne locale n'est pas facturée comme un import ;
6. un conflit de stock local ne produit jamais de fallback silencieux ;
7. une partie disponible peut être retirée sans clôturer toute la commande ;
8. aucun nouveau domaine ou modèle persistant n'est créé sans nécessité démontrée.
