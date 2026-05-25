# Doctrine Komerce — Panier Partagé

> Version 2.0 — Mai 2026
> Remplace `DOCTRINE_PANIER_COLLECTIF.md` (v1, doctrine prospective).
> Ce document est aligné sur le **code en production** : migration `044_shared_cart.sql`,
> service `shared-cart-engine.js`, routes `shared-cart.js`.
> En cas de divergence entre ce document et le code, **le code fait foi** — mettre à jour ici.

---

## 1. Principe fondamental

Le panier partagé Komerce n'est pas une commande immédiate.
C'est une **zone d'engagement financier pré-commande** :

```
Panier partagé = snapshot figé + contributions Stripe + finalisation créateur
```

La commande ferme ne naît qu'après financement complet (`fully_funded`) confirmé
par webhook Stripe, stock vérifié, puis clôture explicite du bénéficiaire.

Cette règle protège Komerce contre :
- les commandes partiellement financées impossibles à consolider ;
- les doubles décréments de stock ;
- les paiements annoncés mais non encaissés (pas de cash promis au MVP) ;
- les surpaiements (contribution max = `remaining_kmf`) ;
- l'idempotence Stripe : un même webhook ne crée jamais deux contributions.

**Doctrine UX :**
```
Créer → depuis le panier ("Payer en groupe")
Suivre → onglet Groupe (créateur) / lien partagé (participant)
```

---

## 2. Acteurs

| Acteur | Rôle |
|---|---|
| **Bénéficiaire / Créateur** | Compose le panier, initie le partage, suit les contributions, clôture |
| **Contributeur / Participant** | Reçoit le lien WhatsApp, choisit un montant, paie par carte |
| **Stripe** | Confirme les paiements via webhook (source de vérité financière) |
| **Admin** | Expire, étend, note, supervise |
| **Système** | Expire automatiquement les paniers dépassés (`expireOldCarts`) |

---

## 3. Schéma de données (production — migration 044)

### 3.1 `shared_carts`

| Champ | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `token` | TEXT UNIQUE | 16 chars Base58 ≈ 95 bits — URL publique `/cart/shared/:token` |
| `beneficiary_user_id` | UUID FK users | Créateur authentifié (ou guest créé à la volée) |
| `beneficiary_name_snapshot` | TEXT | Nom figé à la création |
| `beneficiary_phone_snapshot` | TEXT | Téléphone figé |
| `source_basket_id` | UUID FK baskets nullable | Null si création depuis `from-cart-items` |
| `title` | TEXT nullable | Nom du panier ("Cadeau mariage Aïcha") |
| `message` | TEXT nullable | Message personnalisé |
| `total_kmf_snapshot` | INTEGER | Figé à la création — jamais recalculé |
| `contributed_kmf` | INTEGER | Mis à jour à chaque `paid` webhook |
| `remaining_kmf` | INTEGER | `total - contributed`, mis à jour automatiquement |
| `delivery_relay_id` | UUID FK relais nullable | Peut être rempli à la finalisation |
| `status` | ENUM | Voir §4 |
| `expires_at` | TIMESTAMPTZ | Défaut 30 jours, max 90 jours |
| `finalized_at` | TIMESTAMPTZ | Posé lors de la conversion en commande |
| `finalized_order_id` | UUID FK orders | Lien vers la commande créée |
| `view_count` | INTEGER | Nombre d'ouvertures du lien public |

### 3.2 `shared_cart_items` — snapshot figé

| Champ | Notes |
|---|---|
| `product_id` | UUID nullable — peut devenir null si produit supprimé |
| `product_name_snapshot` | Figé — ne jamais lire `products.name` pour l'affichage |
| `product_image_snapshot` | Figé |
| `quantity` | Figé |
| `unit_price_kmf_snapshot` | Figé — prix vérifié côté serveur à la création |
| `line_total_kmf_snapshot` | Figé |

**Règle critique** : le snapshot est figé dès la première contribution payée.
Le backend vérifie les prix sur `products` à la création — jamais confiance au client.

### 3.3 `shared_cart_contributions`

