'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content, 'utf8');
}

function insertAfter(content, anchor, line, label) {
  if (content.includes(line)) return content;
  if (!content.includes(anchor)) {
    throw new Error(`Lot 7: ancre introuvable pour ${label}`);
  }
  return content.replace(anchor, `${anchor}\n${line}`);
}

function requireExactlyOnce(content, needle, label) {
  const count = content.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`Lot 7: ${label} attendu exactement une fois, trouvé ${count}`);
  }
}

// ── auth-identity : nouvelle preuve REAL_DB + déduplication d'une couture
// wallet répétée par les anciens one-shots Lot 6. ───────────────────────────
const authPath = 'features/auth-identity.feature.js';
let auth = read(authPath);
const walletConsume = "      'wallet (composition frontend Mon Komerce uniquement — public/boutique/js/b-komerce.js délègue le rendu du bloc wallet à b-wallet.js, sans mutation ni ownership du solde)',";
let walletSeen = false;
auth = auth
  .split(/\r?\n/)
  .filter((line) => {
    if (line !== walletConsume) return true;
    if (walletSeen) return false;
    walletSeen = true;
    return true;
  })
  .join('\n');
auth = insertAfter(
  auth,
  "      'tests/unit/pickup-authorization-service.test.js',",
  "      'tests/e2e-api/auth-identity.pickup-authorization-staging.e2e.test.js',",
  'preuve staging auth-identity'
);
requireExactlyOnce(auth, walletConsume, 'consommation auth-identity → wallet');
requireExactlyOnce(
  auth,
  "      'tests/e2e-api/auth-identity.pickup-authorization-staging.e2e.test.js',",
  'preuve staging auth-identity'
);
write(authPath, `${auth.replace(/\s+$/, '')}\n`);

// ── logistics : rattache la preuve de course code/nom au propriétaire de la
// remise atomique. ──────────────────────────────────────────────────────────
const logisticsPath = 'features/logistics.feature.js';
let logistics = read(logisticsPath);
logistics = insertAfter(
  logistics,
  "      'tests/unit/pickup-secret-service.test.js',",
  "      'tests/e2e-api/orders.pickup-code-vs-authorized-name.e2e.test.js',",
  'preuve de course code/nom logistics'
);
requireExactlyOnce(
  logistics,
  "      'tests/e2e-api/orders.pickup-code-vs-authorized-name.e2e.test.js',",
  'preuve de course code/nom logistics'
);
write(logisticsPath, `${logistics.replace(/\s+$/, '')}\n`);

// ── dashboard : rattache le test jsdom au module relais legacy effectivement
// propriétaire de la surface opérateur. Les chemins dashboard sont relatifs à
// public/, conformément aux autres entrées de ce manifeste. ────────────────
const dashboardPath = 'features/dashboard.feature.js';
let dashboard = read(dashboardPath);
dashboard = insertAfter(
  dashboard,
  "      'tests/unit/relay-dashboard-route.test.js',",
  "      'dashboards/tests/unit/pickup-exceptional-flow.test.js',",
  'preuve UI relais dashboard'
);
requireExactlyOnce(
  dashboard,
  "      'dashboards/tests/unit/pickup-exceptional-flow.test.js',",
  'preuve UI relais dashboard'
);
write(dashboardPath, `${dashboard.replace(/\s+$/, '')}\n`);

console.log('Lot 7: manifests réconciliés, couture wallet dédupliquée et preuves rattachées.');
