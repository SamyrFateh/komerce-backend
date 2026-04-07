# Delta — Phase 5.2 Indicateurs annulations & expéditions partielles

## Contexte
Ajout des indicateurs d'annulations, remboursements et expéditions partielles dans le Dashboard Pilotage Unifié.
PR #115 créée sur branche `feat/phase5.2-annulations-parcels-indicators`.

## ROADMAP
- Gouvernance Phase 5 : ⬜ → 🔄 (5.1 Config ✅, 5.2 Indicateurs annulations/parcels ✅ PR #115)
- Progression Gouvernance : 4/5 → 5/5 (une fois PR mergée)
- Section P6 Gouvernance : ajouter ligne Phase 5.2 dans le tableau

## CARTOGRAPHY
### Routes modifiées
- `routes/dashboard.js` : +1 endpoint
  - `GET /api/dashboard/annulations-parcels` (NEW) — KPIs annulations, remboursements Stripe/crédits, expéditions partielles, backorders
  - Sous-routes : `/annulations-parcels/kpi`, `/annulations-parcels/recentes`, `/annulations-parcels/parcels-actifs`

### Frontend modifié
- `public/Komerce_Dashboard.html` :
  - Vue Overview : +2 blocs (Annulations KPI, Expéditions Partielles KPI)
  - Vue Finance : +2 sections (Annulations & Remboursements détaillés, Expéditions Partielles & Backorders)
  - Nouveau fetch `fetchApi('annulations-parcels')` dans `loadDashboard()`

### Tables lues (pas de nouvelles tables)
- `orders` (status = 'cancelled', cancelled_at, cancel_reason)
- `order_refunds` (refund_type, amount_kmf, refunded_at)
- `store_credits` (balance_kmf, status = 'active')
- `sub_orders` / `parcels` (partial shipment tracking)

## AUDIT
- Endpoint protégé par `authMiddleware` existant
- Requêtes SQL paramétrées ($1, $2) — pas d'injection
- Fallback gracieux côté frontend si endpoint non déployé
