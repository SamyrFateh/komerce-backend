# 🛒 Komerce — Comment ça marche (vue synoptique)

> Document de référence en lecture rapide.
> Cible : nouveau dev, partenaire, ou rappel rapide pour le propriétaire.
> Source : code v10.6.1 (mai 2026), 67 routes, 37 services, 51 migrations.

---

## 1. Ce que Komerce résout

Trois douleurs réelles de la diaspora comorienne :

1. **L'aide familiale est invisible** — Amina envoie 200 € à Ali à Anjouan, mais ne sait pas si ça a servi à acheter ce dont sa mère avait besoin.
2. **Le marché local est limité** — pas de cosmétiques pro, pas d'opticien qualifié, pas de matériaux de finition, peu de tenues sur mesure haut de gamme.
3. **La logistique Dubai → Comores est opaque** — délais flous, douane variable, pas de SAV, pas de traçabilité.

**La promesse Komerce :**
> *« On transforme l'aide familiale en achat visible, traçable et livré. »*

---

## 2. Les 4 unités économiques

| Unité | Rôle |
|---|---|
| **Produit** | fixe le prix |
| **Colis** *(parcel)* | porte les coûts logistiques (poids, douane, fret) |
| **Shipment** | porte la vérité terrain (conteneur, douane réelle) |
| **Commande collectée** | prouve la rentabilité (le mois mesure si le business tient) |

C'est la *colonne vertébrale économique*. Tout le code dérive de cette séparation.

---

## 3. Les 5 expériences d'achat

Komerce n'est pas un seul tunnel. C'est **5 façons** d'acheter, qui partagent le même catalogue et la même logistique aval.

```
┌──────────────────────────────────────────────────────────────────┐
│                    CATALOGUE PRODUITS UNIFIÉ                      │
│         (catégories : Sport, Mode, Maison, Tech, Beauté,          │
│          Enfant, Sur-mesure)                                      │
└────────┬───────────┬──────────┬──────────────┬──────────┬────────┘
         │           │          │              │          │
    ┌────▼────┐ ┌────▼────┐ ┌───▼─────┐  ┌─────▼────┐ ┌──▼────────┐
    │ ACHAT   │ │ PANIER  │ │ PANIER  │  │ WORKSPACE │ │ MODULES    │
    │ DIRECT  │ │ PARTAGÉ │ │ OFFERT  │  │ COLLECTIF │ │ SPÉCIAUX   │
    │         │ │ (M10)   │ │ (gift)  │  │ (V1)      │ │ (couture…) │
    └────┬────┘ └────┬────┘ └────┬────┘  └─────┬─────┘ └──┬─────────┘
         │           │           │             │          │
         └───────────┴───────┬───┴─────────────┴──────────┘
                             │
                  ┌──────────▼──────────┐
                  │   COMMANDE UNIQUE   │
                  │   (orders + items)  │
                  └──────────┬──────────┘
                             │
                  Toute la suite est commune
```

| Expérience | Pour qui | Comment |
|---|---|---|
| **1. Achat direct** | Diaspora paye Stripe EUR / proche aux Comores paye cash | Boutique → panier → checkout |
| **2. Panier partagé M10** | Ali fait son panier à Anjouan → envoie un lien WhatsApp → Amina paie depuis Paris | `baskets.share` → Stripe webhook |
| **3. Panier offert (gift)** | Amina compose un panier complet et l'offre à un proche aux Comores | `baskets.gift` → SMS code retrait |
| **4. Workspace collectif** | Plusieurs cousins se cotisent pour un événement (mariage, rentrée scolaire) | `collective-workspaces` → tokens individuels → capture seulement à 100 % |
| **5. Modules spécialisés** | Couture sur mesure, lunettes de vue, matériaux construction, cosmétiques Dubai | `/api/modules` → besoins non couverts par le marché local |

**Clé** : ce sont des **portes d'entrée différentes** vers la même commande. Une fois la commande créée, le pipeline aval (paiement → préparation → expédition → relais → collecte) est identique.

---

## 4. La machine à états (le cœur du backend)

```
   pending ──── confirmed ──── ordered ──── preparation ──── shipped
   (paiement)   (cash/Stripe   (BC chez     (au Hub Dubai)   (en mer/
                 reçu)          fournisseur)                   avion)
                                                                │
                                                                ▼
   collected ◄── available ◄── arrived ◄── in_transit
   (terminal,    (au relais   (à Anjouan)   (entre Dubai
    récupéré)    Anjouan)                    et Anjouan)

   À partir de tout statut sauf collected/refunded :
       ▼
   cancelled ──── refunded (terminal)
```

