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

Action restante Railway :

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

## 4. Couture / variantes — en attente d'architecture finale

### ARCH-COUTURE-00 — Architecture métier couture non arrêtée

Statut : **en attente — arbitrage produit/architecture requis avant patch**.

Le vrai sujet couture n'est pas seulement un bug de variantes. L'architecture finale n'est pas encore arrêtée. Les points `COUTURE-*` ci-dessous sont donc des **constats d'audit** et des **risques à garder visibles**, mais ils ne doivent pas être traités comme des tickets de correction immédiats.

Interdiction opératoire :

- ne pas coder un système définitif de variantes/couture avant décision d'architecture ;
- ne pas figer `variant_combo`, `variant_id`, prix variante, stock variante, panier partagé variante ou sourcing variante sans doctrine cible ;
- ne pas faire une migration DB structurante couture sans document d'architecture validé ;
- ne pas casser le parcours produit simple existant.

Décisions à prendre avant implémentation :

1. **Nature métier** : simple variante catalogue, module couture sur mesure, ou deux voies séparées ?
2. **Identité ligne panier** : produit seul, produit + variante, ou ligne panier autonome ?
3. **Prix** : prix produit, prix variante, prix calculé module, ou snapshot ligne ?
4. **Stock** : stock produit, stock variante, stock tissu/métrage, ou stock fournisseur ?
5. **Sourcing** : PO par produit, par ligne commande, par variante, ou par module couture ?
6. **Panier partagé** : snapshot variante/module figé ou recalcul à la finalisation ?
7. **Affichage métier** : quelle information doit voir client, créateur, admin, hub, relais, fournisseur, facture ?
8. **DB cible** : garder `variant_combo jsonb`, ajouter `variant_id`, créer `cart_line_id`, ou créer une table dédiée aux options/modules ?

Livrable attendu avant code : document court d'architecture cible, idéalement `docs/doctrine/COUTURE_ARCHITECTURE.md` ou `docs/implementation/COUTURE_ARCHITECTURE.md`, puis ajout dans `docs/README.md`.

### COUTURE-01 — Variantes affichées mais non propagées au panier/checkout

Statut : **en attente ARCH-COUTURE-00**.

Constat : le backend accepte `items[].variant_combo`, `GET /api/products/:id` expose les variantes, la fiche produit les affiche, mais le panier frontend ajoute seulement `state.modalProduct`. `submitOrder()` et `_createKomerceOrderForPayPal()` envoient `product_id` + `quantity`, sans `variant_combo`.

Ne pas patcher isolément tant que l'identité de ligne panier et le modèle cible ne sont pas décidés.

### COUTURE-02 — Variantes couleur ignorées côté fiche produit

Statut : **en attente ARCH-COUTURE-00**.

Constat : `_renderVariants()` ignore `couleur`, `color`, `coloris`, `teinte`. Une variante couleur/SKU peut exister côté backend mais ne pas être choisissable.

À reprendre seulement après décision sur la représentation des options produit.

### COUTURE-03 — Stock variante non décrémenté si stock global produit `NULL`

Statut : **en attente ARCH-COUTURE-00**.

Constat : `services/order-payment-confirmation.js` filtre les lignes sur `p.stock IS NOT NULL`, puis vérifie/décrémente les variantes seulement sur ces lignes.

Ne pas corriger isolément sans choisir le modèle stock cible : produit, variante, tissu/métrage, fournisseur ou mix.

### COUTURE-04 — Catalogue frontend demande 1000 produits mais API plafonne à 200

Statut : **ouvert — hors arbitrage couture**.

`loadProducts()` demande `limit: 1000`, mais `routes/products.js` force `MAX_LIMIT = 200`. Au-delà de 200 produits actifs, la boutique peut masquer silencieusement une partie du catalogue.

À corriger indépendamment : pagination frontend ou convention backend/frontend explicite.

### COUTURE-05 — `variant_type` injecté dans le DOM sans garde suffisante

Statut : **en attente ARCH-COUTURE-00 — sauf correction hygiène sans changer l'architecture**.

Constat : `_renderVariants()` injecte `type` dans `innerHTML`. Une correction DOM + `textContent` est possible si elle ne modifie pas le modèle métier.

