# Documentation Komerce

> **Statut** : index documentaire canonique — mis à jour le 15 mai 2026  
> **Méthode** : consolidation des audits existants + vérification contre le code réel (`server.js`, `package.json`, `services/order-status-machine.js`, `services/pricing-engine.js`, `services/wallet-service.js`).  
> **Objectif** : garder uniquement les documents utiles pour comprendre, maintenir et piloter Komerce.

---

## 1. Documents fondamentaux

| Document | Rôle |
|---|---|
| [`SYNOPTIQUE_KOMERCE.md`](./SYNOPTIQUE_KOMERCE.md) | Vue métier et technique rapide : ce que Komerce fait, pour qui, et comment les grands blocs s'enchaînent. |
| [`DOCTRINE_ECONOMIQUE_KOMERCE.md`](./DOCTRINE_ECONOMIQUE_KOMERCE.md) | Doctrine de pricing, marges, coût complet, risque, confiance marché et décisions de sourcing. |
| [`CARTOGRAPHY_360.md`](./CARTOGRAPHY_360.md) | Cartographie opérationnelle vérifiée : routes, domaines, services critiques et points de vérité. |
| [`ZONE_IMPACT.md`](./ZONE_IMPACT.md) | Invariants d'impact : ce qu'il ne faut jamais casser dans les flux sensibles. |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Déploiement Railway, variables d'environnement et points d'exploitation. |
| [`GOVERNANCE.md`](./GOVERNANCE.md) | Règles de gouvernance projet et discipline de modification. |
| [`IMPACT_SYSTEM.md`](./IMPACT_SYSTEM.md) | Documentation du système d'impact / coffre-fort si utilisé dans les PR. |

---

## 2. Documents complémentaires durables

Ces documents complètent la panoplie fondamentale. Ils ne remplacent pas la vérité du code, mais conservent la vision métier, le lancement et la compréhension visuelle.

| Document | Rôle |
|---|---|
| [`VISION_MARCHE_KOMERCE.md`](./VISION_MARCHE_KOMERCE.md) | Vision marché, proposition de valeur, segments clients, barrières et doctrine de confiance. |
| [`PLAN_LANCEMENT_OPERATIONNEL.md`](./PLAN_LANCEMENT_OPERATIONNEL.md) | Plan de lancement terrain : bloquants, commandes pilotes, critères de validation, risques. |
| [`komerce_architecture.mmd`](./komerce_architecture.mmd) | Schéma Mermaid de l'architecture cible actuelle, utile pour visualiser les grands flux. |

---

## 3. ADR conservées

Les ADR restent utiles lorsqu'elles expliquent une décision d'architecture durable. Elles ne doivent pas être lues comme des plans projet à jour, mais comme des décisions de fond.

| ADR | Sujet |
|---|---|
| [`ADR-001-customs-shipments.md`](./ADR-001-customs-shipments.md) | Douane et shipments. |
| [`ADR-002-sales-analytics-v2.md`](./ADR-002-sales-analytics-v2.md) | Analytics ventes. |
| [`ADR-003-accounting-v2.md`](./ADR-003-accounting-v2.md) | Comptabilité / finance. |
| [`ADR-004-customs-rate-coherence.md`](./ADR-004-customs-rate-coherence.md) | Cohérence des taux douane. |
| [`ADR-005-suppliers-unifies.md`](./ADR-005-suppliers-unifies.md) | Fournisseurs unifiés. |
| [`ADR-006-clients-view.md`](./ADR-006-clients-view.md) | Vue clients. |
| [`ADR-007-finance-bo-hygiene.md`](./ADR-007-finance-bo-hygiene.md) | Hygiène back-office finance. |
| [`ADR-008-pilotage-split-and-sante.md`](./ADR-008-pilotage-split-and-sante.md) | Séparation pilotage / santé. |
| [`ADR-009-source-verite-unifiee.md`](./ADR-009-source-verite-unifiee.md) | Source de vérité unifiée. |
| [`ADR-010-pricing-reads-db.md`](./ADR-010-pricing-reads-db.md) | Pricing lu depuis la DB. |
| [`ADR-011-pricing-extensible-3-niveaux.md`](./ADR-011-pricing-extensible-3-niveaux.md) | Pricing extensible en 3 niveaux. |