| Champ | Notes |
|---|---|
| `contributor_name` | Déclaratif — non authentifié volontairement |
| `contributor_email` | Requis — utilisé par Stripe Checkout |
| `contributor_phone` | Optionnel |
| `amount_kmf` | Montant en KMF affiché au bénéficiaire |
| `amount_paid` | Montant réel payé (EUR) — converti via `fx_rate_used` |
| `currency_paid` | `EUR` (Stripe ne supporte pas KMF nativement) |
| `fx_rate_used` | Taux appliqué — lu depuis `finance_config` ou fallback |
| `stripe_session_id` | UNIQUE — garantit l'idempotence |
| `stripe_payment_intent_id` | Posé au webhook |
| `status` | ENUM — voir §4 |
| `paid_at` | Posé par le webhook Stripe |

**Contribution minimum** : 2 500 KMF (~5 EUR)
**Contribution maximum** : 500 000 KMF (~1 000 EUR — au-delà, KYC requis)

### 3.4 `shared_cart_events` — audit log complet

Chaque transition, contribution, annulation produit un événement typé :
`shared_cart_created`, `contribution_started`, `contribution_paid`, `cart_finalized`,
`cart_cancelled`, `cart_expired`, etc.

### 3.5 Extension `orders`

```sql
orders.shared_cart_id       UUID FK shared_carts
orders.prepaid_amount_kmf   INTEGER  -- contributions Stripe déduites
orders.remaining_cash_kmf   INTEGER  -- reste à régler en cash au relais
```

---

## 4. Statuts

### 4.1 `shared_cart_status` (ENUM production)

```
draft → active → partially_funded → fully_funded → converted_to_order
                                                  ↘ expired
                       ↓ (à tout moment ouvert)
                    cancelled → refunded
```

| Statut | Définition |
|---|---|
| `draft` | Panier créé, pas encore actif (non utilisé au MVP — créé en `active` directement) |
| `active` | Lien partageable, accepte les contributions |
| `partially_funded` | Au moins une contribution `paid` reçue |
| `fully_funded` | `contributed_kmf >= total_kmf_snapshot` |
| `converted_to_order` | Finalisé — commande créée (invariant : `finalized_order_id` non null) |
| `expired` | Délai `expires_at` dépassé sans finalisation — expiré par cron |
| `cancelled` | Annulé volontairement par le bénéficiaire ou l'admin |
| `refunded` | Contributions remboursées (action manuelle admin au MVP) |

### 4.2 `shared_cart_contribution_status` (ENUM production)

| Statut | Définition |
|---|---|
| `pending` | Contribution créée, session Stripe ouverte — pas encore payée |
| `paid` | Webhook `checkout.session.completed` reçu et traité |
| `failed` | Webhook `checkout.session.expired` ou `payment_intent.failed` |
| `refunded` | Remboursée (admin) |
| `cancelled` | Annulée avant paiement |

**Règle** : seul le statut `paid` incrémente `contributed_kmf` et `remaining_kmf`.
Un `pending` ne compte jamais comme financement.

---

## 5. Flux complet

### 5.1 Création (Bénéficiaire)

```
Panier boutique
  → "Payer en groupe"
  → Mini-formulaire : titre optionnel + auth si absent (prénom + téléphone)
  → POST /api/shared-carts/from-cart-items
      ↳ authenticateOrCreateGuest (crée un user guest si besoin)
      ↳ Vérification des prix côté DB (jamais confiance client)
      ↳ Snapshot figé : shared_carts + shared_cart_items
      ↳ Status : active
      ↳ expires_at = NOW() + 30 jours (défaut)
  ← { token, share_url, total_kmf, expires_at, items_count }
  → WhatsApp : lien /cart/shared/:token
  → Switch onglet Groupe (suivi immédiat)
```

### 5.2 Suivi (Bénéficiaire)

Depuis l'onglet Groupe, le bénéficiaire voit en temps réel :

```
GET /api/shared-carts/:id   (auth — données complètes)
  ↳ cart : statut, montants, expires_at
  ↳ items : snapshot figé
  ↳ contributions : nom_prénom, montant, statut (paid/pending)
```

Polling toutes les 30s pendant que la vue est ouverte.
Bannière discrète permanente rappelant le panier actif + countdown expiration.

Actions disponibles :
- Re-partager (WhatsApp / copier le lien)
- Contribuer soi-même (bénéficiaire = participant)
- Clôturer et commander (quand `fully_funded`)

### 5.3 Contribution (Participant)

