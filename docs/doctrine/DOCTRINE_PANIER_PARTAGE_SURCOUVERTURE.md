# Doctrine Komerce — Panier partagé : engagements excédentaires et paiements plafonnés

> Complément normatif à `DOCTRINE_PANIER_PARTAGE.md`.
> 
> Objet : figer la règle produit/finance quand la somme des engagements indicatifs atteint ou dépasse le montant du panier.

---

## 1. Principe

Dans le panier partagé Komerce, il faut distinguer trois montants :

```txt
Montant panier / checkout = montant réel attendu pour la commande
Somme des engagements = intentions déclarées par les participants
Somme des paiements = argent réellement encaissé
```

Règle centrale :

```txt
Les engagements peuvent dépasser le total du panier.
Les paiements réels ne doivent jamais dépasser le montant checkout final.
```

Un engagement est une intention de participation. Ce n'est pas encore un paiement, une dette, une autorisation Stripe, ni une somme encaissée.

---

## 2. Panier couvert par engagements

Pendant la phase ouverte, si la somme des engagements actifs atteint ou dépasse le total du panier, Komerce doit considérer le panier comme **couvert en intention**.

```txt
Somme engagements actifs >= total panier
→ panier couvert par les engagements
```

Si la somme des engagements dépasse le total :

```txt
Somme engagements actifs > total panier
→ panier sur-couvert en intention
```

Ce cas est autorisé et non bloquant.

Exemple :

```txt
Total panier : 50 000 KMF
Engagements :
- Fatima : 20 000 KMF
- Ali    : 20 000 KMF
- Nadia  : 20 000 KMF
Total engagements : 60 000 KMF

Résultat : panier sur-couvert à 120 % en intention.
```

---

## 3. Notification UX obligatoire

Quand le panier est couvert par les engagements, l'onglet Groupe doit afficher une notification positive et rassurante.

### 3.1 Couverture exacte ou suffisante

```txt
✅ Panier couvert par les engagements
Les proches ont déjà promis assez pour couvrir ce panier.
Au règlement, Komerce limitera automatiquement les paiements au montant nécessaire.
```

### 3.2 Sur-couverture

```txt
✅ Panier sur-couvert
Les engagements dépassent le total du panier.
Aucun surplus ne sera encaissé : les paiements seront plafonnés au reste à payer.
```

Cette notification doit être affichée comme une information de confiance, pas comme une erreur.

---

## 4. Passage au règlement

Au passage au règlement, les engagements actifs sont verrouillés, mais Komerce ne doit pas transformer automatiquement la totalité des engagements en paiements exigibles.

Règle :

```txt
Chaque participant peut payer au maximum son engagement verrouillé,
mais jamais plus que le reste à payer réel du panier.
```

Formule :

```txt
montant_payable = min(engagement_verrouillé, reste_à_payer)
```

Exemple :

```txt
Total panier : 50 000 KMF
Déjà payé : 40 000 KMF
Reste à payer : 10 000 KMF
Engagement verrouillé de Fatima : 20 000 KMF

Montant payable par Fatima : 10 000 KMF
```

Le bouton de paiement doit donc afficher :

```txt
Payer 10 000 KMF
```

et non :

```txt
Payer 20 000 KMF
```

---

## 5. Panier déjà entièrement réglé

Si le reste à payer est nul, Komerce ne doit plus ouvrir de paiement participant.

```txt
reste_à_payer <= 0
→ aucun nouveau Stripe Checkout
→ aucun encaissement cash supplémentaire
→ message clair au participant
```

Message recommandé :

```txt
✅ Ce panier est déjà entièrement réglé.
Merci, votre participation n'est plus nécessaire.
Aucun surplus ne sera encaissé.
```

---

## 6. Protection backend obligatoire

Le frontend peut afficher le bon montant, mais le backend reste l'autorité.

À la création d'une contribution :

```txt
1. Recharger le panier partagé et son total réel.
2. Recalculer les paiements confirmés.
3. Recalculer le reste à payer.
4. Recharger l'engagement verrouillé du participant.
5. Calculer : montant_payable = min(engagement_verrouillé, reste_à_payer).
6. Refuser si montant_payable <= 0.
7. Créer Stripe Checkout uniquement pour montant_payable.
```

Pseudo-code :

```js
const remaining = Math.max(0, checkoutTotalKmf - confirmedPaidKmf);
const payableAmount = Math.min(commitment.amount_kmf, remaining);

if (payableAmount <= 0) {
  return res.status(409).json({
    success: false,
    code: 'already_fully_funded',
    error: 'Ce panier est déjà entièrement réglé.'
  });
}
```

Le backend ne doit jamais faire confiance au montant envoyé par le front pour déterminer le montant réellement encaissable.

---

## 7. Concurrence et paiements simultanés

Cas critique : deux participants cliquent presque en même temps alors qu'il ne reste qu'un faible solde.

```txt
Reste à payer : 10 000 KMF
Ali clique pour payer 10 000 KMF
Fatima clique pour payer 10 000 KMF au même moment
```

Le backend doit éviter le surencaissement volontaire :

- recalculer le reste à payer avant création Stripe ;
- utiliser une transaction ou un verrou logique si nécessaire ;
- revalider au webhook Stripe avant de comptabiliser définitivement ;
- si un excédent est malgré tout encaissé à cause d'une course, le traiter explicitement comme remboursement, avoir ou exception admin.

Le surplus ne doit jamais disparaître silencieusement.

---

## 8. Relation avec la doctrine principale

Cette règle complète la doctrine principale :

```txt
Engagements indicatifs d'abord.
Paiements réels seulement après passage au règlement.
Finalisation pilotée par le créateur.
Aucun surplus encaissé volontairement.
```

Elle précise le cas particulier :

```txt
Engagement supérieur au total = autorisé.
Paiement supérieur au total = interdit.
Dernier paiement = plafonné au reste à payer.
Panier couvert par engagements = notification positive.
```

---

## 9. Résumé exécutable

```txt
Si engagements_total >= checkout_total :
  afficher "panier couvert par les engagements"

Si engagements_total > checkout_total :
  afficher "panier sur-couvert — aucun surplus ne sera encaissé"

Au paiement :
  payable = min(engagement_verrouillé, checkout_total - paiements_confirmés)

Si payable <= 0 :
  refuser paiement
  afficher "panier déjà entièrement réglé"

Jamais :
  encaisser volontairement plus que le checkout final
  masquer un surplus
  créer une dette complexe
```
