# Komerce — Panier partagé

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

## Doctrine intemporelle · Boutique First

> **Chacun gère sa négo. Komerce sait matérialiser l'achat.**

Ce document n'est pas une spécification. Les specs vieillissent, les routes changent, les statuts techniques se renomment. Ceci est la direction. Quand un choix se présente et qu'on hésite, on revient ici.

---

## 1. La phrase

**Un panier partagé n'est pas un checkout partagé.**

C'est une vue boutique partageable, avec un suivi minimum. Tout lien partagé ouvre d'abord la boutique. Le paiement n'est jamais le point d'entrée : il est une action possible *à l'intérieur* de la vue panier.

**La négociation appartient aux humains. La matérialisation appartient à Komerce.**

Qui paie, combien, pourquoi, avec quelle culpabilité ou quelle générosité, dans quel ordre, après quel coup de téléphone : c'est la famille, la diaspora, les liens qui existaient déjà avant nous. Komerce n'arbitre pas, ne relance pas, ne tient pas de cagnotte, ne gère pas de campagne. Komerce s'arrête là où commence l'intime, et reprend là où commence l'achat.

Komerce sait faire une chose : **transformer une intention en un objet réel, visible, et livré.**

---

## 2. Ce que c'est — et ce que ce n'est pas

C'est une boutique qu'on partage avec ceux qui nous aiment.

Ce n'est pas une plateforme de financement. Pas un portefeuille. Pas une cagnotte. Pas un transfert d'argent. Pas un arbitre des comptes familiaux.

Le panier montre des choses vraies, à des prix vrais, qui arriveront vraiment. On ne paie pas un concept ni une promesse : on règle sa part d'un panier réel.

Komerce ne collecte pas pour atteindre un objectif abstrait. Komerce encaisse une part d'un panier réel, plafonnée au reste dû.

---

## 3. La personne au centre

Tout se décide dans un seul instant.

Quelqu'un qui n'a jamais entendu parler de Komerce ouvre un lien reçu par WhatsApp, sur un téléphone modeste, sur un réseau lent, et on lui demande de sortir de l'argent pour un pays à l'autre bout du monde.

C'est le creuset. La confiance se gagne ou se perd là. Toute décision de design, de copie, d'architecture se juge à cette aune : **est-ce que ça rassure l'inconnu au moment où il s'apprête à payer ?**

C'est pour cette personne qu'on ouvre la boutique en premier. On ne la met pas devant un formulaire de paiement : on la met devant un magasin. Le magasin est le mécanisme de confiance.

---

## 4. Le voyage du lien

Toujours le même chemin :

1. **Le lien ouvre la boutique.** Une vraie vue, claire, rapide, rassurante.
2. **La preuve.** On voit le créateur, les articles, les images, les prix, le total, et ce qui reste à régler.
3. **La lecture seule.** On peut explorer, ouvrir les fiches produits, comprendre. On ne peut jamais casser ni modifier le panier partagé.
4. **Régler ma part.** Une vérité simple sur un bouton. Le montant ne dépasse jamais le reste.
5. **Le retour.** Après le paiement, retour dans la boutique, panier mis à jour, reste diminué, message clair. Jamais de page morte.

---

## 5. Les deux natures du panier

Au moment de partager, le créateur répond à une question humaine :

**Ce panier est-il prêt à être payé ?**

- **Prêt à payer** — le panier est décidé, évident. Les proches consultent et règlent leur part tout de suite. C'est le choix par défaut.
- **À valider ensemble** — le panier est important, cher, à mûrir. Les proches consultent, voient les articles et le total, mais ne paient pas encore. Le créateur ouvrira les paiements quand le panier sera confirmé.

Deux natures. Aucune n'est un workflow. Le créateur choisit la nature de son geste, pas un état de machine.

---

## 6. Flexibilité et invariants

Boutique First ne veut pas dire rigide. Ça veut dire : flexible dans l'usage, strict dans les invariants.

Flexible :

- le créateur choisit `Prêt à payer` ou `À valider ensemble` ;
- il choisit une date limite raisonnable ;
- il peut ouvrir les paiements plus tard ;
- il peut ajuster tant qu'aucun paiement n'a verrouillé le panier ;
- le proche règle le montant qu'il veut, dans la limite du reste.

Non négociable :

- le lien ouvre toujours la boutique ;
- le participant ne modifie jamais le panier partagé ;
- le montant ne dépasse jamais le reste ;
- le paiement n'est réussi qu'après confirmation bancaire ;
- aucun statut technique ne remonte aux humains.

---

## 7. Irréprochable

Comme on ne fait qu'une seule chose, cette chose porte tout. Irréprochable ne veut pas dire tout faire. Ça veut dire, sans exception :

- aucun doute ;
- aucune fausse promesse ;
- aucun statut bizarre ;
- aucun bouton mort ;
- aucune surprise au paiement ;
- aucun écran qui fait peur.

Net, fiable, premium, sans ambiguïté. Pas plus large, pas plus financier, pas plus ambitieux que nos moyens — mais parfaitement tenu.

---

## 8. Les invariants qui protègent

- On n'accepte un paiement que lorsque le panier est réellement payable.
- On ne prélève jamais plus que le reste à couvrir.
- La liste est un instantané structurel figé dès sa publication : produits, variantes et quantités ne changent plus ; seuls disponibilité et statut d'achat peuvent évoluer.
- Un paiement n'est tenu pour réussi qu'une fois confirmé par la banque.
- Ni le participant ni l'organisateur ne modifient une liste publiée ; une erreur se corrige en fermant la liste puis en en publiant une nouvelle.
- Tout geste qui touche à l'argent laisse une trace.

---

## 9. La langue qu'on parle aux humains

Le produit visible ne raconte qu'une histoire :

> Voici le panier.  
> Voici ce qui reste.  
> Tu peux régler ta part.  
> Merci, c'est pris en compte.

Les seuls états qu'un humain voit sont :

- **En préparation** — on peut consulter, pas encore payer.
- **Ouvert au paiement** — on peut régler sa part.
- **Fermé** — la période de paiement est passée.
- **Finalisé** — la commande est faite.
- **Annulé** — terminé, rien n'est dû.

Toute la mécanique d'état qui vit sous le capot peut rester dans le moteur, mais **elle ne parle jamais aux humains**.

---

## 10. La ligne à ne jamais franchir

Komerce matérialise un achat. Komerce ne financiarise pas l'aide.

À l'instant où l'on se met à gérer des fonds collectifs vers un objectif, à arbitrer un financement incomplet, à détenir de l'argent en attente, à relancer des contributeurs, on cesse d'être un commerçant qui se fait payer pour devenir autre chose : un établissement de paiement.

Ce n'est pas notre métier, ce n'est pas à notre portée, et ce n'est pas ce dont nos clients ont besoin.

Si un jour ce pari change — devenir le rail de la diaspora à grande échelle — il se décidera les yeux ouverts, avec un juriste dans la pièce et de quoi tenir. Pas par accumulation de petites décisions techniques. Jusque-là : **Boutique First.**

---

## Le serment

> La négociation est à eux. L'achat est à nous.  
> On ouvre une boutique, pas un guichet.  
> On montre du vrai, on plafonne au juste, on confirme avant de promettre.  
> On ne fait qu'une chose — et on la tient parfaitement.
