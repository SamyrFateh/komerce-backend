'use strict';

const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

function removeExact(path, fragment) {
  const content = read(path);
  if (!content.includes(fragment)) {
    throw new Error(`${path}: fragment absent: ${fragment.trim()}`);
  }
  write(path, content.replace(fragment, ''));
}

removeExact(
  'bootstrap/api-routes.js',
  "  const sharesRouter = require('../routes/shares');\n"
);
removeExact(
  'bootstrap/api-routes.js',
  "  app.use('/api/shares',     sharesRouter);\n"
);
removeExact(
  'features/shared-cart.feature.js',
  "      'routes/shares.js',\n"
);
removeExact(
  'features/shared-cart.feature.js',
  "      'tests/unit/shares-route.test.js',\n"
);

for (const obsolete of [
  'routes/shares.js',
  'tests/unit/shares-route.test.js',
]) {
  if (fs.existsSync(obsolete)) fs.rmSync(obsolete);
}

const ghosts = [
  'cart_contributions',
  'collective_contribution_status',
  'collective_payment_sessions',
  'collective_payment_tokens',
  'collective_session_status',
  'collective_stock_reservations',
  'collective_token_status',
  'collective_workspace_contributions',
  'collective_workspace_contributions_content_check',
  'collective_workspace_contributions_kind_check',
  'collective_workspace_events',
  'collective_workspace_items',
  'collective_workspace_status',
  'collective_workspaces',
  'shared_cart_contributions',
  'shared_cart_estimations',
  'v_group_orders',
];

const schemaPath = 'docs/SCHEMA.md';
let schema = read(schemaPath);
let lines = schema.split(/\r?\n/);
lines = lines.filter((line) => !ghosts.some((name) => line.includes(`\`${name}\``)));
schema = lines.join('\n');
schema = schema.replace(/, `pending_group_payment`/g, '');
schema = schema.replace(
  'Les valeurs `pending_group_payment` et `in_transit` ont été ajoutées via migrations 059 et `fixMissingSchema()` respectivement.',
  'La valeur `in_transit` a été ajoutée via migration et reste gouvernée par la machine d’état canonique.'
);

if (!schema.includes('`user_pickup_authorizations`')) {
  const anchor = '| `pickup_verify_attempts` | Anti-bruteforce de la vérification pickup : compteur par (`attempt_key`, `token`, `ip_hash`) avec fenêtre `reset_at`. Rate-limit multi-instance (remplace un compteur in-memory). |';
  if (!schema.includes(anchor)) {
    throw new Error('docs/SCHEMA.md: ancre pickup_verify_attempts absente');
  }
  const row = '| `user_pickup_authorizations` | Autorisation nominative exceptionnelle courante du compte, versionnée, sans donnée de pièce d’identité. |';
  schema = schema.replace(anchor, `${anchor}\n${row}`);
}

write(schemaPath, schema.replace(/\s*$/, '') + '\n');
console.log('Lot 8 domain cleanup applied.');