---

## 4. Documents historiques / audits

Les audits accumulés ont servi à construire cette documentation. Leur valeur principale est historique : ils montrent le chemin, mais ils peuvent être dépassés par le code actuel.

Règle : lorsqu'un audit contredit `server.js`, une route active, une migration ou un service applicatif, **le code gagne**. Les conclusions encore vraies doivent être remontées dans les documents fondamentaux ci-dessus.

Les documents très ciblés, temporaires ou déjà remplacés par une version consolidée doivent être supprimés ou sortis de l'index principal.

---

## 5. Vérités vérifiées dans le code

### Runtime

- Le dépôt démarre avec `node server.js`.
- Le package exige Node `>=20.0.0`.
- `package.json` porte encore la version npm `10.6.1`, tandis que `server.js` annonce une API v12.4 et le healthcheck `/api/health` retourne `12.3`. Cette divergence est documentaire/metadata et ne doit pas servir de vérité fonctionnelle.

### Sécurité et middlewares

- Variables critiques au boot : `DATABASE_URL`, `JWT_SECRET`.
- Variables fortement recommandées : `ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`.
- Middlewares actifs : `helmet`, `cors`, `cookie-parser`, `express.json`, `requestIdMiddleware`, rate-limiters globaux et spécialisés.
- Les webhooks Stripe doivent recevoir un body brut avant `express.json`.

### Routes majeures montées

Le backend actuel ne se limite plus à l'ancien périmètre 18/19 routes. `server.js` monte notamment :

- boutique/catalogue : `/api/products`, `/api/categories`, `/api/modules`, `/api/baskets` ;
- commandes et paiements : `/api/orders`, `/api/payments`, `/api/cash`, `/api/invoices`, `/api/wallet` ;
- paniers avancés : `/api/shared-carts`, `/api/collective-workspaces`, `/api/collective-payments` ;
- logistique : `/api/parcels`, `/api/v2/parcels`, `/api/v2/orders`, `/api/logistics`, `/api/hub`, `/api/transitaire`, `/api/carriers`, `/api/scans` ;
- suivi client : `/api/tracking`, `/api/client/tracking`, `/api/pickup`, URLs courtes `/s/:token`, `/c/:token` ;
- pilotage/admin : `/api/admin/*`, `/api/dashboard`, `/api/pricing`, `/api/pricing/strategy`, `/api/admin/economic`, `/api/admin/sourcing`, `/api/admin/signals`, `/api/admin/risk-provisions`, `/api/admin/pricing-components`, `/api/admin/cost-components`.

### Invariants critiques

- Les changements de statut commande doivent passer par `services/order-status-machine.js::transitionOrderStatus()`.
- Les paiements Stripe, cash, wallet et panier partagé confirment uniquement `pending → confirmed`.
- Les opérations de scan/système sont forward-only et idempotentes.
- Le wallet remplace progressivement `store_credits` et repose sur transactions immutables + lots FIFO.
- Le moteur de pricing lit la DB : `finance_config`, `customs_categories`, `cost_components`/`pricing_components`, `risk_provisions`, `charges`, `products`, `orders`, `order_items`.

---

## 6. Règle de maintenance documentaire

Avant de modifier la documentation :

1. vérifier le code réel ;
2. ne pas recopier un audit ancien sans validation ;
3. déplacer les décisions durables vers les ADR ou documents fondamentaux ;
4. supprimer les roadmaps temporaires une fois absorbées ;
5. éviter les chiffres figés d'endpoints, tables ou fichiers sauf s'ils sont régénérés automatiquement.

---

## 7. Lecture recommandée

Pour reprendre le projet sans se perdre :

1. `docs/README.md` ;
2. `docs/SYNOPTIQUE_KOMERCE.md` ;
3. `docs/VISION_MARCHE_KOMERCE.md` ;
4. `docs/DOCTRINE_ECONOMIQUE_KOMERCE.md` ;
5. `docs/CARTOGRAPHY_360.md` ;
6. `docs/ZONE_IMPACT.md` ;
7. `docs/PLAN_LANCEMENT_OPERATIONNEL.md` ;
8. `server.js` ;
9. `services/order-status-machine.js` ;
10. `services/pricing-engine.js` ;
11. `services/wallet-service.js`.
