# Komerce — Doctrine canonique de la liste partagée

> **Version normative : 2026-09-01**  
> **Statut : source de vérité métier**  
> Cette version remplace les doctrines antérieures « liste active = panier unique », achat direct par ligne et « payer tout / acheter le reste ».

## 1. La phrase

**Une liste partagée est une sélection publiée et figée ; ce n'est ni un panier personnel, ni un checkout collectif.**

Komerce ne tient pas de cagnotte, ne répartit pas une dette et ne demande jamais de régler le montant total d'une liste. Chaque achat est une commande Komerce standard portant uniquement sur les articles que l'acheteur a explicitement sélectionnés.

## 2. Les trois objets

| Objet | Propriétaire | Nature | Modifiable |
|---|---|---|---|
| **Mon panier** | utilisateur courant | panier privé et vivant | oui |
| **Liste partagée** | organisateur | snapshot publié et accessible par lien | jamais après publication |
| **Commande** | acheteur | matérialisation d'une sélection personnelle | selon le cycle normal des commandes |

Le panier personnel et la liste partagée coexistent, mais leurs articles ne sont jamais fusionnés.

## 3. Nommage centré sur la personne

Les listes V1 ne sont pas nommables. Leur libellé est donc calculé selon la relation avec l'utilisateur courant :

| Situation | Libellé canonique |
|---|---|
| Panier privé | **Mon panier** |
| Liste créée par l'utilisateur courant | **Ma liste** |
| Liste créée par une autre personne | **Liste de [Prénom]** |
| Checkout de sa propre liste | **Achat pour Ma liste** |
| Checkout d'une liste reçue | **Achat pour la liste de [Prénom]** |

Un titre technique nul ne doit jamais produire « Liste sans titre », « Votre liste » ou « Liste partagée » dans l'expérience utilisateur.

Dans l'historique, plusieurs anciennes listes personnelles peuvent être distinguées par leur date et leur statut, sans introduire de nommage libre.

## 4. Publication et immutabilité

La création d'une liste part toujours du panier personnel.

Avant tout appel de création, l'utilisateur confirme explicitement :

> **Une fois partagée, cette liste ne sera plus modifiable.**

Annuler cette confirmation n'écrit rien.

Après succès, dans cet ordre :

1. le snapshot est créé ;
2. le panier personnel source est vidé ;
3. **Ma liste** devient la liste affichée ;
4. le lien est proposé au partage.

La composition publiée — articles, quantités, variantes et médias de référence — n'est plus éditable. Le prix photographié à la publication reste une référence d'affichage ; la commande applique le prix marchand courant et toute variation est annoncée avant confirmation. Une erreur de composition se corrige en fermant la liste puis en en créant une nouvelle.

Tant que les listes ne sont pas nommables, un organisateur ne peut posséder qu'une seule liste **OPEN**. Cette contrainte est volontaire, réversible et garantie par la base.

## 5. Le side-cart universel

Le side-cart possède deux réalités séparées :

~~~text
[ Mon panier ] [ Ma liste ]
ou
[ Mon panier ] [ Liste de Samsam ]
~~~

Règles :

- **Mon panier** est toujours disponible ;
- le second onglet existe uniquement lorsqu'une liste OPEN est affichée ;
- une seule liste partagée peut être affichée à la fois ;
- ouvrir une liste B remplace seulement la liste A affichée ; A n'est ni fermée ni modifiée ;
- changer d'onglet ne déclenche aucun appel métier ;
- les deux surfaces utilisent le même shell et le même checkout canonique, jamais le même contenu.

Le bouton **×** du panneau partagé signifie **quitter cet affichage** :

- il retire la liste du slot local ;
- il ne la ferme pas ;
- il ne la désenregistre pas ;
- il ne modifie aucun article ;
- il restitue immédiatement **Mon panier** ;
- un simple reload de la même session ne doit pas réouvrir automatiquement une liste explicitement quittée.

## 6. Cycle de vie

| État | Signification | Side-cart | Achat |
|---|---|---|---|
| **OPEN** | snapshot publié avec au moins une ligne encore achetable | oui, s'il est affiché | oui |
| **CLOSED** | liste terminée explicitement ou entièrement achetée | jamais | non |
| **CANCELLED** | liste annulée | jamais | non |

**Fermer la liste** est une action métier réservée à l'organisateur : OPEN → CLOSED tant qu'il souhaite arrêter la liste avant sa complétion.

**La complétion ferme automatiquement la liste** : dès que la dernière ligne disponible est réclamée avec succès par une commande, la liste passe de OPEN à CLOSED. L'organisateur n'a aucune action « Clôturer la liste » à effectuer après 100 % d'articles achetés.

La vérité de complétion vient des claims canoniques `order_items.shared_cart_item_id`. La fermeture automatique est réconciliée côté backend immédiatement après le commit de la commande et avant la réponse de création ; elle écrit `shared_carts.status = closed`, `closed_at` et un événement `cart_closed` de raison `all_items_claimed`. Elle est idempotente et sûre face à deux derniers achats concurrents.

L'invariant métier est donc : **une liste dont toutes les lignes sont réclamées ne doit pas rester OPEN dans l'état observable rendu au client.**

**Quitter l'affichage** est une action locale disponible à toute personne : elle ne change aucun statut.

