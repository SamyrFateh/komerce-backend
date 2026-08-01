'use strict';

const fs = require('fs');

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: attendu exactement 1 match, trouvé ${count}`);
  }
  return source.replace(before, after);
}

// 1) La table orders ne porte plus recipient_name : l'identité canonique
// affichée par le contrat de retrait vient de l'acheteur vérifié.
{
  const path = 'services/pickup-secret-service.js';
  let source = fs.readFileSync(path, 'utf8');

  const before = `      SELECT o.id, o.reference, o.relais_id, o.recipient_name, o.status,
             r.name AS relais_name,
             o.pickup_secret_hash, o.pickup_secret_salt, o.pickup_secret_last4,
             o.pickup_secret_expires_at, o.pickup_secret_attempts, o.pickup_secret_blocked_until
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id`;

  const after = `      SELECT o.id, o.reference, o.relais_id,
             u.full_name AS recipient_name,
             o.status,
             r.name AS relais_name,
             o.pickup_secret_hash, o.pickup_secret_salt, o.pickup_secret_last4,
             o.pickup_secret_expires_at, o.pickup_secret_attempts, o.pickup_secret_blocked_until
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id`;

  source = replaceOnce(
    source,
    before,
    after,
    'collectByPickupCode: source canonique du destinataire'
  );

  // PostgreSQL refuse un FOR UPDATE non qualifié lorsqu'une requête contient
  // un LEFT JOIN : seule la ligne orders porte l'invariant de concurrence.
  source = replaceOnce(
    source,
    "        AND o.status = 'available'\n      FOR UPDATE",
    "        AND o.status = 'available'\n      FOR UPDATE OF o",
    'collectByPickupCode: verrou limité à orders'
  );

  const exceptionalLockBefore = `      LEFT JOIN relais r ON r.id = o.relais_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      FOR UPDATE`;

  const exceptionalLockAfter = `      LEFT JOIN relais r ON r.id = o.relais_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      FOR UPDATE OF o`;

  source = replaceOnce(
    source,
    exceptionalLockBefore,
    exceptionalLockAfter,
    'collectByAuthorizedName: verrou limité à orders'
  );

  const oldAudit = '        description: `agent_id=${agentId} role=${role} attempts=${attempts}`,';
  const newAudit = '        description: `actor_id=${agentId} role=${role} order_id=${order.id} relais_id=${order.relais_id} method=AUTHORIZED_NAME_ID_CHECK authorization_version=${authorization.version} result=NAME_MISMATCH attempts=${attempts}`,';

  source = replaceOnce(
    source,
    oldAudit,
    newAudit,
    'audit mismatch nominatif'
  );

  fs.writeFileSync(path, source, 'utf8');
}

// 2) Les noms de contraintes ne sont pas globalement uniques entre schémas :
// la garde idempotente doit être bornée à public.scans.
{
  const path = 'migrations/121_exceptional_pickup_authorization.sql';
  let source = fs.readFileSync(path, 'utf8');

  source = replaceOnce(
    source,
    "    WHERE conname = 'chk_scans_pickup_method'",
    "    WHERE conname = 'chk_scans_pickup_method'\n      AND conrelid = 'public.scans'::regclass",
    'scope contrainte pickup_method'
  );

  source = replaceOnce(
    source,
    "    WHERE conname = 'chk_scans_exceptional_pickup_proof'",
    "    WHERE conname = 'chk_scans_exceptional_pickup_proof'\n      AND conrelid = 'public.scans'::regclass",
    'scope contrainte exceptional proof'
  );

  fs.writeFileSync(path, source, 'utf8');
}

// 3) createCleanup dépile en LIFO. order_status_history référence scans :
// l'historique doit donc être supprimé avant le scan lors du nettoyage.
{
  const path = 'tests/e2e-api/orders.pickup-code-vs-authorized-name.e2e.test.js';
  let source = fs.readFileSync(path, 'utf8');

  const before = `      cleanup.trackSql(
        'DELETE FROM order_status_history WHERE order_id = $1',
        [orderId]
      );

      cleanup.trackSql(
        'DELETE FROM scans WHERE order_id = $1',
        [orderId]
      );`;

  const after = `      cleanup.trackSql(
        'DELETE FROM scans WHERE order_id = $1',
        [orderId]
      );

      cleanup.trackSql(
        'DELETE FROM order_status_history WHERE order_id = $1',
        [orderId]
      );`;

  source = replaceOnce(source, before, after, 'ordre de nettoyage scan/historique');
  fs.writeFileSync(path, source, 'utf8');
}

// 4) La CSP Boutique interdit les scripts inline. Externaliser les deux
// scripts existants sans assouplir script-src ni changer leur ordre d'exécution.
{
  const indexPath = 'public/boutique/index.html';
  let index = fs.readFileSync(indexPath, 'utf8');
  const inlineServiceWorker = `<script>
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(function(regs){
    regs.forEach(function(r){r.update();});
  });

  navigator.serviceWorker.addEventListener('message', function(e){
    if(e.data && e.data.type === 'sw-updated'){
      /* Ne reload que si un SW contrôlait déjà la page au chargement (donc
         une vraie mise à jour) — jamais lors d'une première activation.
         Défensif : protège contre le même symptôme si register() est
         réintroduit un jour (aucun register() n'existe actuellement). */
      if (navigator.serviceWorker.controller) {
        console.log('[SW] Nouvelle version', e.data.version, '→ reload auto');
        location.reload();
      }
    }
  });

  if(window.caches){
    caches.keys().then(function(names){
      names.forEach(function(n){
        if(n.indexOf('komerce-v334') === -1) caches.delete(n);
      });
    });
  }
}
</script>`;

  index = replaceOnce(
    index,
    inlineServiceWorker,
    '<script src="/boutique/js/b-service-worker-refresh.js"></script>',
    'CSP index service worker'
  );
  fs.writeFileSync(indexPath, index, 'utf8');

  fs.writeFileSync('public/boutique/js/b-service-worker-refresh.js', `/**
 * @komerce-arch
 * @role          boutique-service-worker-refresh
 * @domain        boutique
 * @layer         ui-bootstrap
 * @criticality   medium
 * @inputs        navigator.serviceWorker, CacheStorage
 * @outputs       service-worker-update-check, stale-cache-cleanup
 * @depends       browser-service-worker-api, browser-cache-api
 * @used-by       public/boutique/index.html
 * @doctrine      csp_no_inline_script, mise_a_jour_sans_boucle
 * @impact-areas  boutique-bootstrap, cache, service-worker
 * @version       2026-08
 */
