# Contrat exécutable — Liste partagée

> **Version normative : 2026-08-09**  
> **Doctrine associée :** `docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`  
> Ce contrat remplace les flux d'achat direct, « Acheter le reste », « Payer le total » et la doctrine de surface panier unique.

## 1. Vocabulaire

| Terme | Définition |
|---|---|
| **personalCart** | panier privé, vivant et modifiable de l'utilisateur |
| **ownedOpenSharedList** | liste OPEN appartenant à l'utilisateur ; cardinalité 0..1 |
| **displayedSharedList** | liste OPEN affichée localement dans le slot partagé ; cardinalité 0..1 |
| **savedLists** | références sauvegardées dans Mes listes ; cardinalité 0..N |
| **snapshot** | articles, quantités, variantes, prix et médias figés à la publication |
| **selection** | ensemble local d'identifiants de lignes disponibles, sans réservation |
| **claim** | rattachement atomique d'une ligne à une commande via `shared_cart_item_id` |
| **intent** | `PERSONAL_CART` ou `SHARED_LIST`, jamais les deux |
| **pickupCodeRecipient** | `buyer` ou `organizer` pour une commande issue d'une liste |

## 2. Invariants obligatoires

1. Une liste publiée est structurellement immuable.
2. OPEN signifie achetable, jamais éditable.
3. Un créateur possède au maximum une liste OPEN tant que les listes V1 ne sont pas nommables.
4. Une seule liste OPEN peut occuper `displayedSharedList`.
5. Le panier personnel reste disponible et indépendant de la liste affichée.
6. Aucune commande ne mélange lignes personnelles et lignes de liste.
7. La sélection d'une ligne ne la réserve pas et ne l'ajoute pas au panier personnel.
8. Toute sélection passe par un récapitulatif avant le checkout final.
9. Le ✓ du récapitulatif est statique.
10. Une ligne n'est réclamable qu'une fois, sous arbitrage DB.
11. CLOSED/CANCELLED ne sont jamais affichées dans le side-cart.
12. Quitter l'affichage ne change aucun statut.
13. Le choix du destinataire du code secret produit un effet backend réel.
14. Une liste reçue n'est sauvegardée que sur action explicite.
15. Partager une liste existante ne crée jamais une nouvelle liste.

## 3. Nommage canonique

Le libellé dépend de la relation avec l'utilisateur courant, pas d'un titre stocké :

| Contexte | Valeur |
|---|---|
| surface personnelle | `Mon panier` |
| liste dont `isCreator=true` | `Ma liste` |
| liste reçue | `Liste de {creatorFirstName}` |
| checkout de sa liste | `Achat pour Ma liste` |
| checkout reçu | `Achat pour la liste de {creatorFirstName}` |

Les fallbacks `Votre liste`, `Liste sans titre` et `Liste partagée` sont interdits dans l'UI canonique.

Le champ historique `title` peut rester nullable pour compatibilité, mais il ne pilote pas ces libellés V1.

## 4. Modèle d'état frontend

~~~js
state.cart                  // personalCart uniquement
state.cartSurface           // 'personal' | 'shared-list'
state.sharedListContext     // displayedSharedList ou null
state.sharedSelection       // Set<shared_cart_item_id>, local uniquement
state.checkoutDisplayContext = {
  origin: 'PERSONAL_CART' | 'SHARED_LIST',
  sharedCartId: string | null,
  isCreator: boolean,
  creatorFirstName: string | null,
  title: string | null
}
~~~

Contraintes :

- `state.cart` n'est jamais remplacé durablement par une liste ;
- l'adaptateur peut construire un panier éphémère uniquement pendant le checkout ;
- le contexte checkout est structuré, pas réduit à une chaîne d'affichage ;
- toute sortie du modal restaure le panier personnel et efface le contexte éphémère.

## 5. Side-cart

| Événement | Effet local | Effet backend |
|---|---|---|
| ouvrir une liste OPEN | remplace `displayedSharedList`, sélectionne shared-list | aucun |
| cliquer Mon panier | `cartSurface='personal'` | aucun |
| cliquer Ma liste/Liste de X | `cartSurface='shared-list'` | aucun |
| cliquer × | efface `displayedSharedList`, revient au panier | aucun |
| fermer la liste | efface le slot, revient au panier | OPEN → CLOSED |
| ouvrir CLOSED/CANCELLED | message informatif, side-cart inchangé | aucun |
| reload après × dans la même session | ne restaure pas la liste quittée | aucun |

Le second onglet est absent lorsque `displayedSharedList=null`.

## 6. Publication

Avant `POST /api/shared-carts/from-cart-items`, le frontend doit afficher :

> Une fois partagée, cette liste ne sera plus modifiable.

Annulation : aucun POST.

Succès :

1. réponse de création valide ;
2. vidage du panier personnel source ;
3. activation comme **Ma liste** ;
4. proposition de partage.

Échec : panier personnel inchangé.

La création concurrente d'une seconde liste OPEN renvoie :

~~~json
{
  "code": "open_list_exists",
  "existing_token": "..."
}
~~~

## 7. Sélection et récapitulatif

Une ligne est sélectionnable si et seulement si :

- liste OPEN ;
- `claimed=false` ;
- produit encore achetable selon les gardes de commande.

Le CTA apparaît uniquement si la sélection n'est pas vide :

> Commander (N · X KMF)

Le total sélectionné vaut la somme de `snapshot_unit_price_kmf × quantity` des lignes sélectionnées.