**Règle absolue (R1)** : `orders.status` ne change *jamais* par un `UPDATE` direct.
Toute transition passe par **`services/order-status-machine.js::transitionOrderStatus()`** — une seule fonction, une seule source de vérité, audit complet (10 commits, état SSOT 100 %, achevé le 15 avril 2026).

Les colis (`parcels`) ont leur propre machine à états parallèle. Quand tous les colis d'une commande sont `collected` ou `cancelled`, la commande parent passe automatiquement à `collected`.

---

## 5. Le moteur économique (la doctrine)

> *« Komerce ne cherche pas le prix parfait au lancement. Komerce cherche un prix protégé qui permet d'apprendre le marché sans vendre à perte. »*

Pour chaque produit, le système calcule **4 prix** :

| Prix | Formule | Usage |
|---|---|---|
| **Survie** | coûts variables seuls | promo, déstockage |
| **Minimum sûr** | variables + risques + part de fixe | seuil rouge |
| **Conseillé** | coût complet ÷ (1 − marge cible) | prix cible |
| **Test marché** | ≥ minimum sûr | prix réellement affiché |

À cela s'ajoutent :
- **`health_status`** : loss / danger / fragile / healthy / strong
- **`market_confidence`** : unknown / testing / validated / scaling / rejected
- **`sourcing_decision`** : PRIORITY / TEST / WATCH / AVOID / LOSS

Tout est dans `services/pricing-engine.js` (1 483 lignes) — exposé via `/api/pricing/*`.

Les coûts sont **estimés avant vente** (douane par catégorie, fret au poids, paiement Stripe %, etc.) puis **réconciliés au terrain** (douane réelle saisie au shipment, fret au poids volumétrique, ventilation par valeur × coefficient de risque).

---

## 6. La logistique en 3 vagues (état actuel)

| Vague | Contenu | Statut |
|---|---|---|
| **1** | Socle parcel-centric (CRUD parcels, fix logistics.js, sécurité #71-#76) | 🟠 à démarrer |
| **2** | Hub terrain simplifié (3 actions : scanner / carton / sceller) | ⬜ |
| **3** | Optimisation (douane, poids volumétrique, multi-transporteurs) | ⬜ |

L'idée : l'opérateur du Hub Dubai a 3 actions, point. Le système décide, l'humain exécute. Pas de page admin avec 12 boutons « est-ce qu'on passe en preparation ? oui/non » — l'état suit naturellement les scans.

---

## 7. Notifications & confiance

Chaque transition de statut déclenche :

| Étape | WhatsApp | Email | SMS |
|---|:-:|:-:|:-:|
| `payment_confirmed` | ✅ | ✅ | — |
| `parcel_created` | ✅ | — | — |
| `shipped` | ✅ | ✅ | ✅ |
| `in_transit` | ✅ | — | ✅ |
| `available` | ✅ | ✅ | ✅ |
| `collected` | ✅ | — | ✅ |

**Crash-safe** : `res.json()` est envoyé au client *avant* les notifications. Si Twilio/Brevo plante, la commande reste cohérente, juste les notifs partent en retry.

Provider WhatsApp : AuthKey (templates approuvés). Email : Brevo. SMS : Africa's Talking.

---

## 8. Programmes de fidélisation

| Mécanisme | Règle |
|---|---|
| **Wallet** (portefeuille client) | crédit gagné = consommable FIFO sur futures commandes, transactions immutables |
| **Loyalty (gros paniers)** | Nᵉ commande dont total ≥ seuil → cadeau notifié WhatsApp, choix admin manuel |
| **Store credits (legacy)** | en cours de migration vers wallet |

---

## 9. Stack technique

```
Node 20 + Express 4 + PostgreSQL (Supabase) + Redis (rate-limit)
Pino logging · Helmet sécurité · Joi validation · JWT auth · Stripe paiements
Déployé Railway · CI/CD GitHub Actions · Frontend statique en /public
```

---

## 10. Pour comprendre le code, lire dans l'ordre

1. `docs/SYNOPTIQUE_KOMERCE.md` — **ce document**
2. `docs/DOCTRINE_ECONOMIQUE_KOMERCE.md` — pourquoi 4 prix, pourquoi `health_status`
3. `docs/ZONE_IMPACT.md` — invariants, machines à états, blast radius
4. `services/order-status-machine.js` — le seul endroit où `orders.status` change
5. `services/pricing-engine.js` — le moteur des 4 prix
6. `services/shared-cart-engine.js` & `collective-workspace-engine.js` — les expériences d'achat avancées
7. `routes/products.js` + `routes/modules.js` — catalogue + modules spécialisés
