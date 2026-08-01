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
  // un LEFT JOIN : il tenterait aussi de verrouiller le côté nullable. Seule
  // la commande porte l'invariant de concurrence, donc on verrouille orders.
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

// 3) La migration 121 n'est pas encore dans le dump live Railway. Le mécanisme
// canonique du dépôt est une allowlist nominative temporaire, auto-élaguée dès
// que le dump post-déploiement contient la table.
{
  const path = 'scripts/arch-debt-budget.json';
  const budget = JSON.parse(fs.readFileSync(path, 'utf8'));
  const allowlist = budget.knownDriftAllowlist;

  if (!allowlist || typeof allowlist !== 'object') {
    throw new Error('knownDriftAllowlist absente du budget architecture');
  }

  allowlist.user_pickup_authorizations =
    'Lot 5 — table définie par migrations/121_exceptional_pickup_authorization.sql et utilisée par auth-identity avant rafraîchissement du dump live Railway. Entrée nominative temporaire, auto-élaguée par arch-reconcile dès que la migration 121 est déployée et le dump live actualisé.';

  fs.writeFileSync(path, JSON.stringify(budget, null, 2) + '\n', 'utf8');
}

console.log('Lot 5 finalisé : identité acheteur, verrous orders, contraintes bornées et drift pending documenté.');
