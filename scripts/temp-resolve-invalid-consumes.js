'use strict';
const fs = require('fs');
function read(f){return fs.readFileSync(f,'utf8');}
function write(f,c){fs.writeFileSync(f,c,'utf8');}
function replaceOnce(content, from, to, file) {
  const n = content.split(from).length - 1;
  if (n !== 1) throw new Error(`${file}: expected one match, got ${n}: ${from}`);
  return content.replace(from, to);
}

// infrastructure : vieux noms de routeurs -> features canoniques.
const infraFile='features/infrastructure.feature.js';
let infra=read(infraFile);
infra=replaceOnce(infra,
  "      'notification — bootstrap/api-routes.js monte les routes notification',",
  "      'notifications — bootstrap/api-routes.js monte les routes notification',", infraFile);
infra=replaceOnce(infra,
  "      'operations — bootstrap/api-routes.js monte les routes operations',",
  "      'platform-ops — bootstrap/api-routes.js monte les routes operations',", infraFile);
infra=replaceOnce(infra,
  "      'payment — bootstrap/api-routes.js monte les routes payment',",
  "      'payments — bootstrap/api-routes.js monte les routes payment',", infraFile);
write(infraFile,infra);

// orders : les canoniques notifications/payments existent déjà ; retirer les doublons singuliers.
const ordersFile='features/orders.feature.js';
let orders=read(ordersFile);
orders=replaceOnce(orders,"      'notification',\n",'',ordersFile);
orders=replaceOnce(orders,"      'payment',\n",'',ordersFile);
write(ordersFile,orders);

// purchasing : canonicaliser notification -> notifications.
const purchasingFile='features/purchasing.feature.js';
let purchasing=read(purchasingFile);
purchasing=replaceOnce(purchasing,
  "      'notification (notifyLoyaltyEarned-like : notification fournisseur WhatsApp, via services/notification-service.js)',",
  "      'notifications (notification fournisseur WhatsApp, via services/notification-service.js)',", purchasingFile);
write(purchasingFile,purchasing);

// shared-cart : products est la table ; la feature propriétaire est catalog.
const sharedFile='features/shared-cart.feature.js';
let shared=read(sharedFile);
shared=replaceOnce(shared,"      'products (lecture seule)',","      'catalog (lecture seule des produits)',",sharedFile);
shared=replaceOnce(shared,"      'notification (émission uniquement — WhatsApp création de liste)',","      'notifications (émission uniquement — WhatsApp création de liste)',",sharedFile);
write(sharedFile,shared);

// Ratchet : aucune INVALID_DECLARATION restante ; actionable resserré selon les
// dépendances que ces noms canoniques rendent enfin déclarées.
const baselineFile='governance/business-graph-drift-baseline.json';
const doc=JSON.parse(read(baselineFile));
doc._comment_invalid_consumes_20260817='Canonicalisation des 8 consumes invalides : notification→notifications, payment→payments, products→catalog, operations→platform-ops ; doublons orders supprimés. Baseline uniquement resserrée, jamais augmentée.';
doc.baseline['CONSUMES-REFERENCE-UNRESOLVED::INVALID_DECLARATION']=0;
doc.baseline['OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT']=67;
write(baselineFile,JSON.stringify(doc,null,4)+'\n');
