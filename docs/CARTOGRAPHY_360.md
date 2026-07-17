# Cartographie 360 Komerce

> **Statut** : cartographie documentaire canonique  
> **Dernière consolidation** : 15 juillet 2026  
> **Méthode** : version maintenable, vérifiée contre `server.js`, `bootstrap/api-routes.js`, `bootstrap/html-routes.js`, `bootstrap/env.js` et les services critiques.  
> **Règle** : ce document décrit les domaines et invariants. Il évite les comptages figés d'endpoints/fichiers, trop vite obsolètes. Pour le schéma DB complet, voir `SCHEMA.md`.

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
| Boot serveur et montage des routes | `server.js` + `bootstrap/api-routes.js` + `bootstrap/html-routes.js` |
| Runtime Node | `package.json` (`engines.node >=20.0.0`) |
| Variables d'environnement | `bootstrap/env.js` |
| Transitions commande | `services/order-status-machine.js` |
| Cycle paiement -> stock | `services/order-payment-confirmation.js` |
| Pricing | `services/pricing-engine.js` |
| Wallet / avoirs | `services/wallet-service.js` |
| Routage logistique | `services/routing.js` |
| Sécurité pickup/collecte | `routes/pickup-secret.js`, `services/parcel-security.js` |
| Boutique canonique | `public/boutique/index.html` |
| Contrat détail produit public | `services/catalog-product-detail.js` + `schemas/catalog/product-detail.v1.schema.json` + `GET /api/products/:id/detail` |
| Sélection SKU de la modal | `public/boutique/js/view-models/modal-selection-model.js` |
| Composition modal mobile enrichie | `public/boutique/js/b-modal-mobile-product-bootstrap.js` + `public/boutique/js/b-modal-mobile-product.js` |
| Ownership Boutique / modal produit | `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` + `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md` + `features/catalog.feature.js` + `public/boutique/features/modal-product.feature.js` + `npm run gate:boutique-ownership` |
| Couverture unitaire Boutique | `public/boutique/jest.config.js` + `public/boutique/scripts/report-coverage.js` + job `Boutique Quality Gates` de `.github/workflows/ci.yml` |
| Admin moderne | `public/dashboards/admin/index.html` |
| Panier partagé Boutique First | `docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md` + `docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md` |

### 2 bis. Delta Boutique — préparation Playwright du 10 juillet 2026

La couverture Jest de la Boutique porte sur `public/boutique/js/**/*.js`, hors bundles générés `js/dist/**`, fichiers `*.test.js` et dossiers `__tests__/**`. Le rapport `coverage/COVERAGE_MISSING.md` est produit par `npm run test:coverage` et publié comme artefact de CI.

Le lot de stabilisation précédant les tests Playwright a :

- couvert les flux actifs du catalogue, du panier, de la modale, du partage, de la taxonomie et du store produits ;
- retiré le code définitivement inaccessible de `b-group-banner.js` et les enrichissements neutralisés de `b-catalog-desktop-enhancers.js` ;
- ajouté `b-cart-stepper-guard.js`, chargé par `boutique.js`, pour laisser les boutons `+`/`−` du stepper longue pression traverser le listener document en capture de `b-cart.js` sans dupliquer la logique de quantité ;
- déclaré ce module dans `public/boutique/features/boutique.feature.js`.

### 2 ter. Delta Product Detail / modal mobile — PDC-0 à PDC-4 du 12 juillet 2026

La chaîne produit enrichie est désormais cartographiée en quatre responsabilités distinctes :

```text
source fournisseur versionnée
        ↓
raffinerie / catalogue canonique
        ↓
GET /api/products/:id/detail
        ↓
modal-selection-model.js
        ↓
composition mobile / desktop
```

Invariants actifs :

