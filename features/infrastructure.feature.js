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
  type:     'transversal',
  domain:   'infrastructure',
  status:   'production',
  owner:    'backend',
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
      'middleware/upload.js',
      'middleware/validate.js',
    ],
    utils: [
      'utils/logger.js',
      'utils/phone.js',
      'utils/rates.js',
      'utils/reference.js',
      'utils/rules.js',
    ],
    validators: [
      'validators/index.js',
    ],
    bootstrap: [
      'bootstrap/api-routes.js',
      'bootstrap/app.js',
      'bootstrap/crons.js',
      'bootstrap/env.js',
      'bootstrap/html-routes.js',
      'bootstrap/security.js',
      'bootstrap/server-lifecycle.js',
      'bootstrap/startup-migrations.js',
    ],
  },

  contract: {
    exposes: [
      'middleware/error-handler.js — gestion centralisée des erreurs Express',
      'middleware/rate-limit.js — rate limiting par IP/route',
      'middleware/request-id.js — injection X-Request-Id',
      'middleware/upload.js — multer file upload',
      'middleware/validate.js — validation Joi des requêtes',
      'utils/logger.js — wrapper pino structuré',
      'utils/phone.js — normalisation numéros téléphone Comores',
      'utils/rates.js — taux de change KMF/EUR',
      'utils/reference.js — génération de références commande/colis',
      'utils/rules.js — moteur de règles métier centralisé',
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
      'notification — bootstrap/api-routes.js monte les routes notification',
      'operations — bootstrap/api-routes.js monte les routes operations',
      'orders — bootstrap/api-routes.js monte les routes orders',
      'payment — bootstrap/api-routes.js monte les routes payment',
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