### COUTURE-06 — Variantes peu visibles dans suivi/admin/sourcing/facture

Statut : **en attente ARCH-COUTURE-00**.

Constat : `order_items.variant_combo` existe, mais plusieurs lectures ne le relisent pas : détail commande, tracking, API v2, colis, facture, notifications.

À reprendre après définition d'une représentation lisible unique des options/modules.

### COUTURE-07 — Panier partagé perd les variantes

Statut : **en attente ARCH-COUTURE-00**.

Constat : `b-share-cart.js#createSharedCart()` envoie seulement `product_id` + `quantity`. `shared-cart-engine` enrichit par `product_id`, snapshotte sans `variant_combo`, puis `convertSharedCartToOrder()` recrée des `order_items` sans variante.

À reprendre après décision : snapshot figé ou recalcul à finalisation.

### COUTURE-08 — Admin variante : `deleteVariant()` incompatible avec `variant_combo`

Statut : **en attente ARCH-COUTURE-00**.

Constat : `product-admin-service.deleteVariant()` vérifie `order_items.variant_id`, alors que le modèle actuel visible est `order_items.variant_combo jsonb`.

À reprendre après décision DB cible : `variant_id`, `variant_combo`, ou table options dédiée.

### COUTURE-09 — Prix variante affiché mais non porté par le panier

Statut : **en attente ARCH-COUTURE-00**.

Constat : `_renderVariants()` peut changer le prix visuel, mais `addToCart()` conserve `product.price_kmf` et `cartTotal()` calcule sur `i.product.price_kmf`.

À reprendre après décision : prix produit, prix variante, prix module ou snapshot de ligne.

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

Statut : **ouvert — priorité P1 avec variantes, en attente ARCH-COUTURE-00 pour le cas variantes**.

`triggerPurchasing()` évite les doublons avec `(order_id, product_supplier_id, status != cancelled)`. Si deux lignes du même produit/fournisseur apparaissent dans une commande, la seconde peut être ignorée.

À corriger pour le produit simple : vérifier consolidation volontaire des quantités. À reprendre pour les variantes après ARCH-COUTURE-00.

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

Statut : **en attente ARCH-COUTURE-00**.

`routes/modules.js#/price` sait calculer des scénarios couture (`ready_made`, `fabric_only`, `custom_from_fabric`), mais la chaîne panier/checkout actuelle reste centrée sur `products.price_kmf`. La continuité module → panier → commande → sourcing → facture n'est pas démontrée.

À reprendre après décision : module couture intégré au panier ou voie séparée devis/sur-mesure.

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

### À traiter maintenant — hors architecture couture

1. PayPal complet : `/api/orders` accepte `paypal_eur`, create-order, capture, hooks post-paiement.
2. Cash : les trois chemins cash produisent les mêmes effets métier ou deux sont désactivés.
3. Facture quantité > 1 cohérente.
4. Notification payeur + bénéficiaire.
5. Fidélité gros panier sur Stripe, cash, PayPal, wallet full.
6. `purchase_orders` completeness : `qty` / `received_qty`.
7. Réception hub : statuts compatibles DB live.
8. Reçu pickup cash : pas de colonne inexistante.
9. Suivi rapide : format référence actuel.
10. Catalogue > 200 produits : pagination ou limite explicite.

### À mettre en attente — dépend de ARCH-COUTURE-00

1. Variantes panier/checkout.
2. Couleur/taille et choix obligatoire.
3. Stock variante.
4. Prix variante.
5. Panier partagé avec variantes.
6. Variante visible suivi/admin/sourcing/facture.
7. `deleteVariant` selon modèle DB cible.
8. Module couture sur mesure dans panier ou voie devis séparée.

### Product admin service

Créer `tests/unit/product-admin-service.test.js` : create, update, delete soft, setMainImage, appendImages, replaceVariants, deleteVariant avec commande active — sauf parties `deleteVariant` dépendantes du modèle final couture.

---

## 10. Règle de mise à jour

Quand une dette est traitée :

1. citer le fichier/code qui la ferme ;
2. déplacer l'ancien point en faux positif ou le supprimer ;
3. corriger la doc active concernée dans la même PR ;
4. ne jamais réactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne devient opératoire sans être ajouté à `docs/README.md`.
