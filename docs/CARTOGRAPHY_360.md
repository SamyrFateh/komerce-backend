# Cartographie 360 Komerce

> **Statut** : cartographie documentaire canonique  
> **Dernière consolidation** : 15 mai 2026  
> **Méthode** : ancienne cartographie v15 remplacée par une version maintenable, vérifiée contre `server.js` et les services critiques.  
> **Règle** : ce document décrit les domaines et invariants. Il évite les comptages figés d'endpoints/fichiers, trop vite obsolètes.

---

## 1. Résumé d'architecture

Komerce est un backend Express/PostgreSQL déployé sur Railway. Il sert :

1. une boutique publique ;
2. des flux de commande et paiement ;
3. une logistique colis-first ;
4. un suivi client ;
5. un back-office / Control Tower ;
6. des moteurs économiques : pricing, sourcing, coût, risque, wallet.

Le point d'entrée applicatif est `server.js`.

---

## 2. Points de vérité

| Sujet | Source de vérité |
|---|---|
| Boot serveur et montage des routes | `server.js` |
| Runtime Node | `package.json` (`engines.node >=20.0.0`) |
| Transitions commande | `services/order-status-machine.js` |
| Pricing | `services/pricing-engine.js` |
| Wallet / avoirs | `services/wallet-service.js` |
| Routage logistique | `services/routing.js` |
| Sécurité pickup/collecte | `routes/pickup-secret.js`, `services/parcel-security.js` |
| Boutique canonique | `public/boutique/index.html` |
| Admin moderne | `public/dashboards/admin/index.html` |

---

## 3. Domaines API montés

### Authentification et session

| Préfixe | Rôle |
|---|---|
| `/api/auth` | Auth utilisateurs/admins + client auth selon route montée. |
| `/api/auth/otp` | OTP. |
| `/api/client` | Auth/client endpoints compatibles côté client. |

### Catalogue et boutique

| Préfixe | Rôle |
|---|---|
| `/api/products` | Produits. |
| `/api/categories` | Catégories boutique. |
| `/api/admin/boutique-categories` | Admin catégories boutique. |
| `/api/modules` | Modules spécialisés. |
| `/api/baskets` | Paniers historiques / boutique. |
| `/api/shares` | Partage. |

### Commandes, paiements, factures

| Préfixe | Rôle |
|---|---|
| `/api/orders` | Commandes. |
| `/api/v2/orders` | API order-first moderne compatible colis-first. |
| `/api/payments` | Paiements et webhooks Stripe principaux. |
| `/api/cash` | Flux cash. |
| `/api/invoices` | Factures / mini-factures. |
| `/api/wallet` | Wallet client. |

### Paniers partagés et collectifs

| Préfixe | Rôle |
|---|---|
| `/api/shared-carts` | Panier partagé MVP. |
| `/api/admin/shared-carts` | Administration paniers partagés. |
| `/api/shared-carts/stripe/webhook` | Webhook Stripe panier partagé, body brut. |
| `/api/collective-workspaces` | Workspace collectif / événement. |
| `/api/collective-payments` | Contributions et paiements collectifs. |
| `/api/collective-payments/stripe/webhook` | Webhook Stripe collectif, body brut. |

### Logistique colis-first

| Préfixe | Rôle |
|---|---|
| `/api/parcels` | Parcels historiques / compatibilité. |
| `/api/v2/parcels` | API colis-first moderne. |
| `/api/v2/notifications` | Notifications API v2. |
| `/api/v2` | Ops API v2. |
| `/api/logistics` | Logistique historique. |
| `/api/hub` | Hub Dubai et opérations associées. |
| `/api/hub/inventory` | Inventaire hub. |
| `/api/transitaire` | Transitaire. |
| `/api/carriers` | Transporteurs. |
| `/api/scans` | Scans terrain et collecte. |
| `/api/relay` | Dashboard relais. |
| `/api/hub-dash` | Dashboard hub. |
| `/api/transit` et `/api/transit-dashboard` | Dashboard transit. |

### Suivi client et pickup

| Préfixe | Rôle |
|---|---|
| `/api/tracking` | Suivi. |
| `/api/client/tracking` | Suivi côté client. |
| `/api/pickup` | Secret/code retrait. |
| `/s/:token` | URL courte suivi. |
| `/c/:token` | URL courte panier partagé vers boutique. |

### Admin, Control Tower, économie

| Préfixe | Rôle |
|---|---|
| `/api/admin` | Admin général. |
| `/api/admin/dashboard` | Dashboard admin. |
| `/api/admin/pilotage`, `/api/admin/stats`, `/api/dashboard` | Pilotage et statistiques. |
| `/api/admin/rules` | Business rules. |
| `/api/admin/radar` | Radar/alertes. |
| `/api/admin/economic` | Moteur économique. |
| `/api/admin/finance`, `/api/finance` | Finance ; `/api/finance` redirige vers `/api/admin/finance`. |
| `/api/admin/finance-config` | Configuration finance. |
| `/api/admin/loyalty` | Fidélité. |
| `/api/admin/sourcing` | Sourcing engine + scanner. |
| `/api/admin/signals` | Signaux. |
| `/api/admin/pricing-matrices` | Matrices pricing. |
| `/api/admin/pricing-components` | Composantes pricing. |
| `/api/admin/cost-components` | Composantes de coûts. |
| `/api/admin/risk-provisions` | Provisions risques. |
| `/api/admin/customs-shipments` | Douane shipments. |
| `/api/admin/customs-categories` | Catégories douane. |
| `/api/admin/costing` | Costing. |

