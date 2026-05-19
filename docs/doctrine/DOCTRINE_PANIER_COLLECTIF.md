# Doctrine Komerce — Panier collectif

## 1. Principe central

Le panier collectif Komerce n'est pas une commande immédiate.

Il est une zone d'engagement avant commande :

```txt
Panier collectif = réservation temporaire + contributions + validation finale
```

La commande ferme ne naît qu'après financement suffisant, stock encore réservé, puis clôture ou confirmation par l'organisateur.

Cette règle protège Komerce contre :

- les commandes partielles impossibles à consolider ;
- les doubles décréments de stock ;
- les paiements cash annoncés mais non encaissés ;
- les annulations complexes ;
- les paniers collectifs non financés qui bloquent définitivement l'inventaire.

## 2. Objectif produit

Le flux visible doit rester très simple.

Pour l'organisateur :

```txt
Panier → Payer à plusieurs → lien prêt → WhatsApp
```

Pour le participant :

```txt
Lien → choisir montant → carte ou cash → confirmation
```

Le modèle interne peut être robuste, mais l'interface doit rester rapide, visuelle et peu textuelle.

## 3. Entités métier

### 3.1 group_cart

Représente l'espace collectif pré-commande.

Champs conceptuels :

```txt
id
slug friendly
share_token
organizer_user_id / organizer_phone
title
status
total_expected_kmf
total_confirmed_kmf
total_promised_cash_kmf
reserved_until
created_at
updated_at
closed_at
expires_at
order_id nullable
```

### 3.2 group_cart_items

Copie du panier à financer.

```txt
group_cart_id
product_id
qty
unit_price_kmf
snapshot_name
snapshot_image_url
snapshot_category
```

Le snapshot évite qu'un changement catalogue casse la lecture du panier partagé.

### 3.3 group_cart_contributions

Engagement d'un participant.

```txt
group_cart_id
contributor_name
contributor_phone
amount_kmf
method: card | cash
status
stripe_payment_intent_id nullable
stripe_checkout_session_id nullable
cash_code nullable
cash_relais_id nullable
paid_at nullable
collected_at nullable
cancelled_at nullable
expires_at nullable
```

### 3.4 stock_reservations

Réservation temporaire du stock.

```txt
group_cart_id
product_id
qty
status
reserved_until
consumed_at nullable
released_at nullable
```

## 4. Statuts

### 4.1 Statuts group_cart

```txt
draft
open
reserved
funding
funded
ready_to_order
ordered
expired
cancelled
```

Définitions :

- `draft` : panier collectif en préparation, pas encore partagé.
- `open` : lien actif, participants acceptés.
- `reserved` : stock temporairement réservé.
- `funding` : au moins une contribution existe.
- `funded` : montant confirmé suffisant atteint.
- `ready_to_order` : financement + stock validés, prêt à transformer en commande.
- `ordered` : commande Komerce créée.
- `expired` : délai de réservation dépassé.
- `cancelled` : annulé volontairement.

### 4.2 Statuts contribution

Pour carte :

```txt
pending_card
paid
card_failed
card_cancelled
```

Pour cash :

```txt
cash_promised
cash_collected
cash_expired
cash_cancelled
```

Règle importante :

```txt
cash_promised ≠ paid
cash_collected = argent réellement encaissé
```

### 4.3 Statuts stock_reservation

```txt
reserved
consumed
released
expired
```

- `reserved` : stock bloqué temporairement.
- `consumed` : réservation convertie en commande.
- `released` : réservation libérée volontairement.
- `expired` : réservation expirée automatiquement.

## 5. Flux organisateur

### 5.1 Création

L'organisateur compose un panier puis clique :

```txt
Payer à plusieurs
```

Le backend crée :

```txt
group_cart
group_cart_items
stock_reservations
share slug / share token
```

Puis retourne un lien friendly :

```txt
/g/famille-aboudi
/g/panier-abc123
```

L'interface affiche immédiatement :

```txt
✅ Groupe prêt
[Copier]
[WhatsApp]
```

### 5.2 Suivi

Dans l'onglet `Mes groupes`, l'organisateur voit :

```txt
Ouvert / Payé / Prêt
Participants
Payé / En attente / Cash promis
Total collecté
Reste à payer
Actions : copier, clôturer, voir détail
```

### 5.3 Clôture

La clôture ne doit pas créer une commande aveuglément.

Elle vérifie :

```txt
stock encore réservé
montant confirmé suffisant
aucune contribution critique en attente
panier non expiré
```