```
Lien /cart/shared/:token
  → Boutique normale (expérience inchangée)
  → Bannière discrète : "Panier groupe de [Nom] — contribue ici"
  → Onglet Groupe : articles snapshot + formulaire

  → POST /api/shared-carts/public/:token/contributions
      { amount_kmf, contributor_name, contributor_email, message? }
  ← { checkout_url, session_id, contribution_id }
  → Redirection Stripe Checkout (EUR, calculé via fx_rate)

  [Webhook Stripe checkout.session.completed]
      ↳ engine.confirmContributionFromStripe(session)
      ↳ contribution → paid
      ↳ shared_cart.contributed_kmf += amount_kmf
      ↳ shared_cart.remaining_kmf   -= amount_kmf
      ↳ Si remaining_kmf = 0 → status → fully_funded
      ↳ shared_cart_events : contribution_paid
```

Le participant peut aussi faire des achats personnels — les deux flux sont
indépendants. Son panier personnel n'est pas affecté.

### 5.4 Clôture (Bénéficiaire)

```
POST /api/shared-carts/:id/finalize   (auth bénéficiaire)
  Vérifications :
    ✓ status = fully_funded (MVP : financement complet requis)
    ✓ expires_at non dépassé
    ✓ non déjà finalisé
    ✓ stock disponible pour chaque item
    ✗ stock insuffisant → 409 { code: 'stock_issues', items: [...] }
              → bénéficiaire peut forcer avec accept_stock_issues: true

  Si OK :
    → Commande créée (orders)
    → orders.prepaid_amount_kmf = contributed_kmf
    → orders.remaining_cash_kmf = 0 (MVP fully_funded)
    → shared_carts.status → converted_to_order
    → shared_carts.finalized_order_id posé
    → stock décrémenté
    → shared_cart_events : cart_finalized

  ← { order_id, order_reference, prepaid_kmf, remaining_cash_kmf }
```

**Contrainte MVP** : la finalisation n'est autorisée que si `fully_funded`.
Le flux mixte (cash + carte partiel) est documenté dans la doctrine mais
pas industrialisé — roadmap V2.

### 5.5 Expiration automatique

Un cron `expireOldCarts()` passe les paniers `active`/`partially_funded`
dont `expires_at < NOW()` en statut `expired`.
Les contributions `pending` restent dans cet état — remboursement manuel admin.

---

## 6. Règles métier fortes (invariants service)

```
1. Snapshot figé au partage — jamais recalculé depuis products
2. Contribution confirmée UNIQUEMENT via webhook Stripe
3. Idempotence : un stripe_session_id unique → une seule contribution paid
4. Contribution max = remaining_kmf (jamais de surpaiement)
5. Finalisation = fully_funded requis (MVP)
6. Toutes les opérations financières sont transactionnelles (withTransaction)
7. Audit complet : chaque transition → shared_cart_events
```

---

## 7. Limites et configuration

| Paramètre | Valeur | Notes |
|---|---|---|
| Token length | 16 chars Base58 | ≈ 95 bits entropie |
| Expiration défaut | 30 jours | Configurable 1–90 jours |
| Paniers actifs max / user | 5 | |
| Contribution minimum | 2 500 KMF | ~5 EUR |
| Contribution maximum | 500 000 KMF | ~1 000 EUR — KYC au-delà |
| Taux FX KMF→EUR | Lu depuis `finance_config` | Fallback 1/491.97 |

---

## 8. Routes API (production)

### Publiques (sans auth)

```
GET  /api/shared-carts/public/:token
     → { cart, items, contributions[] }
     → contributions anonymisées : prénom + montant + message (paid uniquement)

POST /api/shared-carts/public/:token/contributions
     Body : { amount_kmf, contributor_name, contributor_email, message? }
     → { checkout_url, session_id, contribution_id }

POST /api/shared-carts/stripe/webhook
     → Traitement idempotent checkout.session.completed / expired
```

### Bénéficiaire authentifié

```
POST /api/shared-carts/from-cart-items   (authenticateOrCreateGuest)
     Body : { cart_items[], title?, message?, expiration_days?, delivery_relay_id? }
     → { shared_cart_id, token, share_url, total_kmf, expires_at, items_count }

GET  /api/shared-carts/mine
     → { carts[] } — liste des paniers du bénéficiaire

GET  /api/shared-carts/:id
     → { cart, items, contributions[], share_url } — données complètes

POST /api/shared-carts/:id/finalize
     Body : { delivery_relay_id?, accept_stock_issues? }
     → { order_id, order_reference, prepaid_kmf, remaining_cash_kmf }
     → 409 si stock_issues

POST /api/shared-carts/:id/cancel
     Body : { reason? }
     → { ok: true, cart }
```

