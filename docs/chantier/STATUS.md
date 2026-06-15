# Komerce — État opératoire du chantier

> Mis à jour : **2026-06-15**  
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`  
> Rôle : état courant vérifié contre les documents actifs, audits historiques accessibles et code actuel.  
> Principe : une dette ancienne n'est ouverte ici que si elle est encore confirmée ou non tranchée après confrontation au code.

---

## 1. Point d'entrée obligatoire

Lire dans cet ordre :

1. [`AGENTS.md`](../../AGENTS.md) — règles obligatoires pour agent/dev ;
2. [`docs/README.md`](../README.md) — index documentaire actif ;
3. ce fichier `docs/chantier/STATUS.md` ;
4. [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](../doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) ;
5. [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](../implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md) ;
6. les docs techniques listées dans `docs/README.md` seulement si la zone touchée l'exige.

Ne pas reprendre le chantier depuis un ancien audit, un ancien prompt, une ancienne PR fermée, un changelog ou un document non listé dans `docs/README.md`.

---

## 2. Doctrine produit active — panier partagé

Le panier partagé est **Boutique First**.

```txt
Tout commence dans la boutique.
Tout se comprend dans la boutique.
Tout revient dans la boutique.
```

Règle : Komerce ne construit pas une cagnotte ni un workspace financier. Komerce matérialise un achat réel, visible, plafonné au reste dû.

Les documents V4.1, collective workspace, cagnotte, engagement ou financement collectif sont historiques sauf s'ils sont explicitement repris dans les deux documents actifs Boutique First.

---

## 3. État actuel vérifié — panier partagé

État de référence après réalignement documentaire et vérification code :

- Entrée participant : `/boutique/?p=TOKEN`.
- Anciennes URLs `/c/:token`, `/cart/shared*`, `/account/shared-carts` redirigent vers la boutique avec `p=TOKEN` et `tab=group`.
- Deux natures produit : `ready_to_pay` et `needs_validation`.
- `ready_to_pay` crée un panier immédiatement payable (`status = closed`) avec `payment_window_ends_at`.
- `needs_validation` reste consultable (`status = open`) jusqu'à ouverture paiement par le créateur.
- Bouton argent visible attendu : `Régler ma part`.
- Participant : lecture seule, snapshot produit, aucun ajout/modification/suppression.
- Paiement public : accepté seulement si le panier est payable côté moteur.
- Montant : plafonné au `remaining_kmf` réel côté serveur.
- Retour Stripe : `/boutique/?p=TOKEN&shared_payment=success|cancel`.
- Statuts humains attendus : `En préparation`, `Ouvert au paiement`, `Fermé`, `Finalisé`, `Annulé`.

---

## 4. Dettes ouvertes confirmées ou non tranchées

### D-01 — Tests manuels Boutique First à exécuter en réel

Statut : **ouvert**.

À vérifier sur environnement réel :

1. **Cas A — Prêt à payer** : création, lien, bouton `Régler ma part`, paiement, retour boutique, reste mis à jour.
2. **Cas B — À valider ensemble** : consultation sans paiement, ouverture plus tard, apparition du bouton.
3. **Cas C — Lecture seule** : fiche article snapshot, aucun bouton d'action.
4. **Cas D — Statuts** : aucun statut technique visible côté participant.
5. **Cas E — Dépassement du reste** : maximum annoncé et borné avant paiement.

### D-02 — Vocabulaire V4.1 dans le code interne shared-cart

Statut : **dette de lisibilité — pas de traitement sans tests**.

`routes/shared-cart.js` reste volumineux et conserve le vocabulaire V4.1 dans son en-tête/commentaires (`OPEN`, `CLOSED`, `AWAITING_CHOICE`, etc.). Ce n'est pas un bug produit tant que l'UI Boutique First projette les bons statuts humains.

Règles :

- ne pas renommer les statuts DB mécaniquement ;
- toute découpe ou renommage exige des tests couvrant les statuts visibles et techniques (`open`, `closed`, `awaiting_choice`, `ordered`, `cancelled`, `expired`, `archived`) ;
- aucune UI participant ne doit exposer `open`, `closed`, `awaiting_choice`, `ordered`, `expired`, `archived`, “financé”, “cagnotte”, “engagement”, “workspace collectif”.

Action ouverte : si le fichier devient un point de friction, proposer une découpe prudente en sous-routes `public` / `creator` / `admin` dans une branche dédiée avec tests.

### D-03 — Webhooks WhatsApp documentés dans le modèle sécurité

Statut : **clôturé — 2026-06-15**.

- `/webhook/authkey-whatsapp` est protégé par `verifyAuthkeyWebhook`.
- En production, l'absence de `AUTHKEY_WEBHOOK_SECRET` fait rejeter le webhook Authkey.
- `docs/CARTOGRAPHY_360.md` décrit déjà ce comportement.
- `docs/backend/SECURITY-MODEL.md` v1.1 contient maintenant une section `Webhooks entrants` : Meta WhatsApp HMAC + Authkey token partagé.

### D-04 — Versionning applicatif

Statut : **clôturé — 2026-06-15**.

- `package.json` est la source de vérité du numéro de version ;
- `/api/health` retourne `require('./package.json').version` ;
- l'en-tête statique/changelog inline de `server.js` a été nettoyé ;
- les notes de release doivent vivre dans les commits/tags, pas dans l'en-tête serveur.

### D-05 — FRESH-003 : fichiers historiques `routes_orders_*`

Statut : **clôturé — 2026-06-15**.

Les trois orphelins ont été supprimés après vérification :

- `routes/routes_orders_cancel.js` ;
- `routes/routes_orders_status.js` ;
- `routes/routes_orders_parcels.js`.

Voir [`routes/ORPHELINS_FRESH003.md`](../../routes/ORPHELINS_FRESH003.md).

### D-06 — `revoked_tokens` / N4 JWT

Statut : **partiellement clôturé — code vérifié, DB live à vérifier**.

Le câblage applicatif est confirmé :

- `routes/auth.js` génère un `jti` dans `generateToken()` ;
- `routes/auth.js` insère le `jti` dans `revoked_tokens` au logout ;
- `middleware/auth.js` vérifie `revoked_tokens` à l'authentification ;
- `bootstrap/crons.js` lance `startJwtRevocationCleanupCron()` ;
- `migrations/072_jwt_revocation.sql` est la migration attendue.

Action restante : vérifier la table sur Railway (`SELECT 1 FROM revoked_tokens LIMIT 1`) et appliquer la migration si elle est absente. Tant que la table n'est pas confirmée en DB live, ce point reste ouvert opérationnellement.

### D-07 — Docs Boutique historiques subordonnées

Statut : **surveillance documentaire**.

`docs/README.md` déclare `public/boutique/docs/**` historique ou généré. Les documents Boutique actifs sont :

- `docs/boutique/README.md` ;
- `public/boutique/README.md` ;
- `docs/boutique/BOUTIQUE_CSS_PIPELINE.md` ;
- `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` ;
- `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`.

Action : si un audit local Boutique contredit ces documents ou le code, le classer explicitement comme historique et ne pas le recopier dans une tâche.

### D-08 — Audit couture / variantes bout-en-bout

Statut : **ouvert — audit métier rejoué et approfondi le 2026-06-15**.

Sources historiques utiles : `docs/_archive/AUDIT_BACKEND_FINDINGS.md` + `docs/audit/FRONTEND_AUDIT.md`. Ces audits ne sont pas des vérités actuelles, mais leur grille métier reste excellente : produit → boutique → panier → checkout → commande → paiement/stock → panier partagé → suivi → sourcing → facture/notifs.

Lecture actuelle :

- le backend variantes est partiellement prêt (`product_variants`, `has_variants`, `variant_combo`, validation commande, stockage `order_items.variant_combo`) ;
- le validateur `orders.create` accepte déjà `items[].variant_combo` comme objet `{String:String}` ;
- le frontend charge et affiche certaines variantes dans la fiche produit ;
- la couture complète n'est pas garantie : le choix client ne devient pas encore une ligne panier/commande fiable ;
- même si le choix était envoyé, plusieurs sorties métier ne relisent pas encore `order_items.variant_combo`.

#### COUTURE-01 — Variantes affichées mais non propagées au panier/checkout

Statut : **ouvert — priorité P0/P1**.

État vérifié :

- `GET /api/products/:id` charge `product.variants` si `has_variants = true` ;
- `b-modal-core.js` appelle `_renderVariants(full.variants, full)` ;
- `_renderVariants()` affiche des choix et peut modifier le prix visuel ;
- `b-modal-cart.js` ajoute seulement `state.modalProduct` au panier, sans stocker de `variant_combo` ;
- `submitOrder()` construit les items avec `product_id`, `quantity`, `confection_type: 'aucun'`, sans `variant_combo` ;
- `_createKomerceOrderForPayPal()` fait la même chose côté PayPal.

Conséquence métier : l'utilisateur peut croire avoir choisi une taille/variante, mais la commande peut partir comme produit simple.

À corriger :

1. stocker le choix variante dans un état modal explicite ;
2. empêcher l'ajout panier si une variante obligatoire n'est pas choisie ;
3. stocker `variant_combo` dans chaque ligne panier ;
4. permettre deux variantes du même produit dans le panier (`robe M` + `robe L`) sans fusionner par simple `product.id` ;
5. envoyer `variant_combo` dans `submitOrder()` et `_createKomerceOrderForPayPal()` ;
6. afficher la variante dans panier, récap checkout, succès commande, suivi, admin, sourcing et facture.

#### COUTURE-02 — Variantes couleur ignorées côté fiche produit

Statut : **ouvert — priorité P1**.

État vérifié : `_renderVariants()` ignore explicitement les types `couleur`, `color`, `coloris`, `teinte`.

Conséquence métier : une variante couleur/SKU peut exister côté backend mais ne pas être choisissable par le client.

À corriger : traiter les couleurs comme des choix produits réels, avec image/label/stock/prix si disponibles.

#### COUTURE-03 — Stock variante non décrémenté si stock global produit `NULL`

Statut : **ouvert — priorité P0/P1 backend**.

État vérifié : `services/order-payment-confirmation.js` sélectionne les `order_items` avec `JOIN products p` puis filtre `AND p.stock IS NOT NULL`. La vérification et décrémentation variante se font ensuite uniquement sur les lignes retournées.

Conséquence métier : si un produit est géré uniquement par variantes (`products.stock IS NULL`, `product_variants.stock` renseigné), le paiement peut ne pas décrémenter le stock variante.

À corriger : inclure aussi les items avec `has_variants = true` même si `p.stock IS NULL`, puis appliquer séparément :

- stock global si `p.stock IS NOT NULL` ;
- stock variante si `variant_combo` présent et variante stockée.

À couvrir par test : produit `has_variants = true`, `products.stock = NULL`, variante `stock = 1`, paiement de qty 1 → stock variante devient 0.

#### COUTURE-04 — Catalogue frontend demande 1000 produits mais API plafonne à 200

Statut : **ouvert — priorité P1 si catalogue > 200 produits**.

État vérifié : `loadProducts()` appelle `K.products.list({ limit: 1000 })`, mais `routes/products.js` force `MAX_LIMIT = 200`.

Conséquence métier : au-delà de 200 produits actifs, la boutique peut silencieusement ne pas afficher tout le catalogue.

À corriger : pagination frontend par `offset` ou convention explicite backend/frontend sur la limite.

#### COUTURE-05 — `variant_type` injecté dans le DOM sans garde suffisante

Statut : **ouvert — priorité P2 sécurité/hygiène**.

État vérifié : `_renderVariants()` injecte `type` dans `innerHTML` pour le label de variante. Si `variant_type` vient de la DB/admin, le risque est limité mais réel.

À corriger : construire le label en DOM + `textContent`, ou appliquer `sanitize(type)`.

#### COUTURE-06 — Variantes peu visibles dans suivi/admin/sourcing/facture

Statut : **ouvert — priorité P1 métier**.

Le stockage `order_items.variant_combo` existe côté commande, mais plusieurs lectures métier ne le sélectionnent pas :

- `routes/orders/detail.js` : items sans `variant_combo` ;
- `routes/client-tracking.js` : items sans `variant_combo` ;
- `routes/order-api-v2.js` : détail complet sans `variant_combo` ;
- `services/parcel-auto-create-service.js` : `parcel_items.product_name` sans variante ;
- `services/invoice-service.js` : facture sans variante ;
- notifications : items envoyés sans variante.

Conséquence métier : même si la variante est stockée, les personnes qui doivent acheter, préparer, livrer ou vérifier peuvent ne pas voir la taille/couleur réelle.

À corriger : définir une représentation lisible unique de la variante, par exemple `Taille: M · Couleur: Bleu`, puis l'afficher dans tous les écrans/snapshots concernés.

#### COUTURE-07 — Panier partagé perd les variantes

Statut : **ouvert — priorité P1, surtout Boutique First**.

État vérifié :

- `b-share-cart.js#createSharedCart()` envoie seulement `{ product_id, quantity }` ;
- `shared-cart-engine#createSharedCartFromCartItems()` enrichit depuis DB uniquement par `product_id` ;
- `shared_cart_items` snapshotte nom/image/catégorie/quantité/prix, mais pas `variant_combo` ;
- `convertSharedCartToOrder()` recrée `order_items` sans `variant_combo`.

Conséquence métier : un panier partagé contenant des tailles/couleurs peut perdre l'information variante avant même le paiement collectif.

À corriger : étendre le contrat `cart_items`, le snapshot `shared_cart_items`, la vue publique et la conversion vers commande.

#### COUTURE-08 — Admin variante : `deleteVariant()` semble incompatible avec le modèle `variant_combo`

Statut : **ouvert — priorité P1 admin/data**.

État vérifié : `product-admin-service.deleteVariant()` vérifie `order_items.variant_id = $1`, mais le schéma actuel expose `order_items.variant_combo jsonb` et la recherche code ne montre pas d'autre usage de `variant_id`.

Conséquence métier : suppression d'une variante peut soit échouer SQL si la colonne n'existe pas en DB live, soit ne pas bloquer correctement une variante déjà utilisée par des commandes.

À corriger : remplacer le guard par une vérification contre `variant_combo` (`variant_type` + `variant_value`) et utiliser les statuts réels (`collected`, `cancelled`, `refunded`).

#### COUTURE-09 — Prix variante affiché mais non porté par le panier

Statut : **ouvert — priorité P1 si variantes avec prix spécifique**.

État vérifié : `_renderVariants()` peut changer `dom.modalPrice` si `opt.price_kmf` existe, mais `addToCart()` conserve `product.price_kmf` et `cartTotal()` calcule sur `i.product.price_kmf`.

Conséquence métier : le prix affiché pour une variante peut diverger du prix panier/checkout/commande.

À corriger : porter `unit_price_kmf` au niveau ligne panier, issu de la variante choisie si elle surcharge le prix.

### D-09 — Suivi client / références / timeline

Statut : **ouvert**.

#### TRACK-01 — Suivi rapide par référence obsolète

Statut : **ouvert — priorité P1 UX/suivi**.

État vérifié : `b-tracking.js` reconstruit une référence `KMR-2025-XXXX` à partir de 4 chiffres, alors que `services/order-service.js` génère désormais `K` + 6 caractères alphanumériques.

Conséquence métier : le suivi rapide par 4 chiffres risque d'être inutilisable pour les commandes actuelles.

À corriger : remplacer par l'une de ces options :

- saisie de référence complète ;
- lien/QR de suivi ;
- historique par OTP téléphone comme chemin principal.

#### TRACK-02 — Timeline frontend à harmoniser avec les statuts réels

Statut : **ouvert — priorité P2**.

État vérifié : `b-tracking.js` construit la timeline sur `pending`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, tandis que l'affichage connaît aussi `confirmed`, `paid`, `ordered`, `cancelled`.

Conséquence métier : une commande `confirmed` ou `ordered` peut être affichée avec un statut texte correct mais une timeline peu claire.

À corriger : définir une projection timeline unique pour `pending`, `confirmed`, `paid`, `ordered`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, `cancelled`, `refunded`.

### D-10 — Facture : incohérence prix unitaire / total ligne

Statut : **ouvert — priorité P1 comptable**.

État vérifié :

- `routes/orders/create.js` insère `order_items.price_kmf = product.price_kmf` donc prix unitaire ;
- `shared-cart-engine.convertSharedCartToOrder()` insère aussi `price_kmf = unit_price_kmf_snapshot` ;
- `services/invoice-service.js` lit `oi.quantity, oi.price_kmf`, puis calcule `unit_price = price_kmf / quantity` et `total = price_kmf`.

Conséquence métier : pour une quantité > 1, la facture peut sous-totaliser les lignes et afficher un prix unitaire faux. Le total commande reste celui de `orders.total_kmf`, mais le détail facture devient incohérent.

À corriger : décider une convention unique : soit `order_items.price_kmf` = prix unitaire, soit total ligne. Vu le code commande actuel, corriger la facture pour faire `unit_price = price_kmf`, `total = price_kmf * quantity`.

### D-11 — PayPal checkout affiché mais probablement cassé

Statut : **ouvert — priorité P1 si PayPal visible en prod**.

État vérifié :

- `b-checkout.js` affiche le mode `paypal_eur` et appelle `_createKomerceOrderForPayPal()` ;
- `_createKomerceOrderForPayPal()` appelle `/api/orders` avec `payment_mode: 'paypal_eur'` ;
- `validators/orders.create` n'accepte que `stripe_eur` et `cash_relais` ;
- `routes/orders/create.js` refuse explicitement tout sauf `stripe_eur` et `cash_relais` ;
- le schéma DB et `routes/payments-paypal.js` savent pourtant gérer `paypal_eur` ensuite.

Conséquence métier : le bouton PayPal peut être visible mais échouer avant même la création du PayPal Order.

À corriger : aligner `validators/orders.create`, `routes/orders/create.js`, le statut initial et le cycle PayPal. Tester création commande PayPal → create-order → capture → `confirmPaymentCycle`.

### D-12 — Notifications payeur/bénéficiaire : jointure recipient probablement erronée

Statut : **ouvert — priorité P1 si suivi double critique**.

État vérifié : `notification-service.js` charge parfois `recipient_phone` avec `LEFT JOIN users r ON r.id = o.recipient_id`, alors que `orders.recipient_id` est alimenté depuis la table `recipients` dans `routes/orders/create.js`.

Conséquence métier : certaines notifications de statut peuvent perdre le vrai bénéficiaire et retomber sur le payeur ou aucun téléphone, malgré la doctrine “suivi envoyé aux deux quand nécessaire”.

À corriger : joindre `recipients r ON r.id = o.recipient_id`, et couvrir au moins : payeur diaspora + bénéficiaire local, expédition, disponibilité/retrait, annulation.

---

## 5. Faux positifs / dettes écartées après vérification

### FP-01 — “Le lien partagé ouvre un checkout direct”

Écarté.

Le code actuel génère les liens publics en `/boutique/?p=TOKEN`. Les anciens chemins `/c/:token` et `/cart/shared*` redirigent aussi vers la boutique.

### FP-02 — “Le paiement peut dépasser le reste dû”

Écarté côté serveur.

La route publique contribution recharge `remaining_kmf`, calcule `payableAmount = min(requestedAmount, remainingNow)`, puis retourne `capped: true` si le montant demandé dépasse le reste. L'UI doit quand même afficher clairement le maximum avant paiement.

### FP-03 — “Le participant peut modifier le panier partagé”

Écarté côté API publique.

Les routes de modification `PUT /api/shared-carts/:id/items` sont authentifiées créateur et passent par les services dédiés. La lecture publique retourne des items snapshot et n'expose pas l'UUID interne du panier.

### FP-04 — “Le retour Stripe mène à une page morte”

Écarté côté backend.

Les URLs Stripe success/cancel renvoient vers `/boutique/?p=TOKEN&shared_payment=success|cancel`.

### FP-05 — “Les anciennes PR fermées non mergées sont des dettes ouvertes par défaut”

Écarté.

Les PR fermées non mergées (#3, #4, #6, #7, #8, #9, #14 observées dans l'historique accessible) sont historiques par défaut. Leur contenu ne devient dette ouverte que si le code actuel ou une doc active confirme encore le problème.

### FP-06 — “BUG-014 JWT localStorage est encore ouvert par défaut”

Écarté comme dette par défaut.

L'historique PR indique une migration httpOnly cookie mergée. Toute réouverture doit être basée sur vérification code actuelle et tests frontend, pas sur l'ancien audit.

### FP-07 — “`cart_shares` / `cart_contributions` absents de la cartographie”

Écarté.

`docs/CARTOGRAPHY_360.md` mentionne maintenant `/api/shares` et distingue `cart_shares` / `cart_contributions` de `/api/shared-carts`. L'ancienne dette `SCHEMA.md` sur ce point est donc probablement périmée.

### FP-08 — “Les routes collective-workspaces / collective-payments sont montées”

Écarté.

`docs/CARTOGRAPHY_360.md` est maintenant aligné avec `server.js` et `bootstrap/api-routes.js` : les routes collectives ne sont pas montées, les tables `collective_*` restent historiques.

### FP-09 — “`/api/admin/pilotage` et `/api/admin/stats` sont des alias API actifs”

Écarté.

La cartographie indique désormais que le chemin API canonique est `/api/dashboard`. Les chemins HTML admin, comme `/admin/pilotage`, restent servis par le dashboard moderne.

### FP-10 — “R8B products-admin est encore à refactorer”

Écarté — vérifié 2026-06-15.

`routes/products.js` délègue déjà les mutations admin à `services/product-admin-service.js` : create, update, delete, image principale, galerie images, remplacement de variantes et suppression de variante.

Dette résiduelle : ajouter des tests ciblés pour `product-admin-service.js`, sans refaire le refacto.

### FP-11 — “L'ancien audit frontend critique d'avril 2026 est encore vrai tel quel”

Écarté.

L'ancien audit frontend reste utile comme grille métier, mais ses bugs critiques initiaux sont majoritairement obsolètes :

- `openCart()` existe ;
- `saveCart()` existe via `b-cart-core.js` ;
- `setQty()` existe ;
- `komerce-api.js` est bien chargé avant `main.js` ;
- `/api/relais` existe et est monté ;
- le checkout utilise `stripe_eur` ;
- le checkout passe par OTP/session httpOnly avant commande.

Ne pas recopier ces bugs comme dettes ouvertes sans nouvelle preuve code.

---

## 6. Audits et historiques : règle de traitement

Les audits passés servent à rechercher des risques, pas à décider l'état courant.

Classement opératoire :

| Source | Statut par défaut | Règle |
|---|---|---|
| `docs/README.md` | actif | point d'entrée documentaire |
| `AGENTS.md` | actif | règle supérieure agent/dev |
| `docs/chantier/STATUS.md` | actif | état courant |
| Docs listées dans `docs/README.md` | actives selon zone | vérifier contre code/DB |
| `docs/audit/**` | historique/contextuel | ne devient actif qu'après recoupement code |
| `docs/chantier/*_AUDIT_*.md` | historique/contextuel | ne pas recopier sans vérification |
| `docs/_archive/**` | historique | subordonné |
| `public/boutique/docs/**` | local/historique/généré | subordonné à `docs/boutique/*` |
| PR fermées non mergées | historique | non opératoire sauf recoupement |
| PR mergées anciennes | contexte | vérifier si les fichiers existent encore |

---

## 7. Tests prioritaires

### Panier partagé Boutique First

1. **Cas A — Prêt à payer** : création, lien, bouton `Régler ma part`, paiement, retour boutique, reste mis à jour.
2. **Cas B — À valider ensemble** : consultation sans paiement, ouverture plus tard, apparition du bouton.
3. **Cas C — Lecture seule** : fiche article snapshot, aucun bouton d'action.
4. **Cas D — Statuts** : aucun statut technique visible.
5. **Cas E — Dépassement du reste** : maximum annoncé et borné avant paiement.

### Couture / variantes bout-en-bout

À créer ou vérifier :

1. Produit sans variante : parcours inchangé.
2. Produit avec taille seule : choix obligatoire, panier affiche taille, checkout envoie `variant_combo`.
3. Produit avec couleur seule : choix couleur visible, panier affiche couleur, checkout envoie `variant_combo`.
4. Produit avec couleur + taille : les deux dimensions sont choisies et stockées.
5. Deux variantes du même produit dans le panier : elles restent deux lignes distinctes.
6. Variante en rupture : bouton désactivé, ajout impossible.
7. Variante avec prix spécifique : prix modal = prix panier = prix checkout = prix commande.
8. Produit `products.stock = NULL` + `product_variants.stock = 1` : paiement décrémente la variante.
9. Stripe : paiement accepté décrémente stock global et stock variante.
10. Cash relais : confirmation agent décrémente stock global et stock variante.
11. Wallet full : paiement intégral wallet déclenche aussi le cycle stock.
12. Panier partagé : variante conservée dans snapshot public, contributions, finalisation commande.
13. Détail commande / suivi / admin / sourcing / facture : variante visible partout où le métier en a besoin.
14. `deleteVariant` : bloque une variante utilisée par une commande en cours et ne référence pas une colonne inexistante.

### Paiements / facture / notifications

1. PayPal : commande `paypal_eur` créée, PayPal Order créé, capture OK, `confirmPaymentCycle` appelé.
2. Facture quantité > 1 : lignes cohérentes (`unit_price`, `total`, subtotal) avec `orders.total_kmf`.
3. Notification payeur + bénéficiaire : commande diaspora vers bénéficiaire local, statut shipped/collected, les bons numéros reçoivent les bons messages.

### Tests manquants : `product-admin-service.js`

À créer dans `tests/unit/product-admin-service.test.js` :

1. `createProduct` — payload valide, insert produit, audit prix/stock si applicable.
2. `createProduct` — catégorie ou sous-catégorie invalide, réponse 422.
3. `updateProduct` — produit inexistant, réponse 404.
4. `deleteProduct` — désactive `is_active` sans supprimer la ligne.
5. `setMainImage` — met à jour `image_url` et gère produit introuvable.
6. `appendImages` — ajoute dans `images` et initialise `image_url` au premier ajout.
7. `replaceVariants` — remplace atomiquement les variantes et bloque une suppression totale si commandes en cours.
8. `deleteVariant` — bloque si commandes en cours, supprime sinon.

### Vérifications ponctuelles

1. Vérifier DB live pour `revoked_tokens` et appliquer `migrations/072_jwt_revocation.sql` si la table est absente.
2. Vérifier si le catalogue produit peut dépasser 200 articles actifs ; si oui, traiter `COUTURE-04` avant croissance catalogue.
3. Vérifier le suivi rapide : désactiver ou remplacer le format `KMR-2025-XXXX` si aucune commande actuelle ne suit ce format.
4. Vérifier si `paypal_eur` est visible en production ; si oui, traiter `D-11` avant communication utilisateur.

---

## 8. Règle de mise à jour

Ce fichier doit rester court mais explicite sur les dettes ouvertes.

Quand une dette est traitée :

1. citer le fichier/code qui la ferme ;
2. déplacer l'ancien point en faux positif ou le supprimer ;
3. corriger le document actif concerné dans la même PR ;
4. ne jamais réactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne doit devenir opératoire sans être ajouté à `docs/README.md`.
