# Komerce — Liste partagée · Doctrine Boutique First

> **Canonique — août 2026**
>
> Une liste publiée est un snapshot figé. Les proches achètent des articles ; Komerce ne gère ni cagnotte, ni engagement, ni contribution collective.

## 1. Principe

**La liste active est le panier visible.**

Il n'existe pas de seconde surface concurrente, de panier collectif financier ou de checkout de groupe.

La liste partage des articles réels. Chaque achat reste un achat Komerce normal.

## 2. Création = publication

Le créateur prépare librement son panier personnel.

Lorsqu'il crée la liste, son contenu publié devient structurellement immuable : produits, variantes et quantités sont figés.

`OPEN` signifie **achetable**, jamais **éditable**.

Une erreur après publication se corrige en fermant la liste puis en en publiant une nouvelle. L'ancien lien ne change pas silencieusement.

## 3. Une seule surface

Quand une liste est active, elle occupe la surface panier/side-cart.

Le panier personnel continue d'exister en état isolé mais ne concurrence jamais la liste dans l'interface.

Fermer le contexte de liste restitue le panier personnel. Aucune bascule manuelle panier/liste n'est nécessaire.

## 4. Une ligne = une décision d'achat

Chaque ligne disponible expose l'article, son prix, son état et l'action `Acheter`.

`Acheter` ouvre le checkout standard avec cette ligne uniquement.

Une ligne achetée reste visible mais devient verrouillée : `Déjà acheté`.

Le snapshot structurel ne change pas ; seul son état transactionnel évolue.

## 5. Organisateur et participant

L'organisateur voit `Déjà acheté par <nom>` lorsqu'une ligne a été achetée. Ses actions de liste sont `Partager`, `Fermer la liste` et `Payer` lorsqu'il reste des lignes disponibles.

Il n'existe plus de stepper, de suppression, de mode Modifier ni de CTA `Ajouter à cette liste`.

Le participant voit `Déjà acheté`, peut `Sauvegarder`, acheter une ligne disponible ou utiliser `Payer`.

Sauvegarder crée un signet d'accès. Cela ne copie ni ne modifie la liste.
## 6. Payer

Le CTA global s'appelle `Payer · X KMF`.

Il achète en une seule commande toutes les lignes encore disponibles.

Il ne signifie jamais contribuer d'un montant libre, promettre une somme, financer un objectif ou compléter une cagnotte.

S'il ne reste aucune ligne achetable, le CTA disparaît.

## 7. Concurrence et vérité d'achat

Le frontend informe. Le backend décide.

Deux personnes ne doivent jamais pouvoir acheter la même ligne.

Le rattachement de la ligne partagée à la commande et la contrainte d'unicité en base protègent contre les achats concurrents.

Après confirmation : `Disponible → Déjà acheté`.

## 8. Fiche produit et panier personnel

Ouvrir une fiche produit depuis une liste ne donne jamais le droit de modifier cette liste.

`Ajouter au panier` vise le panier personnel de l'utilisateur, organisateur comme participant.

Ce panier reste isolé tant que la liste occupe la surface canonique.

## 9. Partager

Partager une liste active réutilise toujours son lien.

Repartager ne crée jamais une nouvelle liste.

Une nouvelle liste naît uniquement d'une intention explicite de publication depuis un panier personnel.

Le partage simple `/api/shares`, utilisé notamment pour les favoris, n'est pas une liste collective : il ne porte ni engagement, ni contribution, ni paiement collectif.

## 10. Fermer

Fermer une liste interdit les nouveaux achats, libère son quota actif et restitue le panier personnel.

Pour corriger une liste publiée :

**Fermer → préparer le bon panier → publier une nouvelle liste.**

Jamais : publier puis modifier silencieusement le snapshot partagé.

## 11. États métier minimaux

Le domaine de la liste reste volontairement petit :

- `OPEN` : publiée et achetable ;
- `CLOSED` : fermée aux nouveaux achats ;
- `CANCELLED` : annulée.

Commandes et paiements gardent leurs propres états. La liste ne recrée pas une machine financière parallèle.

## 12. Ce qui n'existe plus

La liste partagée ne possède plus :

- engagement indicatif ;
- contribution ;
- montant libre participant ;
- passage collectif au règlement ;
- panier sur-couvert ;
- fenêtre de collecte ;
- modification post-publication ;
- reconstruction du snapshot en panier éditable ;
- routes `as-cart-items` ou mutations `/items` ;
- moteur `event + contributions` sous `/api/shares`.

Ces concepts ne doivent pas réapparaître sous un nouveau nom.

## 13. Retrait — décision produit actée

Le code de retrait reste produit par le mécanisme canonique. La liste ne génère jamais un second secret.

Décision produit à implémenter et certifier dans le lot checkout/retrait :

- le participant doit pouvoir choisir que Komerce adresse le code de retrait à l'organisateur ;
- sinon le participant reçoit ou conserve le code et peut le transmettre lui-même.

Cette option réutilise le mécanisme canonique existant, sans nouveau système de codes.

## 14. Invariant de conception

Si une évolution semble nécessiter un nouveau composant collectif, une route financière ou un état de groupe, demander d'abord :

> Peut-on résoudre ce besoin avec la liste figée + checkout standard + commande standard ?

La réponse par défaut est oui.

## Le serment

> La liste dit ce qui a été décidé.
> L'achat dit qui l'a acheté.
> Komerce vend des objets ; il ne tient pas les comptes de la famille.
