# Doctrine Komerce — Panier Partagé Boutique-First

> Version 3.0 — 25 mai 2026  
> Remplace la doctrine v2.0 trop rigide orientée "zone d'engagement financier pré-commande".  
> Doctrine produit : **tout commence dans la boutique, tout se comprend dans la boutique, tout revient dans la boutique.**
>
> En cas de divergence entre ce document et le code, le code fait foi temporairement — puis ce document doit être réaligné dans la même PR.

---

## 1. Principe fondamental

Le panier partagé Komerce est une **capacité naturelle du panier boutique**.

Il ne doit pas devenir :

- un workspace séparé ;
- un projet événementiel lourd ;
- une zone d'engagement complexe ;
- un workflow qui bloque l'utilisateur parce qu'il a déjà un autre panier partagé actif.

Le parcours doit rester simple :

```txt
Boutique
→ panier
→ payer en groupe
→ lien partagé
→ contributions
→ suivi dans l'onglet Groupe
→ finalisation si financé
```

La promesse produit est :

```txt
Acheter seul, acheter pour quelqu'un, ou acheter ensemble — dans la même boutique.
```

---

## 2. Doctrine UX : liberté d'abord, garde-fous derrière

Le créateur doit garder sa liberté.

Un utilisateur peut avoir plusieurs paniers partagés actifs, dans la limite backend. Avoir déjà un groupe actif ne doit pas empêcher de créer un nouveau panier partagé avec le panier courant.

Comportement attendu :

```txt
Aucun panier partagé actif
→ bouton : Payer en groupe

Un panier partagé actif existe déjà
→ raccourci : Voir le groupe actif
→ option : Créer un nouveau groupe avec le panier actuel
```

La liberté côté utilisateur est acceptable parce que le système garde les limites :

- limite de paniers actifs par utilisateur ;
- expiration automatique ;
- annulation possible ;
- finalisation uniquement si le panier est réellement financé ;
- aucun surpaiement silencieux ;
- exceptions visibles côté admin.

Autrement dit :

```txt
On ne bloque pas l'envie de créer.
On nettoie ce qui ne devient pas concret.
```

---

## 3. Acteurs

| Acteur | Rôle |
|---|---|
| Créateur / bénéficiaire | Compose le panier dans la boutique, crée le lien, suit, relance, finalise |
| Contributeur / participant | Reçoit le lien, choisit un montant libre, paie par carte |
| Stripe | Confirme les paiements via webhook — source de vérité financière |
| Admin | Supervise, expire, note, traite les remboursements manuels |
| Système | Expire les paniers non concrétisés et empêche les incohérences financières |

---

## 4. Modèle actif et modèle déclassé

### Actif : panier partagé boutique

Surfaces actives :

```txt
/boutique
/cart/shared/:token
/account/shared-carts
/api/shared-carts/*
/api/admin/shared-carts/*
```

Modules front principaux :

| Module | Rôle |
|---|---|
| `b-share-cart.js` | Création depuis le panier courant, restauration du dernier groupe actif comme raccourci, partage WhatsApp |
| `b-group-view.js` | Onglet Groupe : suivi, contributions, finalisation |
| `b-group-banner.js` | Bannière légère de rappel |

### Déclassé : collective workspace

L'ancien modèle `collective workspace / panier événement collectif` est désactivé.

Depuis PR #486 :

```txt
/event/* et /workspace/* → redirection /boutique
/api/collective-workspaces → 410 collective_workspace_disabled
/api/collective-payments → 410 collective_workspace_disabled
collective-payment-orchestrator → no-op / tombstone
```

Les tables et migrations historiques peuvent rester pour référence tant qu'aucune migration destructive n'est décidée.

---

## 5. Schéma de données : principes

Le modèle reste basé sur :

- `shared_carts` ;
- `shared_cart_items` ;
- `shared_cart_contributions` ;
- `shared_cart_events` ;
- extension de `orders` pour le lien final.

### 5.1 `shared_carts`

| Champ | Rôle |
|---|---|
| `token` | Lien public `/cart/shared/:token` |
| `beneficiary_user_id` | Créateur authentifié ou guest créé à la volée |
| `beneficiary_name_snapshot` / `beneficiary_phone_snapshot` | Identité figée au moment de la création |
| `title` | Nom lisible du panier |
| `total_kmf_snapshot` | Total figé à la création |
| `contributed_kmf` | Somme confirmée par webhook |
| `remaining_kmf` | Reste à financer |
| `status` | Vie du panier partagé |
| `expires_at` | Nettoyage naturel des paniers non concrétisés |
| `finalized_order_id` | Commande créée après finalisation |

### 5.2 Snapshot articles

Les items sont snapshotés à la création du panier partagé : nom, image, catégorie, quantité, prix unitaire et ligne totale.

Règle : le client ne décide jamais du prix. Les prix sont revérifiés côté serveur à la création.

### 5.3 Contributions

Une contribution est libre en montant, mais bornée :

```txt
minimum contribution
≤ montant choisi
≤ remaining_kmf
```

Seul le webhook Stripe confirme réellement une contribution.

