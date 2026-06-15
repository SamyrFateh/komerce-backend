# Komerce — État opératoire du chantier

> Mis à jour : **2026-06-15**  
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`  
> Rôle : point de vérité opératoire pour Sonnet/agent dev.  
> Principe : un audit historique est un indice, pas une vérité. Une dette est ouverte seulement si le code actuel, la DB live ou une doc active la confirme.

---

## 1. Point d'entrée obligatoire

Lire dans cet ordre :

1. `AGENTS.md` ;
2. `docs/README.md` ;
3. `docs/chantier/STATUS.md` ;
4. `docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md` ;
5. `docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md` ;
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

État de référence :

- Entrée participant : `/boutique/?p=TOKEN`.
- Anciennes URLs `/c/:token`, `/cart/shared*`, `/account/shared-carts` redirigent boutique.
- Deux natures : `ready_to_pay` et `needs_validation`.
- Bouton attendu : `Régler ma part`.
- Participant : lecture seule, snapshot produit, aucun ajout/modification/suppression.
- Paiement public : seulement si panier payable côté moteur.
- Montant : plafonné au `remaining_kmf` réel côté serveur.
- Retour Stripe : `/boutique/?p=TOKEN&shared_payment=success|cancel`.
- Statuts humains attendus : `En préparation`, `Ouvert au paiement`, `Fermé`, `Finalisé`, `Annulé`.

---

## 3. Couture / variantes — en attente d'architecture finale

### ARCH-COUTURE-00 — Architecture métier couture non arrêtée

Statut : **en attente — arbitrage produit/architecture requis avant patch**.

Le vrai sujet couture n'est pas seulement un bug de variantes. L'architecture finale n'est pas arrêtée. Les points `COUTURE-*` restent des constats d'audit et des risques à garder visibles, mais ils ne doivent pas être traités comme des tickets de correction immédiats.

Interdiction opératoire :

- ne pas coder un système définitif de variantes/couture avant décision d'architecture ;
- ne pas figer `variant_combo`, `variant_id`, prix variante, stock variante, panier partagé variante ou sourcing variante sans doctrine cible ;
- ne pas faire une migration DB structurante couture sans document d'architecture validé ;
- ne pas casser le parcours produit simple existant.

Décisions à prendre avant implémentation : nature métier, identité ligne panier, prix, stock, sourcing, panier partagé, affichage métier, DB cible.

Livrable attendu avant code : document court d'architecture cible, idéalement `docs/doctrine/COUTURE_ARCHITECTURE.md` ou `docs/implementation/COUTURE_ARCHITECTURE.md`, puis ajout dans `docs/README.md`.

### COUTURE-* — Constats en attente

Statut : **en attente ARCH-COUTURE-00**, sauf `COUTURE-04`.

Constats à reprendre après arbitrage : variantes non propagées panier/checkout, couleurs ignorées, stock variante, affichage variante, panier partagé avec variantes, `deleteVariant`, prix variante, module couture.

### COUTURE-04 — Catalogue frontend demande 1000 produits mais API plafonne à 200

Statut : **ouvert — hors arbitrage couture**.

`loadProducts()` demande `limit: 1000`, mais `routes/products.js` force `MAX_LIMIT = 200`. Au-delà de 200 produits actifs, la boutique peut masquer silencieusement une partie du catalogue.

---

## 4. Dettes paiement / cash / facture / notifications

### PAY-01 — PayPal checkout affiché mais bloqué à la création commande

Statut : **partiel — validator OK, route création commande à confirmer/patcher**.

Vérifié : `validators/index.js` accepte désormais `paypal_eur` dans `orders.create.payment_mode`.

Reste à confirmer ou patcher : `routes/orders/create.js` doit accepter aussi `paypal_eur` dans son guard métier et son message d'erreur. Tant que ce fichier n'est pas corrigé dans le repo, PAY-01 n'est pas tamponnable globalement.

### PAY-02 — PayPal capture : hooks post-paiement

Statut : **à revalider après intégration complète PayPal**.

Attendu : `notifyPaymentConfirmed` + `triggerPurchasing` post-COMMIT seulement si `stockBlocked=false`, aligné sur Stripe/cash.

### CASH-01 — Chemins cash avec effets post-paiement différents

Statut : **clôturé — patch appliqué 2026-06-15**.

`routes/cash.js#/collect` déclenche `notifyPaymentConfirmed` + `triggerPurchasing` post-COMMIT, aligné sur `/api/payments/cash/confirm` et `/api/pickup/pay-cash`.

### CASH-02 — `/api/cash/collect/:orderId` et `payment_status`

Statut : **clôturé et validé par inspection — 2026-06-15**.

Vérifié :

- `services/cash-operations.js` sélectionne `payment_status` avec la commande verrouillée `FOR UPDATE` ;
- `collectCash()` retourne `{ invalid_payment_status, payment_status }` si `payment_status !== 'pending'` ;
- `routes/cash.js` gère `invalid_payment_status` par `ROLLBACK` + HTTP `409` avant `COMMIT` ;
- `tests/unit/cash-operations.test.js` couvre `paid`, `refunded`, chemin nominal `pending`, et la branche HTTP `409` simulée.

Tampon cash : **OK code/audit statique**. Test exécutable à lancer côté repo :

```bash
npx jest tests/unit/cash-operations.test.js
```

#### VALIDATION — CASH-02 / encaissement cash déjà payé

