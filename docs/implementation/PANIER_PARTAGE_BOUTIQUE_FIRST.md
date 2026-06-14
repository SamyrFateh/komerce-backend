# Panier partagé — Mise en œuvre Boutique First

> Document daté et révisable.  
> Mis à jour : **2026-06-14**  
> Doctrine de référence : `docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`

---

## 1. But

Ce document traduit la doctrine Boutique First en règles opératoires pour le code.

Le parcours actif est :

```txt
Lien partagé
→ vue panier dans la boutique
→ consultation des articles
→ règlement de la part si le panier est payable
→ retour dans la boutique avec le panier mis à jour
```

Le checkout n'est jamais le point d'entrée. Il reste une étape déclenchée depuis la boutique.

---

## 2. Invariants

Ne pas casser :

- le participant ne modifie jamais le panier partagé ;
- le paiement public est possible uniquement si le panier est en phase payable ;
- le montant demandé ne dépasse jamais le reste dû ;
- la confirmation bancaire reste la source de vérité ;
- les articles publics sont affichés depuis le snapshot du panier ;
- les statuts techniques ne sont jamais exposés tels quels aux humains.

---

## 3. Six coutures à tenir

### C1 — Retour dans la boutique

Après succès ou annulation du paiement, l'utilisateur revient toujours dans la boutique avec le token du panier et un indicateur de résultat.

Acceptation : aucune page morte, aucun détour durable hors boutique.

### C2 — Cinq libellés humains

Les seuls états visibles sont :

```txt
En préparation
Ouvert au paiement
Fermé
Finalisé
Annulé
```

`awaiting_choice` peut exister dans le moteur, mais côté participant il s'affiche comme **Fermé**.

### C3 — Le mode prêt à payer est vraiment payable

`share_mode = ready_to_pay` doit créer ou basculer immédiatement le panier en phase payable.

`share_mode = needs_validation` laisse le panier en consultation. Le créateur ouvre les paiements plus tard.

Ne jamais résoudre ce besoin en autorisant un paiement public sur un panier non payable.

### C4 — Fiche produit lecture seule

La vue participant peut ouvrir une fiche article construite uniquement depuis le snapshot reçu.

Interdit : appel catalogue live, ajout au panier, modification, suppression, commande séparée, mutation du panier partagé.

### C5 — Création Boutique First

Au partage, poser la question humaine :

```txt
Ce panier est-il prêt à être payé ?
```

Options :

```txt
Oui, ouvrir les paiements maintenant
Non, partager d'abord en consultation
```

Le message WhatsApp doit refléter cette nature : panier payable maintenant ou panier consultable avant validation.

### C6 — Copie argent honnête

Bouton :

```txt
Régler ma part
```

Afficher avant action :

```txt
Maximum : X KMF
```

Le champ montant est borné par le reste dû. Si la saisie dépasse le reste, l'UI corrige ou explique avant l'appel API.

---

## 4. Flexibilité autorisée

Boutique First ne veut pas dire rigide.

Autorisé :

- choix prêt à payer / à valider ;
- date limite raisonnable ;
- ouverture des paiements plus tard ;
- ajustement tant qu'aucun paiement n'a verrouillé le panier ;
- montant libre dans la limite du reste.

Non négociable :

- entrée par la boutique ;
- participant en lecture seule ;
- plafond au reste ;
- confirmation bancaire avant promesse de réussite ;
- pas de statut technique visible.

---

## 5. Tests manuels

### Cas A — Prêt à payer

Créer un panier prêt à payer, ouvrir le lien en navigation privée, vérifier articles, total, reste, bouton `Régler ma part`, paiement puis retour boutique avec reste mis à jour.

### Cas B — À valider ensemble

Créer un panier consultable, vérifier absence de bouton de paiement côté participant, ouvrir les paiements côté créateur, vérifier apparition du bouton de règlement.

### Cas C — Lecture seule

Ouvrir une fiche article depuis le lien participant, vérifier qu'elle est consultable et qu'aucune action de modification n'existe.

### Cas D — Statuts

Vérifier la projection humaine des états : préparation, ouvert au paiement, fermé, finalisé, annulé.

### Cas E — Dépassement du reste

Vérifier qu'une saisie supérieure au reste est annoncée et bornée avant l'action de paiement.

---

## 6. Definition of Done

La mise en œuvre est acceptable si elle garantit :

- aucun doute ;
- aucune fausse promesse ;
- aucun statut bizarre ;
- aucun bouton mort ;
- aucune surprise au paiement ;
- aucun écran qui fait peur.