'use strict';
/* global navigator, caches, location */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    registrations.forEach(function (registration) {
      registration.update();
    });
  });

  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'sw-updated' && navigator.serviceWorker.controller) {
      console.log('[SW] Nouvelle version', event.data.version, '→ reload auto');
      location.reload();
    }
  });

  if (window.caches) {
    caches.keys().then(function (names) {
      names.forEach(function (name) {
        if (name.indexOf('komerce-v334') === -1) caches.delete(name);
      });
    });
  }
}
`, 'utf8');

  const redirectPath = 'public/boutique/test-modal-view-model.html';
  let redirect = fs.readFileSync(redirectPath, 'utf8');
  redirect = replaceOnce(
    redirect,
    `  <script>
    location.replace('/boutique/?tab=group');
  </script>`,
    '  <script src="/boutique/js/test-modal-view-model-redirect.js"></script>',
    'CSP test modal redirect'
  );
  fs.writeFileSync(redirectPath, redirect, 'utf8');

  fs.writeFileSync('public/boutique/js/test-modal-view-model-redirect.js', `/**
 * @komerce-arch
 * @role          boutique-test-modal-redirect
 * @domain        boutique
 * @layer         ui-bootstrap
 * @criticality   low
 * @inputs        legacy-test-modal-url
 * @outputs       canonical-group-view-redirect
 * @depends       browser-location-api
 * @used-by       public/boutique/test-modal-view-model.html
 * @doctrine      csp_no_inline_script, legacy_entry_redirect_only
 * @impact-areas  boutique-test-entry
 * @version       2026-08
 */
'use strict';
/* global location */

location.replace('/boutique/?tab=group');
`, 'utf8');
}

console.log('Lot 5 corrigé : identité acheteur, verrous orders, audit, contraintes, nettoyage E2E et CSP Boutique.');
