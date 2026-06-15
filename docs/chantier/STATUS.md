# Komerce — État opératoire du chantier

> Mis à jour : **2026-06-15**  
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`  
> Rôle : point de vérité opératoire pour Sonnet/agent dev.  
> Principe : un audit historique est un indice, pas une vérité. Une dette est ouverte seulement si le code actuel, la DB live ou une doc active la confirme.

---

## 1. Point d'entrée obligatoire

Lire dans cet ordre :

1. [`AGENTS.md`](../../AGENTS.md) ;
2. [`docs/README.md`](../README.md) ;
3. ce fichier `docs/chantier/STATUS.md` ;
4. [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](../doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) ;
5. [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](../implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md) ;
6. docs techniques listées dans `docs/README.md` seulement si la zone touchée l'exige.

Ne pas repartir d'un ancien audit, prompt, changelog, PR fermée ou document non listé dans `docs/README.md`.

---

## 2. Doctrine produit active — panier partagé

Le panier partagé est **Boutique First**.

```txt
Tout commence dans la boutique.
Tout se comprend dans la boutique.
Tout revient dans la boutique.
```

Règle : Komerce ne construit pas une cagnotte ni un workspace financier. Komerce matérialise un achat réel, visible, plafonné au reste dû.

Les documents V4.1, collective workspace, cagnotte, engagement ou financement collectif sont historiques sauf reprise explicite dans les deux documents actifs Boutique First.

État de référence vérifié :

- Entrée participant : `/boutique/?p=TOKEN`.
- Anciennes URLs `/c/:token`, `/cart/shared*`, `/account/shared-carts` redirigent boutique.
- Deux natures : `ready_to_pay` et `needs_validation`.
- `ready_to_pay` crée un panier payable (`status = closed`) avec `payment_window_ends_at`.
- `needs_validation` reste consultable (`status = open`) jusqu'à ouverture paiement.
- Bouton attendu : `Régler ma part`.
- Participant : lecture seule, snapshot produit, aucun ajout/modification/suppression.
- Paiement public : seulement si panier payable côté moteur.
- Montant : plafonné au `remaining_kmf` réel côté serveur.
- Retour Stripe : `/boutique/?p=TOKEN&shared_payment=success|cancel`.
- Statuts humains attendus : `En préparation`, `Ouvert au paiement`, `Fermé`, `Finalisé`, `Annulé`.

---

## 3. Dettes ouvertes — panier partagé / docs / sécurité

### D-01 — Tests manuels Boutique First à exécuter en réel

Statut : **ouvert**.

Tests :

1. Prêt à payer : création, lien, bouton `Régler ma part`, paiement, retour boutique, reste mis à jour.
2. À valider ensemble : consultation sans paiement, ouverture plus tard, apparition du bouton.
3. Lecture seule : fiche article snapshot, aucun bouton d'action.
4. Statuts : aucun statut technique visible côté participant.
5. Dépassement du reste : maximum annoncé et borné avant paiement.

### D-02 — Vocabulaire V4.1 dans le code interne shared-cart

Statut : **dette de lisibilité — pas de traitement sans tests**.

`routes/shared-cart.js` conserve le vocabulaire V4.1 (`OPEN`, `CLOSED`, `AWAITING_CHOICE`, etc.). Ce n'est pas un bug produit tant que l'UI Boutique First projette les bons statuts humains.

Règles :

- ne pas renommer les statuts DB mécaniquement ;
- découpe possible seulement avec tests statuts visibles/techniques ;
- aucune UI participant ne doit exposer `open`, `closed`, `awaiting_choice`, `ordered`, `expired`, `archived`, “financé”, “cagnotte”, “engagement”, “workspace collectif”.

### D-03 — `revoked_tokens` / N4 JWT

Statut : **partiellement clôturé — code vérifié, DB live à vérifier**.

Câblage code confirmé : `routes/auth.js` génère un `jti`, logout insère dans `revoked_tokens`, `middleware/auth.js` vérifie la révocation, `bootstrap/crons.js` lance le cleanup, migration attendue `072_jwt_revocation.sql`.

Action restante : vérifier sur Railway :

```sql
SELECT 1 FROM revoked_tokens LIMIT 1;
```

Si absent : appliquer `migrations/072_jwt_revocation.sql`.

### D-04 — Docs Boutique historiques subordonnées

Statut : **surveillance documentaire**.

`public/boutique/docs/**` est historique/généré. Docs Boutique actives :

- `docs/boutique/README.md` ;
- `public/boutique/README.md` ;
- `docs/boutique/BOUTIQUE_CSS_PIPELINE.md` ;
- `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` ;
- `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`.

---

## 4. Audit métier bout-en-bout — dettes ouvertes

Cet audit reprend la grille métier complète : catalogue → boutique → panier → checkout → commande → paiement/stock → panier partagé → suivi → sourcing → facture/notifs → dashboards.

### COUTURE-01 — Variantes affichées mais non propagées au panier/checkout

Statut : **ouvert — priorité P0/P1**.

État vérifié : le backend accepte `items[].variant_combo`, `GET /api/products/:id` expose les variantes, la fiche produit les affiche, mais le panier frontend ajoute seulement `state.modalProduct`. `submitOrder()` et `_createKomerceOrderForPayPal()` envoient `product_id` + `quantity`, sans `variant_combo`.

Conséquence : l'utilisateur peut croire avoir choisi une taille/couleur, mais la commande part comme produit simple.

À corriger : stocker `variant_combo` dans la ligne panier, rendre le choix obligatoire si nécessaire, distinguer deux variantes d'un même produit dans le panier, envoyer `variant_combo` au checkout Stripe/cash/PayPal, afficher la variante partout.

### COUTURE-02 — Variantes couleur ignorées côté fiche produit

Statut : **ouvert — priorité P1**.

`_renderVariants()` ignore explicitement `couleur`, `color`, `coloris`, `teinte`. Une variante couleur/SKU peut donc exister côté backend mais ne pas être choisissable.

À corriger : traiter les couleurs comme des choix produits réels avec label/image/stock/prix.

### COUTURE-03 — Stock variante non décrémenté si stock global produit `NULL`

Statut : **ouvert — priorité P0/P1 backend**.

`services/order-payment-confirmation.js` filtre les lignes sur `p.stock IS NOT NULL`, puis vérifie/décrémente les variantes seulement sur ces lignes. Si un produit est géré uniquement par `product_variants.stock` avec `products.stock = NULL`, le paiement peut ne pas décrémenter la variante. À l'annulation, la machine peut restaurer une variante qui n'a jamais été décrémentée.

À corriger : inclure les items `has_variants = true` même si `p.stock IS NULL`, puis séparer stock global et stock variante.

### COUTURE-04 — Catalogue frontend demande 1000 produits mais API plafonne à 200

Statut : **ouvert — priorité P1 si catalogue > 200 produits**.

`loadProducts()` demande `limit: 1000`, mais `routes/products.js` force `MAX_LIMIT = 200`. Au-delà de 200 produits actifs, la boutique peut masquer silencieusement une partie du catalogue.

À corriger : pagination frontend ou convention backend/frontend explicite.

### COUTURE-05 — `variant_type` injecté dans le DOM sans garde suffisante

Statut : **ouvert — priorité P2 sécurité/hygiène**.

`_renderVariants()` injecte `type` dans `innerHTML`. Corriger via DOM + `textContent` ou sanitize.

### COUTURE-06 — Variantes peu visibles dans suivi/admin/sourcing/facture

Statut : **ouvert — priorité P1 métier**.

`order_items.variant_combo` existe, mais plusieurs lectures ne le relisent pas : `routes/orders/detail.js`, `routes/client-tracking.js`, `routes/order-api-v2.js`, `parcel-auto-create-service`, facture, notifications.

À corriger : définir une représentation lisible unique (`Taille: M · Couleur: Bleu`) et l'afficher dans panier, checkout, commande, suivi, admin, sourcing, colis, facture, notifications.

### COUTURE-07 — Panier partagé perd les variantes

Statut : **ouvert — priorité P1 Boutique First**.

`b-share-cart.js#createSharedCart()` envoie seulement `product_id` + `quantity`. `shared-cart-engine` enrichit par `product_id`, snapshotte sans `variant_combo`, puis `convertSharedCartToOrder()` recrée des `order_items` sans variante.

À corriger : étendre contrat cart items, snapshot `shared_cart_items`, vue publique et conversion commande.

### COUTURE-08 — Admin variante : `deleteVariant()` incompatible avec `variant_combo`

Statut : **ouvert — priorité P1 admin/data**.

`product-admin-service.deleteVariant()` vérifie `order_items.variant_id`, alors que le modèle actuel est `order_items.variant_combo jsonb`. Risque : erreur SQL ou suppression mal protégée d'une variante déjà utilisée.

À corriger : guard via `variant_combo` (`variant_type` + `variant_value`) et statuts réels.

### COUTURE-09 — Prix variante affiché mais non porté par le panier

Statut : **ouvert — priorité P1 si variantes avec prix spécifique**.

`_renderVariants()` peut changer le prix visuel, mais `addToCart()` conserve `product.price_kmf` et `cartTotal()` calcule sur `i.product.price_kmf`.

À corriger : porter `unit_price_kmf` au niveau ligne panier, issu de la variante choisie si surcharge.

---

## 5. Dettes ouvertes — paiement, cash, PayPal, wallet, facture, notifications

### PAY-01 — PayPal checkout affiché mais bloqué à la création commande

Statut : **ouvert — priorité P1 si PayPal visible en prod**.

Le frontend peut envoyer `payment_mode: 'paypal_eur'`, mais `validators/orders.create` et `routes/orders/create.js` n'acceptent que `stripe_eur` et `cash_relais`. Le schéma DB et `routes/payments-paypal.js` savent pourtant gérer PayPal ensuite.

À corriger : aligner validator, route `/api/orders`, création PayPal Order et capture. Tester : création commande PayPal → create-order → capture → `confirmPaymentCycle`.

### PAY-02 — PayPal capture ne déclenche pas les hooks métier post-paiement

Statut : **ouvert — priorité P1**.

`services/payment-paypal.js#capturePaypalOrder()` appelle bien `confirmPaymentCycle`, mais ni le service ni `routes/payments-paypal.js` ne déclenchent ensuite explicitement les mêmes effets que Stripe/cash : `notifyPaymentConfirmed`, `triggerPurchasing`, fidélité/gros panier.

Conséquence : commande PayPal peut être payée et stock décrémenté, mais sans notification, sans sourcing fournisseur, sans fidélité.

À corriger : extraire un hook post-confirmation commun Stripe/cash/PayPal/wallet.

### CASH-01 — Deux chemins cash concurrents avec effets post-paiement différents

Statut : **ouvert — priorité P1 métier/opérationnel**.

Chemins constatés :

- `/api/payments/cash/confirm` par `cash_ref_code` → `confirmCashByReference()` → `confirmPaymentCycle()` + notification + `triggerPurchasing`.
- `/api/cash/collect/:orderId` → `collectCash()` → `confirmPaymentCycle()` + insert `cash_collections`, mais pas de notification/sourcing post-commit visible dans `routes/cash.js`.
- `/api/pickup/pay-cash/:orderId` → `confirmPickupCashPayment()` → `confirmPaymentCycle()` + code retrait + `triggerPurchasing`, mais hook fidélité seulement ici.

Conséquence : selon l'écran utilisé par l'agent, la commande cash peut avoir des effets métier différents.

À corriger : définir un seul chemin canonique cash ou extraire un `postPaymentConfirmedHooks(orderId, channel)` commun.

### CASH-02 — `/api/cash/collect/:orderId` ne vérifie pas explicitement `payment_status='pending'`

Statut : **ouvert — priorité P1**.

`collectCash()` refuse certains `orders.status`, vérifie `payment_mode`, et empêche doublon `cash_collections`, mais ne filtre pas explicitement `payment_status = 'pending'`. `confirmPaymentCycle()` est idempotent si déjà confirmé, mais la route peut quand même insérer une collection cash avant de voir un noop.

À corriger : charger `payment_status`, refuser si déjà `paid`, ou déplacer l'insert collection après confirmation effective.

### FACT-01 — Facture : incohérence prix unitaire / total ligne

Statut : **ouvert — priorité P1 comptable**.

`routes/orders/create.js` insère `order_items.price_kmf = product.price_kmf` donc prix unitaire. `services/invoice-service.js` calcule pourtant `unit_price = price_kmf / quantity` et `total = price_kmf`.

Conséquence : pour quantité > 1, détail facture faux, même si `orders.total_kmf` reste correct.

À corriger : facture = `unit_price = price_kmf`, `total = price_kmf * quantity`, ou changer partout la convention `order_items.price_kmf`.

### NOTIF-01 — Notifications payeur/bénéficiaire : jointure recipient probablement erronée

Statut : **ouvert — priorité P1 si suivi double critique**.

`notification-service.js` charge parfois `recipient_phone` avec `LEFT JOIN users r ON r.id = o.recipient_id`, alors que `recipient_id` pointe vers `recipients`. Risque : perte du bénéficiaire réel dans les notifications.

À corriger : joindre `recipients r ON r.id = o.recipient_id`. Tester payeur diaspora + bénéficiaire local.

### LOY-01 — Fidélité/gros panier non appelée par tous les paiements

Statut : **ouvert — priorité P1 si fidélité active**.

`loyalty-service.handleOrderConfirmed()` existe, mais la recherche code montre un appel actif seulement depuis `pickup-secret.js`. Stripe, PayPal, `/api/payments/cash/confirm`, `/api/cash/collect`, wallet full ne semblent pas appeler le même hook.

Conséquence : les gros paniers peuvent compter seulement pour certains canaux.

À corriger : brancher la fidélité dans le hook commun post-confirmation.

---

## 6. Dettes ouvertes — sourcing, logistique, suivi, pickup

### SRC-01 — `purchase_orders` : routes en décalage avec le schéma actuel

Statut : **ouvert — priorité P0/P1 hub Dubai**.

`db/schema.sql` expose `purchase_orders.qty` et `received_qty`. `routes/purchasing.js#/order/:order_id/completeness` lit `qty_ordered` et `qty_received`.

Conséquence : l'endpoint de complétude peut casser SQL ou retourner des valeurs nulles.

À corriger : remplacer par `qty` / `received_qty` et tester réception partielle/totale.

### SRC-02 — Réception hub écrit des statuts absents du check constraint schema

Statut : **ouvert — priorité P0/P1 à vérifier DB live**.

`purchasing-receive-service.js` écrit `status = 'received'` ou `'partially_received'`. Le schéma visible contraint `purchase_orders.status` à `pending`, `notified`, `confirmed`, `shipped`, `hub_received`, `cancelled`.

Conséquence : si la DB live a ce constraint, la réception hub échoue.

À vérifier sur Railway :

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'purchase_orders'::regclass
  AND contype = 'c';
```

À corriger : aligner statuts code + DB, ou utiliser `hub_received` + champs quantité.

### SRC-03 — Sourcing PO idempotent par fournisseur, pas par ligne commande

Statut : **ouvert — priorité P1 avec variantes**.

`triggerPurchasing()` évite les doublons avec `(order_id, product_supplier_id, status != cancelled)`. Si deux lignes du même produit/fournisseur apparaissent dans une commande (cas futur : variante M + variante L, ou deux lignes séparées), la seconde peut être ignorée.

À corriger : idempotence par `order_item_id` ou consolidation volontaire des quantités avec détail variante.

### PICKUP-01 — Reçu pickup lit `relais.city`, absent du schéma relais

Statut : **ouvert — priorité P1 si reçu cash utilisé**.

`routes/pickup-secret.js#/receipt` sélectionne `r.city AS relais_city`. Le schéma `relais` expose `name`, `agent_name`, `phone`, `address`, `zone`, `hours`, `island`, `island_code`, mais pas `city`.

Conséquence : le reçu pickup peut échouer SQL.

À corriger : remplacer par `r.zone`, `r.island` ou `r.address`, ou ajouter réellement la colonne si voulue.

### TRACK-01 — Suivi rapide par référence obsolète

Statut : **ouvert — priorité P1 UX/suivi**.

`b-tracking.js` reconstruit une référence `KMR-2025-XXXX` à partir de 4 chiffres, alors que `services/order-service.js` génère désormais `K` + 6 caractères alphanumériques.

À corriger : saisie référence complète, lien/QR de suivi, ou historique par OTP téléphone.

### TRACK-02 — Timeline frontend à harmoniser avec statuts réels

Statut : **ouvert — priorité P2**.

`b-tracking.js` construit la timeline sur `pending`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, tandis que l'app connaît aussi `confirmed`, `paid`, `ordered`, `cancelled`, `refunded`.

À corriger : projection timeline unique pour tous les statuts métier.

---

## 7. Dettes ouvertes — modules, pricing, moteur économique

### MOD-01 — Module couture : calcul prix séparé du vrai panier/commande

Statut : **ouvert — à vérifier avant activation module couture public**.

`routes/modules.js#/price` sait calculer des scénarios couture (`ready_made`, `fabric_only`, `custom_from_fabric`), mais la chaîne panier/checkout actuelle reste centrée sur `products.price_kmf`. La continuité module → panier → commande → sourcing → facture n'est pas démontrée.

À corriger/tester : un produit couture sur mesure doit porter son type, tissu, modèle, métrage, prix final, délai, et l'information doit survivre au checkout, paiement, sourcing, suivi et facture.

### ECO-01 — Moteur économique : vérifier raccord dashboard ↔ pricing ↔ commandes

Statut : **ouvert — audit fonctionnel, pas bug bloquant confirmé**.

Le moteur économique (`routes/economic-engine.js`, `services/economic-engine-queries.js`, `pricing-engine.js`) existe, mais il faut vérifier que les dashboards racontent clairement : charges → allocation → coût complet → prix recommandé → impact marge/commande.

À faire : test UX admin avec modification d'une variable économique et vérification de son impact visible sur recommandations/prix/cohérence.

---

## 8. Faux positifs / dettes écartées après vérification

- **FP-01** — Lien partagé checkout direct : écarté, lien actuel `/boutique/?p=TOKEN`.
- **FP-02** — Paiement partagé au-delà du reste : écarté côté serveur, montant plafonné.
- **FP-03** — Participant modifie panier partagé : écarté côté API publique.
- **FP-04** — Retour Stripe page morte : écarté, retour boutique avec paramètres.
- **FP-05** — PR fermées non mergées = dettes : écarté par défaut.
- **FP-06** — BUG-014 JWT localStorage encore ouvert : écarté par défaut après migration httpOnly cookie mergée ; réouvrir seulement avec preuve actuelle.
- **FP-07** — Routes collective-workspaces/payments montées : écarté, non montées ; tables `collective_*` historiques.
- **FP-08** — `/api/admin/pilotage` et `/api/admin/stats` alias API actifs : écarté, canonique `/api/dashboard`.
- **FP-09** — R8B products-admin encore à refactorer : écarté, mutations admin déjà déléguées à `product-admin-service.js`. Dette résiduelle : tests.
- **FP-10** — Ancien audit frontend critique vrai tel quel : écarté. Il reste utile comme grille, mais ses bugs initiaux doivent être revérifiés un par un.

---

## 9. Tests prioritaires

### Panier partagé Boutique First

1. Prêt à payer.
2. À valider ensemble.
3. Lecture seule.
4. Statuts humains.
5. Dépassement du reste.

### Couture / variantes

1. Produit sans variante : parcours inchangé.
2. Taille seule : choix obligatoire, panier affiche taille, checkout envoie `variant_combo`.
3. Couleur seule : choix visible, panier affiche couleur, checkout envoie `variant_combo`.
4. Couleur + taille : deux dimensions conservées.
5. Deux variantes du même produit : deux lignes distinctes.
6. Variante en rupture : ajout impossible.
7. Variante avec prix spécifique : prix modal = panier = checkout = commande.
8. Produit `products.stock = NULL` + `product_variants.stock = 1` : paiement décrémente variante.
9. Stripe/cash/wallet/PayPal : tous déclenchent stock + hooks métier.
10. Panier partagé : variante conservée snapshot → paiement → commande.
11. Suivi/admin/sourcing/facture : variante visible partout.
12. `deleteVariant` : bloque une variante utilisée par une commande.

### Paiement / cash / PayPal / facture / notifications

1. PayPal complet : `/api/orders` accepte `paypal_eur`, create-order, capture, hooks post-paiement.
2. Cash : les trois chemins cash produisent les mêmes effets métier ou deux sont désactivés.
3. Facture quantité > 1 cohérente.
4. Notification payeur + bénéficiaire.
5. Fidélité gros panier sur Stripe, cash, PayPal, wallet full.

### Sourcing / hub / pickup / suivi

1. `purchase_orders` completeness : `qty` / `received_qty`.
2. Réception hub : statuts compatibles DB live.
3. Deux lignes même fournisseur/produit : pas de perte sourcing.
4. Reçu pickup cash : pas de colonne inexistante.
5. Suivi rapide : format référence actuel.

### Product admin service

Créer `tests/unit/product-admin-service.test.js` : create, update, delete soft, setMainImage, appendImages, replaceVariants, deleteVariant avec commande active.

---

## 10. Règle de mise à jour

Quand une dette est traitée :

1. citer le fichier/code qui la ferme ;
2. déplacer l'ancien point en faux positif ou le supprimer ;
3. corriger la doc active concernée dans la même PR ;
4. ne jamais réactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne devient opératoire sans être ajouté à `docs/README.md`.
