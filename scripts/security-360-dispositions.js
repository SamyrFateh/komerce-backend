'use strict';

/**
 * Dispositions explicites des routes que le scanner de gardes Express ne doit
 * pas confondre avec de la dette de sécurité.
 *
 * Règles :
 * - clés EXACTES `METHOD /path` uniquement — aucune regex de famille ;
 * - une disposition explique POURQUOI l'absence de session Express est voulue ;
 * - une nouvelle route non authentifiée reste donc un signal bloquant ;
 * - REAL_DEBT n'est volontairement pas un type ici : une vraie dette reste
 *   dans `flagged` jusqu'à correction, elle n'est jamais dispositionnée.
 */
const ALLOWED_KINDS = new Set([
  'EXPECTED_PUBLIC',
  'CAPABILITY_TOKEN',
  'APPLICATION_GUARD',
  'TEST_ONLY',
  'RETIRED',
]);

const DISPOSITIONS = Object.freeze({
  // ── Auth bootstrap / identité ─────────────────────────────────────────────
  'GET /api/auth/magic-link/validate': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/client-auth.js',
    rationale: 'Validation publique d’un magic-link à token signé/mono-usage ; la possession du token est la capacité.',
  },
  'GET /api/client/magic-link/validate': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/client-auth.js',
    rationale: 'Alias client du parcours magic-link ; token signé/mono-usage requis.',
  },
  'POST /api/auth/magic-link': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/client-auth.js; features/auth-identity.feature.js',
    rationale: 'Point d’entrée public d’authentification : il émet un lien de connexion, il ne consomme pas une session existante.',
  },
  'POST /api/client/magic-link': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/client-auth.js; features/auth-identity.feature.js',
    rationale: 'Alias public du bootstrap magic-link.',
  },
  'POST /api/auth/otp/request': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/otp.js; tests/unit/otp-route.test.js',
    rationale: 'Bootstrap OTP public avec cooldown par téléphone et plafond de demandes ; aucune session n’existe encore.',
  },
  'POST /api/auth/otp/verify': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/otp.js; tests/unit/otp-route.test.js',
    rationale: 'La vérification OTP est précisément l’étape qui crée la session vérifiée.',
  },
  'POST /api/auth/otp/test-reset': {
    kind: 'TEST_ONLY',
    evidence: 'routes/otp.js; services/otp-test-mode.js; tests/unit/otp-route.test.js',
    rationale: 'Retourne 404 hors mode test ; le mode maître est explicitement impossible en production.',
  },
  'POST /api/auth/guest-checkout': {
    kind: 'RETIRED',
    evidence: 'routes/auth.js',
    rationale: 'Ancienne voie non vérifiée retirée ; endpoint conservé uniquement comme tombstone HTTP 410.',
  },
  'POST /api/auth/activate-account': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/auth.js; services/credential-action-store.js; tests/unit/auth-route.test.js; tests/unit/credential-action-store.test.js',
    rationale: 'Activation de compte sans session, uniquement par jeton à usage unique, empreinte SHA-256, expiration et consommation transactionnelle ; limite IP.',
  },
  'POST /api/auth/password-reset/request': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/auth.js; tests/unit/auth-route.test.js',
    rationale: 'Demande publique de récupération (aucune session préalable) : réponse uniforme anti-énumération, limite IP, lien éphémère par canal vérifié.',
  },
  'POST /api/auth/password-reset/confirm': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/auth.js; services/credential-action-store.js; middleware/auth.js; tests/unit/credential-session-guard.test.js',
    rationale: 'Réinitialisation sans session via jeton à usage unique et borné dans le temps ; consommation transactionnelle, invalidation des anciennes sessions, limite IP.',
  },
  'POST /api/auth/admin-reset': {
    kind: 'APPLICATION_GUARD',
    evidence: 'routes/auth.js; tests/unit/auth-route.test.js',
    rationale: 'Garde applicative : clé >=32 caractères, comparaison constante, désactivé par défaut en production et sans clé.',
  },

  // ── Catalogue / découverte publique ───────────────────────────────────────
  'GET /api/boutique/suggestions': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/boutique-suggestions.js',
    rationale: 'Suggestions de découverte de la boutique, nécessaires avant authentification.',
  },
  'GET /api/categories': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/categories.js; features/catalog.feature.js',
    rationale: 'Taxonomie publique du catalogue.',
  },
  'GET /api/local-stock/availability': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/local-stock.js',
    rationale: 'Projection read-only de disponibilité locale pour la découverte produit.',
  },
  'GET /api/local-stock/checkout-preview': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/local-stock.js',
    rationale: 'Projection read-only de fulfillment ; ne réserve ni ne mute aucun stock.',
  },
  'GET /api/loyalty/tiers': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/loyalty.js; features/loyalty.feature.js',
    rationale: 'Référentiel public des paliers de fidélité, sans donnée utilisateur.',
  },
  'GET /api/modules': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/modules.js',
    rationale: 'Référentiel public des modules de configuration produit.',
  },
  'GET /api/modules/fabrics': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/modules.js',
    rationale: 'Référentiel public des tissus.',
  },
  'GET /api/modules/models': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/modules.js',
    rationale: 'Référentiel public des modèles.',
  },
  'GET /api/modules/{type}': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/modules.js',
    rationale: 'Lecture publique d’un référentiel de module par type.',
  },
  'POST /api/modules/price': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/modules.js',
    rationale: 'Calculateur public sans mutation métier persistante.',
  },
  'GET /api/products': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/products.js; features/catalog.feature.js',
    rationale: 'Catalogue marchand public.',
  },
  'GET /api/products/categories': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/products.js',
    rationale: 'Projection publique des catégories catalogue.',
  },
  'GET /api/products/subcategories': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/products.js',
    rationale: 'Projection publique des sous-catégories catalogue.',
  },
  'GET /api/products/{id}': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/products.js',
    rationale: 'Fiche publique d’un produit exposable.',
  },
  'GET /api/products/{id}/detail': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/catalog-product-detail.js; schemas/catalog/product-detail.v1.schema.json',
    rationale: 'Contrat public de détail produit ; filtre explicitement les produits non exposables.',
  },
  'GET /api/providers-services/physical-offers/{id}': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/providers-services.js',
    rationale: 'Offre locale publique après contrôle serveur isPhysicalOfferExposable.',
  },
  'GET /api/providers-services/services/{id}': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/providers-services.js',
    rationale: 'Service local public après contrôle serveur isServiceExposable.',
  },
  'GET /api/relais': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/relais.js; features/logistics.feature.js',
    rationale: 'Annuaire public des points relais.',
  },
  'GET /api/relais/public': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/relais.js; features/logistics.feature.js',
    rationale: 'Projection publique des points relais.',
  },
  'GET /api/relais/{id}': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/relais.js; features/logistics.feature.js',
    rationale: 'Détail public d’un point relais.',
  },
  'POST /api/orders/quote-pdf': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/orders/create.js; services/public-cart-quote-service.js; tests/unit/public-cart-quote-service.test.js; tests/unit/cart-quote-pdf.test.js',
    rationale: 'Devis de panier non transactionnel et anonyme. Exposition et prix locaux contrôlés par le serveur, 1 à 30 lignes, zéro commande, zéro écriture persistée, globalLimiter et cache no-store. Même route JSON (aperçu) ou PDF (partage), jamais un checkout.',
  },
  'POST /api/pricing/calculate': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/pricing.js',
    rationale: 'Calculateur de prix public ; pas de mutation d’autorité métier.',
  },
  'POST /api/pricing/couture': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/pricing.js',
    rationale: 'Calculateur couture public ; pas de mutation d’autorité métier.',
  },

  // ── Intégrations fournisseur / callbacks OAuth ────────────────────────────
  'GET /api/integrations/aliexpress/oauth/callback': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/integrations-aliexpress.js; tests/unit/aliexpress-oauth.test.js; features/catalog.feature.js',
    rationale: 'Callback OAuth AliExpress sans session Express : le state CSPRNG est lié au navigateur par cookie HttpOnly/SameSite, comparé en temps constant puis effacé avant échange du code.',
  },

  // ── Capabilities / partage ────────────────────────────────────────────────
  'GET /api/orders/retrait/{token}': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/orders/qr.js; tests/unit/qr.test.js; features/orders.feature.js',
    rationale: 'Page de retrait publique protégée par un token capability généré côté serveur et validé avant lecture.',
  },
  'GET /api/shares/{token}': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/shares.js; tests/unit/shares-token-entropy.test.js',
    rationale: 'Snapshot non transactionnel adressé par token CSPRNG ; aucun paiement ni lifecycle métier n’est exposé.',
  },
  'POST /api/shares': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/shares.js; middleware/rate-limit.js; tests/unit/shares-token-entropy.test.js',
    rationale: 'Création publique d’un snapshot non transactionnel, rate-limitée, avec token CSPRNG.',
  },
  'GET /api/tracking/{token}': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/tracking.js; tests/unit/tracking.test.js; features/logistics.feature.js',
    rationale: 'Tracking public par capability token ; données client minimisées/masquées.',
  },
  'POST /api/tracking/{token}/verify-pickup': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/tracking.js; tests/unit/tracking.test.js; features/logistics.feature.js',
    rationale: 'Capability token de tracking + vérification du secret de retrait hashé ; pas d’autorité par session implicite.',
  },

  // ── Paiements publics nécessaires au navigateur ──────────────────────────
  'GET /api/payments/config': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/payments.js; features/payments.feature.js',
    rationale: 'Expose uniquement la configuration/les clés publiables nécessaires au checkout navigateur.',
  },
  'POST /api/payments/paypal/create-order': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/payments-paypal.js; tests/unit/payments-paypal.test.js; features/payments.feature.js',
    rationale: 'Étape PayPal du checkout navigateur ; l’autorité montant/commande est résolue côté serveur, pas depuis le client.',
  },
  'POST /api/payments/paypal/capture/{paypalOrderId}': {
    kind: 'CAPABILITY_TOKEN',
    evidence: 'routes/payments-paypal.js; tests/unit/payments-paypal.test.js; features/payments.feature.js',
    rationale: 'Capture liée à un ordre PayPal opaque et réconciliée côté serveur ; l’identifiant PayPal sert de capacité.',
  },
  'GET /api/payments/mobile-money/availability': {
    kind: 'EXPECTED_PUBLIC',
    evidence: 'routes/payments-mobile-money.js; services/payment-mobile-money.js; features/payments.feature.js',
    rationale: 'Expose uniquement la disponibilité commerciale du provider résolu serveur pour un code marché ; aucun secret, montant de commande ou identifiant client.',
  },
  'POST /api/payments/mobile-money/callback/{provider}/{transactionId}': {
    kind: 'APPLICATION_GUARD',
    evidence: 'routes/payments-mobile-money.js; services/payment-mobile-money.js; tests/unit/payment-mobile-money.test.js',
    rationale: 'Endpoint transport opérateur sans session : le body reçu n’accorde aucune autorité ; Komerce relit obligatoirement le statut, le montant et la devise auprès du provider avant toute confirmation canonique.',
  },
  'POST /api/payments/mobile-money/webhook/{provider}': {
    kind: 'APPLICATION_GUARD',
    evidence: 'routes/payments-mobile-money.js; services/mobile-money/kartapay-km.js; tests/unit/kartapay-webhook.test.js; features/payments.feature.js',
    rationale: 'Webhook gateway public au niveau transport mais authentifié par HMAC-SHA256 KartaPay, rapproché à la tentative locale puis relu par API provider authentifiée avant toute confirmation canonique.',
  },

  // ── Santé publique ────────────────────────────────────────────────────────
  'GET /health': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/health.js',
    rationale: 'Liveness public sans secret métier.',
  },
  'GET /health/ready': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/health.js',
    rationale: 'Readiness public pour l’orchestrateur.',
  },
  'GET /health/version': {
    kind: 'EXPECTED_PUBLIC', evidence: 'routes/health.js',
    rationale: 'Version applicative publique utilisée par les probes/outils de diagnostic.',
  },

  // ── Webhook Meta : public au niveau transport, authentifié applicativement ─
  'GET /webhook/meta-whatsapp': {
    kind: 'APPLICATION_GUARD',
    evidence: 'routes/meta-whatsapp.js; tests/unit/meta-whatsapp.test.js',
    rationale: 'Handshake Meta vérifié par META_WA_VERIFY_TOKEN ; un mauvais token reçoit 403.',
  },
  'POST /webhook/meta-whatsapp': {
    kind: 'APPLICATION_GUARD',
    evidence: 'routes/meta-whatsapp.js; bootstrap/env.js; tests/unit/meta-whatsapp.test.js',
    rationale: 'Signature X-Hub-Signature-256 HMAC-SHA256 vérifiée en temps constant ; secret obligatoire en production.',
  },
});

function validateDispositions() {
  const errors = [];
  for (const [key, value] of Object.entries(DISPOSITIONS)) {
    if (!/^(GET|POST|PUT|PATCH|DELETE) \//.test(key)) errors.push(`${key}: clé METHOD /path invalide`);
    if (!value || !ALLOWED_KINDS.has(value.kind)) errors.push(`${key}: kind invalide`);
    if (!value?.evidence || String(value.evidence).trim().length < 5) errors.push(`${key}: evidence manquante`);
    if (!value?.rationale || String(value.rationale).trim().length < 20) errors.push(`${key}: rationale insuffisante`);
  }
  return errors;
}

function getDisposition(key) {
  return DISPOSITIONS[key] || null;
}

module.exports = {
  ALLOWED_KINDS,
  DISPOSITIONS,
  getDisposition,
  validateDispositions,
};