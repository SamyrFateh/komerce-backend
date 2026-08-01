'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function replaceInFile(filePath, search, replacement, label) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(search)) {
    if (content.includes(replacement)) return false;
    throw new Error(`Lot 6: marqueur introuvable pour ${label}`);
  }
  content = content.replace(search, replacement);
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

const schemaPath = path.join(root, 'docs', 'SCHEMA.md');
let doc = fs.readFileSync(schemaPath, 'utf8');

function replaceRequired(search, replacement, label) {
  if (!doc.includes(search)) {
    if (doc.includes(replacement)) return;
    throw new Error(`Lot 6: marqueur introuvable pour ${label}`);
  }
  doc = doc.replace(search, replacement);
}

replaceRequired('| Tables | 96 |', '| Tables | 115 |', 'compte tables live');
replaceRequired('| Vues | 16 |', '| Vues | 18 |', 'compte vues live');
replaceRequired('| ENUMs | 14 |', '| ENUMs | 16 |', 'compte ENUM live');
replaceRequired('| Triggers | 31 |', '| Triggers | 37 |', 'compte triggers live');

replaceRequired('### 4.4 Paiements et finance (9 tables)', '### 4.4 Paiements et finance (10 tables)', 'titre paiements');
const transactionDocumentsRow = '| `transaction_documents` | Documents transactionnels hors facture : reçu remboursement (`refund_receipt`), reçu contribution panier partagé (`contribution_receipt`), reçu wallet (`wallet_receipt`), preuve retrait (`pickup_proof`), bon fournisseur (`purchase_order`), **facture douane classifiée** (`customs_invoice` — migration 093, Lot B keystone douane). Idempotence UNIQUE(document_type, subject_type, subject_id). Séquences dédiées : `refund_receipt_seq`, `wallet_receipt_seq`, `pickup_proof_seq`, `customs_invoice_seq`. |';
const outboxRow = '| `outbox_events` | **Résidu live vérifié, non canonique** créé par l’ancienne preuve d’intégration `r6-crash-window.test.js`. Aucun runtime ne le consomme. La migration 122 le supprime après confirmation d’absence d’usage et le test utilise désormais une table temporaire de session. |';
if (!doc.includes(outboxRow)) {
  replaceRequired(transactionDocumentsRow, `${transactionDocumentsRow}\n${outboxRow}`, 'outbox_events');
}

const productRows = [
  '| `product_content_profile` | Profil éditorial 1:1 par produit : marque, description courte et provenance globale. Migration 111, **vérifiée live le 2026-08-01**. Cible de promotion depuis `normalized_source_contract` V2, jamais depuis `raw_payload`. |',
  '| `product_content_sections` | Sections éditoriales structurées et blocs materials/care/warnings. UNIQUE(`product_id`, `section_key`) pour une ré-promotion idempotente. Migration 111, **vérifiée live le 2026-08-01**. |',
  '| `product_attributes` | Attributs structurés : highlights et specifications. UNIQUE(`product_id`, `kind`, `group_key`, `attribute_key`). Migration 111, **vérifiée live le 2026-08-01**. |',
];
for (const name of ['product_content_profile', 'product_content_sections', 'product_attributes']) {
  const pending = new RegExp(`\\n?<!-- schema-pending\\s+object: ${name}\\b[\\s\\S]*?-->\\n?`, 'm');
  doc = doc.replace(pending, '\n');
}
if (!doc.includes(productRows[0])) {
  replaceRequired('\n\n### 4.6 Paniers partagés', `\n${productRows.join('\n')}\n\n### 4.6 Paniers partagés`, 'tables contenu produit');
}

replaceRequired('### 4.8 Pricing et économie (14 tables)', '### 4.8 Pricing et économie (18 tables)', 'titre pricing');
const pricingAuditRow = '| `pricing_matrices_audit` | Audit matrices. |';
const hiddenAuditRow = '| `pricing_matrices_audit_hidden` | **Résidu live vérifié, non canonique** laissé par l’ancienne preuve REAL_DB `txg01-pricing-matrices.test.js`, qui renommait la table publique. La migration 122 fusionne les éventuelles lignes dans `pricing_matrices_audit`, restaure les noms canoniques et supprime cette table. |';
if (!doc.includes(hiddenAuditRow)) {
  replaceRequired(pricingAuditRow, `${pricingAuditRow}\n${hiddenAuditRow}`, 'pricing_matrices_audit_hidden');
}

