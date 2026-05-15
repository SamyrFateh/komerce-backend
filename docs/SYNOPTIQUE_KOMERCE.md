# Komerce — Vue synoptique

> **Statut** : document fondamental de lecture rapide  
> **Dernière consolidation** : 15 mai 2026  
> **Sources vérifiées** : `server.js`, `package.json`, `services/order-status-machine.js`, `services/pricing-engine.js`, `services/wallet-service.js`.  
> **But** : comprendre Komerce sans relire tous les audits historiques.

---

## 1. Ce que Komerce résout

Komerce transforme l'aide familiale et l'achat diaspora en commande visible, traçable et livrée aux Comores.

Trois douleurs structurantes :

1. **L'aide familiale est peu traçable** : la diaspora paie ou envoie de l'argent sans toujours savoir ce qui a été acheté.
2. **Le marché local est limité** : beaucoup de produits ou services doivent être sourcés hors des Comores.
3. **La logistique import est opaque** : fret, douane, délais, relais et collecte doivent être suivis par preuves.

Promesse :

> On transforme une intention d'achat ou d'aide en produit commandé, suivi, reçu et collecté.

---

## 2. Les unités de vérité

| Unité | Vérité portée |
|---|---|
| **Produit** | Prix, coût, stock, catégorie, attractivité commerciale. |
| **Commande** | Client, paiement, statut global, historique, wallet, facture. |
| **Colis** | Unité logistique réelle : préparation, transit, arrivée, disponibilité, collecte. |
| **Shipment** | Vérité terrain groupée : transport, douane, coûts réels, arrivage. |
| **Relais** | Point de confiance local : remise, cash, code retrait, preuve client. |

Le projet est désormais **parcel-centric** : la commande reste la vue client, mais le colis porte une grande partie de la vérité opérationnelle.

---

## 3. Les expériences d'achat

Komerce n'est pas un seul tunnel. Plusieurs portes d'entrée mènent au même cycle aval.

| Expérience | Usage |
|---|---|
| **Achat direct** | Un client compose un panier et paie par Stripe ou cash selon le mode. |
| **Panier partagé** | Un panier peut être financé par un tiers via lien partagé. |
| **Panier événement / collectif** | Plusieurs contributeurs financent une commande ou un événement commun. |
| **Gift / achat offert** | Une personne paie pour un proche qui récupère localement. |
| **Modules spécialisés** | Couture, produits spécifiques, sourcing et besoins non standards. |

Une fois l'ordre engagé, la logique aval converge : paiement → confirmation → sourcing/préparation → colis → transport → relais → collecte.

---

## 4. Cycle de vie commande

La source de vérité des transitions commande est `services/order-status-machine.js`.

Statuts commande actuellement connus :

```text
pending
pending_group_payment
confirmed
ordered
preparation
shipped
in_transit
available
collected
cancelled
refunded
```

Règles principales :

- `transitionOrderStatus()` est l'entrée unique attendue pour changer `orders.status`.
- Les sources de paiement (`stripe_webhook`, `cash_confirm`, `wallet_full_payment`, `shared_cart_full_payment`) confirment uniquement `pending → confirmed`.
- Les sources système/scan sont forward-only et idempotentes.
- `cancelled → refunded` est la voie terminale de remboursement.
- Le passage à `available` peut générer un `pickup_code` si absent.
- Une annulation restaure le stock et contre-passe le wallet lorsque nécessaire.

---

## 5. Cycle de vie colis

Le colis est l'unité opérationnelle de terrain.

Domaines actifs dans le code :

- `/api/parcels` : gestion colis historique / compatibilité ;
- `/api/v2/parcels` : API colis-first moderne ;
- `/api/v2/orders` : vues order-first compatibles avec le modèle colis ;
- `/api/hub`, `/api/hub/inventory`, `/api/transitaire`, `/api/carriers` : exploitation hub / transport ;
- `/api/scans` : scans terrain et collecte ;
- `/api/tracking`, `/api/client/tracking`, `/s/:token` : suivi client.

Principe : l'humain scanne et confirme des faits ; le système agrège et synchronise.

---

## 6. Paiements et wallet

Modes et mécanismes actifs :