- une unité vendable = un SKU ; `product_variants` décrit les axes et ne porte pas la vérité de stock cible ;
- le contrat détail public compose `product`, `pricing`, `media`, `option_axes`, `sellable_units` et `delivery_options` depuis des sources canoniques ;
- un produit `LEGACY_VARIANTS` peut exposer ses axes mais ne reçoit aucune fausse `sellable_unit` ;
- `modal-selection-model.js` est l'unique owner de `selected_options`, `selected_sku_id`, `selected_media` et des états `AVAILABLE / OUT_OF_STOCK / INCOMPATIBLE` ;
- PDC-4 charge le contrat détail au `modal:opened` sur mobile et rend vignettes photo, tailles combo-aware, message contextuel, médias liés à la sélection et livraison contractuelle ;
- le frontend n'invente ni `Gratuit`, ni délai universel `3 à 5 semaines`, ni ancienne valeur de prix depuis un pourcentage de promotion ;
- `AIR_EXPRESS` n'apparaît dans `delivery_options` que lorsque `logistics` le rend commercialement exposable ;
- jusqu'à PDC-6, un guard de repaint strictement transitoire rétablit le rendu PDC-4 si le fetch legacy de `b-modal-core.js` repeint tardivement les variantes. Ce guard ne dérive aucune vérité métier et doit disparaître avec le chemin legacy.

### 2 quater. Delta viewport modal mobile — Samsung Internet du 15 juillet 2026

Le premier garde runtime basé sur `height: 100%` du parent a été invalidé par un test réel sur Samsung Internet : un overlay `position: fixed` ancré aux quatre côtés peut encore suivre le layout viewport et inclure une zone masquée par les barres du navigateur. Le shell mobile `#k-modal` reçoit désormais directement une hauteur en pixels issue de `window.visualViewport.height`, avec `window.innerHeight` en fallback. La mesure est resynchronisée à l'initialisation, à l'ouverture de la modal, au resize, au changement d'orientation et au `resize` du Visual Viewport. La barre d'actions reste un enfant flex direct de `#k-modal`, hors de `.k-modal-scroll`, afin que le scroll occupe uniquement l'espace réellement visible restant.

### 2 quinquies. Delta modal SKU — synchronisation ciblée du 17 juillet 2026

La disponibilité affichée par la modal possède désormais une projection unique dans `public/boutique/js/b-modal-buybox-shared.js`. Cette projection pilote de façon fail-closed le statut et l’activation des CTA dans les compositions mobile et desktop.

Invariants actifs :

- `#k-modal-stock` est synchronisé sur mobile comme sur desktop : choix initial, sélection partielle, SKU disponible ou combinaison indisponible ;
- la quantité brute de stock n’est pas exposée par défaut ;
- sur desktop, une sélection met à jour en place les axes, le message, la référence, le prix, le stock, le sous-total, les CTA et les médias ;
- le contenu enrichi, la livraison, le paiement et les éléments de sélection existants ne sont plus reconstruits à chaque clic ;
- `modal-selection-model.js` reste l’unique owner de la résolution SKU et des états d’option ; les renderers ne recalculent aucun stock.

---

## 3. Domaines API montés

### Authentification et session

| Préfixe | Rôle |
|---|---|
| `/api/auth` | Auth utilisateurs/admins + client auth selon route montée. |
| `/api/auth/otp` | OTP. Table : `otp_codes`. |
| `/api/client` | Auth/client endpoints compatibles côté client. |

### Catalogue et boutique

| Préfixe | Rôle |
|---|---|
| `/api/products` | Produits, axes descriptifs et unités SKU. `GET /api/products/:id/detail` expose le Product Detail Contract v1 validé. Tables : `products`, `product_variants`, `product_skus`. |
| `/api/categories` | Catégories boutique. |
| `/api/admin/boutique-categories` | Admin catégories boutique. |
| `/api/modules` | Modules spécialisés (cérémonie : tissus + modèles, lunettes, couture). Voir §6 bis. |
| `/api/baskets` | Paniers historiques / boutique. |
| `/api/shares` | Partage simple de panier, distinct de `/api/shared-carts`. Voir §8 ter. Tables : `cart_shares`, `cart_contributions`. |

### Commandes, paiements, factures