replaceRequired('### 4.12 Utilisateurs et fidélité (6 tables)', '### 4.12 Utilisateurs et fidélité (7 tables)', 'titre identité');
const otpRow = '| `otp_codes` | Codes OTP. |';
const authorizationRow = '| `user_pickup_authorizations` | Autorisation nominative exceptionnelle active du compte. Une ligne par utilisateur, versionnée et révocable ; consultée au moment exact de la remise. Ne contient aucune donnée de pièce d’identité. Migration 121, **vérifiée live le 2026-08-01**. |';
if (!doc.includes(authorizationRow)) {
  replaceRequired(otpRow, `${otpRow}\n${authorizationRow}`, 'user_pickup_authorizations');
}

fs.writeFileSync(schemaPath, doc, 'utf8');

const platformOpsPath = path.join(root, 'features', 'platform-ops.feature.js');
replaceInFile(
  platformOpsPath,
  "  files: {\n    compositionRoots:",
  "  files: {\n    migrations: [\n      // Lot 6 : nettoyage conservatif de deux résidus DDL laissés par des\n      // preuves REAL_DB historiques ; aucune nouvelle capacité métier.\n      'migrations/122_cleanup_realdb_test_schema_residue.sql',\n    ],\n    compositionRoots:",
  'ownership migration 122'
);
replaceInFile(
  platformOpsPath,
  "      tests: [\n      'tests/integration/api.test.js',",
  "      tests: [\n      'tests/integration/r6-crash-window.test.js',\n      'tests/integration/api.test.js',",
  'ownership test R6'
);

const economicPath = path.join(root, 'features', 'economic-engine.feature.js');
replaceInFile(
  economicPath,
  "        tests: [\n      'tests/unit/admin-cost-components.test.js',",
  "        tests: [\n      'tests/integration/txg01-pricing-matrices.test.js',\n      'tests/unit/admin-cost-components.test.js',",
  'ownership test TXG-01'
);

const authIdentityPath = path.join(root, 'features', 'auth-identity.feature.js');
replaceInFile(
  authIdentityPath,
  "      'notifications (services/notification-service.js — envoi OTP/alertes depuis routes/client-auth.js, routes/otp.js)',\n",
  "      'notifications (services/notification-service.js — envoi OTP/alertes depuis routes/client-auth.js, routes/otp.js)',\n      'wallet (composition frontend Mon Komerce uniquement — public/boutique/js/b-komerce.js délègue le rendu du bloc wallet à b-wallet.js, sans mutation ni ownership du solde)',\n",
  'déclaration auth-identity vers wallet'
);

const exceptionsPath = path.join(root, 'governance', 'feature-dependency-exceptions.json');
const exceptionsDoc = JSON.parse(fs.readFileSync(exceptionsPath, 'utf8'));
if (!exceptionsDoc.exceptions.some((entry) => entry.from === 'auth-identity' && entry.to === 'wallet')) {
  exceptionsDoc.exceptions.push({
    from: 'auth-identity',
    to: 'wallet',
    decision: 'accepted-dependency',
    rationale: 'Mon Komerce est la surface frontend canonique du compte. Elle compose en lecture la vue wallet possédée par wallet via renderWalletView(), sans calculer le solde, modifier les lots ni déplacer l’autorité métier.',
    scope: [
      'public/boutique/js/b-komerce.js -> public/boutique/js/b-wallet.js / renderWalletView',
    ],
    reviewTrigger: 'Extraire un contrat frontend dédié si Mon Komerce commence à muter le wallet, à interpréter ses lots ou si plusieurs surfaces répliquent cette composition.',
  });
  fs.writeFileSync(exceptionsPath, `${JSON.stringify(exceptionsDoc, null, 2)}\n`, 'utf8');
}

if (process.env.LOT6_POST_CLEANUP === '1') {
  let target = fs.readFileSync(schemaPath, 'utf8');
  target = target
    .replace('| Tables | 115 |', '| Tables | 113 |')
    .replace('### 4.4 Paiements et finance (10 tables)', '### 4.4 Paiements et finance (9 tables)')
    .replace(`\n${outboxRow}`, '')
    .replace('### 4.8 Pricing et économie (18 tables)', '### 4.8 Pricing et économie (17 tables)')
    .replace(`\n${hiddenAuditRow}`, '');
  fs.writeFileSync(schemaPath, target, 'utf8');
  console.log('Lot 6: projection post-migration 122 générée pour les gates.');
}

console.log('Lot 6: schéma vivant, ownerships et disposition auth-identity→wallet réconciliés.');