| Mécanisme | Rôle |
|---|---|
| **Stripe** | Paiement carte diaspora / EUR. |
| **Cash** | Paiement local ou relais selon flux. |
| **Wallet** | Avoir client unifié, lots FIFO, transactions immutables. |
| **Shared cart payments** | Paiement d'un panier partagé. |
| **Collective payments** | Contributions individuelles sur workspace collectif. |

Le wallet remplace progressivement l'ancien modèle `store_credits`. Il repose sur :

- `wallets` ;
- `wallet_transactions` ;
- `wallet_credit_lots` ;
- `wallet_consumptions`.

Règle : on ne supprime pas l'historique financier ; on contre-passe.

---

## 7. Moteur économique

Voir [`DOCTRINE_ECONOMIQUE_KOMERCE.md`](./DOCTRINE_ECONOMIQUE_KOMERCE.md).

Le moteur `services/pricing-engine.js` calcule :

- `survival_price` ;
- `minimum_safe_price` ;
- `recommended_price` ;
- `test_market_price` ;
- `health_status` ;
- `market_confidence` ;
- `sourcing_decision`.

Sources de données principales :

- `finance_config` ;
- `customs_categories` ;
- `cost_components` ou fallback `pricing_components` ;
- `risk_provisions` ;
- `charges` ;
- `products` ;
- `orders` / `order_items`.

Doctrine : protéger le prix, apprendre le marché, puis renforcer seulement ce qui prouve sa viabilité.

---

## 8. Surfaces applicatives

### Backend API

`server.js` monte de nombreuses surfaces : auth, produits, commandes, paiements, wallet, colis, hub, transitaire, tracking, pricing, sourcing, admin, dashboards, paniers partagés et collectifs.

Ne pas se fier aux anciens chiffres figés `18 routes / 118 endpoints` ou `67 routes / 37 services` : ils deviennent vite obsolètes.

### Boutique

La boutique canonique est servie via :

- `/boutique` ;
- `/Komerce_Boutique.html` ;
- fallback général vers `public/boutique/index.html`.

### Admin / Control Tower

Les chemins admin modernes pointent vers `public/dashboards/admin/index.html` :

- `/admin/pilotage` ;
- `/admin/control-tower` ;
- `/admin/costing` ;
- `/admin/orders-logistics` ;
- `/admin/event-workspaces` ;
- `/admin/sourcing` ;
- `/admin/alerts` ;
- `/admin/categories`.

Des chemins legacy existent encore pour compatibilité.

---

## 9. Stack réelle

| Élément | État vérifié |
|---|---|
| Runtime | Node.js `>=20.0.0` exigé par `package.json`. |
| Serveur | Express 4, `server.js`. |
| DB | PostgreSQL via `pg`. |
| Auth | JWT + cookies. |
| Sécurité | Helmet, CORS, rate-limiters, request id. |
| Paiement | Stripe. |
| PDF / QR | PDFKit, QRCode. |
| Email | `nodemailer` côté dépendances ; vérifier le provider effectif dans le code avant d'affirmer Brevo/Mailjet. |
| Déploiement | Railway. |

Attention : `package.json` affiche encore `10.6.1`, mais `server.js` se présente comme API v12.4 et `/api/health` retourne `12.3`. Cette divergence doit être résolue séparément comme dette de metadata.

---

## 10. Lire dans l'ordre

1. `docs/README.md` ;
2. `docs/SYNOPTIQUE_KOMERCE.md` ;
3. `docs/DOCTRINE_ECONOMIQUE_KOMERCE.md` ;
4. `docs/CARTOGRAPHY_360.md` ;
5. `docs/ZONE_IMPACT.md` ;
6. `server.js` ;
7. `services/order-status-machine.js` ;
8. `services/pricing-engine.js` ;
9. `services/wallet-service.js`.

---

## 11. Règles de vérité documentaire

- Si une roadmap ancienne contredit le code actuel, le code gagne.
- Si un audit est encore vrai, sa conclusion doit être remontée dans un document fondamental.
- Les documents temporaires ne doivent pas rester au même niveau que les documents de référence.
- Les chiffres d'endpoints, fichiers ou tables doivent être évités sauf génération automatique.