| Préfixe | Rôle |
|---|---|
| `/api/orders` | Commandes. |
| `/api/v2/orders` | API order-first moderne compatible colis-first. |
| `/api/payments` | Paiements et webhooks Stripe principaux. |
| `/api/payments/paypal` | Paiements et webhook PayPal. |
| `/api/cash` | Flux cash. |
| `/api/invoices` | Factures / mini-factures. |
| `/api/wallet` | Wallet client. |

### Paniers partagés

| Préfixe | Rôle |
|---|---|
| `/api/shared-carts` | Panier partagé Boutique First / MVP historique côté code. |
| `/api/admin/shared-carts` | Administration paniers partagés et remboursements. |
| `/api/shared-carts/stripe/webhook` | Webhook Stripe panier partagé, body brut. |
| `/webhook/authkey-whatsapp` | Webhook WhatsApp entrant Authkey. GET avec paramètres query `Mobile`, `Email`, `Status`, `Log ID`, `Time`. Protégé par `verifyAuthkeyWebhook` : secret partagé `AUTHKEY_WEBHOOK_SECRET` via `?token=` ou header `x-authkey-token`; fail-closed en production si secret absent. |

### Système collectif historique non monté

Le système `collective_workspaces` / `collective_payments` n'est plus monté côté API.

| Ancien préfixe | Statut actuel |
|---|---|
| `/api/collective-workspaces` | Non monté. Tables `collective_*` conservées comme données historiques. |
| `/api/collective-payments` | Non monté. |
| `/api/collective-payments/stripe/webhook` | Supprimé. Pas de raw body configuré dans `server.js`. |
| `/api/admin/collective` | Non monté. Services repair démontés. |

Ne pas réintroduire ces routes depuis un ancien audit sans décision produit explicite.

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
| `/c/:token` | URL courte panier partagé ; redirige vers `/boutique/?p=TOKEN&tab=group`. |

### Admin, Control Tower, économie

| Préfixe | Rôle |
|---|---|
| `/api/admin` | Admin général. |
| `/api/admin/dashboard` | Dashboard admin. |
| `/api/dashboard` | Pilotage et statistiques, chemin API canonique. |
| `/api/admin/rules` | Business rules. |
| `/api/admin/radar` | Radar/alertes. |
| `/api/admin/economic` | Moteur économique. |
| `/api/admin/finance`, `/api/finance` | Finance ; `/api/finance` répond 301 JSON vers `/api/admin/finance`. |
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

Les anciens alias API `/api/admin/pilotage` et `/api/admin/stats` ne sont plus montés. Les chemins HTML `/admin/pilotage` et autres vues admin restent servis par `public/dashboards/admin/index.html`.

### Pricing public/interne

| Préfixe | Rôle |
|---|---|
| `/api/pricing` | Recommandations pricing. |
| `/api/pricing/strategy` | Stratégie pricing avancée. |
| `/api/simulator` | Simulateur. |
| `/api/admin/simulator` | Alias admin du simulateur. |

---

## 4. Surfaces HTML servies

| Chemin | Comportement / fichier servi |
|---|---|
| `/boutique`, `/Komerce_Boutique.html` | `public/boutique/index.html` |
| fallback non-API | `public/boutique/index.html` |
| `/mon-compte` | `public/mon-compte.html` |
| `/cart/shared`, `/cart/shared/:token`, `/cart/shared/success`, `/cart/shared/cancel` | Redirection vers `/boutique/?p=TOKEN&tab=group` avec éventuel `shared_payment=success|cancel`. |
| `/account/shared-carts` | Redirection vers `/boutique/?p=TOKEN&tab=group`. |
| `/c/:token` | Redirection vers `/boutique/?p=TOKEN&tab=group`. |
| `/relais`, `/Komerce_Relais.html` | `public/relais/index.html` |
| `/hub` | `public/hub/index.html` |
| `/event/create`, `/event/manage/:creatorToken`, `/event/w/:publicToken`, `/event/pay/:paymentToken`, `/event/:creatorToken/manage`, `/workspace/:publicToken` | Redirection vers `/boutique`. |
| `/control-tower.html` | Redirection 301 vers `/admin/pilotage` sauf `ADMIN_LEGACY_ENABLED=1`. |
| `/admin/*` chemins modernes listés dans `bootstrap/html-routes.js` | `public/dashboards/admin/index.html` |

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
- webhooks Stripe/PayPal en `express.raw` avant parser JSON.

