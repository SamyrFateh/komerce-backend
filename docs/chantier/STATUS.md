# Komerce — Etat operatoire du chantier

> Mis a jour : **2026-06-15**  
> Repo : `SamyrFateh/komerce-backend` — branche de reference : `main`  
> Commit de reference : `71e7efc15290801c40531d6599c9a22ae87401df`  
> Role : point de verite operatoire pour Sonnet/agent dev.  
> Principe : un audit historique est un indice, pas une verite. Une dette est ouverte seulement si le code actuel, la DB live ou une doc active la confirme.

---

## 0. Tampon de validation — livraison code

Statut : **TAMPON CODE VALIDE — 2026-06-15**.

Validation effectuee :

- Deploiement relance sans crash apres ajout de `services/payment-paypal-events.js`.
- Inspection GitHub de `main` au commit `71e7efc15290801c40531d6599c9a22ae87401df`.
- Verification des invariants livrés : PayPal, cash, fidelite post-commit, facture, notifications, sourcing hub, pickup/scan, suivi reference, catalogue 1000 produits.
- Aucun run GitHub Actions associe au commit `main` n'a ete detecte via le connecteur ; les tests Jest restent a executer dans un environnement avec checkout complet.

Limites du tampon :

- Tampon code + boot, pas tampon metier live complet.
- Les tests sandbox/live restent recommandes pour PayPal sandbox, DB live purchase_orders, recu pickup, facture quantite > 1 et parcours notification reel.
- Couture/variantes reste volontairement hors livraison, en attente `ARCH-COUTURE-00`.

---

## 1. Point d'entree obligatoire

Lire dans cet ordre :

1. `AGENTS.md` ;
2. `docs/README.md` ;
3. `docs/chantier/STATUS.md` ;
4. `docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md` ;
5. `docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md` ;
6. docs techniques listees dans `docs/README.md` seulement si la zone touchee l'exige.

Ne pas repartir d'un ancien audit, prompt, changelog, PR fermee ou document non liste dans `docs/README.md`.

---

## 2. Doctrine produit active — panier partage

Le panier partage est **Boutique First**.

```txt
Tout commence dans la boutique.
Tout se comprend dans la boutique.
Tout revient dans la boutique.
```

Regle : Komerce ne construit pas une cagnotte ni un workspace financier. Komerce materialise un achat reel, visible, plafonne au reste du.

Etat de reference :

- Entree participant : `/boutique/?p=TOKEN`.
- Anciennes URLs `/c/:token`, `/cart/shared*`, `/account/shared-carts` redirigent boutique.
- Deux natures : `ready_to_pay` et `needs_validation`.
- Bouton attendu : `Regler ma part`.
- Participant : lecture seule, snapshot produit, aucun ajout/modification/suppression.
- Paiement public : seulement si panier payable cote moteur.
- Montant : plafonne au `remaining_kmf` reel cote serveur.
- Retour Stripe : `/boutique/?p=TOKEN&shared_payment=success|cancel`.
- Statuts humains attendus : `En preparation`, `Ouvert au paiement`, `Ferme`, `Finalise`, `Annule`.

---

## 3. Couture / variantes — en attente d'architecture finale

### ARCH-COUTURE-00 — Architecture metier couture non arretee

Statut : **en attente — arbitrage produit/architecture requis avant patch**.

Le vrai sujet couture n'est pas seulement un bug de variantes. L'architecture finale n'est pas arretee. Les points `COUTURE-*` restent des constats d'audit et des risques a garder visibles, mais ils ne doivent pas etre traites comme des tickets de correction immediate.

Interdiction operatoire :

- ne pas coder un systeme definitif de variantes/couture avant decision d'architecture ;
- ne pas figer `variant_combo`, `variant_id`, prix variante, stock variante, panier partage variante ou sourcing variante sans doctrine cible ;
- ne pas faire une migration DB structurante couture sans document d'architecture valide ;
- ne pas casser le parcours produit simple existant.

Livrable attendu avant code : document court d'architecture cible, idealement `docs/doctrine/COUTURE_ARCHITECTURE.md` ou `docs/implementation/COUTURE_ARCHITECTURE.md`, puis ajout dans `docs/README.md`.

