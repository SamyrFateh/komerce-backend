'use strict';

require('dotenv').config();

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SHARED_CART_WEBHOOK_SECRET',
  'STRIPE_COLLECTIVE_WEBHOOK_SECRET',
  'QR_SECRET',
];

const RECOMMENDED_ENV = [
  'ADMIN_PASSWORD',
  'META_WA_APP_SECRET',
];

const missingRequired = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missingRequired.length > 0) {
  for (const key of missingRequired) {
    console.error(`❌ FATAL: ${key} manquant — impossible de démarrer`);
  }
  process.exit(1);
}

for (const key of RECOMMENDED_ENV) {
  if (!process.env[key]) {
    console.warn(`⚠️  ${key} non défini — à configurer avant la prod si le module associé est activé`);
  }
}