**Utilitaires partagés notables** :

| Fichier | Rôle |
|---|---|
| `utils/phone.js` | `normalizePhone(raw, defaultCountry?)` — normalisation E.164 unifiée back/front. |
| `utils/user-cache.js` | Cache partagé entre `auth.js` et `auth-guest.js`. |
| `utils/logger.js` | Logger structuré Pino. Seul fichier autorisé à contenir des `console.*` hors exceptions historiques explicitement acceptées. |
| `utils/rates.js` | Taux de change EUR<->KMF. |

Variables **obligatoires** au boot (`bootstrap/env.js`) :

- `DATABASE_URL` ;
- `JWT_SECRET` ;
- `ADMIN_PASSWORD` ;
- `STRIPE_SECRET_KEY` ;
- `STRIPE_WEBHOOK_SECRET` ;
- `QR_SECRET` ;
- `AUTHKEY_API_KEY` ;
- `PAYPAL_CLIENT_ID` ;
- `PAYPAL_CLIENT_SECRET` ;
- `PAYPAL_WEBHOOK_ID`.

Variables recommandées :

- `STRIPE_SHARED_CART_WEBHOOK_SECRET` ;
- `PAYPAL_ENV` ;
- `TRANSITAIRE_PASSWORD` ;
- `AUTHKEY_WEBHOOK_SECRET`.

En production, `PAYPAL_ENV` doit valoir `production`, sinon le boot est refusé. En production, `AUTHKEY_WEBHOOK_SECRET` absent rend le webhook Authkey fail-closed.

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
- `shared_cart_full_payment` ;
- `collective_payment`.

`collective_payment` reste une source technique reconnue par la machine à états, mais les routes collectives ne sont plus montées. Ne pas en déduire que le workspace collectif est actif côté API.

Garanties :

- transition idempotente si le statut cible est déjà présent ;
- paiement strictement `pending -> confirmed` ;
- scans/système forward-only ;
- insertion dans `order_status_history` ;
- timestamps posés une seule fois par `COALESCE` ;
- génération du `pickup_code` au passage `available` si absent ;
- annulation avec restauration stock et contrepassation wallet.

---

## 6 bis. Modules spécialisés (cérémonie, couture, lunettes)

Source : `routes/modules.js` + ENUM `ceremony_order_type`.

Tables dédiées :

- `fabrics` — catalogue de tissus pour modules cérémonie ;
- `garment_models` — modèles de vêtements (références, prix, dimensions).

Colonnes commande associées (`orders`) :

- `confection_type` : `aucun`, `couture_standard`, `sur_mesure`, `retouche_locale`, `broderie`, `lunettes_vue`, `lunettes_solaires` ;
- `module_type`, `module_fabric_id`, `module_fabric_type`, `module_size`, `module_retouche`, `module_qty_meters`, `module_accessories`, `confection_instructions`, `confection_delay_days`, `confection_artisan_id`.

Vue agrégée : `v_ceremony_orders`.

Principe : les modules spécialisés ne remplacent pas le moteur catalogue. Ils enrichissent une commande standard avec un type de confection et des paramètres dédiés.

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

## 8 bis. Notifications, SMS et idempotence Stripe

Tables transverses utilisées par plusieurs services :

- `notification_log` — log applicatif des notifications (email, push, in-app). Consommée par `services/notification-service.js` et `routes/notification-api.js`.
- `sms_log` — log des SMS envoyés. Consommée par `utils/sms.js`, `routes/admin.js`, `routes/relay-dashboard.js`.
- `stripe_events_processed` — anti-double-traitement des webhooks Stripe. Consommée par `routes/payments.js` et `routes/shared-cart.js`.

Principes :