### COUTURE-* — Constats en attente

Statut : **en attente ARCH-COUTURE-00**, sauf `COUTURE-04`.

Constats a reprendre apres arbitrage : variantes non propagees panier/checkout, couleurs ignorees, stock variante, affichage variante, panier partage avec variantes, `deleteVariant`, prix variante, module couture.

### COUTURE-04 — Catalogue frontend demande 1000 produits mais API plafonnait a 200

Statut : **cloture par inspection code — 2026-06-15**.

`routes/products.js` accepte maintenant `MAX_LIMIT = 1000`, aligne avec la demande frontend `loadProducts(limit: 1000)` et supprime le masquage silencieux au-dela de 200 produits actifs.

---

## 4. Paiement / cash / facture / notifications / fidelite

### PAY-01 — PayPal checkout bloque a la creation commande

Statut : **cloture et valide — 2026-06-15**.

Verifie :

- `validators/index.js` accepte `paypal_eur` dans `orders.create.payment_mode` ;
- `routes/orders/create.js` accepte `paypal_eur` dans son guard metier ;
- le message d'erreur route liste `stripe_eur | cash_relais | paypal_eur` ;
- la route garde `payment_status='pending'`, coherent avec create-order puis capture PayPal.

### PAY-02 — PayPal capture : hooks post-paiement

Statut : **cloture et valide — 2026-06-15**.

Verifie :

- `services/payment-paypal.js` importe correctement `services/payment-paypal-events.js` ;
- `capturePaypalOrder()` appelle `confirmPaymentCycle()` puis declenche fidelite, notification et sourcing seulement si `stockBlocked=false` ;
- si `stockBlocked=true`, la capture PayPal est tracee, une alerte est creee et les hooks metier sont suspendus ;
- `_handleCaptureCompleted()` applique la meme regle cote fallback webhook avec `cycleResult.stockBlocked` ;
- `markPaypalEventProcessed()` preserve l'idempotence via `paypal_events_processed`.

### CASH-01 — Chemins cash avec effets post-paiement differents

Statut : **cloture et valide — 2026-06-15**.

`routes/cash.js#/collect` declenche fidelite, notification et sourcing post-COMMIT, aligne avec `/api/payments/cash/confirm` et `/api/pickup/pay-cash`.

### CASH-02 — `/api/cash/collect/:orderId` et `payment_status`

Statut : **cloture et valide — 2026-06-15**.

Verifie :

- `services/cash-operations.js` selectionne `payment_status` avec la commande verrouillee `FOR UPDATE` ;
- `collectCash()` retourne `{ invalid_payment_status, payment_status }` si `payment_status !== 'pending'` ;
- `routes/cash.js` gere `invalid_payment_status` par `ROLLBACK` + HTTP `409` avant `COMMIT` ;
- le chemin nominal ne tente plus d'utiliser `result.collection` quand le paiement est deja traite.

### FACT-01 — Facture : incoherence prix unitaire / total ligne

Statut : **cloture par inspection code — test reel recommande**.

`services/invoice-service.js` calcule maintenant :

- `unit_price = price_kmf` ;
- `total = price_kmf * quantity`.

Test metier recommande : generer une facture avec quantite > 1 et verifier le PDF/HTML produit.

### NOTIF-01 — Notifications : jointure recipient erronee

Statut : **cloture par inspection code — test metier recommande**.

`services/notification-service.js` joint maintenant `recipients r ON r.id = o.recipient_id` pour recuperer `recipient_phone` et `recipient_name`.

### LOY-01 — Fidelite/gros panier

Statut : **cloture par inspection code — 2026-06-15**.

Decision : ne pas appeler la fidelite depuis `confirmPaymentCycle()` car ce service opere dans la transaction paiement/stock. Les hooks `loyalty-service.handleOrderConfirmed({ orderId })` sont branches post-COMMIT et non bloquants dans les chemins livres :

- Stripe : `services/payment-stripe.js` ;
- PayPal capture et webhook : `services/payment-paypal.js` ;
- Cash reference : `services/payment-cash-confirm.js` ;
- Cash collect : `routes/cash.js` ;
- Wallet full : `routes/orders/create.js` ;
- Panier partage finalise : `routes/shared-cart.js`.

