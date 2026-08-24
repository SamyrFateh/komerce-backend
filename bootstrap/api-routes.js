/**
 * @komerce-arch
 * @role          api-route-manifest
 * @domain        infrastructure
 * @layer         route-manifest
 * @criticality   critical
 * @inputs        express_app
 * @outputs       mounted_api_routes
 * @depends       routes/orders.js, routes/payments.js, routes/otp.js, routes/meta-whatsapp.js, routes/economic-engine.js, routes/boutique-suggestions.js, routes/catalog-product-detail.js
 * @db-write      none
 * @db-read       none
 * @used-by       server.js
 * @doctrine      routes_canoniques, stripe_raw_body_preserve, alias_historiques_limites
 * @impact-areas  all-api, checkout, shared-cart, payment, dashboard, economic-engine, boutique, product-detail
 * @version       2026-08
 */

'use strict';

function mountApiRoutesBeforeStripeOwnedBlocks(app) {
  const authRouter       = require('../routes/auth');
  const productsRouter   = require('../routes/products');
  const ordersRouter     = require('../routes/orders');
  const relaisRouter     = require('../routes/relais');
  const financeRouter    = require('../routes/finance');
  const transitDashRouter = require('../routes/transit-dashboard');
  const adminCustomsShipmentsRouter = require('../routes/admin-customs-shipments');
  const adminCustomsCategoriesRouter = require('../routes/admin-customs-categories');
  const adminPricingComponentsRouter = require('../routes/admin-pricing-components');
  const adminCostComponentsRouter    = require('../routes/admin-cost-components');
  const categoriesRouter = require('../routes/categories');
  const adminBoutiqueCategoriesRouter = require('../routes/admin-boutique-categories');
  const boutiqueSuggestionsRouter = require('../routes/boutique-suggestions');

  app.use('/api/transit-dashboard', transitDashRouter);
  app.use('/api/auth',       authRouter);
  app.use('/api/products',   productsRouter);
  app.use('/api/orders',     ordersRouter);
  app.use('/api/relais',     relaisRouter);
  app.use('/api/admin/finance',  financeRouter);
  app.use('/api/admin/customs-shipments', adminCustomsShipmentsRouter);
  app.use('/api/admin/customs-categories', adminCustomsCategoriesRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/admin/boutique-categories', adminBoutiqueCategoriesRouter);
  app.use('/api/boutique/suggestions', boutiqueSuggestionsRouter);
  app.use('/api/admin/pricing-components', adminPricingComponentsRouter);
  app.use('/api/admin/cost-components',    adminCostComponentsRouter);
}

function mountApiRoutesAfterStripeOwnedBlocks(app) {
  const adminRouter      = require('../routes/admin');
  const catalogApprovalRouter = require('../routes/admin/catalog-approval');
  const adminRulesRouter = require('../routes/admin-rules');
  const adminPricingMatricesRouter = require('../routes/admin-pricing-matrices');
  const dashboardRouter  = require('../routes/dashboard');
  const pricingRouter    = require('../routes/pricing');
  const pricingStrategyRouter = require('../routes/pricing-strategy');
  const modulesRouter    = require('../routes/modules');
  const basketsRouter    = require('../routes/baskets');
  const logisticsRouter  = require('../routes/logistics');
  const paymentsRouter   = require('../routes/payments');
  const paymentsPaypalRouter = require('../routes/payments-paypal');
  const scansRouter      = require('../routes/scans');
  const financeRouter    = require('../routes/finance');
  const purchasingRouter = require('../routes/purchasing');
  const loyaltyRouter    = require('../routes/loyalty');
  const unsoldRouter     = require('../routes/unsold');
  const healthRouter     = require('../routes/health');
  const parcelsRouter    = require('../routes/parcels');
  const hubRouter        = require('../routes/hub');
  const carriersRouter   = require('../routes/carriers');
  const walletRouter     = require('../routes/wallet');
  const relayDashRouter  = require('../routes/relay-dashboard');
  const hubDashRouter    = require('../routes/hub-dashboard');
  const transitDashRouter = require('../routes/transit-dashboard');
  const invoicesRouter   = require('../routes/invoices');
  const documentsRouter  = require('../routes/documents');
  const opsApiRouter = require('../routes/ops-api');
  const trackingRouter   = require('../routes/tracking');
  const clientAuthRouter = require('../routes/client-auth');
  const adminRadarRouter = require('../routes/admin-radar');
  const parcelApiV2Router = require('../routes/parcel-api-v2');
  const parcelLabelRouter = require('../routes/parcel-label');
  const orderApiV2Router = require('../routes/order-api-v2');
  const notificationApiRouter = require('../routes/notification-api');
  const clientNotificationsRouter = require('../routes/client-notifications');
  const otpRouter = require('../routes/otp');
  const authPasskeyRouter = require('../routes/auth-passkey');
  const clientTrackingRouter = require('../routes/client-tracking');
  const simulatorRouter = require('../routes/simulator');
  const pickupRouter    = require('../routes/pickup-secret');
  const cashRouter = require('../routes/cash');
  const inventoryApiRouter = require('../routes/inventory-api');
  const transitaireApiRouter = require('../routes/transitaire-api');
  const autoDistributeRouter = require('../routes/auto-distribute-api');
  const hubMarkOrderedRouter = require('../routes/hub-mark-ordered');
  const sharesRouter = require('../routes/shares');
  const sharedCartSavedRouter = require('../routes/shared-cart-saved');
  const metaWhatsAppRoutes = require('../routes/meta-whatsapp');
  const economicEngineRouter  = require('../routes/economic');
  const adminFinanceConfig    = require('../routes/admin-finance-config');
  const adminLoyaltyRouter    = require('../routes/admin-loyalty');
  const sourcingEngineRouter  = require('../routes/sourcing');
  const sourcingScannerRouter = require('../routes/sourcing-scanner');
  const signalsRouter         = require('../routes/signals');
  const adminRiskProvisionsRouter = require('../routes/admin-risk-provisions');
  const adminOrder360Router = require('../routes/admin-order-360');

  app.use('/api/admin/risk-provisions',    adminRiskProvisionsRouter);
  app.use('/api/admin/dashboard',   require('../routes/admin-dashboard-market'));
  app.use('/api/admin/dashboard',   require('../routes/admin-dashboard'));
  app.use('/api/admin/entities',    adminOrder360Router);
  app.use('/api/admin/costing',     require('../routes/admin-costing'));
  app.use('/api/admin',      catalogApprovalRouter);
  app.use('/api/admin',      adminRouter);
  app.use('/api/admin/rules', adminRulesRouter);
  app.use('/api/admin/radar', adminRadarRouter);
  app.use('/api/admin/economic', economicEngineRouter);
  app.use('/api/admin/finance-config', adminFinanceConfig);
  app.use('/api/admin/loyalty', adminLoyaltyRouter);
  app.use('/api/admin/sourcing', sourcingEngineRouter);
  app.use('/api/admin/sourcing', sourcingScannerRouter);
  app.use('/api/admin/signals', signalsRouter);
  app.use('/api/admin/pricing-matrices', adminPricingMatricesRouter);
  app.use('/api/dashboard',  dashboardRouter);
  app.use('/api/relay',      relayDashRouter);
  app.use('/api/hub-dash',   hubDashRouter);
  app.use('/api/transit',    transitDashRouter);

  app.use('/api/v2/parcels', parcelApiV2Router);
  app.use('/api/v2/parcels', parcelLabelRouter);
  app.use('/api/v2/orders', orderApiV2Router);
  app.use('/api/v2/notifications', notificationApiRouter);
  app.use('/api/v2', opsApiRouter);

  app.use('/api/tracking', trackingRouter);
  app.use('/api/auth/otp', otpRouter);
  app.use('/api/auth/passkey', authPasskeyRouter);
  app.use('/api/client/tracking', clientTrackingRouter);
  app.use('/api/simulator', simulatorRouter);
  app.use('/api/admin/simulator', simulatorRouter);
  app.use('/api/pickup',   pickupRouter);
  app.use('/api/cash', cashRouter);
  app.use('/api/auth', clientAuthRouter);
  app.use('/api/client', clientAuthRouter);
  app.use('/api/auth/me/documents', documentsRouter);
  app.use('/api/auth/me/notifications', clientNotificationsRouter);
  app.use('/api/invoices',   invoicesRouter);
  app.use('/api/pricing/strategy', pricingStrategyRouter);
  app.use('/api/pricing',    pricingRouter);
  app.use('/api/modules',    modulesRouter);
  app.use('/api/baskets',    basketsRouter);
  app.use('/api/logistics',  logisticsRouter);
  app.use('/api/parcels',    parcelsRouter);
  app.use('/api/hub',        hubRouter);
  app.use('/api/hub',        hubMarkOrderedRouter);
  app.use('/api/hub/inventory', inventoryApiRouter);
  app.use('/api/transitaire', transitaireApiRouter);
  app.use('/api/hub', autoDistributeRouter);
  app.use('/api/carriers',   carriersRouter);
  app.use('/api/wallet',     walletRouter);
  app.use('/api/payments/paypal', paymentsPaypalRouter);
  app.use('/api/payments',   paymentsRouter);
  app.use('/api/scans',      scansRouter);
  app.use('/api/finance', (req, res) => {
    res.status(301).json({
      error:    'Endpoint déplacé',
      redirect: `/api/admin/finance${req.path}`,
      message:  'Utilisez /api/admin/finance à la place',
    });
  });
  app.use('/api/purchasing', purchasingRouter);
  app.use('/api/loyalty',    loyaltyRouter);
  app.use('/api/unsold',     unsoldRouter);
  app.use('/api/shared-carts/saved', sharedCartSavedRouter);
  app.use('/api/shares',     sharesRouter);
  app.use('/health',         healthRouter);
  app.use(metaWhatsAppRoutes);
}

module.exports = {
  mountApiRoutesBeforeStripeOwnedBlocks,
  mountApiRoutesAfterStripeOwnedBlocks,
};