- toute notification métier doit être tracée dans `notification_log` ou `sms_log` selon le canal ;
- `stripe_events_processed` garantit l'idempotence des webhooks Stripe actifs : principal et panier partagé.

---

## 8 ter. Partage simple (`/api/shares`) vs panier partagé (`/api/shared-carts`)

Komerce a **deux systèmes de partage distincts**, à ne pas confondre.

| Critère | `/api/shares` | `/api/shared-carts` |
|---|---|---|
| Source de vérité | `routes/shares.js` | `services/shared-cart-engine.js` |
| Tables | `cart_shares`, `cart_contributions` | `shared_carts`, `shared_cart_items`, `shared_cart_contributions`, `shared_cart_events` |
| Cas d'usage | Partage simple de panier avec contributions libres | Panier partagé Boutique First avec paiement Stripe/cash dédié et conversion vers commande |
| Webhook Stripe | non | oui (`/api/shared-carts/stripe/webhook`, body brut) |
| ENUMs typés | non (champs `status` libres) | `shared_cart_status`, `shared_cart_contribution_status` |

`/api/shares` n'est pas le panier partagé Boutique First. Le parcours participant canonique passe par `/boutique/?p=TOKEN`.

---

## 9. Dette documentaire détectée

Ces divergences sont connues et ne doivent pas contaminer les docs de référence :

1. `docs/SCHEMA.md` est daté du dump Railway du 26 mai 2026. Les mentions `revoked_tokens`, `cart_shares`/`cart_contributions` et modules spécialisés peuvent être périmées et doivent être revalidées contre DB live avant action.
2. Plusieurs audits du 7 avril, du 8 mai et des PR fermées parlent de nombres de routes/endpoints devenus obsolètes.
3. Les documents temporaires de prompts/roadmaps Sonnet/Temu/mobile sont historiques sauf s'ils sont listés dans `docs/README.md`.
4. Certains noms providers email/notification varient selon les périodes ; vérifier le code avant d'affirmer un provider actif.
5. Le code garde des noms internes V4.1 (`shared-cart-engine`, statuts DB, tests `v41`). Ce n'est pas une preuve que la doctrine V4.1 est active côté produit : la doctrine active est Boutique First.
6. Pour la modal produit Boutique, l'ancien document local mobile n'est plus source de vérité. La source active est `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`, contrôlée par `npm run gate:boutique-ownership`.
7. PDC-4 garde un guard de repaint autour du renderer legacy uniquement parce que `b-modal-core.js` lance encore le fetch variantes historique. Ce guard est une dette transitoire explicitement assignée à PDC-6 ; ne pas l'étendre à d'autres surfaces.

---

## 10. Règle de mise à jour

Pour maintenir cette cartographie :

1. lire `server.js`, `bootstrap/api-routes.js`, `bootstrap/html-routes.js` et `bootstrap/env.js` ;
2. mettre à jour les domaines, pas seulement les chiffres ;
3. vérifier les services critiques (voir `CONTRACTS.md`) ;
4. confronter au schéma DB (voir `SCHEMA.md`) ;
5. ne pas recopier un audit ancien sans confrontation au code ;
6. documenter toute divergence code/doc dans cette section.

Ce document est l'un des documents socle référencés par `docs/README.md`. Toute modification structurelle du backend ou de la gouvernance Boutique doit le mettre à jour dans la même PR. La règle de divergence doc <-> code <-> DB est définie dans `AGENTS.md`.


## Delta 2026-07-16 — MDM-9 — galerie produit adaptative

- `public/boutique/js/b-modal-product.js` : propriétaire du mode média explicite `single|multiple`, mesure du sujet et navigation canonique.
- `public/boutique/js/boutique.js` : suppression du listener délégué legacy qui annulait `goToSlide()`.
- `public/boutique/css/modal-mobile-canonical.css` : 36 % du viewport visible en single, 48 % conservés en multiple ; CTA et contenu enrichi préservés.
- Aucun endpoint, aucune route et aucune mutation de schéma introduits par MDM-9. Le snapshot DB documente séparément la migration ING-6 déjà appliquée.