---

## 5. Sourcing, logistique, pickup, suivi

### SRC-01 — `purchase_orders` : colonnes incorrectes dans completeness

Statut : **cloture par inspection code — test DB live recommande**.

`routes/purchasing.js#/order/:order_id/completeness` lit maintenant `qty` et `received_qty`, pas `qty_ordered` / `qty_received`.

### SRC-02 — Reception hub : statuts non conformes au check constraint

Statut : **cloture par inspection code — test DB live recommande**.

`services/purchasing-receive-service.js` utilise maintenant :

- `hub_received` pour reception complete ;
- `confirmed` pour reception partielle.

### SRC-03 — Sourcing PO idempotent par fournisseur, pas par ligne commande

Statut : **ouvert — priorite P1 produit simple, variantes en attente ARCH-COUTURE-00**.

A verifier : consolidation volontaire des quantites quand deux lignes d'une meme commande visent le meme fournisseur/produit.

### PICKUP-01 — Recu pickup lisait `relais.city`, absent du schema relais

Statut : **cloture par inspection code — test endpoint recommande**.

Verifie :

- `routes/pickup-secret.js#/receipt` utilise `r.zone AS relais_city` ;
- `services/scan-engine.js#getParcelTrace` utilise aussi `r.zone AS relais_city`.

### TRACK-01 — Suivi rapide par reference obsolete

Statut : **cloture par inspection code — 2026-06-15**.

`public/boutique/js/b-tracking.js` ne reconstruit plus `KMR/KOM-YYYY-XXXXXX`. Il prend 6 caracteres alphanumeriques, normalise en uppercase, construit `K` + suffixe, puis appelle `/api/orders/KXXXXXX`.

### TRACK-02 — Timeline frontend a harmoniser avec statuts reels

Statut : **ouvert — priorite P2**.

---

## 6. Faux positifs / dettes ecartees

- Lien partage checkout direct : ecarte, lien actuel `/boutique/?p=TOKEN`.
- Paiement partage au-dela du reste : ecarte cote serveur, montant plafonne.
- Participant modifie panier partage : ecarte cote API publique.
- Retour Stripe page morte : ecarte, retour boutique avec parametres.
- PR fermees non mergees = dettes : ecarte par defaut.
- BUG-014 JWT localStorage encore ouvert : ecarte par defaut apres migration httpOnly cookie mergee ; rouvrir seulement avec preuve actuelle.
- Routes collective-workspaces/payments montees : ecarte, non montees ; tables `collective_*` historiques.
- R8B products-admin encore a refactorer : ecarte, mutations admin deja deleguees a `product-admin-service.js`. Dette residuelle : tests.
- Ancien audit frontend critique vrai tel quel : ecarte. Il reste utile comme grille, mais ses bugs initiaux doivent etre reverifies un par un.

---

## 7. Validation encore recommandee hors code

Ces points ne bloquent pas le tampon code, mais restent utiles avant tampon metier/prod strict :

1. PayPal sandbox : create-order -> approve/capture -> retour UI -> notification/sourcing.
2. Tests Jest cibles : `payment-paypal.test.js`, `cash-operations.test.js`, `validators.test.js`.
3. Facture quantite > 1 : verifier rendu reel.
4. Notification payeur + beneficiaire : verifier SMS/WhatsApp reel.
5. `purchase_orders` completeness et reception hub sur DB live.
6. Recu pickup cash endpoint reel.
7. Sourcing `SRC-03` : confirmer consolidation des quantites si deux lignes meme fournisseur/produit.
8. Timeline frontend `TRACK-02` : harmonisation UX, non bloquant livraison code actuelle.

### En attente architecture

Variantes panier/checkout, couleur/taille, stock/prix variante, panier partage avec variantes, visibilite suivi/admin/sourcing/facture, `deleteVariant`, module couture sur mesure.

---

## 8. Regle de mise a jour

Quand une dette est traitee :

1. citer le fichier/code qui la ferme ;
2. deplacer l'ancien point en faux positif ou le supprimer ;
3. corriger la doc active concernee dans la meme PR ;
4. ne jamais reactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne devient operatoire sans etre ajoute a `docs/README.md`.