### Admin

```
GET  /api/admin/shared-carts
POST /api/admin/shared-carts/:id/expire
POST /api/admin/shared-carts/:id/extend
POST /api/admin/shared-carts/:id/note
```

---

## 9. Frontend Boutique (alignement)

### Modules concernés

| Module | Rôle |
|---|---|
| `b-share-cart.js` | Flow création — formulaire init + `POST from-cart-items` + WhatsApp |
| `b-group-view.js` | Onglet Groupe — suivi créateur + formulaire participant |
| `b-group-banner.js` | Bannière discrète permanente — countdown expiration |

### State frontend (`b-store.js`)

```js
state.shareToken   // token actif — persisté en sessionStorage kmrc_share
state.shareId      // shared_cart_id — pour les appels auth /:id
state.cartName     // titre — affiché dans la bannière
state.shareExpiry  // expires_at — pour le countdown
```

Le state est posé par `b-share-cart.install()` au boot depuis `sessionStorage`.
Il expire à la fermeture du navigateur (sessionStorage, pas localStorage).

### Onglet Groupe

- **Mobile** : 4ᵉ bouton dans `k-bnav` (`data-tab="group"`)
- **Desktop** : bouton dans `k-header-actions` (`data-tab="group"`)
- Badge vert si panier actif (`state.shareToken` non null)

### Bannière permanente (`#k-group-banner`)

Injectée sous le header, visible sur toutes les vues.
Affiche : nom du panier · temps restant.
Devient ambre si < 2h restantes.
Fermable manuellement (sessionStorage `kmrc_banner_dismissed`).
Réapparaît à la prochaine session ou connexion.

---

## 10. Ce qui n'est PAS dans le MVP

Ces éléments sont documentés dans la doctrine prospective mais
**pas encore implémentés en production** :

| Fonctionnalité | Note |
|---|---|
| Finalisation partielle (financement incomplet) | `convertSharedCartToOrder` bloque si `remaining_kmf > 0` |
| Paiement cash au relais par les contributeurs | Flux `mixed_shared_cart_cash` — roadmap V2 |
| Modification du panier après première contribution | Snapshot figé par conception |
| Réservation de stock temporaire | `stock_reservations` — en doctrine, pas en migration 044 |
| Friendly slug (`/g/famille-aboudi`) | Token UUID actuel — roadmap V2 |
| Remboursement automatique à l'expiration | Manuel admin pour le MVP |
| Délai de paiement 7 jours post-clôture | Non implémenté — chaque contribution paie immédiatement |
| Panier "vivant" (modification articles) | Snapshot figé — demande une V2 avec versioning |

---

## 11. Décisions de conception

**Pourquoi `sessionStorage` et pas `localStorage` pour le token ?**
Le panier partagé a une durée de vie limitée (30 jours). Un token expiré
visible à la prochaine visite créerait une fausse continuité. La fermeture du
navigateur vide le state proprement.

**Pourquoi le bénéficiaire est aussi un contributeur ?**
Dans le contexte comorien, l'organisateur paie souvent une partie (la diaspora
envoie, le local complète). Le formulaire de contribution est donc accessible
depuis la vue créateur avec les mêmes règles.

**Pourquoi la finalisation nécessite `fully_funded` au MVP ?**
Le flux mixte (contribution partielle + solde cash au relais) implique une
réconciliation logistique complexe. P0 de stabilité : on ne crée une commande
que lorsque le financement est total et confirmé via Stripe.

**Pourquoi pas de réservation de stock à la création ?**
Migration 044 n'inclut pas `stock_reservations`. L'indisponibilité éventuelle
est détectée à la finalisation (`convertSharedCartToOrder` vérifie le stock
et retourne un 409 structuré). C'est un compromis MVP conscient.

---

## 12. Résumé exécutif

```
Panier partagé Komerce V1 =
  snapshot figé (prix vérifiés serveur)
+ token public Base58 (lien WhatsApp)
+ contributions Stripe idempotentes
+ confirmation webhook avant comptabilisation
+ finalisation créateur (fully_funded requis)
= commande ferme avec prépaiement diaspora
```

Architecture terrain : diaspora paie par carte depuis la France/Europe,
local récupère la commande au relais aux Comores, stock sensible,
logistique longue. Le flux est volontairement simple et robuste.