Statut : **VALIDÉ — tampon limité à la dernière modification cash — 2026-06-15**.

Périmètre validé :

- service `collectCash()` : refus métier si `payment_status !== 'pending'` ;
- route `POST /api/cash/collect/:orderId` : `ROLLBACK` + `409` avant `COMMIT` en cas de `invalid_payment_status` ;
- absence de chute vers le chemin nominal quand `result.collection` est absent ;
- test unitaire présent pour `paid`, `refunded`, nominal `pending`, et réponse HTTP 409 simulée.

Preuves repo :

- patch code : commit `43b9fcf` ;
- tampon doc : commit courant `docs: tamponne validation cash collect` ;
- test cible : `tests/unit/cash-operations.test.js`.

Limites du tampon :

- validation par audit statique + présence des tests ;
- exécution Jest à lancer dans l'environnement repo/CI : `npx jest tests/unit/cash-operations.test.js` ;
- ne valide pas PayPal, fidélité globale, facture, pickup, sourcing DB live, ni couture.

### FACT-01 — Facture : incohérence prix unitaire / total ligne

Statut : **code apparemment corrigé, test réel à faire avant clôture**.

Attendu : `unit_price = price_kmf`, `total = price_kmf * quantity`. À clôturer seulement après test facture quantité > 1.

### NOTIF-01 — Notifications : jointure recipient erronée

Statut : **clôturé côté code — test métier recommandé**.

`services/notification-service.js` doit joindre `recipients r ON r.id = o.recipient_id` pour résoudre le bénéficiaire local.

### LOY-01 — Fidélité/gros panier

Statut : **ouvert — priorité P1 si fidélité active**.

À finaliser : brancher la fidélité dans un hook post-confirmation sûr, sans requête fire-and-forget sur le client transactionnel.

---

## 5. Sourcing, logistique, pickup, suivi

### SRC-01 — `purchase_orders` : colonnes incorrectes dans completeness

Statut : **clôturé côté code — test DB live recommandé**.

Attendu : `qty` / `received_qty`, pas `qty_ordered` / `qty_received`.

### SRC-02 — Réception hub : statuts non conformes au check constraint

Statut : **clôturé côté code — test DB live recommandé**.

Attendu : `hub_received` pour réception complète, `confirmed` pour réception partielle.

### SRC-03 — Sourcing PO idempotent par fournisseur, pas par ligne commande

Statut : **ouvert — priorité P1 produit simple, variantes en attente ARCH-COUTURE-00**.

À vérifier : consolidation volontaire des quantités quand deux lignes d'une même commande visent le même fournisseur/produit.

### PICKUP-01 — Reçu pickup lit `relais.city`, absent du schéma relais

Statut : **code apparemment corrigé, test endpoint recommandé**.

Attendu : utiliser `r.zone`, `r.island` ou `r.address`, pas `r.city`.

### TRACK-01 — Suivi rapide par référence obsolète

Statut : **ouvert — priorité P1 UX/suivi**.

`b-tracking.js` reconstruit `KMR-2025-XXXX`, alors que `services/order-service.js` génère `K` + 6 caractères alphanumériques.

### TRACK-02 — Timeline frontend à harmoniser avec statuts réels

Statut : **ouvert — priorité P2**.

---

## 6. Faux positifs / dettes écartées

- Lien partagé checkout direct : écarté, lien actuel `/boutique/?p=TOKEN`.
- Paiement partagé au-delà du reste : écarté côté serveur, montant plafonné.
- Participant modifie panier partagé : écarté côté API publique.
- Retour Stripe page morte : écarté, retour boutique avec paramètres.
- PR fermées non mergées = dettes : écarté par défaut.
- BUG-014 JWT localStorage encore ouvert : écarté par défaut après migration httpOnly cookie mergée ; réouvrir seulement avec preuve actuelle.
- Routes collective-workspaces/payments montées : écarté, non montées ; tables `collective_*` historiques.
- R8B products-admin encore à refactorer : écarté, mutations admin déjà déléguées à `product-admin-service.js`. Dette résiduelle : tests.
- Ancien audit frontend critique vrai tel quel : écarté. Il reste utile comme grille, mais ses bugs initiaux doivent être revérifiés un par un.

---

## 7. Tests prioritaires

### À traiter maintenant — hors architecture couture

1. PayPal : `validators/index.js` + `routes/orders/create.js` acceptent `paypal_eur`, create-order, capture, hooks post-paiement.
2. Cash : `npx jest tests/unit/cash-operations.test.js`.
3. Facture quantité > 1.
4. Notification payeur + bénéficiaire.
5. Fidélité gros panier sur Stripe, cash, PayPal, wallet full.
6. `purchase_orders` completeness et réception hub sur DB live.
7. Reçu pickup cash.
8. Suivi rapide : format référence actuel.
9. Catalogue > 200 produits : pagination ou limite explicite.

### À mettre en attente — dépend de ARCH-COUTURE-00

Variantes panier/checkout, couleur/taille, stock/prix variante, panier partagé avec variantes, visibilité suivi/admin/sourcing/facture, `deleteVariant`, module couture sur mesure.

---

## 8. Règle de mise à jour

Quand une dette est traitée :

1. citer le fichier/code qui la ferme ;
2. déplacer l'ancien point en faux positif ou le supprimer ;
3. corriger la doc active concernée dans la même PR ;
4. ne jamais réactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne devient opératoire sans être ajouté à `docs/README.md`.
