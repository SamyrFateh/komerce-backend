/**
 * @feature       infrastructure
 * @type          transversal
 * @domain        infrastructure
 * @status        production
 * @owner         backend
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine transversal
 * "infrastructure". Couvre les fichiers consommés par toutes les features
 * mais qui ne relèvent d'aucun domaine métier : middleware non-auth,
 * utilitaires partagés, validators, bootstrap applicatif.
 *
 * Créé le 2026-07-01 pour fermer le TROU 3 de l'audit gouvernance :
 * 19 fichiers étaient exemptés dans ORPHAN_IGNORE sans feature owner.
 */
'use strict';

module.exports = {

  name:     'infrastructure',
  nature:   'feature',   // feature | capability | governance-unit
  type:     'transversal',
  domain:   'infrastructure',
  status:   'production',
  owner:    'backend',

  // ── Classification d'ontologie (arbitrage 2026-07-29) ────────────────────
  // `axis` est la SEULE source de la binarité business/support. `type` est un
  // champ historique de topologie et ne doit jamais servir à la dériver.
  classification: {
    axis:     'support',   // business | support
    kind:     'technical-foundation',
    rationale: [
      'Socle technique pur (arbitrage B, 2026-07-29). Les écritures runtime constatées sur finance_config / charges / economic_snapshots ont été re-scopées vers economic-engine, users vers auth-identity, business_rules vers la feature business-rules. Ne subsistent que des écritures technical-writer (DDL de démarrage, crons d\'orchestration).',
      'technical-foundation est distinct de technical-transversal : ce socle possède explicitement le bootstrap, les migrations/DDL techniques et les primitives d’exécution partagées, sans posséder de vérité métier ni décider un cycle de vie métier.',
    ],
  },
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Infrastructure transversale consommée par toutes les features : middleware non-auth (error-handler, rate-limit, request-id, upload, validate), utilitaires partagés (logger, phone, rates, reference, rules), barrel de validation Joi, et bootstrap applicatif (Express, routes, crons, env, sécurité, migrations startup).",

  perimeter: {
    in:  ['middleware non-auth', 'utils transversaux', 'validators', 'bootstrap'],
    out: ['middleware auth (feature auth)', 'services métier', 'logique backend spécifique'],
  },

  files: {
    middleware: [
      'middleware/error-handler.js',
      'middleware/rate-limit.js',
      'middleware/request-id.js',
      'middleware/require-non-production.js',
      'middleware/upload.js',
      'middleware/validate.js',
    ],
    utils: [
      'utils/logger.js',
      'utils/phone.js',
      'utils/rates.js',
      'utils/reference.js',
      // utils/rules.js — transféré à la feature business-rules (arbitrage B, 2026-07-29)
    ],
    validators: [
      'validators/index.js',
    ],
    bootstrap: [
      'bootstrap/feature-wiring.js',
      'bootstrap/api-routes.js',
      'bootstrap/boot-guard.js',
      'bootstrap/crons.js',
      'bootstrap/env.js',
      'bootstrap/html-routes.js',
      'bootstrap/security.js',
      'bootstrap/server-lifecycle.js',
      'bootstrap/startup-migrations.js',
    ],
    migrations: [
      'migrations/_superseded/RECONCILIATION_PROD.sql',
      'migrations/016_add_missing_indexes.sql',
      'migrations/018_schema_reconciliation.sql',
      'migrations/069_analytical_indexes.sql',
      'migrations/072_jwt_revocation.sql',
      'migrations/084_jwt_revocation.sql',
      'migrations/AUD-10_rename_tracking_fix.sql',
      'migrations/deploy-all.sql',
    ],
    scripts: [
      'scripts/.boutique-360-baseline.json',
      'scripts/.dashboards-360-baseline.json',
      'scripts/.docs-history-lint-baseline.json',
      'scripts/.feature-schema-tests-baseline.json',
      'scripts/.meta-graph-baseline.json',
      'scripts/.security-360-baseline.json',
      'scripts/analyze-boutique-css.mjs',
      'scripts/apply-komerce-arch-headers-phase2.js',
      'scripts/apply-komerce-arch-headers-phase3.js',
      'scripts/apply-komerce-arch-headers.js',
      'scripts/apply-komerce-arch-total-coverage.js',
      'scripts/arch-db-check.js',
      'scripts/arch-debt-budget.json',
      'scripts/arch-doctrine-sanitize-check.js',
      'scripts/arch-header-sql-check.js',
      'scripts/arch-reconcile.js',
      'scripts/arch-schema-drift-check.js',
      'scripts/audit-backend-arch.js',
      'scripts/audit-komerce-arch-headers.js',
      'scripts/audit-sourcing.js',
      'scripts/backfill-boot-data.js',
      'scripts/boutique-ownership-check.js',
      'scripts/boutique-ownership-full-check.js',
      'scripts/check-boutique-doc-ack.js',
      'scripts/check-boutique.mjs',
      'scripts/check-no-market-id-mutation.js',
      'scripts/check-schema-freshness.js',
      'scripts/schema-sync-summary.js',
      'scripts/ci-migrate.js',
      'scripts/ci-probe-token.js',
      'scripts/code-quality-gate.js',
      'scripts/contract-check.js',
      'scripts/contract-generate.js',
      'scripts/db-snapshot.js',
      'scripts/debt-audit.js',
      'scripts/docs-history-lint.js',
      'scripts/enrich-komerce-arch-db-fields.js',
      'scripts/f1-console-to-logger.js',
      'scripts/f1b-notification-logger-codemod.js',
      'scripts/feature-audit.js',
      'scripts/feature-classification-check.js',
      'scripts/feature-guard.js',
      'scripts/feature-invariant-check.js',
      'scripts/feature-memo.js',
      'scripts/feature-registry-check.js',
      'scripts/feature-schema-check.js',
      'scripts/fix-komerce-arch-links.js',
      'scripts/fix-schema.js',
      'scripts/gen-backend-arch-live.js',
      'scripts/gen-boutique-360.js',
      'scripts/gen-dashboards-360.js',
      'scripts/gen-meta-graph.js',
      'scripts/gen-security-360.js',
      'scripts/generate-komerce-arch-graph.js',
      'scripts/gov09-aud10-check.js',
      'scripts/h1a-wire-api-routes.js',
      'scripts/h1b-wire-html-routes.js',
      'scripts/h1c-wire-security.js',
      'scripts/h1d-wire-crons.js',
      'scripts/h1e-wire-env.js',
      'scripts/h1f-wire-startup-migrations.js',
      'scripts/h2-wire-server-lifecycle.js',
      'scripts/impact-check.js',
      'scripts/impact-suppression-check.js',
      'scripts/impact-config.json',
      'scripts/impact-suppressions.json',
      'scripts/komerce-db-reset.sh',
      'scripts/lib/arch-drift-core.js',
      'scripts/lib/npm-audit-core.js',
      'scripts/map-check.js',
      'scripts/migrate.js',
      'scripts/npm-audit-exceptions.json',
      'scripts/npm-audit-gate.js',
      'scripts/p0-runtime-check.js',
      'scripts/pr-governance-check.js',
      'scripts/predeploy-gate.js',
      'scripts/refine-komerce-arch-quality.js',
      'scripts/refresh-schema.js',
      'scripts/refresh-schema.sh',
      'scripts/reset-admin.js',
      'scripts/run-migrations.js',
      'scripts/run-integration-tests.js',
      'scripts/run-security-360.js',
      'scripts/seed.js',
      'scripts/setup-hooks.sh',
      'scripts/test-settings-api.sh',
      'scripts/test_e2e_full.sh',
      'scripts/touched-files-feature-gate.js',
      'scripts/touched-tests-gate.js',
      'scripts/validate-required-env.js',
      'audit-backend-arch.js',
    ],
    docs: [
      'AGENTS.md',
      'AUDIT_FEATURE_DOCTRINE.md',
      'CONTRIBUTING.md',
      'PROCEDURE.md',
      'README.md',
      'docs/BOUTIQUE_360.json',
      'docs/BOUTIQUE_360.md',
      'docs/BRAND_TRUTH_KOMERCE.md',
      'docs/CABLAGE.md',
      'docs/CARTE_FIRST_INDEX.md',
      'docs/CARTOGRAPHY_360.md',
      'docs/CONTRACTS.md',
      'docs/DECOUPAGE.md',
      'docs/FIX_ERROR_HANDLER_22P02.md',
      'docs/KOMERCE_ARCHITECTURE_HEADERS.md',
      'docs/KOMERCE_ARCHITECTURE_MAP.md',
      'docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md',
      'docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md',
      'docs/KOMERCE_ARCH_HEADER_AUDIT.md',
      'docs/KOMERCE_ARCH_HEADER_GRAPH.md',
      'docs/KOMERCE_DB_SCHEMA_DOCTRINE.md',
      'docs/KOMERCE_DB_TOUCHPOINTS_MAP.md',
      'docs/META_GRAPH.json',
      'docs/META_GRAPH.md',
      'docs/README.md',
      'docs/TEST_CERTIFICATION.md',
      'docs/ROLLBACK_PLAN.md',
      'docs/RUNBOOK_DEBLOCAGE_HOOKS.md',
      'docs/SCHEMA.md',
      'docs/SECURITY_360.json',
      'docs/SECURITY_360.md',
      'docs/SECURITY_360_METHODE.md',
      'docs/ZONE_IMPACT.md',
      'docs/backend/ARCHI_DECOUPAGE_MODULAIRE.md',
      'docs/backend/BACKEND_AUDIT.md',
      'docs/backend/BACKEND_AUDIT_CORRECTIONS.md',
      'docs/backend/BACKEND_AUDIT_SESSIONS_PLAN.md',
      'docs/backend/BACKEND_GOLIVE_ROADMAP.md',
      'docs/backend/SECURITY-MODEL.md',
      'docs/contract/DEBT.md',
      'docs/contract/openapi.json',
      'docs/db/railway-live-schema.sql',
      'docs/doctrine/APP_FEATURE_REGISTRY.md',
      'docs/doctrine/BACKEND_FEATURE_REGISTRY.md',
      'docs/doctrine/CERTIFICATION_DOCTRINE_FEATURE.md',
      'docs/doctrine/DECISIONS_ARCHI_GROUPE_C.md',
      'docs/doctrine/FEATURE_DOCTRINE.md',
      'docs/doctrine/FEATURE_SLICE_DOCTRINE.md',
      'docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md',
      'docs/komerce-arch-header-audit.json',
      'docs/komerce-arch-header-graph.json',
      'docs/komerce-architecture-map.json',
      'docs/ops/DEPLOYMENT.md',
      'docs/ops/DEPLOY_GUIDE_V2.md',
      'docs/ops/PLAN_LANCEMENT_OPERATIONNEL.md',
      'docs/ops/SYNOPTIQUE_KOMERCE.md',
      'docs/ops/komerce_architecture.mmd',
      'docs/specs/TEST_CHECKLIST_KOMERCE.md',
      'docs/vision/BRAND_TRUTH_v8.md',
      'docs/vision/VISION_MARCHE_KOMERCE.md',
    ],
    ci: [
      '.github/CODEOWNERS',
      '.github/workflows/railway-prod-unblock.yml',
      '.github/copilot-instructions.md',
      '.github/pull_request_template.md',
      // Workflows ACTIFS — GitHub Actions ne charge que `.github/workflows/`.
      '.github/workflows/ci.yml',
      '.github/workflows/pr-enforcement.yml',
      '.github/workflows/staging-discovery-ops.yml',
      '.github/workflows/showcase-v2-media-realism.yml',
      '.github/workflows/schema-refresh.yml',
      // Workflows EN PAUSE (revue gouvernance CI/CD 2026-08-14, cf.
      // `.github/workflows-disabled/README.md`) : conservés dans Git mais
      // inactifs, réactivés individuellement après revue (chantier CI cible :
      // fast local → scoped merge enforcement → heavy certification).
      // Déclarés à leur emplacement RÉEL pour rester possédés — ni faux
      // « absent du disque », ni orphelins.
      '.github/workflows-disabled/README.md',
      '.github/workflows-disabled/apply-komerce-arch-headers.yml',
      '.github/workflows-disabled/carte-first.yml',
      '.github/workflows-disabled/ci-full-gated.yml',
      '.github/workflows-disabled/contract-conformance.yml',
      '.github/workflows-disabled/contract.yml',
      '.github/workflows-disabled/docs-guard.yml',
      '.github/workflows-disabled/e2e-boutique.yml',
      '.github/workflows-disabled/e2e.yml',
      '.github/workflows-disabled/generate-komerce-arch-graph.yml',
      '.github/workflows-disabled/governance.yml',
      '.github/workflows-disabled/impact-check.yml',
      '.github/workflows-disabled/lot7-finalize-governance-once.yml',
      '.github/workflows-disabled/lot7-staging-business-qualification.yml',
      '.github/workflows-disabled/lot8-pre-go-live-certification.yml',
      '.github/workflows-disabled/lot8-reconcile-current-main-once.yml',
      '.github/workflows-disabled/pr-governance.yml',
    ],
    assets: [
      'public/images/Komerce_Kero_Desktop_2.png',
      'public/images/Logo_Komerce.png',
      'public/images/Logo_Komerce@2x.png',
      'public/images/Logo_Komerce_white.png',
      'public/images/apple-touch-icon.png',
      'public/images/avatar_panier.png',
      'public/images/avatar_seule.png',
      'public/images/categories/cat-beaute.jpg',
      'public/images/categories/cat-beaute.svg',
      'public/images/categories/cat-couture.jpg',
      'public/images/categories/cat-couture.svg',
      'public/images/categories/cat-enfant.jpg',
      'public/images/categories/cat-enfant.svg',
      'public/images/categories/cat-mode.jpg',
      'public/images/categories/cat-mode.svg',
      'public/images/categories/cat-tech.jpg',
      'public/images/categories/cat-tech.svg',
      'public/images/categories/cat-tout.jpg',
      'public/images/categories/cat-tout.svg',
      'public/images/favicon-16.png',
      'public/images/favicon-192.png',
      'public/images/favicon-32.png',
      'public/images/favicon.ico',
      'public/images/icon-192.png',
      'public/images/icon-512.png',
      'public/images/panier_africain.png',
      'public/images/panier_africain_sm.png',
      'public/images/panier_tresse.png',
      'public/images/panier_tresse_vert.png',
    ],
    db: [
      'db/migrations/004_fix_order_status_enum.sql',
      'db/migrations/005_add_in_transit_status.sql',
      'db/migrations/006_dashboard_columns.sql',
      'db/migrations/007_business_rules.sql',
      'db/migrations/008_pricing_rules.sql',
      'db/migrations/009_partial_shipping.sql',
      'db/migrations/010_parcels_foundation.sql',
      'db/migrations/011_parcels_dual_write.sql',
      'db/migrations/012_parcels_trigger_migration.sql',
      'db/migrations/013_legacy_cleanup.sql',
      'db/migrations/014_transaction_documents.sql',
      'db/migrations/083_transaction_documents.sql',
      'db/schema.sql',
      'db/schema_extension.sql',
      'db/seed-products-v2.json',
      'db/seed.sql',
    ],
    // server.js est aussi déclaré ici (D2, 2026-07-29) : les 5 endpoints
    // ci-dessous (exposes) sont montés inline directement sur `app` dans
    // server.js, pas via un routeur monté séparément — FF-D2 a besoin de
    // le trouver dans un groupe "routes" pour rattacher ces endpoints.
    routes: [
      'server.js',
    ],
    config: [
      'db.js',
      'server.js',
      '.cursorrules',
      '.env.example',
      '.gitattributes',
      '.gitignore',
      '.nvmrc',
      'jest.config.js',
      'jest.unit.config.js',
      'package-lock.json',
      'package.json',
      'railway.toml',
    ],
    tests: [
      'tests/integration/groupe-paiement.manual.js',
      'tests/integration/test-harness/mock-db.js',
      'tests/test-benchmarks.js',
      'tests/test-chain.js',
      'tests/test-flow-contract.js',
      'tests/unit/error-handler-fallback.test.js',
      'tests/unit/error-handler.test.js',
      'tests/unit/logger.test.js',
      'tests/unit/npm-audit-core.test.js',
      'tests/unit/order-parcel-link-rules.test.js',
      'tests/unit/phone.test.js',
      'tests/unit/rate-limit.test.js',
      'tests/unit/db.test.js',
      'tests/unit/rates.test.js',
      'tests/unit/reference.test.js',
      'tests/unit/request-id.test.js',
      'tests/unit/schema-sync-summary.test.js',
      // tests/unit/rules-engine.test.js — transféré à business-rules (arbitrage B)
      'tests/unit/upload.test.js',
    ],
  },

  // ── Tables DB (inféré, audit 2026-07-06, §axe2) ─────────────────────────
  // Généré par parsing réel des appels .query() (pas un grep de mots) :
  // R = lu par cette feature, W = écrit par cette feature, RW = les deux.
  // Une table listée ici pour PLUSIEURS features est une vraie propriété
  // partagée détectée dans le code, pas un artefact de méthode — à
  // documenter explicitement si volontaire, ou à re-scoper sinon.
  // Champ auto-généré : à corriger à la main si une requête dynamique
  // (nom de table construit par variable) a échappé au scan.
  db: {
    tables: [
      // business_rules — retiré : propriété business-rules (arbitrage B) — feature scindée le 2026-07-29
      // business_rules_history — retiré : propriété business-rules (arbitrage B)
      // charges — retiré : propriété economic-engine (arbitrage B)

      'economic_snapshots: W~',   // technical-writer : bootstrap/crons.js planifie le snapshot, economic-engine le calcule et le possède
      // finance_config — retiré : propriété economic-engine (arbitrage B). Écriture runtime constatée : services/pricing-rates.js, routes/admin-finance-config.js, routes/admin-costing.js — toutes economic-engine
      'pickup_print_tokens: W~',   // technical-writer : purge planifiée (bootstrap/crons.js). Propriétaire : logistics
      'pickup_reveal_codes: W~',   // technical-writer : purge planifiée (bootstrap/crons.js). Propriétaire : logistics
      'revoked_tokens: W~',   // technical-writer : purge planifiée. Propriétaire : auth-identity (arbitrage A)
      // schema_migrations : écrit par scripts/run-migrations.js (runner CI/deploy).
      // Ce fichier est hors des SCAN_ROOTS du générateur de graphe (scripts/ non
      // scanné), donc invérifiable par header — c'est un angle mort de l'outil,
      // pas une fausse déclaration. Vérifié manuellement le 2026-07-07.
      'schema_migrations: W',   // technical-writer : DDL versionné, aucune décision métier
      // users — retiré : propriété auth-identity (arbitrage A)
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 2,
    totalRoutes: 5,
    note: "3 routes publiques par design : GET /health, /health/ready, /health/version (sondes Railway/uptime, pas de données sensibles). GET /api/public/config public par design (clés publiques Stripe/PayPal). GET /*.html : routes HTML des dashboards, protégées par session côté client. Webhook authkey-whatsapp : vérifié par token WhatsApp (META_WA_VERIFY_TOKEN).",
  },
  contract: {
    // Ajouté (audit 2026-07-06, §axe1-bug2) : ces 5 routes sont câblées
    // directement sur `app` dans server.js (pas via un `router` local), ce
    // qui les rendait invisibles de scripts/gen-route-registry.js jusqu'à
    // correction du générateur. Elles existent et tournent en production
    // depuis avant cet audit — seule leur déclaration ici était manquante.
    // GET /api/public/config en particulier est consommée activement par
    // le paiement boutique (b-paypal.js, b-checkout.js) : voir komerce-boutique
    // features/payment.feature.js.
    exposes: [
      'GET /api/health',
      'GET /api/public/config',
      'GET /webhook/authkey-whatsapp',
      'GET /*.html',
    ],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : aucune de ces
    // entrées n'est une route HTTP — ce sont des exports JS internes consommés
    // par les features métier via require(), jamais via un client HTTP.
    internalApi: [
      'middleware/error-handler.js — gestion centralisée des erreurs Express',
      'middleware/rate-limit.js — rate limiting par IP/route',
      'middleware/request-id.js — injection X-Request-Id',
      'middleware/upload.js — multer file upload',
      'middleware/validate.js — validation Joi des requêtes',
      'utils/logger.js — wrapper pino structuré',
      'utils/phone.js — normalisation numéros téléphone Comores',
      'utils/rates.js — taux de change KMF/EUR',
      'utils/reference.js — génération de références commande/colis',
      'validators/index.js — barrel des schémas Joi',
      'bootstrap/* — démarrage Express, routage, crons, migrations',
    ],
    consumes: [
      'auth — bootstrap/api-routes.js monte les routes auth',
      'catalog — bootstrap/api-routes.js monte les routes catalog',
      'customs — bootstrap/api-routes.js monte les routes customs',
      'dashboard — bootstrap/api-routes.js monte les routes dashboard',
      'economic-engine — bootstrap/api-routes.js monte les routes economic-engine',
      'inventory — bootstrap/api-routes.js monte les routes inventory',
      'logistics — bootstrap/api-routes.js monte les routes logistics',
      'notifications — bootstrap/api-routes.js monte les routes notification',
      'platform-ops — bootstrap/api-routes.js monte les routes operations',
      'orders — bootstrap/api-routes.js monte les routes orders',
      'payments — bootstrap/api-routes.js monte les routes payment',
      'recommendations — bootstrap/api-routes.js monte les routes recommendations',
      'shared-cart — bootstrap/api-routes.js monte les routes shared-cart',
      'wallet — bootstrap/api-routes.js monte les routes wallet',
    ],
  },

  authority: 'backend — ces fichiers sont consommés par toutes les features. Tout changement ici a un impact potentiel global.',

  invariants: [
    'tout fichier middleware/ non-auth doit être listé ici',
    'tout fichier utils/ à @domain infrastructure doit être listé ici',
    'tout fichier bootstrap/ doit être listé ici',
    'validators/index.js est le barrel unique de validation',
  ],

};