Puis seulement :

```txt
group_cart → ready_to_order → ordered
stock_reservations → consumed
order créée
```

## 6. Flux participant

### 6.1 Ouverture du lien

Le participant ouvre un lien friendly.

Il doit comprendre en quelques secondes :

```txt
👥 Panier collectif
🧺 articles
💰 reste à payer
[Carte]
[Cash au relais]
```

### 6.2 Paiement carte

```txt
choix montant
→ contribution pending_card
→ Stripe Checkout
→ webhook Stripe
→ contribution paid
→ total_confirmed_kmf augmente
```

La contribution carte n'est définitive qu'après webhook.

### 6.3 Paiement cash

```txt
choix montant
→ contribution cash_promised
→ code cash / référence
→ paiement au relais
→ agent encaisse
→ contribution cash_collected
→ total_confirmed_kmf augmente
```

Le cash promis peut être affiché dans l'interface, mais il ne doit pas être compté comme argent confirmé.

## 7. Garantie stock

La garantie stock est une réservation temporaire, pas un achat définitif.

```txt
stock disponible boutique = stock réel - réservations actives
```

Exemple :

```txt
stock réel produit A = 10
panier collectif réserve 2
stock disponible affiché = 8
```

Si le panier collectif aboutit :

```txt
reservation reserved → consumed
commande créée
```

Si le panier collectif expire ou est annulé :

```txt
reservation reserved → released / expired
stock redevient disponible
```

Durée recommandée V1 :

```txt
24h à 48h
```

La durée doit être configurable via règles métier.

## 8. Calcul du financement

Trois montants doivent être distingués :

```txt
total_expected_kmf       = montant du panier
total_confirmed_kmf      = carte payée + cash encaissé
total_promised_cash_kmf  = cash promis mais pas encaissé
```

Le panier est finançable si :

```txt
total_confirmed_kmf >= total_expected_kmf
```

Le cash promis peut aider à piloter l'organisation, mais ne suffit pas à créer la commande ferme.

## 9. Friendly link

Le lien partagé doit être court et lisible :

```txt
/g/famille-aboudi
/g/cadeau-mariage
/g/panier-8k2m
```

Le slug n'est pas la sécurité.

La sécurité repose sur un `share_token` non devinable côté backend.

Le slug sert à l'humain, le token sert à l'accès.

## 10. Règles anti-erreur

### Ne jamais faire

```txt
clic Payer → commande directe
cash_promised → paid
réservation stock infinie
stock décrémenté avant commande ferme
commande créée sans vérifier le stock
commande créée avec financement incomplet
```

### Toujours faire

```txt
contribution avant paiement
webhook avant confirmation carte
encaissement relais avant confirmation cash
réservation temporaire du stock
validation finale avant commande
historique des transitions
idempotence Stripe
```

## 11. Routes cibles

V1 backend recommandée :

```txt
POST /api/group-carts
GET  /api/group-carts/:slug
POST /api/group-carts/:slug/contributions
POST /api/group-carts/:slug/contributions/:id/checkout
POST /api/group-carts/:id/close
POST /api/group-carts/:id/cancel
POST /api/group-carts/:id/release-reservations
POST /api/relais/cash-contributions/:cash_code/collect
```

Stripe webhook existant à étendre :

```txt
checkout.session.completed
payment_intent.succeeded
```

## 12. Tables cibles

```txt
group_carts
group_cart_items
group_cart_contributions
stock_reservations
group_cart_events
```

`group_cart_events` doit garder une trace lisible :

```txt
created
shared
contribution_created
card_paid
cash_promised
cash_collected
stock_reserved
stock_released
funded
closed
ordered
expired
cancelled
```

## 13. Décision produit

Le bouton permanent de création n'appartient pas à `Mes groupes`.

- `Panier` = création.
- `Mes groupes` = suivi.
- `Fiche produit` = éventuellement entrée secondaire plus tard.

Doctrine UX :

```txt
Créer là où l'utilisateur a déjà son panier.
Suivre là où il a ses groupes.
```

## 14. Résumé exécutif

Le panier collectif Komerce doit être une couche pré-commande fiable :

```txt
friendly link
+ réservation stock temporaire
+ contributions carte/cash
+ validation finale
= commande ferme
```

Cette architecture correspond au terrain Komerce : diaspora qui paie par carte, local qui paie cash au relais, stock sensible, logistique longue, retours difficiles.