Les listes CLOSED/CANCELLED restent accessibles dans **Mes listes** comme historique passif.

## 7. Sélection avant achat

Une ligne OPEN non achetée est **sélectionnable**. Une ligne déjà achetée est verrouillée.

L'utilisateur peut sélectionner :

- un seul article ;
- plusieurs articles ;
- tous les articles encore disponibles via une action de sélection globale.

La sélection :

- est locale et temporaire ;
- ne réserve rien ;
- ne modifie pas la liste ;
- n'ajoute rien au panier personnel ;
- n'inclut jamais une ligne déjà achetée.

Le CTA canonique est :

> **Commander (N · montant sélectionné)**

Il n'existe plus d'achat direct par bouton « Acheter », de « Payer [montant de la liste] », ni d'obligation de régler le reste.

**Reste disponible** est une information sur la liste, jamais une somme due.

## 8. Récapitulatif puis checkout canonique

Toute sélection, y compris un seul article, suit exactement ce parcours :

~~~text
Liste OPEN
  → sélection explicite
  → Commander
  → récapitulatif des articles inclus
  → checkout canonique
  → création d'une commande standard
~~~

Dans le récapitulatif :

- le symbole **✓** signifie « inclus dans cette commande » ;
- ce symbole est statique et n'est jamais une case à cocher ;
- chaque ligne affiche article, quantité et prix marchand courant ;
- toute variation depuis le prix de publication est annoncée explicitement ;
- l'utilisateur peut revenir à la liste avant de confirmer.

Le checkout final conserve le contrat Komerce standard : identité, relais, crédit disponible, moyen de paiement et confirmation. La liste n'ajoute qu'un contexte d'affichage et les identifiants de claim nécessaires à la commande.

Un checkout porte soit sur **PERSONAL_CART**, soit sur **SHARED_LIST**. Jamais les deux.

Le panier personnel est conservé intégralement pendant un checkout liste et restauré à toute sortie du modal : succès, annulation, retour, Escape ou fermeture.

## 9. Code secret de retrait

Pour une commande issue d'une liste reçue, l'acheteur choisit dans le checkout final :

- **Me l'envoyer** — choix par défaut ;
- **L'envoyer à l'organisateur** — option explicite.

Pour une commande issue de **Ma liste**, ces deux destinations représentent la même personne ; aucun choix redondant n'est affiché.

Le navigateur transmet uniquement une intention sûre : **buyer** ou **organizer**. Il ne transmet jamais librement le numéro de l'organisateur.

Le serveur :

1. vérifie que les lignes appartiennent à une seule liste ;
2. résout l'organisateur depuis cette liste ;
3. utilise son numéro vérifié si l'option organizer est choisie ;
4. persiste le choix sur la commande ;
5. notifie réellement le destinataire retenu lorsqu'il devient disponible ;
6. réserve à ce destinataire l'accès à la révélation sécurisée du code complet.

Une préférence uniquement visuelle, sans effet backend, est interdite.

## 10. Achat concurrent et vérité des états

La sélection ne réserve pas les lignes. Deux personnes peuvent sélectionner le même article.

Une ligne ne peut toutefois être réclamée qu'une fois. La commande gagnante est arbitrée atomiquement par la base via **shared_cart_item_id**.

En cas de conflit :

- la commande concurrente est refusée proprement ;
- la liste est rafraîchie ;
- la ligne devient **Déjà acheté** ;
- l'organisateur peut voir **Déjà acheté par [Prénom]** ;
- le participant voit seulement **Déjà acheté**.

Après chaque commande issue d'une liste, le backend vérifie la complétion. La commande qui rend la dernière ligne réclamée déclenche la fermeture automatique ; deux commandes concurrentes ne peuvent produire ni double fermeture ni double événement `cart_closed`.

## 11. Mes listes

**Mes listes** référence :

- les listes créées par moi ;
- les listes reçues que j'ai explicitement sauvegardées.

Sauvegarder une liste reçue est idempotent et ne copie pas son snapshot.

Une personne peut participer à plusieurs listes dans le temps, mais une seule liste OPEN est affichée dans le side-cart à un instant donné.

## 12. Ce qui est interdit

Ne pas réintroduire :

- modification ou ajout après publication ;
- stepper ou suppression de ligne sur une liste publiée ;
- CTA « Ajouter à cette liste » dans une fiche produit ;
- achat direct sans récapitulatif ;
- paiement forcé de toutes les lignes disponibles ;
- fusion panier personnel + liste ;
- checkout collectif parallèle ;
- cagnotte, contribution, montant libre ou objectif de financement ;
- liste CLOSED/CANCELLED résidente dans le side-cart ;
- maintien d'une liste 100 % réclamée au statut OPEN ;
- choix de destinataire du code sans effet réel côté serveur.

## 13. Test décisif

À tout moment, l'utilisateur doit pouvoir répondre sans hésiter à quatre questions :

1. Suis-je dans **Mon panier**, **Ma liste** ou **Liste de [Prénom]** ?
2. Quels articles ai-je sélectionnés pour cette commande précise ?
3. Quel montant vais-je confirmer maintenant ?
4. Qui recevra le code secret de retrait ?

Si une réponse n'est pas immédiatement claire, l'implémentation n'est pas conforme.