### Pricing public/interne

| Préfixe | Rôle |
|---|---|
| `/api/pricing` | Recommandations pricing. |
| `/api/pricing/strategy` | Stratégie pricing avancée. |
| `/api/simulator` | Simulateur. |

---

## 4. Surfaces HTML servies

| Chemin | Fichier servi |
|---|---|
| `/boutique`, `/Komerce_Boutique.html` | `public/boutique/index.html` |
| fallback non-API | `public/boutique/index.html` |
| `/mon-compte` | `public/mon-compte.html` |
| `/cart/shared`, `/cart/shared/:token` | `public/boutique/shared-cart-public.html` |
| `/account/shared-carts` | `public/boutique/shared-cart-account.html` |
| `/relais`, `/Komerce_Relais.html` | `public/relais/index.html` |
| `/hub` | `public/hub/index.html` |
| `/event/create` | `public/boutique/event/create.html` |
| `/event/manage/:creatorToken` | `public/boutique/event/manage.html` |
| `/event/w/:publicToken` | `public/boutique/event/public.html` |
| `/event/pay/:paymentToken` | `public/boutique/event/pay.html` |
| `/control-tower.html` | `public/dashboards/admin-legacy/control-tower.html` |
| `/admin/*` chemins modernes | `public/dashboards/admin/index.html` |

---

## 5. Middlewares et sécurité

Actifs dans `server.js` :

- `helmet` avec CSP ;
- `cors` avec origine contrôlée ;
- `cookie-parser` ;
- `express.json` limité à 1 MB ;
- `requestIdMiddleware` ;
- rate limiting global `/api/` ;
- rate limiting spécialisé pour login/register, cash confirm, scans collect, création commande, dashboard et admin ;
- webhooks Stripe en `express.raw` avant parser JSON.

Variables critiques au boot :

- `DATABASE_URL` ;
- `JWT_SECRET`.

Variables recommandées :

- `ADMIN_PASSWORD` ;
- `STRIPE_SECRET_KEY`.

---

## 6. Machine à états commande

Source : `services/order-status-machine.js`.

Statuts :

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

Sources de transition reconnues :

- `patch` ;
- `scan` ;
- `system` ;
- `stripe_webhook` ;
- `cash_confirm` ;
- `wallet_full_payment` ;
- `shared_cart_full_payment`.

Garanties :

- transition idempotente si le statut cible est déjà présent ;
- paiement strictement `pending → confirmed` ;
- scans/système forward-only ;
- insertion dans `order_status_history` ;
- timestamps posés une seule fois par `COALESCE` ;
- génération du `pickup_code` au passage `available` si absent ;
- annulation avec restauration stock et contrepassation wallet.

---

## 7. Pricing et économie

Source : `services/pricing-engine.js`.

Le moteur calcule :

- `survival_price` ;
- `minimum_safe_price` ;
- `recommended_price` ;
- `test_market_price` ;
- `health_status` ;
- `market_confidence` ;
- `sourcing_decision`.

Sources DB attendues :

- `finance_config` ;
- `customs_categories` ;
- `cost_components` avec fallback `pricing_components` ;
- `risk_provisions` ;
- `charges` ;
- `products` ;
- `orders` ;
- `order_items`.

Voir [`DOCTRINE_ECONOMIQUE_KOMERCE.md`](./DOCTRINE_ECONOMIQUE_KOMERCE.md).

---

## 8. Wallet

Source : `services/wallet-service.js`.

Tables :

- `wallets` ;
- `wallet_transactions` ;
- `wallet_credit_lots` ;
- `wallet_consumptions`.

Principes :

- 1 wallet par user ;
- création lazy ;
- transactions immutables ;
- consommation FIFO des lots ;
- idempotence sur les créations automatiques ;
- contrepassation plutôt que suppression.

---

## 9. Dette documentaire détectée

Ces divergences sont connues et ne doivent pas contaminer les docs de référence :

1. `package.json` indique `10.6.1`, `server.js` annonce v12.4, `/api/health` retourne `12.3`.
2. Plusieurs audits du 7 avril et du 8 mai parlent de nombres de routes/endpoints devenus obsolètes.
3. Des documents temporaires de prompts/roadmaps Sonnet/Temu/mobile ont été retirés de l'index principal ou doivent être archivés/supprimés dans une passe dédiée.
4. Certains noms providers email/notification varient selon les périodes ; vérifier le code avant d'affirmer un provider actif.

---

## 10. Règle de mise à jour

Pour maintenir cette cartographie :

1. lire `server.js` ;
2. mettre à jour les domaines, pas seulement les chiffres ;
3. vérifier les services critiques ;
4. ne pas recopier un audit ancien sans confrontation au code ;
5. documenter toute divergence code/doc dans cette section.