---

## 6. Statuts

### 6.1 Panier partagé

```txt
draft → active → partially_funded → fully_funded → converted_to_order
                                                  ↘ expired
                       ↓
                    cancelled → refunded
```

| Statut | Sens |
|---|---|
| `active` | Lien actif, contribution possible |
| `partially_funded` | Au moins une contribution confirmée |
| `fully_funded` | Total atteint |
| `converted_to_order` | Commande créée |
| `expired` | Non concrétisé dans le délai |
| `cancelled` | Annulé volontairement |
| `refunded` | Remboursement traité manuellement/admin |

### 6.2 Contribution

| Statut | Sens |
|---|---|
| `pending` | Session Stripe ouverte, non confirmée |
| `paid` | Confirmée par webhook Stripe |
| `failed` | Échec, expiration ou paiement tardif non comptabilisable |
| `refunded` | Remboursée manuellement/admin |
| `cancelled` | Annulée avant paiement |

Règle : seul `paid` incrémente le financement du panier.

---

## 7. Flux principal

### 7.1 Création

```txt
Panier boutique courant
→ Payer en groupe
→ formulaire léger : titre optionnel + identité si guest
→ POST /api/shared-carts/from-cart-items
→ snapshot serveur
→ token public
→ lien WhatsApp
→ onglet Groupe
```

Si un autre panier partagé actif existe déjà, l'UX doit proposer :

```txt
Voir le groupe actif
Créer un nouveau groupe avec ce panier
```

Le backend applique la limite active, pas le front.

### 7.2 Suivi

Le suivi vit dans l'onglet Groupe, pas dans un workspace séparé.

Le créateur voit :

- statut ;
- total ;
- montant collecté ;
- reste à financer ;
- contributions ;
- lien à partager ;
- finalisation si `fully_funded`.

### 7.3 Contribution

```txt
/cart/shared/:token
→ visualisation du panier snapshoté
→ montant libre
→ Stripe Checkout
→ webhook
→ contribution paid ou failed
```

Aucun paiement annoncé ne compte sans webhook.

### 7.4 Finalisation

La commande ferme naît uniquement quand :

- panier `fully_funded` ;
- non expiré ;
- non déjà finalisé ;
- stock vérifié ;
- créateur valide.

Le MVP ne crée pas de commande partiellement financée.

### 7.5 Expiration / non-concrétisation

Un panier partagé non concrétisé n'est pas une anomalie métier.

Il peut expirer ou être annulé.

C'est volontaire : l'utilisateur doit pouvoir tenter, partager, tester l'intérêt familial, puis abandonner si la famille ne suit pas.

---

## 8. Règles financières et sécurité

Règles fortes :

```txt
1. Webhook Stripe = source de vérité.
2. Un même event Stripe ne doit jamais compter deux fois.
3. Contribution max = remaining_kmf.
4. Paiement tardif/non comptabilisable = exception visible.
5. Pas de remboursement automatique Stripe au MVP.
6. Refund queue admin + mark-refunded manuel.
7. Audit via shared_cart_events.
```

Les webhooks Stripe doivent rester montés en raw body avant `express.json`.

Les tokens publics sont non prédictibles et ne donnent accès qu'au panier public/anonymisé.

---

## 9. Ce qui est autorisé en évolution future

Compatible doctrine :

- plusieurs paniers partagés actifs ;
- montant indicatif moyen par participant ;
- délai simple de contribution : 24h / 3 jours / 7 jours ;
- bouton de clôture/annulation simple ;
- relance WhatsApp ;
- historique des paniers partagés dans le compte ;
- choix explicite entre “voir groupe actif” et “créer nouveau groupe”.

---

## 10. Ce qui est interdit

Ne pas réintroduire :

- workspace séparé ;
- intentions complexes avant paiement ;
- préautorisation collective lourde ;
- parcours événement parallèle ;
- blocage front qui empêche un nouveau panier partagé parce qu'un ancien groupe actif existe ;
- vocabulaire technique visible côté client.

---

## 11. Configuration actuelle

| Paramètre | Valeur actuelle | Note |
|---|---|---|
| Token length | 16 chars Base58 | ≈ 95 bits entropie |
| Expiration défaut | 30 jours | Peut évoluer vers choix simple 24h / 3j / 7j |
| Paniers actifs max / user | 5 | Garde-fou backend, pas verrou UX à 1 panier |
| Contribution minimum | 2 500 KMF | ~5 EUR |
| Contribution maximum | 500 000 KMF | ~1 000 EUR — KYC au-delà |
| Taux FX KMF→EUR | `finance_config` | fallback 1/491.97 |

---

## 12. Résumé exécutif

```txt
Panier partagé Komerce =
  panier boutique réel
+ lien WhatsApp
+ contributions libres mais bornées
+ webhook Stripe comme vérité
+ finalisation créateur si financé
+ expiration naturelle si non concret
```

La liberté utilisateur est centrale.

Le système ne doit pas empêcher la création ; il doit garantir que seuls les paniers réellement financés deviennent des commandes fermes.
