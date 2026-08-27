'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, text) { fs.writeFileSync(file, text); }
function removeLineContaining(file, needle) {
  const lines = read(file).split('\n');
  const next = lines.filter(line => !line.includes(needle));
  if (next.length === lines.length) throw new Error(`${file}: residual not found: ${needle}`);
  write(file, next.join('\n'));
}
function replaceOnce(file, from, to) {
  const text = read(file);
  if (!text.includes(from)) throw new Error(`${file}: target not found: ${from.slice(0, 140)}`);
  write(file, text.replace(from, to));
}

// 1) auth -> orders : contradit explicitement le périmètre (auth ne connaît pas les commandes).
removeLineContaining('features/auth.feature.js', "'orders',");

// 2) dashboard -> recommendations : ancienne déclaration sans import/interface/data observé.
removeLineContaining('features/dashboard.feature.js', "'recommendations',");

// 3) economic-engine -> wallet : aucun canal observé ; le moteur n'appelle plus le wallet.
removeLineContaining('features/economic-engine.feature.js', "'wallet',");

// 4-7) incident-management : LOT9 a déjà remplacé les écritures SQL cross-feature
// par incident-write-service. Les producteurs consomment incident-management ;
// incident-management ne consomme pas ses producteurs.
removeLineContaining('features/incident-management.feature.js', "'payments (reconciliation-service écrit incidents — SQL inline)',");
removeLineContaining('features/incident-management.feature.js', "'notifications (alert-engine écrit incidents — SQL inline)',");
removeLineContaining('features/incident-management.feature.js', "'dashboard / ops-api legacy (écrit incidents — SQL inline)',");
replaceOnce(
  'features/incident-management.feature.js',
  "      'table incidents en écriture multi-domaines : logistics (scan-engine), payments (reconciliation-service), notifications (alert-engine), dashboard (ops-api legacy, SQL inline hors incident-service.js)',",
  "      'table incidents possédée par incident-management ; les producteurs cross-feature passent par incident-write-service.js',"
);
replaceOnce(
  'features/incident-management.feature.js',
  "    // CURRENT RUNTIME WRITERS / PRODUCERS — écrivent réellement dans la table\n    // incidents aujourd'hui, mais via SQL inline, pas via incident-service.js.",
  "    // Dépendances réelles de l'owner incident-management. Les producteurs\n    // externes appellent son API interne ; ils ne deviennent pas ses dépendances."
);
replaceOnce(
  'features/incident-management.feature.js',
  "    // TARGET CONSUMERS AFTER WIRING — état visé une fois la dette de câblage\n    // résolue (hors périmètre de ce lot, cf. debt.knownGaps).\n    targetConsumersAfterWiring: [\n      'logistics',\n      'payments',\n      'notifications',\n      'dashboard / ops-api',\n    ],\n",
  ''
);
replaceOnce(
  'features/incident-management.feature.js',
  "      multiConsumer:       true,  // table incidents écrite par logistics, payments, notifications, dashboard/ops-api legacy — Signal 4 transversal (écriture directe SQL, pas via incident-service.js — cf. debt.knownGaps)",
  "      multiConsumer:       true,  // API interne incident-write-service consommée par plusieurs domaines producteurs"
);
replaceOnce(
  'features/incident-management.feature.js',
  "      \"table incidents écrite symétriquement par 4 domaines distincts (scan-engine/logistics, reconciliation-service/payments, alert-engine/notifications, ops-api/dashboard) — Signal 4 de la doctrine ; câblage effectif via services/incident-service.js encore non fait (SQL inline actuellement, cf. debt.knownGaps)\",",
  "      \"API interne d'écriture consommée par plusieurs domaines producteurs ; la table incidents reste possédée et mutée derrière la boundary incident-management\","
);

// 8-10) logistics : anciennes intentions sans canal code/interface/data actuel.
removeLineContaining('features/logistics.feature.js', "'customs (statut declaration)',");
removeLineContaining('features/logistics.feature.js', "'economic-engine',");
removeLineContaining('features/logistics.feature.js', "'wallet',");

// 11) loyalty -> wallet : le manifest précise lui-même qu'aucune table wallet n'est lue.
removeLineContaining('features/loyalty.feature.js', "'wallet (aucune écriture — v_loyalty_summary et le calcul de palier ne lisent pas les tables wallet)',");

// 12) notifications : liste prose des producteurs entrants, pas une dépendance sortante canonique.
removeLineContaining('features/notifications.feature.js', "'toutes les features emettrices (orders, payments, shared-cart, refunds...) en entree evenementielle uniquement',");

// 13) orders -> dashboard : direction historique inversée ; dashboard consomme orders.
removeLineContaining('features/orders.feature.js', "'dashboard',");

// 14) recommendations -> auth : endpoint public par design, aucune garde ni autre preuve O5.
removeLineContaining('features/recommendations.feature.js', "'auth',");

// 15) refunds -> shared-cart : shared-cart est un appelant de refunds, pas une dépendance du service.
removeLineContaining('features/refunds.feature.js', "'shared-cart (panier source)',");
replaceOnce(
  'features/refunds.feature.js',
  "  service: 'Rembourser un client (wallet, cash, panier partage) de facon tracable et sans double remboursement.',",
  "  service: 'Rembourser un client de facon tracable et sans double remboursement, quel que soit le flux appelant.',"
);

// 16) wallet -> payments : payment-service.js est aujourd'hui une boundary orders ;
// O5 observe déjà wallet -> orders et aucune dépendance wallet -> payments.
removeLineContaining('features/wallet.feature.js', "'payments (finalise le paiement — payment-service.js markPaid, transactionnel, quand le debit wallet couvre integralement la commande ; invariant D-02, payment-service reste seul proprietaire de payment_status — O7.2 Cycle D)',");

console.log('Debt Zero: 16 Feature360 residual contracts reconciled');
