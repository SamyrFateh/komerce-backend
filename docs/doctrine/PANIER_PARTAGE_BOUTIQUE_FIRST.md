# Komerce — Panier partagé

> **Version** : 2026-08-01 — doctrine simplifiée.

## Doctrine intemporelle · Boutique First

> **Une liste commune. Des achats indépendants. Un rattachement logique.**

Le panier partagé n'est ni une cagnotte, ni un checkout collectif, ni une commande financière commune.

C'est une vue boutique partageable dans laquelle plusieurs personnes achètent des articles ordinaires. Chaque paiement confirmé crée immédiatement une commande unitaire réelle. Le panier partagé ne fait que rattacher symboliquement et logiquement ces commandes à une même liste.

**La négociation appartient aux humains. L'achat appartient à Komerce.**

---

## 1. La phrase

**Un panier partagé n'est pas une commande particulière. C'est une vue particulière sur des commandes ordinaires.**

Le lien ouvre la boutique. Le participant voit les articles encore disponibles. Il choisit un article, passe par le checkout canonique, paie et obtient une commande normale.

Il n'existe pas de montant libre à réconcilier avec le panier. Il n'existe pas de paiement gardé en attente jusqu'à une clôture collective. Il n'existe pas de commande finale globale.

---

## 2. Le voyage du participant

Toujours le même chemin :

1. **Le lien ouvre la liste dans la boutique.**
2. **Le participant voit ce qui reste disponible.**
3. **Il choisit un article ou une quantité.**
4. **L'article est verrouillé uniquement pendant le checkout.**
5. **Le paiement confirmé crée une commande unitaire.**
6. **L'article est marqué acheté dans la liste.**
7. **Le participant revient sur une confirmation claire.**

La réservation longue n'existe pas. Une réservation sert uniquement à protéger le paiement en cours pendant quelques minutes. Si le paiement échoue ou est abandonné, l'article redevient disponible.

> **Choisir sans payer ne bloque rien. Payer matérialise l'achat.**

---

## 3. Le rôle de l'organisateur

L'organisateur :

- crée la liste ;
- choisit les articles ;
- partage le lien ;
- voit ce qui a été acheté et ce qui reste disponible ;
- modifie les lignes non achetées ;
- ferme la liste quand il le souhaite.

La date souhaitée de finalisation est un repère humain, pas une bombe à retardement transactionnelle.

Fermer la liste empêche seulement de nouveaux achats depuis cette liste. Les commandes déjà payées existent déjà et continuent leur cycle normal.

---

## 4. Ce que Komerce ne gère pas

Komerce ne gère pas :

- les promesses de participation ;
- l'équité entre proches ;
- les relances sociales ;
- les tontines ;
- les cagnottes ;
- les dettes ou engagements familiaux ;
- les montants libres à redistribuer ;
- les paiements collectifs en attente ;
- la décision de savoir qui doit aider qui.

Komerce reprend la main uniquement lorsqu'un achat réel commence.

---

## 5. Commandes unitaires et rattachement

Chaque paiement confirmé produit une commande autonome avec :

- son acheteur ;
- son paiement ;
- sa facture ;
- ses lignes ;
- son cycle logistique ;
- son remboursement éventuel ;
- son code de retrait.

La commande conserve un contexte optionnel de panier partagé :

- `shared_cart_id` ;
- `shared_cart_item_id` ou un identifiant de ligne équivalent.

Ce rattachement sert à la lecture, à la coordination et à la traçabilité. Il ne transforme jamais plusieurs commandes en une seule transaction.

---

## 6. Doctrine du checkout

Le panier partagé utilise le checkout canonique de Komerce.

Il ne rajoute aucune étape sociale ou financière.

Le participant ne renseigne pas :

- de bénéficiaire ;
- de personne de retrait ;
- de montant libre ;
- de promesse ;
- de date de paiement future.

> **Le contexte de panier partagé ne doit pas contaminer le checkout.**

---

## 7. Doctrine du retrait

Chaque commande unitaire conserve son propre code de sécurité.

Pour une commande ordinaire, le destinataire initial du code reste l'acheteur vérifié.

Pour une commande rattachée à un panier partagé, le destinataire initial du code est par défaut l'organisateur vérifié du panier.

L'organisateur peut :

- garder le code ;
- transmettre un code à une autre personne ;
- transmettre plusieurs codes à une même personne ;
- répartir les codes entre plusieurs personnes.

Cette transmission ne recrée pas de bénéficiaire. Elle change seulement le détenteur pratique d'un secret de retrait.

Le code n'est jamais envoyé au checkout ni immédiatement après le paiement. Il est envoyé uniquement lorsque la commande atteint le jalon logistique prévu.

> **Une commande, un code. Par défaut, l'organisateur reçoit les codes du panier partagé.**

---

## 8. Invariants

- Le lien ouvre toujours la boutique.
- Le participant ne modifie jamais la liste partagée.
- Un article n'est bloqué que pendant un paiement actif et court.
- Un paiement confirmé crée immédiatement une commande unitaire.
- Aucun argent n'est conservé en attente d'une commande collective.
- Aucune commande globale finale n'est créée.
- Une fermeture de liste n'annule pas les commandes existantes.
- Le checkout reste canonique et sans bénéficiaire.
- Le destinataire initial du code est résolu côté serveur.
- Un code reste lié à une seule commande et à une remise atomique.
- Tout geste touchant au paiement, au code ou à la remise laisse une trace.

---

## 9. La langue qu'on parle aux humains

Le produit visible raconte seulement :

> Voici la liste.  
> Voici ce qui reste disponible.  
> Choisissez un article.  
> Payez normalement.  
> Merci, votre achat est confirmé.

Côté organisateur :

> Voici ce qui a été acheté.  
> Voici ce qui reste.  
> Fermez la liste quand vous le souhaitez.  
> Gérez les codes lorsqu'ils deviennent disponibles.

Pas de jauge financière. Pas de solde à atteindre. Pas de statut de contribution. Pas de commande collective à déclencher.

---

## 10. La ligne à ne jamais franchir

Komerce matérialise des achats. Komerce ne financiarise pas l'aide.

À l'instant où l'on détient des fonds collectifs, où l'on arbitre un financement incomplet, où l'on promet une commande future à partir de montants libres, on quitte le commerce pour devenir autre chose.

Jusque-là : **Boutique First.**

---

## Le serment

> Une liste. Plusieurs acheteurs. Des commandes normales.  
> Le paiement crée l'achat.  
> Le panier partagé ne crée qu'un contexte.  
> L'organisateur garde la main.  
> Komerce reste commerçant.