Une action « Tout sélectionner » peut remplir la sélection avec toutes les lignes disponibles. Elle ne déclenche jamais directement le checkout.

Le récapitulatif :

- est obligatoire pour N ≥ 1 ;
- affiche uniquement les lignes sélectionnées ;
- affiche un ✓ non interactif ;
- permet de revenir à la liste ;
- ne modifie pas le snapshot.

## 8. Checkout canonique

~~~text
PERSONAL_CART → panier personnel → récapitulatif → checkout
SHARED_LIST   → sélection locale → panier éphémère → récapitulatif → checkout
~~~

Chaque ligne SHARED_LIST transmise à `POST /api/orders` contient `shared_cart_item_id`.

Toutes les lignes d'une même commande SHARED_LIST doivent appartenir à la même liste affichée.

Le checkout affiche :

- `Achat pour Ma liste` si l'acheteur est aussi l'organisateur ;
- `Achat pour la liste de X` sinon.

Le checkout liste n'efface jamais le panier personnel. Celui-ci est restauré sur succès comme sur annulation.

## 9. Destinataire du code secret

Extension du payload `POST /api/orders` pour une intention SHARED_LIST :

~~~json
{
  "pickup_code_recipient": "buyer"
}
~~~

Valeurs :

| Valeur | Effet |
|---|---|
| `buyer` | code envoyé au téléphone vérifié de l'acheteur |
| `organizer` | code envoyé au téléphone vérifié du créateur de la liste |

Règles serveur :

1. le champ est accepté uniquement si au moins une ligne contient `shared_cart_item_id` ;
2. sa valeur par défaut est `buyer` ;
3. le client n'envoie ni numéro ni identifiant d'organisateur ;
4. le serveur résout l'organisateur depuis les lignes réclamées ;
5. toutes les lignes doivent pointer vers la même liste ;
6. le choix est persisté sur la commande ;
7. le service de code de retrait utilise ce choix lors de l'envoi réel ;
8. pour **Ma liste**, `organizer` et `buyer` désignent la même identité et le sélecteur UI est masqué.

## 10. Claim atomique et conflit

La sélection ne constitue aucune réservation.

L'unicité de `order_items.shared_cart_item_id` arbitre le gagnant.

En cas de conflit, l'API répond avec un code structuré `already_claimed` ou équivalent stable. Le frontend :

1. garde le panier personnel intact ;
2. ferme ou suspend la confirmation ;
3. recharge la liste ;
4. retire la ligne de la sélection ;
5. affiche **Déjà acheté**.

L'organisateur reçoit `buyer_first_name`; les autres utilisateurs reçoivent une valeur nulle.

## 11. Matrice des rôles

| Action | Organisateur | Participant |
|---|---:|---:|
| afficher une liste OPEN | oui | oui |
| sélectionner des lignes disponibles | oui | oui |
| commander sa sélection | oui | oui |
| sélectionner tout le disponible | oui | oui |
| partager le lien existant | oui | oui |
| fermer OPEN → CLOSED | oui | non |
| quitter l'affichage × | oui | oui |
| sauvegarder dans Mes listes | inutile | oui |
| voir le prénom de l'acheteur | oui | non |
| modifier articles/quantités/variantes | non | non |
| ajouter un produit après publication | non | non |

## 12. API de liste autorisées

~~~text
GET    /api/shared-carts/public/:token
POST   /api/shared-carts/from-cart-items
GET    /api/shared-carts/mine
GET    /api/shared-carts/library
POST   /api/shared-carts/save
DELETE /api/shared-carts/saved/:sharedCartId
GET    /api/shared-carts/:id
POST   /api/shared-carts/:id/close
POST   /api/shared-carts/:id/cancel
~~~

Le claim passe exclusivement par `POST /api/orders`.

## 13. API interdites

Ne jamais restaurer :

~~~text
GET    /api/shared-carts/:id/as-cart-items
PUT    /api/shared-carts/:id/items
POST   /api/shared-carts/:id/items
PATCH  /api/shared-carts/:id/items/:itemId
DELETE /api/shared-carts/:id/items/:itemId
POST   /api/shared-carts/:id/contributions/*
POST   /api/shared-carts/:id/finalize
POST   /api/shared-carts/:id/awaiting-choice/*
~~~

## 14. Critères d'acceptation fonctionnels

- [ ] l'organisateur voit **Ma liste** partout ;
- [ ] le participant voit **Liste de [Prénom]** partout ;
- [ ] une seconde liste OPEN appartenant au même créateur est refusée atomiquement ;
- [ ] Mon panier reste accessible et inchangé pendant toute consultation/commande de liste ;
- [ ] × quitte l'affichage sans fermer la liste ;
- [ ] une liste quittée ne se restaure pas au reload de la même session ;
- [ ] CLOSED/CANCELLED ne s'affichent jamais dans le side-cart ;
- [ ] une ou plusieurs lignes peuvent être sélectionnées ;
- [ ] Commander ouvre toujours le récapitulatif ;
- [ ] le ✓ du récapitulatif n'est pas interactif ;
- [ ] le montant confirmé correspond uniquement à la sélection ;
- [ ] aucune ligne du panier personnel n'entre dans la commande liste ;
- [ ] le choix buyer/organizer apparaît uniquement lorsqu'il est pertinent ;
- [ ] ce choix est validé, persisté et appliqué côté serveur ;
- [ ] un claim concurrent perdant retourne une erreur stable puis rafraîchit la liste ;
- [ ] les E2E ne cherchent plus `.k-cart-item-buy` et couvrent `.k-cart-item-select` + `Commander`.
